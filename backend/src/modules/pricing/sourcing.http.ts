/**
 * 1688 纯 HTTP 抓取（不依赖浏览器）
 *
 * 实测结论（2026-09）：
 *  - 货品详情页 detail.1688.com/offer/<id>.html 是 SSR，**匿名可抓**，0.6 秒返回，
 *    内联 JSON 里有 "priceDisplay":"18.80" 和 pieceWeightScaleInfo（每个 SKU 的长宽高重量）
 *  - 搜索页 s.1688.com 是空壳 SPA，抓不到东西；而移动端 m.1688.com/offer_search/... 是 SSR，
 *    一次返回 20 张卡片（图/标题/价格/成交/城市），**但需要 1688 登录态 cookie**，
 *    否则会 302 到 login.1688.com
 *  - Ozon 商品页对服务端请求返回 307，所以 Ozon 主图仍走浏览器读一次（或用户手填）
 *
 * cookie 从「浏览器接管」的调试 Chrome 里同步一次存库，之后这里全程纯 HTTP。
 */

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface Fetched {
  status: number;
  body: string;
  finalUrl: string;
  needsLogin: boolean;
  /** 命中 1688 风控（滑块惩罚页） */
  punished: boolean;
}

/** 1688 请求节流：同一个出口 IP 短时间被打太密会触发滑块风控（实测过），所以串行 + 最小间隔 */
let lastReqAt = 0;
const MIN_INTERVAL_MS = 1500;
let queue: Promise<any> = Promise.resolve();

/** 命中风控后的冷却时间：这段时间内不再打搜索接口，避免越撞越黑 */
let punishUntil = 0;
export const isPunished = () => Date.now() < punishUntil;
export const punishLeftMs = () => Math.max(0, punishUntil - Date.now());
export const markPunished = (ms = 3 * 60 * 1000) => {
  punishUntil = Date.now() + ms;
};

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastReqAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReqAt = Date.now();
    return fn();
  });
  // 队列不因单次失败而中断
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

/** 带超时的 HTTP GET，自动识别「被踢到登录页 / 命中风控」 */
export async function httpGet(
  url: string,
  opts: { cookie?: string | null; mobile?: boolean; timeoutMs?: number; referer?: string; throttle?: boolean } = {},
): Promise<Fetched> {
  const doFetch = async (): Promise<Fetched> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12000);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctl.signal,
        headers: {
          'User-Agent': opts.mobile ? MOBILE_UA : DESKTOP_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: opts.referer || 'https://www.1688.com/',
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
      });
      const body = await res.text();
      const finalUrl = res.url || url;
      const punished = /_____tmd_____|x5secdata|punish\?/.test(body.slice(0, 1200)) || /_____tmd_____/.test(finalUrl);
      const needsLogin =
        !punished &&
        (/login\.1688\.com|login\.taobao\.com/.test(finalUrl) || /请先登录|会员登录/.test(body.slice(0, 3000)));
      return { status: res.status, body, finalUrl, needsLogin, punished };
    } finally {
      clearTimeout(timer);
    }
  };
  return opts.throttle === false ? doFetch() : throttle(doFetch);
}

/** 简单 TTL 缓存：同样的关键词/货品在短时间内不重复打 1688（防风控 + 提速） */
const cache = new Map<string, { at: number; val: any }>();
export function cacheGet<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.val as T;
}
export function cacheSet(key: string, val: any) {
  cache.set(key, { at: Date.now(), val });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    oldest.forEach(([k]) => cache.delete(k));
  }
}

