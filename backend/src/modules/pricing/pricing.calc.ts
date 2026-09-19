/**
 * 核价计算引擎（纯函数，不依赖 Nest / Prisma）
 *
 * 全部公式照搬《定价表模版最新.xlsx》：
 *   毛利润   = 定价 − 采购成本 − 国际运费 − 贴单费 − 定价×平台佣金 − 定价×Ozon代理佣金
 *   净利润   = 毛利润 − (采购成本 + 毛利润) × 提现费率
 *   利润率   = 净利润 / 采购成本
 *   运费利润比 = 净利润 / 国际运费
 *   加 35%   = 定价 / 0.65
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
/** 向上取整到 2 位（对应 Excel 的 ROUNDUP(x,2)） */
export const roundUp2 = (n: number) => Math.ceil(n * 100 - Number.EPSILON) / 100;

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

export const CATEGORIES = [
  'Extra Small',
  'Budget',
  'Small',
  'Big',
  'Premium Small',
  'Premium Big',
];

export const CATEGORY_LABEL: Record<string, string> = {
  'Extra Small': '超级轻小件',
  Budget: '低客单轻小件',
  Small: '轻小件',
  Big: '大件',
  'Premium Small': '高客单轻小件',
  'Premium Big': '高客单大件',
};

export const countryLabel = (v: string) => COUNTRIES.find((c) => c.value === v)?.label || v;
export const vendorLabel = (v: string) => VENDORS.find((c) => c.value === v)?.label || v;

/** 渠道（数值字段已转成 number） */
export interface ChannelLike {
  id?: number;
  country: string;
  vendor: string;
  category: string;
  name: string;
  shipMode?: string | null;
  delivery?: string | null;
  pricePerKg: number;
  pricePerOrder: number;
  priceText?: string | null;
  minWeightKg: number;
  maxWeightKg: number;
  minValueRub: number;
  maxValueRub: number;
  maxSumCm: number;
  maxSideLongCm: number;
  maxSideShortCm: number;
  volumetric: boolean;
  divisor: number;
  roundUp: boolean;
  etaDays?: string | null;
  battery?: string | null;
  note?: string | null;
  enabled?: boolean;
  sort?: number;
}

export interface QuoteInput {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  valueRub: number;
  /** 手填运费，传了就不再按渠道算 */
  manualFee?: number | null;
}

export interface QuoteResult {
  ok: boolean;
  reason?: string;
  billWeightKg: number;
  volumetricWeightKg: number;
  shippingFee: number;
}

/** 体积重（抛重） */
export function volumetricWeight(lengthCm: number, widthCm: number, heightCm: number, divisor = 12000) {
  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0 || divisor <= 0) return 0;
  return (lengthCm * widthCm * heightCm) / divisor;
}

/** 计费重量：计抛渠道取 max(实重, 体积重)，否则取实重 */
export function billWeight(input: QuoteInput, channel: ChannelLike) {
  const actual = Math.max(0, input.weightKg);
  const vol = volumetricWeight(input.lengthCm, input.widthCm, input.heightCm, channel.divisor);
  const used = channel.volumetric ? Math.max(actual, vol) : actual;
  return { bill: r4(used), vol: r4(vol) };
}

/** 渠道可用性校验，返回不可用原因（可用则返回 null） */
export function checkChannel(input: QuoteInput, channel: ChannelLike): string | null {
  const w = Math.max(0, input.weightKg);
  const sides = [input.lengthCm || 0, input.widthCm || 0, input.heightCm || 0].sort((a, b) => b - a);

  if (w <= 0) return '请填写重量';
  if (w < channel.minWeightKg) return `重量低于渠道下限 ${channel.minWeightKg}kg`;
  if (w > channel.maxWeightKg) return `重量超出渠道上限 ${channel.maxWeightKg}kg`;

  if (channel.minValueRub > 0 && input.valueRub < channel.minValueRub)
    return `货值低于渠道下限 ${channel.minValueRub}₽`;
  if (channel.maxValueRub > 0 && input.valueRub > channel.maxValueRub)
    return `货值超出渠道上限 ${channel.maxValueRub}₽`;

  const sum = sides[0] + sides[1] + sides[2];
  if (sum > channel.maxSumCm) return `三边之和超长（上限 ${channel.maxSumCm}cm）`;
  if (sides[0] > channel.maxSideLongCm) return `最长边超长（上限 ${channel.maxSideLongCm}cm）`;
  if (sides[1] > channel.maxSideShortCm || sides[2] > channel.maxSideShortCm)
    return `其余边超长（上限 ${channel.maxSideShortCm}cm）`;

  return null;
}

