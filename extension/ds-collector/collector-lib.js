/**
 * 页面采集逻辑（会被注入到 Ozon 商品页里执行）。
 *
 * 数据来源优先级（和后端 sourcing.service.ts 的 PUBLIC_PROBE_JS 保持一致）：
 *   ① JSON-LD（Ozon 商品页自带，服务端渲染就带在 HTML 里，最可靠）
 *   ② og / meta 标签
 *   ③ 公开 DOM 兜底（h1、品牌链接、面包屑、评论数文案、FBS/FBO、卖家）
 *   ④ 「中实跨境ERP / 闪电采集」插件渲染的商品卡（月销/加购率/退货率/广告占比等经营指标，
 *      只有登录 Ozon 卖家账号后才有，没装就不影响其它字段）
 *
 * 注意：这个函数会被序列化后在页面上下文里执行，**不能引用外部变量、不能用 import**。
 */
export function collectProduct() {
  const out = {};
  const txt = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  };
  const meta = (sel) => {
    const m = document.querySelector(sel);
    return m ? txt(m.getAttribute('content')) : '';
  };

  /** 浮层字段值归一化（规则匹配和后端都按这套语义消费）：
   *  - 俄语小数是逗号（"10,94 ¥" → 10.94），千分位是空格
   *  - 重量统一成克（"1,2 кг" → 1200、"50g" → 50）
   *  - 上架日期 / 体积 / 跟卖列表保留原文（带单位、多值，不能粗暴转数字） */
  const cardVal = (k, t) => {
    if (k === 'createDate' || k === 'volume' || k === 'offers') return t;
    if (k === 'weight') {
      const wm = t.match(/([\d.,]+)\s*(кг|kg|гр?|g)?/i);
      if (wm) {
        let v = num(String(wm[1]).replace(/,/g, '.'));
        if (v !== null) {
          if (/^(кг|kg)$/i.test(wm[2] || '')) v *= 1000;
          return Math.round(v);
        }
      }
      return t;
    }
    if (t.indexOf('/') >= 0) return t;
    const n = num(t.replace(/%/g, '').replace(/[\s\u00a0]/g, '').replace(/,/g, '.'));
    return n !== null ? n : t;
  };

  // ① JSON-LD
  try {
    const lds = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < lds.length; i++) {
      let j = null;
      try { j = JSON.parse(lds[i].textContent || ''); } catch (e) { continue; }
      const arr = Array.isArray(j) ? j : [j];
      for (let k = 0; k < arr.length; k++) {
        const o = arr[k];
        if (!o || o['@type'] !== 'Product') continue;
        if (o.name) out.title = txt(o.name);
        if (o.brand) out.brand = txt(typeof o.brand === 'string' ? o.brand : o.brand.name);
        if (o.image) out.imageUrl = Array.isArray(o.image) ? String(o.image[0]) : String(o.image);
        const of = o.offers ? (Array.isArray(o.offers) ? o.offers[0] : o.offers) : null;
        if (of && of.price) out.price = num(of.price);
        const ar = o.aggregateRating;
        if (ar) {
          if (ar.ratingValue) out.rating = num(ar.ratingValue);
          if (ar.reviewCount) out.reviewsCount = num(ar.reviewCount);
          else if (ar.ratingCount) out.reviewsCount = num(ar.ratingCount);
        }
      }
    }
  } catch (e) { /* ignore */ }

  // ② meta 兜底
  if (!out.title) out.title = txt(meta('meta[property="og:title"]') || document.title || '');
  if (!out.imageUrl) out.imageUrl = txt(meta('meta[property="og:image"]'));
  if (out.price == null) {
    const pm = txt(meta('meta[property="product:price:amount"]'));
    if (pm) out.price = num(pm);
  }
  if (out.price == null) {
    try {
      const m = String(document.body.innerText || '').match(/(\d[\d\s\u00a0]*)[\s\u00a0]*₽/);
      if (m) out.price = num(m[1]);
    } catch (e) { /* ignore */ }
  }

  // ③ 公开 DOM 兜底
  try {
    const h1 = document.querySelector('h1');
    if (h1) {
      const ht = txt(h1.innerText || h1.textContent);
      // 选品插件浮层的字段串（「闪电采集选品标签：类目：…」）绝不能被当成商品名
      const widgetLike = /选品标签|类目[:：]|rFBS佣金|月销量|跟卖最低价|暂无数据/.test(ht);
      if (ht && !widgetLike && ht.length > (out.title || '').length) out.title = ht;
    }
  } catch (e) { /* ignore */ }
  try {
    const b = document.querySelector('a[href*="/brand/"]');
    if (b) {
      const bt = txt(b.innerText || b.textContent);
      if (bt && bt.length < 60 && !out.brand) out.brand = bt;
    }
  } catch (e) { /* ignore */ }
  try {
    // 面包屑：Ozon 挂在 [data-widget="breadCrumbs"]（驼峰大写 C），选择器要同时覆盖各种写法
    const cr = document.querySelectorAll(
      '[data-widget*="bread"] a,[data-widget*="Bread"] a,[class*="breadcrumb"] a,[class*="Breadcrumb"] a,[class*="bread"] a',
    );
    const ps = [];
    for (let c = 0; c < cr.length; c++) {
      const t = txt(cr[c].innerText || cr[c].textContent);
      if (t && t.length < 40 && ps.indexOf(t) < 0) ps.push(t);
    }
    if (ps.length) out.categoryPath = ps.join(' / ');
  } catch (e) { /* ignore */ }
  try {
    const bt = String(document.body.innerText || '');
    // 评论数：俄语 "12 отзывов" / 中文 "12 条评论"（Ozon 会按账号语言本地化）
    if (/нет отзывов|暂无评论|还没有评论/i.test(bt)) out.reviewsCount = 0;
    else if (out.reviewsCount == null) {
      const m = bt.match(/(\d[\d\s\u00a0]*)[\s\u00a0]*(отзыв[а-яё]*|条评论|个评价|条评价|评论|评价)/i);
      if (m) out.reviewsCount = num(m[1].replace(/[\s\u00a0]/g, ''));
    }
  } catch (e) { /* ignore */ }
  try {
    const st = String(document.body.innerText || '').match(/\b(FBS|FBO|rFBS)\b/);
    if (st) out.salesSchema = st[1];
  } catch (e) { /* ignore */ }
  try {
    const sl = document.querySelector('a[href*="/seller/"]');
    if (sl) {
      const sn = txt(sl.innerText || sl.textContent);
      if (sn && sn.length < 80) out.sellerName = sn;
    }
  } catch (e) { /* ignore */ }

  // ④ 选品插件（中卖搏通ERP / 中实ERP / 闪电采集）渲染的商品卡（可选增强）
  try {
    const card = {};
    const readRows = (rows) => {
      for (let i = 0; i < rows.length; i++) {
        const k = rows[i].getAttribute('data-s2-field-key');
        if (!k || card[k] !== undefined) continue;
        const ve = rows[i].querySelector('.s2-widget-value');
        let t = '';
        if (k === 'rfbsCommission' && ve) {
          // rFBS 佣金是三档标签（12% / 14% / 20%），直接拼会变成假数字，用 / 连接
          const bands = ve.querySelectorAll('.s2-widget-rfbs-band');
          if (bands.length) {
            const parts = [];
            for (let b = 0; b < bands.length; b++) parts.push(txt(bands[b].innerText || bands[b].textContent));
            t = parts.join('/');
          }
        }
        if (!t) t = ve ? (ve.innerText || ve.textContent) : (rows[i].innerText || rows[i].textContent || '');
        t = txt(t);
        if (!t) continue;
        card[k] = cardVal(k, t);
      }
    };
    const hosts = document.querySelectorAll(
      '[data-s2-ozon-sku],.s2-widget-card,.s2-widget-ready-content,.s2-tile-host,#s2-pdp-real-price-card',
    );
    for (let h = 0; h < hosts.length; h++) readRows(hosts[h].querySelectorAll('[data-s2-field-key]'));
    // 兜底：widget 挂载点类名变了也照样能读到字段
    if (!Object.keys(card).length) readRows(document.querySelectorAll('[data-s2-field-key]'));
    if (Object.keys(card).length) out.pluginCard = card;
  } catch (e) { /* 没装插件就跳过 */ }

  /*
   * 商品链接：优先 og:url（SEO 给的是干净地址），退回当前地址。
   * 注意一定要带 https 前缀 —— 后端写库前会校验 http(s)，插件表单 stirng 处理不当会存成相对路径。
   */
  let purl = meta('meta[property="og:url"]');
  if (!purl) {
    try {
      const l = document.querySelector('link[rel="canonical"]');
      if (l) purl = String(l.getAttribute('href') || '');
    } catch (e) { /* ignore */ }
  }
  if (!purl) purl = location.href;
  if (purl && purl.indexOf('//') === 0) purl = 'https:' + purl;
  out.productUrl = purl;

  out.url = location.href;
  return out;
}

