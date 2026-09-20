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
  warnings: string[];
}

/** 从 pieceWeightScaleInfo 里按括号配对切出完整数组（比正则更稳） */
function sliceBalancedArray(html: string, key: string): string | null {
  const keyIdx = html.indexOf(key);
  if (keyIdx < 0) return null;
  const start = html.indexOf('[', keyIdx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < html.length && i < start + 200000; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
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

  const minOrderM = html.match(/"minOrderQuantity"\s*:\s*"?([0-9]+)/);
  const companyM =
    html.match(/"companyName"\s*:\s*"([^"]+)"/) || html.match(/<meta[^>]+name="description"[^>]+content="([^"]{4,60})"/);

  if (!uniq.length) warnings.push('未能读取价格');
  if (!fromPackInfo) warnings.push('未能在页面里找到「商品件重尺」（长宽高/重量）');

  return {
    offerId,
    title,
    price: uniq.length ? uniq[0] : null,
    priceMax: uniq.length ? uniq[uniq.length - 1] : null,
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
    warnings,
  };
}