export interface SearchItem {
  offerId: string;
  title: string;
  price: number | null;
  priceText: string | null;
  imageUrl: string | null;
  offerUrl: string;
  shop: string | null;
  salesText: string | null;
  repurchase: string | null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 解析 m.1688.com 搜索结果页的 SSR 卡片 */
export function parseSearchCards(html: string): SearchItem[] {
  const out: SearchItem[] = [];
  const blocks = html.split('data-offer-id="').slice(1);
  for (const b of blocks) {
    const idMatch = b.match(/^(\d{8,})/);
    if (!idMatch) continue;
    const offerId = idMatch[1];
    const img = b.match(/data-src="([^"]+)"/);
    let text = stripTags(b);
    text = text.replace(/^\d+"[^>]*>\s*/, '');
    // 标题：截到「广告 / 复购率 / 成交 / ￥」这些标记之前
    const cut = text.search(/(广告|复购率|成交|￥|¥)/);
    const title = (cut > 0 ? text.slice(0, cut) : text.slice(0, 80)).trim();
    const priceM = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/);
    const salesM = text.match(/成交([0-9+]+\s*笔)/);
    const repM = text.match(/复购率[:：]\s*([0-9.]+%)/);
    // 城市一般出现在成交之后
    const cityM = text.match(/(成交[0-9+]+笔|\d+年|深度验商|实力商家)\s+([\u4e00-\u9fa5]{2,8}市)/);
    out.push({
      offerId,
      title,
      price: priceM ? parseFloat(priceM[1]) : null,
      priceText: priceM ? `¥${priceM[1]}` : null,
      imageUrl: img ? img[1].replace(/^\/\//, 'https://') : null,
      offerUrl: `https://detail.1688.com/offer/${offerId}.html`,
      shop: cityM ? cityM[2] : null,
      salesText: salesM ? salesM[1] : null,
      repurchase: repM ? repM[1] : null,
    });
  }
  return out;
}

export interface OfferDetail {
  offerId: string;
  title: string;
  price: number | null;
  priceMax: number | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  volumeCm3: number | null;
  packSkuCount: number;
  packSkuName: string | null;
  minOrderQuantity: number | null;
  companyName: string | null;
  fromPackInfo: boolean;
  /** 另需运费（freightInfo.totalCost，随买家收货地址/规格变） */
  freightYuan: number | null;
  /** 全部可选规格（名称/价格/重量/尺寸），供前端挑规格后填成本与包裹 */
  skus: OfferSku[];
  warnings: string[];
}

/** 从括号配对的 JSON 片段里按 "key" 切出完整对象/数组（比正则更稳，能正确处理字符串里的括号） */
function sliceBalancedJson(html: string, key: string): string | null {
  for (const s of sliceAllBalancedJson(html, key)) return s;
  return null;
}

/**
 * 同名 key 在页面里可能出现多次（比如先出现 "skuWeight":{"$ref":…} 占位、
 * 后面才是真实数据），所以返回全部匹配，调用方逐个试。
 */
function* sliceAllBalancedJson(html: string, key: string): Generator<string> {
  let from = 0;
  const needle = `"${key}"`;
  while (true) {
    const keyIdx = html.indexOf(needle, from);
    if (keyIdx < 0) return;
    from = keyIdx + needle.length;
    // 跳过 key 后的引号与冒号，找到第一个 { 或 [
    let i = from;
    while (i < html.length && !'{['.includes(html[i])) i++;
    if (i >= html.length) return;
    const open = html[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < html.length && j < i + 500000; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end > 0) yield html.slice(i, end);
  }
}

/** 从括号配对的数组片段里切出完整数组 */
function sliceBalancedArray(html: string, key: string): string | null {
  const s = sliceBalancedJson(html, key);
  return s && s.startsWith('[') ? s : null;
}

/** 从规格名里抠尺寸：「2合1款双片装（17*7*3）」→ 17/7/3（兼容 × x X 与全角括号） */
export function parseDimsFromName(name: string): { l: number; w: number; h: number } | null {
  const m = String(name || '').match(
    /(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)/,
  );
  if (!m) return null;
  const dims = [m[1], m[2], m[3]].map((x) => parseFloat(x));
  // 尺寸要像话：0 < n <= 200cm
  if (dims.some((n) => !(n > 0 && n <= 200))) return null;
  // 按长≥宽≥高排好（规格名里的写法不保证有序，物流计费也按最长边算）
  dims.sort((a, b) => b - a);
  return { l: dims[0], w: dims[1], h: dims[2] };
}

/** 货品页里的单个可选规格（SKU） */
export interface OfferSku {
  skuId: string;
  name: string;
  price: number | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  stock: number | null;
}

/** 解析 detail.1688.com 货品页（SSR 内联 JSON） */
export function parseOfferHtml(html: string, offerId: string): OfferDetail {
  const warnings: string[] = [];
  const titleM =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<title>([^<]*)<\/title>/i);
  const title = (titleM ? titleM[1] : '').replace(/\s*-\s*阿里巴巴.*$/, '').trim().slice(0, 300);

