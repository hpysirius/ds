/**
 * 从 .xlsx 导入「定价表」到定价记录（纯 Node，不装任何依赖：xlsx 就是个 zip，
 * 用系统的 unzip 抽出 XML 再解析）。
 *
 * 为什么要做这个：用户希望系统里的「定价记录」包含他 Excel《9月定价表》里的所有数据 ——
 * 既要字段逐列对齐（含重量原文 300g、尺寸原文 18.5cm*7cm*17cm、A 列标记），
 * 也要把历史行导进来。
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

export interface ExcelImportRow {
  row: number;
  excelRef: string;
  mark?: string | null;
  sellPrice?: number | null;
  purchaseCost?: number | null;
  shippingFee?: number | null;
  labelFee?: number | null;
  commissionRate?: number | null;
  agentRate?: number | null;
  withdrawRate?: number | null;
  netProfit?: number | null;
  grossProfit?: number | null;
  profitRate?: number | null;
  freightProfitRatio?: number | null;
  markup35?: number | null;
  logistics?: string | null;
  weightText?: string | null;
  weightKg?: number | null;
  sizeText?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  remark?: string | null;
  sku?: string | null;
  supplyUrl?: string | null;
  offer1688Title?: string | null;
  retailUrl?: string | null;
}

/** 用 unzip 从 xlsx 里读一个成员文件的文本 */
function readZipEntry(file: string, entry: string): string {
  try {
    return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  } catch (e: any) {
    throw new Error(`读取 ${entry} 失败：${e.message}`);
  }
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** 解析 sharedStrings.xml → 字符串数组 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const itemRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const parts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1]));
    out.push(parts.join(''));
  }
  return out;
}

/** 列名 A1 → {col: 'A', row: 1} */
function splitRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

/** 工作表名 → 对应 XML 路径 */
function resolveSheetPath(file: string, sheetName: string): { path: string; name: string } {
  const wb = readZipEntry(file, 'xl/workbook.xml');
  const rels = readZipEntry(file, 'xl/_rels/workbook.xml.rels');
  const sheets = [...wb.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => m[0]);
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) relMap.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const list = sheets.map((tag) => ({
    name: unescapeXml(/name="([^"]*)"/.exec(tag)?.[1] || ''),
    rid: /r:id="([^"]+)"/.exec(tag)?.[1] || '',
  }));
  const hit = sheetName ? list.find((s) => s.name.trim() === sheetName.trim()) || list[0] : list[0];
  if (!hit) throw new Error('工作簿里没有工作表');
  const target = relMap.get(hit.rid) || 'worksheets/sheet1.xml';
  return { path: `xl/${target}`, name: hit.name };
}

/** 读一张表 → Map<行号, {列: 值}>（值已按类型转换为 string | number） */
function readSheet(
  file: string,
  sheetName: string,
): { sheetName: string; rows: Map<number, Record<string, string | number>>; maxRow: number } {
  const { path: sheetPath, name } = resolveSheetPath(file, sheetName);
  const shared = parseSharedStrings(readZipEntry(file, 'xl/sharedStrings.xml'));
  const xml = readZipEntry(file, sheetPath);
  const rows = new Map<number, Record<string, string | number>>();
  let maxRow = 0;

  for (const rowM of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(rowM[1]);
    const cells: Record<string, string | number> = {};
    /*
     * 注意：空单元格是自闭合的（<c r="P3" s="253"/>）。
     * 如果只用 /<c([^>]*)\/?>([\s\S]*?)<\/c>/ 去匹配，自闭合标签会一路吞到下一个 </c>，
     * 导致后面的单元格整体错位（踩过：sizeText 读到了 Q 列的值）。
     */
    for (const cellM of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellM[1];
      const body = cellM[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const col = splitRef(ref)!.col;
      let value: string | number = '';
      if (type === 's') {
        const idx = Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? -1);
        value = shared[idx] ?? '';
      } else if (type === 'inlineStr') {
        value = unescapeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw == null) continue;
        const n = Number(raw);
        value = Number.isFinite(n) ? n : unescapeXml(raw);
      }
      if (value !== '' && value != null) cells[col] = value;
    }
    if (Object.keys(cells).length) {
      rows.set(rowNo, cells);
      maxRow = Math.max(maxRow, rowNo);
    }
  }
  return { sheetName: name, rows, maxRow };
}

