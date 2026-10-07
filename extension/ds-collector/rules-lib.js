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

/**
 * 卢布 → 人民币近似汇率（1 ₽ ≈ 0.08 ¥）。
 * 供「价格(人民币)」条件换算用；汇率有变动只改这一处即可。
 */
export const RUB_TO_CNY = 0.08;

/** 规则条件的字段定义（顺序即规则编辑器里的展示顺序，与选品插件的「更多规则条件」对齐）
 *  unit: 该条件输入框旁显示的单位提示（如价格用卢布）；isDerived: 是否为由其它字段派生的条件 */
export const RULE_DEFS = [
  { key: 'soldCount', label: '月销量' },
  { key: 'soldSum', label: '月销售额' },
  // missingAsZero：页面上「没有评价/评分」时，Ozon 卡片干脆不渲染这块文案，采集值就是 null。
  // 但业务上「没有评价」就等于 0 条评价 / 0 分，所以这两个字段缺失时按 0 参与比较
  // （例如「评论数 0~0」就是筛「零评价的商品」）。其他字段（价格、销量…）缺失仍判不命中，
  // 因为采不到不等于真的是 0，瞎补 0 会让「月销量 ≤ 10」这类规则把没采到的商品全放进来。
  { key: 'rating', label: '商品评分', missingAsZero: true },
  { key: 'reviewsCount', label: '评论数', missingAsZero: true },
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
  // 由卢布价格换算出的人民币价格（按 RUB_TO_CNY 近似汇率，保留 2 位小数）；价格缺失则无人民币价
  m.priceCny = m.price != null ? Math.round(m.price * RUB_TO_CNY * 100) / 100 : null;
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

  // 范围条件：min ≤ v ≤ max
  // 字段缺失默认判不命中；但标了 missingAsZero 的字段（评分 / 评论数）按 0 处理 —— 无评价即 0
  const conds = rule.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    const min = c.min === '' || c.min == null ? null : Number(c.min);
    const max = c.max === '' || c.max == null ? null : Number(c.max);
    if (min == null && max == null) continue;
    let v = m[def.key];
    if (v == null && def.missingAsZero) v = 0;
    if (v == null) return false;
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
  }
  return true;
}

/**
 * 规则是否带「实际过滤条件」。
 *
 * 只填了标签名、条件全留空的规则会命中**全部**商品 —— 拿它当过滤器等于不过滤。
 * 所以过滤模式只认「至少有一个条件」的规则：品牌（仅无品牌 / 品牌含关键字）、
 * 发货模式、或任意一个范围条件（min/max 至少填了一个）。
 */
export function ruleHasConstraints(rule) {
  if (!rule || rule.enabled === false) return false;
  if (rule.salesSchema) return true;
  const b = rule.brand;
  if (b === 'none') return true;
  if (b === 'custom' && String(rule.brandText || '').trim()) return true;
  const conds = rule.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    const min = c.min === '' || c.min == null ? null : Number(c.min);
    const max = c.max === '' || c.max == null ? null : Number(c.max);
    if (min != null || max != null) return true;
  }
  return false;
}

/**
 * 过滤模式判定：商品是否命中任意一条「带条件的启用规则」。
 *   - 命中 → true（允许采集入库）
 *   - 全不命中 → false（过滤模式下直接丢弃，不上报）
 *   - 一条「带条件的启用规则」都没有 → 全部放行（true），避免把商品全滤光。
 *
 * 注意：字段读不到的（比如列表页没渲染评论数 → reviewsCount = null）按「不命中」处理
 * （与 matchRule 的「宁缺毋滥」一致），所以列表页采集时评论数读不到的商品会被过滤掉。
 */
export function passesFilter(item, rules) {
  const list = (Array.isArray(rules) ? rules : []).filter(ruleHasConstraints);
  if (!list.length) return true; // 没有可用作过滤的规则 → 过滤不生效
  for (const r of list) {
    try {
      if (matchRule(item, r)) return true;
    } catch (e) { /* 单条规则出错不影响其它规则 */ }
  }
  return false;
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