  const prices: number[] = [];
  const push = (re: RegExp) => {
    for (const m of html.matchAll(re)) {
      const n = parseFloat(m[1]);
      if (n > 0 && n < 1000000) prices.push(n);
    }
  };
  push(/"priceDisplay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)"/g);
  if (!prices.length) push(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/g);
  const uniq = [...new Set(prices)].sort((a, b) => a - b);

  let weightG: number | null = null;
  let lengthCm: number | null = null;
  let widthCm: number | null = null;
  let heightCm: number | null = null;
  let volumeCm3: number | null = null;
  let packSkuCount = 0;
  let packSkuName: string | null = null;
  let fromPackInfo = false;

  const arrStr = sliceBalancedArray(html, 'pieceWeightScaleInfo');
  if (arrStr) {
    try {
      const arr = JSON.parse(arrStr);
      if (Array.isArray(arr) && arr.length) {
        packSkuCount = arr.length;
        // 多 SKU 时：优先取「长宽高齐全」的那条拿尺寸，重量单独找第一条有的
        const dimItem = arr.find(
          (x: any) => Number(x?.length) && Number(x?.width) && Number(x?.height),
        );
        const wtItem = arr.find((x: any) => Number(x?.weight));
        lengthCm = Number(dimItem?.length) || null;
        widthCm = Number(dimItem?.width) || null;
        heightCm = Number(dimItem?.height) || null;
        weightG = Number(wtItem?.weight) || Number(dimItem?.weight) || null;
        volumeCm3 = Number(dimItem?.volume) || null;
        packSkuName = (wtItem?.sku1 || dimItem?.sku1 || wtItem?.skuName || '') || null;
        fromPackInfo = !!(lengthCm || weightG);
      }
    } catch (e) {
      warnings.push('包装信息 JSON 解析失败');
    }
  }

  /*
   * 规格列表（skuMap）：每个规格的名称/价格/库存，再和 pieceWeightScaleInfo、skuWeight 按 skuId 合并。
   * 实测结构（detail.1688.com 内联 JSON）：
   *   "skuMap":[{"canBookCount":3551,"price":"1.85","skuId":6049710163339,"specAttrs":"单片装普通款（17*7*3）"},…]
   *   "skuWeight":{"6049710163340":0.0750,…}   ← kg，注意单位
   * 规格名里通常带真实尺寸（17*7*3），比包装外箱尺寸（24*19*7）更贴近计费重 —— 物流按这个填。
   */
  const skus: OfferSku[] = [];
  const weightBySkuId = new Map<string, number>();
  const packBySkuId = new Map<string, any>();
  {
    // skuWeight 在页面里可能先出现 {"$ref":…} 占位、后面才是真实数据，所以遍历所有出现位置
    for (const swStr of sliceAllBalancedJson(html, 'skuWeight')) {
      try {
        const sw = JSON.parse(swStr);
        for (const [k, v] of Object.entries(sw || {})) {
          const kg = Number(v);
          if (kg > 0) weightBySkuId.set(String(k), Math.round(kg * 1000)); // kg → g
        }
      } catch (e) {
        /* skuWeight 偶尔是非标准 JSON（无引号 key），解析失败就走别的来源 */
      }
    }
    if (arrStr) {
      try {
        for (const x of JSON.parse(arrStr) || []) {
          if (x?.skuId != null) packBySkuId.set(String(x.skuId), x);
        }
      } catch (e) {
        /* ignore */
      }
    }
    const seenIds = new Set(skus.map((s) => s.skuId));
    /*
     * 规格列表在两种页面变体里的位置和形态都不同（实测）：
     *  - 富含版：  "skuMap":[{specAttrs,price,skuId,…},…]（数组、带价格）
     *  - 精简版：  "skuMap":[{…无 price…}]，带价格的是 "skuMapOriginal":[…] / "skuInfoMap":{规格名:{…}}
     * 所以三个 key 都试，数组/对象两种形态都兼容，按 skuId 去重合并。
     */
    for (const key of ['skuMap', 'skuMapOriginal', 'skuInfoMap']) {
      for (const seg of sliceAllBalancedJson(html, key)) {
        let arr: any[] = [];
        try {
          const parsed = JSON.parse(seg);
          if (Array.isArray(parsed)) arr = parsed;
          else if (parsed && typeof parsed === 'object') arr = Object.values(parsed);
        } catch (e) {
          continue;
        }
        for (const s of arr) {
          const name = String(s?.specAttrs || s?.skuName || s?.name || '').trim();
          if (!name) continue;
          const skuId = String(s?.skuId ?? '');
          if (!skuId || seenIds.has(skuId)) continue;
          const priceN = s?.discountPrice != null ? Number(s.discountPrice) : s?.price != null ? Number(s.price) : NaN;
          if (!Number.isFinite(priceN) || priceN <= 0) continue; // 无价格的残缺条目跳过
          seenIds.add(skuId);
          const pack = packBySkuId.get(skuId);
          const nameDims = parseDimsFromName(name);
          skus.push({
            skuId,
            name: name.slice(0, 120),
            price: priceN,
            weightG:
              weightBySkuId.get(skuId) ??
              (Number(pack?.weight) > 0 ? Number(pack.weight) : null),
            // 尺寸：规格名里的最可信，其次包装信息里的 length/width/height
            lengthCm: nameDims?.l ?? (Number(pack?.length) > 0 ? Number(pack.length) : null),
            widthCm: nameDims?.w ?? (Number(pack?.width) > 0 ? Number(pack.width) : null),
            heightCm: nameDims?.h ?? (Number(pack?.height) > 0 ? Number(pack.height) : null),
            stock: s?.canBookCount != null ? Number(s.canBookCount) : null,
          });
        }
      }
    }
  }