/**
 * 列表页采集：把当前 Ozon 列表页（/highlight/…、/search/…、类目页）上的商品卡片全抓下来。
 *
 * 实测结构（2026-09-28）：
 *   卡片容器  div.tile-root（类名带哈希后缀如 "tile-root p5g_21 h3k_21"，所以按 class* 匹配）
 *   商品链接  a[href="/product/xxx-1234567890/?…"]  ← sku 从这里抠；其 title/aria-label 常是完整商品名
 *   主图      img[src]（alt 通常就是商品名，是最稳的标题来源）
 *   标题      class 含 tsBody 的文本（Ozon 设计系统排版类，构建期哈希变但前缀稳定）
 *   价格      class 含 tsHeadline 的文本，形如 "479 ₽" 或 "25,13 ₽42,12 ₽-40%"
 *            ⚠️ 优先取带 ₽ 的；只有整张卡片都没有 ₽ 时才退回 ¥（那说明页面把价渲染成了人民币，
 *               此时数值就是人民币，后端会按下发的汇率换算回卢布再入库）
 *
 * ⚠️ 关键：Ozon 会按账号语言把界面本地化 —— 俄语/中文都见过，促销标签会变成「还剩5件新品」这类中文。
 * 所以文案特征必须**同时覆盖俄语和中文**，否则促销标签会被当成商品名（实测踩过）。
 * 类名全是构建期哈希，不能硬编码；这里靠结构 + class 前缀(tsBody/tsHeadline) + 文本特征三重兜底。
 */
