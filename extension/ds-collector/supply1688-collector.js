/**
 * 1688 商品详情页采集：价格 / 规格 / 重量 / 长宽高 / 另需运费。
 *
 * 注入到当前标签页后调用 window.__dsCollect1688() 拿结果。
 * 之所以放在页面里跑（而不是后端 HTTP 抓），是因为：
 *   - 机房 IP 会被 1688 的 cloud_ip_bl 整体拉黑（连滑块都不给），根本抓不到；
 *   - 这里是用户自己的浏览器：真实登录态 + 家庭宽带出口，基本不会被拦；
 *   - 渲染后的 DOM 里还能读到后端 HTML 里没有的可见文案（规格与包装表格）。
 *
 * 数据来源按可信度排序：
 *   1. 内联 JSON：skuMap / skuMapOriginal（规格名 + 价格）、pieceWeightScaleInfo（每规格重量/长宽高）
 *   2. 页面上可见的「商品件重尺 / 规格与包装」文案（长 24 宽 19 高 7、重 0.025kg 之类）
 *   3. 规格名里自带的尺寸，如「2合1款双片装（17*7*3）」
 */
(function () {
  /** 从 innerHTML 里按 key 切出一个完整的 JSON 对象/数组（正确处理字符串里的括号） */
  function sliceBalanced(html, key) {
    const ki = html.indexOf('"' + key + '"');
    if (ki < 0) return null;
    let i = ki + key.length + 2;
    while (i < html.length && '{['.indexOf(html[i]) < 0) i++;
    if (i >= html.length) return null;
    const open = html[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < html.length && j < i + 800000; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return html.slice(i, j + 1);
      }
    }
    return null;
  }

  /** 规格名里抠尺寸：「2合1款双片装（17*7*3）」→ { l:17, w:7, h:3 }（按 长≥宽≥高 排） */
  function parseDimsFromName(name) {
    if (!name) return null;
    // 三个分隔符都要支持 * x × X —— 1688 规格名里最常见的是「（17*7*3）」
    const m = String(name).match(/(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = [Number(m[1]), Number(m[2]), Number(m[3])].filter((x) => x > 0);
    if (n.length !== 3) return null;
    n.sort((a, b) => b - a);
    return { l: n[0], w: n[1], h: n[2] };
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  window.__dsCollect1688 = function () {
    const warnings = [];
    try {
      const html = document.documentElement ? document.documentElement.innerHTML || '' : '';
      const offerM = location.href.match(/offer\/(\d+)\.html/) || html.match(/offerId["']?\s*[:=]\s*["']?(\d{6,})/);
      const offerId = offerM ? offerM[1] : '';

      // ---- 标题 ----
      let title = '';
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = (ogTitle.getAttribute('content') || '').trim();
      if (!title) {
        const t = document.querySelector('h1');
        if (t) title = (t.innerText || '').trim();
      }
      if (!title) {
        const dm = html.match(/<title>([^<]{4,120})<\/title>/);
        if (dm) title = dm[1].trim();
      }

      // ---- 包装/重量：pieceWeightScaleInfo ----
      const packByName = new Map();
      const packBySkuId = new Map();
      const pwsStr = sliceBalanced(html, 'pieceWeightScaleInfo');
      if (pwsStr) {
        try {
          const arr = JSON.parse(pwsStr);
          (Array.isArray(arr) ? arr : []).forEach((x) => {
            const rec = {
              name: String(x && (x.sku1 || x.skuName) || '').trim(),
              weightG: num(x && x.weight),
              l: num(x && x.length),
              w: num(x && x.width),
              h: num(x && x.height),
              skuId: String((x && x.skuId) || ''),
            };
            if (rec.skuId) packBySkuId.set(rec.skuId, rec);
            if (rec.name) packByName.set(rec.name, rec);
          });
        } catch (e) {
          warnings.push('包装信息解析失败');
        }
      }

      // ---- 规格与价格：skuMap / skuMapOriginal / skuInfoMap ----
      const skus = [];
      const seen = new Set();
      const pushSku = (name, price, skuId) => {
        const nm = String(name || '').trim();
        if (!nm || seen.has(nm)) return;
        seen.add(nm);
        const pack = packBySkuId.get(String(skuId || '')) || packByName.get(nm);
        const nameDims = parseDimsFromName(nm);
        skus.push({
          name: nm.slice(0, 120),
          price: price,
          weightG: pack && pack.weightG ? pack.weightG : null,
          lengthCm: nameDims ? nameDims.l : pack && pack.l ? pack.l : null,
          widthCm: nameDims ? nameDims.w : pack && pack.w ? pack.w : null,
          heightCm: nameDims ? nameDims.h : pack && pack.h ? pack.h : null,
        });
      };
      ['skuMap', 'skuMapOriginal'].forEach((key) => {
        const s = sliceBalanced(html, key);
        if (!s) return;
        try {
          const arr = JSON.parse(s);
          (Array.isArray(arr) ? arr : []).forEach((x) => {
            const p = x && (x.discountPrice != null ? x.discountPrice : x.price);
            pushSku(x && (x.specAttrs || x.skuName || x.name), num(p), x && x.skuId);
          });
        } catch (e) {
          /* 单个源解析失败不影响其他源 */
        }
      });
      {
        const s = sliceBalanced(html, 'skuInfoMap');
        if (s) {
          try {
            const obj = JSON.parse(s);
            Object.keys(obj || {}).forEach((k) => {
              const x = obj[k] || {};
              const p = x.discountPrice != null ? x.discountPrice : x.price;
              pushSku(k, num(p), x.skuId);
            });
          } catch (e) {
            /* ignore */
          }
        }
      }

      // ---- 另需运费 ----
      let freightYuan = null;
      const fm = html.match(/"totalCost"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
      if (fm) freightYuan = num(fm[1]);

      // ---- 兜底：页面上可见的文案（规格与包装 / 商品件重尺）----
      let textDims = null;
      let textWeightKg = null;
      let textPrice = null;
      const text = document.body ? document.body.innerText || '' : '';
      if (text) {
        // 长 24 / 宽 19 / 高 7（单位可能写 cm、厘米）
        const L = text.match(/长[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)/);
        const W = text.match(/宽[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)/);
        const H = text.match(/高[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)/);
        if (L && W && H) textDims = { l: num(L[1]), w: num(W[1]), h: num(H[1]) };
        // 24*19*7 / 24×19×7 这种连写的三边
        if (!textDims) {
          const tri = text.match(/(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/);
          if (tri) textDims = { l: num(tri[1]), w: num(tri[2]), h: num(tri[3]) };
        }
        // 重量：0.025kg / 25g
        const kg = text.match(/重[量]?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克|KG)/i);
        if (kg) textWeightKg = num(kg[1]);
        if (textWeightKg == null) {
          const g = text.match(/重[量]?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*g\b/i);
          if (g) textWeightKg = num(g[1]) / 1000;
        }
        // 价格：页面上第一个 ¥ 数字
        const pm = text.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
        if (pm) textPrice = num(pm[1]);
      }

      // 规格列表里缺尺寸的，用页面文案兜底
      if (skus.length && textDims) {
        skus.forEach((s) => {
          if (!s.lengthCm && !s.widthCm && !s.heightCm) {
            s.lengthCm = textDims.l;
            s.widthCm = textDims.w;
            s.heightCm = textDims.h;
          }
        });
      }

      // 没有任何规格时，用页面文案 + 标题拼一条
      if (!skus.length) {
        skus.push({
          name: title ? title.slice(0, 60) : '默认',
          price: textPrice,
          weightG: textWeightKg != null ? Math.round(textWeightKg * 1000) : null,
          lengthCm: textDims ? textDims.l : null,
          widthCm: textDims ? textDims.w : null,
          heightCm: textDims ? textDims.h : null,
        });
        warnings.push('没读到规格列表，用页面上的价格/件重尺兜底（请核对）');
      }

      if (!skus.some((s) => s.price != null)) warnings.push('没读到价格，请在弹窗里手填');
      if (!skus.some((s) => s.weightG != null)) warnings.push('没读到重量，请在弹窗里手填');

      return {
        ok: true,
        offerId,
        title,
        offerUrl: location.href,
        freightYuan,
        skus,
        warnings,
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
})();
