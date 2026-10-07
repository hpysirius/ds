/**
 * 采集规则的条件字段定义。
 *
 * ⚠️ 必须与插件 `extension/ds-collector/rules-lib.js` 的 `RULE_DEFS` 保持一致
 * （key 与顺序都要对齐），否则后台展示的条件标签会对不上、摘要也会漏项。
 */
export const RULE_DEFS: { key: string; label: string; unit?: string; isDerived?: boolean }[] = [
  { key: 'soldCount', label: '月销量' },
  { key: 'soldSum', label: '月销售额' },
  { key: 'rating', label: '商品评分' },
  { key: 'reviewsCount', label: '评论数' },
  { key: 'price', label: '价格', unit: '卢布 ₽' },
  { key: 'priceCny', label: '价格(人民币)', isDerived: true },
  { key: 'weightG', label: '重量(g)' },
  { key: 'createDays', label: '上架时间(天)' },
  { key: 'salesDynamics', label: '月周转动态(%)' },
  { key: 'drr', label: '广告费占比(%)' },
  { key: 'daysInPromo', label: '参与促销天数' },
  { key: 'discount', label: '促销折扣(%)' },
  { key: 'promoRevenueShare', label: '促销转化率(%)' },
  { key: 'daysWithTrafarets', label: '付费推广天数' },
  { key: 'qtyViewPdp', label: '商品卡浏览量' },
  { key: 'convToCartPdp', label: '商品卡加购率(%)' },
  { key: 'sessionCountSearch', label: '搜索浏览量' },
  { key: 'convToCartSearch', label: '搜索加购率(%)' },
  { key: 'convViewToOrder', label: '展示转化率(%)' },
  { key: 'customClickRate', label: '商品点击率(%)' },
  { key: 'redemptionRate', label: '退货取消率(%)' },
  { key: 'offersCount', label: '跟卖人数' },
  { key: 'offerMinPrice', label: '跟卖最低价', unit: '卢布 ₽' },
];

/** 规则里能出现的发货模式 */
export const SALES_SCHEMAS = ['FBS', 'FBO', 'rFBS'];

const num = (v: any): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 把规则归一化成「结构化条件列表」，供详情页逐条展示。
 * 逻辑与插件 `rules.js` 的 `condSummary` 对齐，只是这里给的是键值对而不是一句话。
 */
export function conditionsOf(rule: any): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (rule?.brand === 'none') out.push({ label: '品牌', value: '仅无品牌' });
  else if (rule?.brand === 'custom' && rule?.brandText) out.push({ label: '品牌', value: `品牌名含「${rule.brandText}」` });
  if (rule?.salesSchema) out.push({ label: '发货模式', value: String(rule.salesSchema) });

  const conds = rule?.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    const min = num(c.min);
    const max = num(c.max);
    if (min === null && max === null) continue;
    if (min !== null && max !== null) out.push({ label: def.label, value: `${min} ~ ${max}` });
    else if (min !== null) out.push({ label: def.label, value: `≥ ${min}` });
    else out.push({ label: def.label, value: `≤ ${max}` });
  }
  if (!out.length) out.push({ label: '条件', value: '无条件（命中全部商品）' });
  return out;
}

/** 条件摘要（一句话，存库 + 列表展示） */
export function condSummaryOf(rule: any): string {
  const parts = conditionsOf(rule).map((c) => (c.label === '条件' ? c.value : `${c.label} ${c.value}`));
  return parts.join(' · ').slice(0, 600);
}

/** 规则是否带「实际过滤条件」（与插件 ruleHasConstraints 同语义） */
export function ruleHasConstraints(rule: any): boolean {
  if (!rule || rule.enabled === false) return false;
  if (rule.salesSchema) return true;
  if (rule.brand === 'none') return true;
  if (rule.brand === 'custom' && String(rule.brandText || '').trim()) return true;
  const conds = rule.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    if (num(c.min) !== null || num(c.max) !== null) return true;
  }
  return false;
}

/**
 * 把插件上报的原始规则清洗成可入库的形状。
 * 拿不到 ruleId / tag 的直接丢弃 —— 没有它们既没法幂等更新，也没法跟商品标签对应。
 */
export function sanitizeRule(raw: any): any | null {
  const ruleId = String(raw?.id || '').trim().slice(0, 60);
  const tag = String(raw?.tag || '').trim().slice(0, 40);
  if (!ruleId || !tag) return null;

  const conds: any = {};
  const src = raw?.conds && typeof raw.conds === 'object' ? raw.conds : {};
  for (const def of RULE_DEFS) {
    const c = src[def.key];
    if (!c || typeof c !== 'object') continue;
    const min = num(c.min);
    const max = num(c.max);
    if (min === null && max === null) continue;
    conds[def.key] = { min, max };
  }

  const color = /^#[0-9a-fA-F]{3,8}$/.test(String(raw?.color || '')) ? String(raw.color).slice(0, 20) : null;
  const brand = ['any', 'none', 'custom'].includes(raw?.brand) ? raw.brand : 'any';
  const salesSchema = SALES_SCHEMAS.includes(raw?.salesSchema) ? raw.salesSchema : null;
  const name = String(raw?.name || '').trim().slice(0, 100) || null;

  const clean = {
    ruleId,
    name,
    tag,
    color,
    priority: Math.trunc(num(raw?.priority) ?? 0),
    enabled: raw?.enabled !== false,
    brand,
    brandText: String(raw?.brandText || '').trim().slice(0, 100) || null,
    salesSchema,
    conds: Object.keys(conds).length ? conds : null,
  };
  return { ...clean, condText: condSummaryOf(clean) };
}