/** 「300g」「10.5kg」「120」→ 千克 */
export function parseWeightKg(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v / 1000; // 原表裸数字都是克
  const s = String(v).trim().toLowerCase();
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(kg|g|克|千克)?/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'kg' || m[2] === '千克') return n;
  return n / 1000; // 默认按克
}

/** 「18.5cm * 7cm * 17cm」「40*30*11」「14×12×11.5」→ 三边（cm） */
export function parseSizeCm(v: unknown): { lengthCm: number | null; widthCm: number | null; heightCm: number | null } {
  const empty = { lengthCm: null, widthCm: null, heightCm: null };
  if (v == null || v === '') return empty;
  const nums = String(v)
    .replace(/[（(].*?[)）]/g, ' ')
    .match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!nums || nums.length < 3) return empty;
  const [a, b, c] = nums.slice(0, 3).map(Number);
  return { lengthCm: a, widthCm: b, heightCm: c };
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').replace(/[¥￥%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const toStr = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
};

/** 汇率/百分比列：表里可能是 0.12 也可能是 12 */
const toRate = (v: unknown): number | null => {
  const n = toNum(v);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
};

/**
 * 把「定价表」转成定价记录数组。
 * 列对应（第 2 行是表头）：A 序号/标记、B 加35%、C 定价、D 采购成本、E 国际运费、F 贴单费、
 * G 平台佣金、H 代理佣金、I 提现费率、J 净利润、K 毛利润、L 利润率、M 运费利润比、
 * N 物流方式、O 重量、P 尺寸、Q 产品备注、R 跟卖链接(SKU)、S 货源链接、T 跟卖链接(URL)
 */
export function parsePricingSheet(file: string, sheetName = '定价表'): ExcelImportRow[] {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
  const { sheetName: actual, rows } = readSheet(file, sheetName);
  const out: ExcelImportRow[] = [];
  const rowNos = [...rows.keys()].sort((a, b) => a - b);
  for (const rowNo of rowNos) {
    if (rowNo <= 2) continue; // 1 行标题、2 行表头
    const c = rows.get(rowNo)!;
    const sellPrice = toNum(c.C);
    const purchaseCost = toNum(c.D);
    // 空行 / 说明行跳过：既没定价也没成本
    if (sellPrice == null && purchaseCost == null) continue;

    const sizeText = toStr(c.P);
    const dims = parseSizeCm(sizeText);
    const weightText = toStr(c.O);
    const q = toStr(c.Q);
    const sCol = toStr(c.S);
    const sku = toStr(c.R);
    const tUrl = toStr(c.T);
    const isUrl = (x: string | null) => !!x && /^https?:\/\//i.test(x);

    out.push({
      row: rowNo,
      excelRef: `${actual}!${rowNo}`,
      mark: toStr(c.A),
      sellPrice,
      purchaseCost,
      shippingFee: toNum(c.E),
      labelFee: toNum(c.F),
      commissionRate: toRate(c.G),
      agentRate: toRate(c.H),
      withdrawRate: toRate(c.I),
      netProfit: toNum(c.J),
      grossProfit: toNum(c.K),
      profitRate: toNum(c.L),
      freightProfitRatio: toNum(c.M),
      markup35: toNum(c.B),
      logistics: toStr(c.N),
      weightText,
      weightKg: parseWeightKg(c.O),
      sizeText,
      ...dims,
      remark: q,
      sku,
      supplyUrl: isUrl(sCol) ? sCol : null,
      offer1688Title: isUrl(sCol) ? null : sCol,
      retailUrl: isUrl(tUrl) ? tUrl : sku ? `https://www.ozon.ru/product/${sku}/` : null,
    });
  }
  return out;
}
