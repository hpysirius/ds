/**
 * 采集规则引擎（ES module，background 与规则管理页共用）。
 *
 * 规则 = 一组「选品条件」，采集时对每个商品逐条匹配，命中的商品打上标签：
 *   item.tags = [{ name: '潜力款', color: '#16a34a', priority: 0, rule: '小体积高销量' }, ...]
 * 标签随商品一起上报后端，存进 products.raw.tags（JSON，无需加列）。
 *
 * 条件来源：
 *   - 公开字段：price / rating / reviewsCount（列表页、详情页都有）
 *   - 插件浮层字段（pluginCard）：月销/佣金/加购率等经营指标，
 *     只有登录 Ozon 卖家账号后第三方选品插件才会渲染，没登录时这些条件判 null（视为不命中）
 */

/** 规则条件的字段定义（顺序即规则编辑器里的展示顺序，与选品插件的「更多规则条件」对齐） */
export const RULE_DEFS = [
  { key: 'soldCount', label: '月销量' },
  { key: 'soldSum', label: '月销售额' },
  { key: 'rating', label: '商品评分' },
  { key: 'reviewsCount', label: '评论数' },
  { key: 'price', label: '价格' },
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
  { key: 'offerMinPrice', label: '跟卖最低价' },
];

/** pluginCard 的 key → 规则条件的 key（同名直接透传） */
const PC_MAP = {
  soldCount: 'soldCount', soldSum: 'soldSum', drr: 'drr', daysInPromo: 'daysInPromo',
  discount: 'discount', promoRevenueShare: 'promoRevenueShare', daysWithTrafarets: 'daysWithTrafarets',
  qtyViewPdp: 'qtyViewPdp', convToCartPdp: 'convToCartPdp', convToCartSearch: 'convToCartSearch',
  sessionCountSearch: 'sessionCountSearch', convViewToOrder: 'convViewToOrder',
  customClickRate: 'customClickRate', redemptionRate: 'redemptionRate', offerMinPrice: 'offerMinPrice',
};

const num = (v) => {
  if (v == null) return null;
  const x = parseFloat(String(v).replace(/,/g, '.'));
  return isNaN(x) ? null : x;
};

/** 从插件浮层的 createDate（"2026-08-29(25天)" / "29.08.2026"）算出上架天数 */
function daysSinceDate(s) {
  const str = String(s == null ? '' : s);
  let m = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  let d = null;
  if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  else {
    m = str.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  if (!d || isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/**
 * 把采集到的商品（列表页 item 或详情页 payload）归一化成规则条件的数值。
 * 缺的字段是 null —— 规则里配了这个字段就判不命中（宁缺毋滥，不瞎猜）。
 */
export function extractMetrics(item) {
  const pc = (item && item.pluginCard) || {};
  const m = {
    price: num(item && item.price),
    rating: num(item && item.rating),
    reviewsCount: num(item && item.reviewsCount),
    salesSchema: String((item && item.salesSchema) || pc.salesSchema || '').toUpperCase(),
    brand: String((item && item.brand) || pc.brand || '').trim(),
  };
  for (const k of Object.keys(PC_MAP)) m[PC_MAP[k]] = num(pc[k]);
  // 重量：采集端已统一成克（支持 g/kg）；万一进来的是原始字符串（"1,2 кг"），这里再兜一次单位换算
  m.weightG = null;
  if (typeof pc.weight === 'string' && pc.weight) {
    const wm = pc.weight.match(/([\d.,]+)\s*(кг|kg|гр?|g)?/i);
    if (wm) {
      let wv = num(String(wm[1]).replace(/,/g, '.'));
      if (wv != null) {
        if (/^(кг|kg)$/i.test(wm[2] || '')) wv *= 1000;
        m.weightG = Math.round(wv);
      }
    }
  } else {
    m.weightG = num(pc.weight);
  }
  // 上架天数：优先用浮层的上架日期现算（每天看都是准的），否则退回采集时的值
  m.createDays = daysSinceDate(pc.createDate);
  if (m.createDays == null) m.createDays = num(pc.createDays != null ? pc.createDays : (item && item.createDays));
  // 跟卖人数：浮层给的是 "Lmc-002 等 93个 卖家"，抠出数字
  if (m.offersCount == null) {
    const om = typeof pc.offers === 'string' ? pc.offers.match(/(\d+)\s*个/) : null;
    m.offersCount = om ? num(om[1]) : num(pc.offers);
  }
  // 月周转动态："暂无数据" → null；"12.3%" → 12.3
  m.salesDynamics = num(pc.salesDynamics);
  return m;
}

/** 单条规则是否命中（所有启用的条件 AND 起来；条件留空 = 不限制） */
export function matchRule(item, rule) {
  if (!rule || rule.enabled === false) return false;
  const m = extractMetrics(item);

  // 品牌选项：any=不限 / none=只匹配无品牌 / custom=品牌名包含关键字
  const brandOpt = rule.brand || 'any';
  if (brandOpt === 'none') {
    const b = m.brand;
    if (b && b !== '无品牌' && !/^нет бренда$/i.test(b)) return false;
  } else if (brandOpt === 'custom') {
    const kw = String(rule.brandText || '').trim();
    if (kw && !m.brand.toLowerCase().includes(kw.toLowerCase())) return false;
  }

  // 发货模式：FBS / FBO / rFBS（留空不限）
  if (rule.salesSchema && m.salesSchema !== String(rule.salesSchema).toUpperCase()) return false;

  // 范围条件：min ≤ v ≤ max；字段缺失判不命中
  const conds = rule.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    const min = c.min === '' || c.min == null ? null : Number(c.min);
    const max = c.max === '' || c.max == null ? null : Number(c.max);
    if (min == null && max == null) continue;
    const v = m[def.key];
    if (v == null) return false;
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
  }
  return true;
}

/**
 * 对一个商品应用全部规则 → 命中的标签数组（按优先级升序，数字小的在前）。
 * 永远返回数组，没命中就是空数组。
 */
export function applyRulesToItem(item, rules) {
  const tags = [];
  const list = (Array.isArray(rules) ? rules : [])
    .filter((r) => r && r.enabled !== false && r.tag)
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
  for (const r of list) {
    try {
      if (matchRule(item, r)) {
        tags.push({
          name: String(r.tag).slice(0, 6),
          color: String(r.color || '#1677ff').slice(0, 16),
          priority: Number(r.priority) || 0,
          rule: String(r.name || '').slice(0, 15),
        });
      }
    } catch (e) { /* 单条规则出错不影响其它规则 */ }
  }
  return tags;
}