  /*
   * 另需运费：1688 下单时在商品金额之外单独收（freightInfo.totalCost，元）。
   * 实测页面里 shippingServices.freightInfo.totalCost = 5.5（随收货地址/规格变），取第一个即可。
   */
  let freightYuan: number | null = null;
  const freightM = html.match(/"totalCost"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  if (freightM) {
    const f = parseFloat(freightM[1]);
    if (f >= 0 && f < 100000) freightYuan = f;
  }

  /*
   * 默认尺寸/重量取「规格名里带尺寸」的 SKU：规格名尺寸（17*7*3）是产品实际尺寸，
   * 比包装外箱尺寸（24*19*7）对物流计费更准；没有规格列表时退回包装信息。
   */
  const skuWithDims = skus.find((s) => s.lengthCm && s.widthCm && s.heightCm);
  if (skuWithDims) {
    lengthCm = skuWithDims.lengthCm;
    widthCm = skuWithDims.widthCm;
    heightCm = skuWithDims.heightCm;
    if (skuWithDims.weightG) weightG = skuWithDims.weightG;
    packSkuName = skuWithDims.name;
    fromPackInfo = true;
  }

  const minOrderM = html.match(/"minOrderQuantity"\s*:\s*"?([0-9]+)/);
  const companyM =
    html.match(/"companyName"\s*:\s*"([^"]+)"/) || html.match(/<meta[^>]+name="description"[^>]+content="([^"]{4,60})"/);

  if (!uniq.length && !skus.length) warnings.push('未能读取价格');
  if (!fromPackInfo) warnings.push('未能在页面里找到「商品件重尺」（长宽高/重量）');

  // 价格区间：页面 priceDisplay（可能是单值）与规格价合并取完整低-高区间
  const skuPrices = skus.map((s) => s.price).filter((p): p is number => p != null);
  const allPrices = [...new Set([...uniq, ...skuPrices])].sort((a, b) => a - b);

  return {
    offerId,
    title,
    price: allPrices.length ? allPrices[0] : null,
    priceMax: allPrices.length ? allPrices[allPrices.length - 1] : null,
    weightG,
    lengthCm,
    widthCm,
    heightCm,
    volumeCm3,
    packSkuCount,
    packSkuName,
    minOrderQuantity: minOrderM ? Number(minOrderM[1]) : null,
    companyName: companyM ? decode(companyM[1]).trim() : null,
    fromPackInfo,
    freightYuan,
    skus,
    warnings,
  };
}
