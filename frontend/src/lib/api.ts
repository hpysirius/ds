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
