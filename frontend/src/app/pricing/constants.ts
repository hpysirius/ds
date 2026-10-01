// 定价模块共享常量与格式化 helpers（定价工作台 / 定价记录 / 参数设置 共用）
export const COUNTRIES = [
  { value: 'RU', label: '俄罗斯' },
  { value: 'BY', label: '白俄罗斯' },
  { value: 'KZ', label: '哈萨克斯坦' },
  { value: 'KG', label: '吉尔吉斯斯坦' },
];
export const VENDORS = [
  { value: 'GUOO', label: 'GUOO（黑河国欧）' },
  { value: 'XY', label: '兴远国际 XY' },
];
export const CATEGORIES = ['Extra Small', 'Budget', 'Small', 'Big', 'Premium Small', 'Premium Big'];

export const pct = (v: any) => `${((Number(v) || 0) * 100).toFixed(2)}%`;
export const money = (v: any, d = 2) => (Number(v) || 0).toFixed(d);
export const countryLabel = (v: string) => COUNTRIES.find((c) => c.value === v)?.label || v || '-';
export const vendorLabel = (v: string) => (v === 'GUOO' ? 'GUOO' : v === 'XY' ? '兴远 XY' : v || '-');