/** 单个渠道的运费试算 */
export function quoteChannel(input: QuoteInput, channel: ChannelLike): QuoteResult {
  const { bill, vol } = billWeight(input, channel);
  const reason = checkChannel(input, channel);
  if (reason) return { ok: false, reason, billWeightKg: bill, volumetricWeightKg: vol, shippingFee: 0 };

  const raw = bill * channel.pricePerKg + channel.pricePerOrder;
  // XY 走 ROUNDUP(x,2)；GUOO 原表不取整，这里保留 4 位以对齐手算结果
  const fee = channel.roundUp ? roundUp2(raw) : r4(raw);
  return { ok: true, billWeightKg: bill, volumetricWeightKg: vol, shippingFee: fee };
}

export interface PricingInput {
  /** 定价（人民币） */
  sellPriceCny: number;
  purchaseCost: number;
  shippingFee: number;
  labelFee: number;
  commissionRate: number;
  agentRate: number;
  withdrawRate: number;
}

export interface PricingResult {
  grossProfit: number;
  netProfit: number;
  /** 净利润 / 采购成本 */
  profitRate: number;
  /** 净利润 / 国际运费 */
  freightProfitRatio: number;
  /** 加 35% 参考价 = 定价 / 0.65 */
  markup35: number;
  /** 毛利率（毛利润 / 定价） */
  grossMargin: number;
  /** 净利率（净利润 / 定价） */
  netMargin: number;
  costTotal: number;
}

export function calcPricing(i: PricingInput): PricingResult {
  const grossProfit =
    i.sellPriceCny - i.purchaseCost - i.shippingFee - i.labelFee - i.sellPriceCny * i.commissionRate - i.sellPriceCny * i.agentRate;
  const netProfit = grossProfit - (i.purchaseCost + grossProfit) * i.withdrawRate;

  return {
    grossProfit: r2(grossProfit),
    netProfit: r2(netProfit),
    profitRate: i.purchaseCost > 0 ? r4(netProfit / i.purchaseCost) : 0,
    freightProfitRatio: i.shippingFee > 0 ? r4(netProfit / i.shippingFee) : 0,
    markup35: r2(i.sellPriceCny / 0.65),
    grossMargin: i.sellPriceCny > 0 ? r4(grossProfit / i.sellPriceCny) : 0,
    netMargin: i.sellPriceCny > 0 ? r4(netProfit / i.sellPriceCny) : 0,
    costTotal: r2(i.purchaseCost + i.shippingFee + i.labelFee),
  };
}

/**
 * 反算定价：给定目标净利润（或目标利润率），求售价。
 *
 * 由 J = [C(1−g−h) − (D+E+F)](1−i) − D·i 反解 C：
 *   C = [ J + D·i + (D+E+F)(1−i) ] / [ (1−g−h)(1−i) ]
 */
export function solveSellPrice(params: {
  purchaseCost: number;
  shippingFee: number;
  labelFee: number;
  commissionRate: number;
  agentRate: number;
  withdrawRate: number;
  /** 目标净利润额（元），与 targetProfitRate 二选一 */
  targetNetProfit?: number;
  /** 目标利润率（净利润 / 采购成本） */
  targetProfitRate?: number;
}): number {
  const { purchaseCost: D, shippingFee: E, labelFee: F, commissionRate: g, agentRate: h, withdrawRate: i } = params;
  const target = params.targetNetProfit != null ? params.targetNetProfit : (params.targetProfitRate || 0) * D;
  const denom = (1 - g - h) * (1 - i);
  if (denom <= 0) return 0;
  const c = (target + D * i + (D + E + F) * (1 - i)) / denom;
  return r2(Math.max(0, c));
}

/** 卢布 → 人民币 */
export const rubToCny = (rub: number, rate: number) => r2(rub * rate);
/** 人民币 → 卢布 */
export const cnyToRub = (cny: number, rate: number) => r2(rate > 0 ? cny / rate : 0);
