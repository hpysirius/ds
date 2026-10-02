import axios from 'axios';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3101';

export const http = axios.create({ baseURL: API_BASE, timeout: 120000 });

http.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('ds_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    // 登录态失效（token 过期/无效）：清掉本地登录态并跳登录页
    if (status === 401 && typeof window !== 'undefined' && localStorage.getItem('ds_token')) {
      localStorage.removeItem('ds_token');
      localStorage.removeItem('ds_user');
      window.location.href = '/login';
      return Promise.reject(err);
    }
    const msg = err?.response?.data?.message || err.message || '请求失败';
    const e: any = new Error(Array.isArray(msg) ? msg[0] : msg);
    e.response = err?.response; // 保留状态码，便于页面区分"未登录"等场景
    return Promise.reject(e);
  },
);

/**
 * 1688 抓取的「本机回退通道」。
 *
 * 背景：线上服务部署在云服务器上，机房 IP 段被 1688 判定为风险来源，
 * 抓详情页会返回 x5secdata 滑块页（换 UA / 换请求头都没用，是 IP 信誉层面的拦截）。
 * 而用户本机的出口是家庭宽带，抓同一个页面一直正常。
 * 所以：线上页面里抓 1688 失败时，直接请求用户本机的后端（127.0.0.1:3101）再来一次。
 * 这些接口都是 @Public，不需要登录态；本机后端需在 .env 里放行线上 origin（见 PUBLIC_SITE_URL）。
 */
export const LOCAL_API = 'http://127.0.0.1:3101';

let localApiOk: boolean | null = null;
/** 探测本机后端是否在跑（结果缓存，避免每次都等超时） */
export async function probeLocalApi(force = false): Promise<boolean> {
  if (localApiOk !== null && !force) return localApiOk;
  try {
    await axios.get(`${LOCAL_API}/pricing/meta`, { timeout: 2500 });
    localApiOk = true;
  } catch (e) {
    localApiOk = false;
  }
  return localApiOk;
}

const isLocalBase = (base: string) => /localhost|127\.0\.0\.1/.test(base);

/**
 * 调 1688 相关接口：先走当前后端，命中风控（ALI_RISK）且当前用的是线上后端时，
 * 自动回退到用户本机后端再试一次。
 */
export async function postSourcing<T = any>(
  path: string,
  body: any,
  timeout = 40000,
): Promise<{ data: T; via: 'server' | 'local' }> {
  try {
    const r = await http.post<T>(path, body, { timeout });
    return { data: r.data, via: 'server' };
  } catch (e: any) {
    const code = e?.response?.data?.code;
    const isRisk = code === 'ALI_RISK' || /风控|滑块/.test(String(e?.message || ''));
    if (isRisk && !isLocalBase(API_BASE) && (await probeLocalApi())) {
      const r2 = await axios.post<T>(`${LOCAL_API}${path}`, body, { timeout: timeout + 20000 });
      return { data: r2.data, via: 'local' };
    }
    throw e;
  }
}

/**
 * 带登录态下载文件（导出 CSV 用）。
 *
 * 后端 JWT 只认 `Authorization: Bearer` 头，所以用 `<a href="...">` 或 `window.open(...)`
 * 直接打开导出接口是**顶层导航，不会带这个头**，必然 401。
 * 因此统一走 http（请求拦截器会自动补 token），拿到 blob 后在前端触发下载。
 *
 * @param path 接口路径（相对 baseURL）
 * @param fallbackName 服务端没给 Content-Disposition 时使用的文件名
 * @param params 可选的 query 参数
 */
export async function downloadFile(
  path: string,
  fallbackName = 'export.csv',
  params?: Record<string, any>,
): Promise<void> {
  const res = await http.get<Blob>(path, { responseType: 'blob', params });
  const blob = res.data;

  // 后端报错时若仍返回 200，body 会是 JSON 而不是 CSV —— 转成文本取出 message 再抛出去，
  // 否则用户会下载到一个名为 .csv 的报错 JSON 文件
  if (blob && blob.type && !/csv|text|octet-stream|excel/i.test(blob.type)) {
    let msg = '导出失败';
    try {
      msg = JSON.parse(await blob.text())?.message || msg;
    } catch {
      /* body 不是 JSON，用默认文案 */
    }
    throw new Error(msg);
  }

  const name = fileNameFromDisposition(res.headers?.['content-disposition']) || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 从 `attachment; filename="pricing.csv"` 里取出文件名 */
function fileNameFromDisposition(header?: string): string | null {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * 商品图统一走同源代理。
 *
 * Ozon（ir-*.ozonstatic.cn / *.ozone.ru）的图带防盗链，直接在 <img src> 里用原地址
 * 会 403 → 列表里只显示裂图，所以必须经后端 `pricing/sourcing/image-proxy` 转一手。
 * 所有展示商品图的地方都用这个函数，别再直接写 <img src={imageUrl}>。
 *
 * @param u 原始图片地址（支持 `//host/x.jpg` 这种协议相对写法）
 * @returns 可直接放进 img src 的地址；地址为空/非法时返回 ''
 */
export function proxyImageUrl(u?: string | null): string {
  if (!u) return '';
  const abs = u.startsWith('//') ? `https:${u}` : u;
  if (!/^https?:\/\//i.test(abs)) return '';
  return `${API_BASE}/pricing/sourcing/image-proxy?url=${encodeURIComponent(abs)}`;
}

export interface RuleSet {
  salesMin: number;
  salesMax: number;
  sweetMin: number;
  sweetMax: number;
  allowNewbie: boolean;
  newbieMaxDays: number;
  allowOrganic: boolean;
  organicMinSales: number;
  cartHardMin: number;
  cartGood: number;
  cartGreat: number;
  returnMax: number;
  reviewsMax: number;
  daysMax: number;
  daysPreferredMin: number;
  daysPreferredMax: number;
  allowAds: boolean;
  adMax: number;
  requireNoBrand: boolean;
  requireFbs: boolean;
  scoreFollow: number;
  scoreWatch: number;
  scoreObserve: number;
}

export const GRADE_TEXT = ['淘汰', '优先跟进', '可跟进', '观察'];
export const GRADE_COLOR = ['red', 'green', 'blue', 'orange'];

export const PRESETS = [
  {
    name: '中国商品 · 新品榜',
    url: 'https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=14793&sorting=new',
  },
  {
    name: '中国商品 · 全部',
    url: 'https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=14793',
  },
  {
    name: '中国商品 · 价格升序',
    url: 'https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/?category=14793&sorting=price',
  },
];
