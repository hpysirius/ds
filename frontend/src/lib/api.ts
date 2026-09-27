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
