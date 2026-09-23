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
      if (ht && ht.length > (out.title || '').length) out.title = ht;
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
    if (/Нет отзывов/i.test(bt)) out.reviewsCount = 0;
    else if (out.reviewsCount == null) {
      const m = bt.match(/(\d[\d\s\u00a0]*)[\s\u00a0]*(отзыв|отзыва|отзывов)/i);
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

  // ④ 中实ERP / 闪电采集 插件的商品卡（可选增强）
  try {
    const card = {};
    const hosts = document.querySelectorAll(
      '[data-s2-ozon-sku],.s2-widget-card,.s2-tile-host,#s2-pdp-real-price-card',
    );
    for (let h = 0; h < hosts.length; h++) {
      const rows = hosts[h].querySelectorAll('[data-s2-field-key]');
      for (let i = 0; i < rows.length; i++) {
        const k = rows[i].getAttribute('data-s2-field-key');
        if (!k) continue;
        const ve = rows[i].querySelector('.s2-widget-value');
        let t;
        if (ve) {
          t = ve.innerText || ve.textContent;
        } else {
          const le = rows[i].querySelector('.s2-widget-label');
          t = rows[i].innerText || rows[i].textContent || '';
          if (le) {
            const lv = txt(le.innerText || le.textContent);
            const all = txt(t);
            t = lv && all.indexOf(lv) === 0 ? all.slice(lv.length) : all;
          }
        }
        t = txt(t);
        if (!t) continue;
        const n = num(t.replace(/[%\s\u00a0,]/g, ''));
        card[k] = n !== null ? n : t;
      }
    }
    if (Object.keys(card).length) out.pluginCard = card;
  } catch (e) { /* 没装插件就跳过 */ }

  out.url = location.href;
  return out;
}

/**
 * 列表页采集：把当前 Ozon 列表页（/highlight/…、/search/…、类目页）上的商品卡片全抓下来。
 *
 * 实测结构（2026-09）：
 *   卡片容器  div.tile-root（类名带哈希后缀如 "tile-root p5g_21 h3k_21"，所以按 class* 匹配）
 *   商品链接  a[href="/product/xxx-1234567890/?…"]  ← sku 从这里抠
 *   主图      img[src]
 *   价格      形如 "479 ₽" 的文本
 *   标题      卡片里第一条「长度够、不含 ₽、不是促销标签、不是日期」的文本
 * 类名全是构建期哈希，不能硬编码；所以这里全靠结构 + 文本特征，比写死 class 稳得多。
 */
export function collectList() {
  const items = [];
  const txt = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  };
  // 促销标签 / 日期 / 评论数：这些都不是标题，要剔掉
  const LABEL = /^(Новинка|Распродажа|Хит|Выгодно|Топ|Лучшая цена|Скидка|Подарок|Кэшбэк)/i;
  const DATE = /^\d{1,2}\s*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;

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

    let price = null;
    let title = '';
    let reviewsCount = null;
    let rating = null;

    const els = card.querySelectorAll('span,div,a');
    for (let j = 0; j < els.length; j++) {
      const t = txt(els[j].textContent);
      if (!t || t.length > 400) continue;

      if (price === null) {
        const pm = t.match(/^(\d[\d\s\u00a0]*)\s*₽$/);
        if (pm) { price = num(pm[1]); continue; }
      }
      if (reviewsCount === null) {
        const rm = t.match(/^(\d[\d\s\u00a0]*)\s*(отзыв|отзыва|отзывов)$/i);
        if (rm) { reviewsCount = num(rm[1]); continue; }
      }
      if (rating === null) {
        const am = t.match(/^(\d[.,]\d)\s*$/);
        if (am) { rating = num(am[1].replace(',', '.')); continue; }
      }
      // 标题：第一条够长、不含价格符号、不是标签/日期/评论的文本
      if (!title && t.length >= 8 && t.indexOf('₽') < 0 && !LABEL.test(t) && !DATE.test(t) && !/отзыв/i.test(t)) {
        title = t;
      }
    }

    items.push({
      sku,
      title: title || null,
      price,
      imageUrl: imageUrl || null,
      productUrl: href.indexOf('http') === 0 ? href : 'https://www.ozon.ru' + href,
      rating,
      reviewsCount,
    });
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