export function collectList() {
  const items = [];
  const txt = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  };
  /*
   * 文案特征（俄语 + 中文都要覆盖）：促销标签 / 日期 / 评论 / 库存 / 纯单位词 —— 这些都不是商品名。
   * Ozon 中文界面下促销标签是「还剩5件新品」这种，早期只写了俄语，导致它被当成标题入库（已修）。
   */
  const LABEL = /^(Новинка|Распродажа|Хит|Выгодно|Топ|Лучшая цена|Скидка|Подарок|Кэшбэк|新品|还剩|剩\s*\d|仅剩|清仓|特价|优惠|折扣|促销|爆款|热销|秒杀|包邮|次日达|最低价|超值|限时|现货|预售|赠品|返现)/i;
  const DATE = /^\d{1,2}\s*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;
  const REVIEW = /отзыв|评论|评价/;
  const STOCK = /仅剩|остал|还剩|剩\s*\d|新品/i;
  const PRICEY = /[₽¥$€]/;
  const UNIT_ONLY = /^(шт\.?|г|кг|мл|л|см|мм|м|т|天|件|个|条|包|盒|片|双|套|pcs|ml|g|kg|cm|mm)$/i;
  const HAS_LETTER = /[A-Za-zА-Яа-яЁё\u4e00-\u9fff]/;
  /*
   * 第三方选品插件（中实跨境ERP / 闪电采集）浮层文本的特征词。
   * 它的浮层是一整段「闪电采集选品标签：类目：…rFBS佣金：…月销量：…跟卖最低价：…」，
   * 段长、不含货币符号，靠 class 过滤一旦失手就会被当成「最长的合格文本」选成商品名
   * （实测库里真出现过这种标题）。所以在**文本层面**再加一道硬闸，不依赖 DOM class。
   */
  const NOT_TITLE = /选品标签|类目[:：]|rFBS佣金|月销量|月销售额|跟卖最低价|历史平均价格|商品卡加购率|退货取消率|付费推广天数|推广天数|暂无数据/;

  /** 这段文本能不能当商品名（宁可判空也不要把促销标签/价格/插件浮层当名字） */
  const okTitle = (t) => {
    if (!t || t.length < 6 || t.length > 320) return false;
    if (PRICEY.test(t) || t.indexOf('%') >= 0) return false;
    if (LABEL.test(t) || DATE.test(t) || STOCK.test(t) || REVIEW.test(t) || UNIT_ONLY.test(t)) return false;
    if (NOT_TITLE.test(t)) return false; // 选品插件浮层的字段串，绝不是商品名
    if (!HAS_LETTER.test(t)) return false; // 纯数字/符号不算标题
    if (/^\d+$/.test(t)) return false;
    return true;
  };

  /**
   * 从一段文本里取「现价」+ 币种符号：第一处货币符号前的数字就是现价。
   * 中文/俄语小数都是逗号，千分位是空格 —— "25,13 ₽42,12 ₽-40%" → 25.13。
   *
   * ⚠️ 币种符号必须认「所有常见符号」而不是只认 ₽：实测用户的浏览器里价格会显示成 **¥**。
   *    注意 ¥ 有两种可能：① 只是符号被本地化（数值仍是卢布）；② **数值本身就是人民币**——
   *    2026-10-09 实测确认线上有 608 条属于第 ② 种（如 789 ₽ 存成了 61.88）。
   *    所以本函数只负责原样解析「数值 + 符号」，币种口径统一交给后端按符号换算。
   */
  const parsePrice = (t) => {
    const m = String(t || '').match(/(\d[\d\s\u00a0]*)(?:[.,](\d{1,2}))?\s*([₽¥$€])/);
    if (!m) return { value: null, symbol: '' };
    const whole = String(m[1]).replace(/[\s\u00a0]/g, '');
    return { value: num(m[2] ? whole + '.' + m[2] : whole), symbol: m[3] };
  };

  /*
   * 第三方选品插件（中卖搏通ERP 等）会把浮层 widget 注进商品卡片 DOM：
   * 「中卖搏通ERP选品标签：类目：---rFBS佣金：…」整段文本很容易被当成标题抓走（实测踩过）。
   * 所以凡是「在 widget 里」或「子树里含 widget」的元素一律跳过。
   */
  const WIDGET_SEL = '[class*="s2-widget"],[class*="s2-tile"],[data-s2-ozon-sku]';
  const touchedByWidget = (el) =>
    !!(el.closest && (el.closest(WIDGET_SEL) || el.querySelector(WIDGET_SEL)));

  // 浮层字段值归一化（同 collectProduct 里的 cardVal：重量成克、日期/体积/跟卖保留原文、逗号小数）
  const cardVal = (k, t) => {
    if (k === 'createDate' || k === 'volume' || k === 'offers') return t;
    if (k === 'weight') {
      const wm = t.match(/([\d.,]+)\s*(кг|kg|гр?|g)?/i);
      if (wm) {
        let v = num(String(wm[1]).replace(/,/g, '.'));
        if (v !== null) {
          if (/^(кг|kg)$/i.test(wm[2] || '')) v *= 1000;
          return Math.round(v);
        }
      }
      return t;
    }
    if (t.indexOf('/') >= 0) return t;
    const n = num(t.replace(/%/g, '').replace(/[\s\u00a0]/g, '').replace(/,/g, '.'));
    return n !== null ? n : t;
  };

  /** 读一个浮层容器里的 [data-s2-field-key] → {字段名: 值} */
  const readPluginCard = (root) => {
    const pc = {};
    let rows;
    try { rows = root.querySelectorAll('[data-s2-field-key]'); } catch (e) { return pc; }
    for (let r = 0; r < rows.length; r++) {
      const k = rows[r].getAttribute('data-s2-field-key');
      if (!k || pc[k] !== undefined) continue;
      const ve = rows[r].querySelector('.s2-widget-value');
      let t = '';
      if (k === 'rfbsCommission' && ve) {
        // rFBS 佣金是三档标签（12% / 14% / 20%），直接拼会变成假数字，用 / 连接
        const bands = ve.querySelectorAll('.s2-widget-rfbs-band');
        if (bands.length) {
          const parts = [];
          for (let b = 0; b < bands.length; b++) parts.push(txt(bands[b].innerText || bands[b].textContent));
          t = parts.join('/');
        }
      }
      if (!t) t = ve ? (ve.innerText || ve.textContent) : (rows[r].innerText || rows[r].textContent || '');
      t = txt(t);
      if (!t) continue;
      pc[k] = cardVal(k, t);
    }
    return pc;
  };

  /*
   * 浮层不一定长在商品卡片里（有的选品插件渲染成独立浮层/侧栏），
   * 所以先按 data-s2-ozon-sku 建一张全局索引，卡片里读不到时按 sku 兜底。
   */
  const widgetBySku = {};
  try {
    const wHosts = document.querySelectorAll('[data-s2-ozon-sku]');
    for (let h = 0; h < wHosts.length; h++) {
      const sk = String(wHosts[h].getAttribute('data-s2-ozon-sku') || '').replace(/\D/g, '');
      if (!sk) continue;
      const pc = readPluginCard(wHosts[h]);
      if (Object.keys(pc).length) widgetBySku[sk] = pc;
    }
  } catch (e) { /* 没装插件就跳过 */ }

  const cards = document.querySelectorAll('div[class*="tile-root"]');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const a = card.querySelector('a[href*="/product/"]');
    if (!a) continue;
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/product\/[^/]*?(\d{6,})/);
    if (!m) continue;
    const sku = m[1];

    const imgEl = card.querySelector('img');
    let imageUrl = imgEl ? (imgEl.getAttribute('src') || '') : '';
    if (imageUrl && imageUrl.indexOf('//') === 0) imageUrl = 'https:' + imageUrl;

    // 先把卡片里所有候选文本收集出来（跳过第三方插件浮层里的文本）
    const els = card.querySelectorAll('span,div,a');
    const cands = [];
    for (let j = 0; j < els.length; j++) {
      if (touchedByWidget(els[j])) continue; // 插件浮层里的文本一律不看
      const t = txt(els[j].textContent);
      if (!t || t.length > 400) continue;
      cands.push({ t: t, cls: String(els[j].className || '') });
    }

    // ── 价格：**一律优先取卢布(₽)**，取不到才退回 ¥。
    //    原因（2026-10-09 查实）：Ozon 有时把卡片价渲染成 ¥（人民币），早期版本直接把 ¥ 值当价格入库，
    //    导致跟卖价/定价比较整体错了一个汇率（线上 608 条）。所以这里两轮挑选：
    //      第一轮只要含 ₽ 的候选（tsHeadline 优先，再退最短文本块）
    //      第二轮（一个 ₽ 都没有）才接受 ¥ —— 此时把符号一并上报，由后端按汇率换算回卢布。
    const pickPriceText = (needRub) => {
      for (let j = 0; j < cands.length; j++) {
        const t = cands[j].t;
        if (/tsHeadline/i.test(cands[j].cls) && PRICEY.test(t) && (!needRub || t.indexOf('₽') >= 0)) return t;
      }
      let best = '';
      for (let j = 0; j < cands.length; j++) {
        const t = cands[j].t;
        if (!PRICEY.test(t) || t.length > 60) continue;
        if (needRub && t.indexOf('₽') < 0) continue;
        if (!best || t.length < best.length) best = t;
      }
      return best;
    };
    const priceText = pickPriceText(true) || pickPriceText(false);
    const pp = parsePrice(priceText);
    const price = pp.value;

    // ── 评论数：俄语 "12 отзывов" / 中文 "12 条评论"
    let reviewsCount = null;
    for (let j = 0; j < cands.length; j++) {
      const rm = cands[j].t.match(/^(\d[\d\s\u00a0]*)\s*(отзыв[а-яё]*|条评论|个评价|条评价|评论|评价)$/i);
      if (rm) { reviewsCount = num(rm[1]); break; }
    }
    if (reviewsCount === null) {
      for (let j = 0; j < cands.length; j++) {
        if (/^(нет отзывов|暂无评论|还没有评论)$/i.test(cands[j].t)) { reviewsCount = 0; break; }
      }
    }

    // ── 评分：卡片上的 "4,8" / "4.8"
    let rating = null;
    for (let j = 0; j < cands.length; j++) {
      const am = cands[j].t.match(/^(\d[.,]\d)$/);
      if (am) { rating = num(am[1]); break; }
    }

    /*
     * ── 标题：按可信度依次取
     *   ① 商品链接的 title / aria-label（Ozon 常给完整商品名）
     *   ② 主图 alt（通常就是商品名，最稳）
     *   ③ class 含 tsBody 的文本（Ozon 标题排版类），优先 500 号，再取最长
     *   ④ 全卡兜底：取最长的「合格」文本（促销标签/价格/评论/日期都已被 okTitle 挡掉）
     */
    let title = '';
    const linkTitle = txt(a.getAttribute('title') || a.getAttribute('aria-label') || '');
    if (okTitle(linkTitle)) title = linkTitle;
    if (!title && imgEl) {
      const alt = txt(imgEl.getAttribute('alt') || '');
      if (okTitle(alt)) title = alt;
    }
    if (!title) {
      let best = '';
      let bestScore = -1;
      for (let j = 0; j < cands.length; j++) {
        if (!/tsBody/i.test(cands[j].cls) || !okTitle(cands[j].t)) continue;
        const sc = (/500/.test(cands[j].cls) ? 1000 : 0) + Math.min(cands[j].t.length, 300);
        if (sc > bestScore) { bestScore = sc; best = cands[j].t; }
      }
      title = best;
    }
    if (!title) {
      for (let j = 0; j < cands.length; j++) {
        if (okTitle(cands[j].t) && cands[j].t.length > title.length) title = cands[j].t;
      }
    }

    const item = {
      sku,
      title: title || null,
      price,
      // 抓到的币种符号（₽ / ¥ …）：只作诊断留档，数值一律按页面原值存，方便日后核对是否被本地化换算过
      priceSymbol: pp.symbol || null,
      imageUrl: imageUrl || null,
      productUrl: href.indexOf('http') === 0 ? href : 'https://www.ozon.ru' + href,
      rating,
      reviewsCount,
    };

    // 卡片上若挂着选品插件的浮层（月销/佣金/类目等经营指标），有就一并带上报给后端
    try {
      let pc = readPluginCard(card);
      if (!Object.keys(pc).length && widgetBySku[sku]) pc = widgetBySku[sku];
      if (Object.keys(pc).length) item.pluginCard = pc;
    } catch (e) { /* 没装插件就跳过 */ }

    items.push(item);
  }
  return items;
}

/** 列表页往下滚一屏（配合无限滚动加载更多商品） */
export function scrollDown() {
  const before = document.body.scrollHeight;
  window.scrollTo(0, before);
  return before;
}

/**
 * 页面就绪判定（避免对着反爬挑战页 / 空白页开抓）。
 * @returns {'ready'|'challenge'|'loading'}
 */
export function probeReady() {
  try {
    const t = String(document.title || '');
    if (/Antibot|нет соединени|Доступ ограничен|Access Denied/i.test(t)) return 'challenge';
    const ld = document.querySelectorAll('script[type="application/ld+json"]').length;
    const h1 = document.querySelector('h1');
    if (ld > 0 || (h1 && String(h1.innerText || '').trim().length > 0)) return 'ready';
    return 'loading';
  } catch (e) {
    return 'loading';
  }
}
