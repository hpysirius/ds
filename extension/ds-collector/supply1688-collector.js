/**
 * 1688 商品详情页采集：价格 / 规格 / 重量 / 长宽高 / 另需运费 / 包装信息。
 *
 * 注入到当前标签页后调用 window.__dsCollect1688(cache) 拿结果。
 * 之所以放在页面里跑（而不是后端 HTTP 抓），是因为：
 *   - 机房 IP 会被 1688 的 cloud_ip_bl 整体拉黑（连滑块都不给），根本抓不到；
 *   - 这里是用户自己的浏览器：真实登录态 + 家庭宽带出口，基本不会被拦；
 *   - 渲染后的 DOM 里还能读到后端 HTML 里没有的可见文案（规格与包装表格）。
 *
 * ── 包装信息（商品件重尺）的取数优先级 ──
 *   0. 本地缓存：这个货品你上次手填过的长宽高（1688 自己没填时的救命稻草）
 *   1. 内联 JSON：productPackInfo.fields.pieceWeightScale.pieceWeightScaleInfo
 *      （每条含 length / width / height / volume / weight，可能带 skuId / sku1）
 *   2. 页面上渲染出来的「商品件重尺」表格：按表头 长(cm)/宽(cm)/高(cm)/体积/重量 对齐取值
 *   3. 可见文案里的尺寸：包装尺寸 24×19×7 / 长 24cm 宽 19cm 高 7cm
 *   4. 规格名里自带的尺寸：「2合1款双片装（17*7*3）」
 *   5. productPackInfo.fields.unitWeight（单位 kg）→ 只兜底重量
 *
 * ⚠ 1688 的「默认占位值」坑：
 *   商家没填包装尺寸时，接口照样返回 {length:1, width:1, height:1, volume:1}。
 *   这不是真实尺寸（1cm³ 的东西不存在），老版本会把它当真值回填 → 核价里的抛重/运费全算错。
 *   现在识别出来按「缺失」处理，并在 warnings 里明确提示手填。
 */
(function () {
  /** 从 innerHTML 里按 key 切出一个完整的 JSON 对象/数组（正确处理字符串里的括号） */
  function sliceBalanced(html, key, from) {
    const ki = html.indexOf('"' + key + '"', from || 0);
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

  /** 同一个 key 在页面里可能出现多次（先占位、后真实数据），全部切出来 */
  function sliceAllBalanced(html, key) {
    const out = [];
    let from = 0;
    for (let n = 0; n < 8; n++) {
      const s = sliceBalanced(html, key, from);
      if (!s) break;
      out.push(s);
      from = html.indexOf('"' + key + '"', from) + key.length + 2;
      if (from <= key.length + 1) break;
    }
    return out;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const cleanNum = (t) => {
    const n = Number(String(t == null ? '' : t).replace(/[,\s\u00a0]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  /**
   * 1688 的占位尺寸判定：商家没填时长宽高/体积全是 1。
   * 只在「数值齐全且明显不合理」时判为占位；缺值（null/0）不算占位，按缺失处理。
   */
  function isPlaceholderPack(l, w, h, volume) {
    const n = [Number(l), Number(w), Number(h)];
    if (n.some((x) => !Number.isFinite(x) || x <= 0)) return false;
    if (n.every((x) => x <= 1.0001)) return true; // 1×1×1
    const v = Number(volume);
    if (Number.isFinite(v) && v > 0 && v <= 1.0001) return true; // 体积 1cm³
    return false;
  }

  /** 一组尺寸能不能用（缺值 / 占位值 / 明显离谱都不要） */
  function usableDims(l, w, h, volume) {
    const n = [Number(l), Number(w), Number(h)];
    if (n.some((x) => !Number.isFinite(x) || x <= 0)) return false;
    if (isPlaceholderPack(l, w, h, volume)) return false;
    if (n.some((x) => x > 500)) return false; // 超过 5 米，多半是把 mm 当 cm 读了
    return true;
  }

  /** 规格名里抠尺寸：「2合1款双片装（17*7*3）」→ { l:17, w:7, h:3 }（按 长≥宽≥高 排） */
  function parseDimsFromName(name) {
    if (!name) return null;
    // 三个分隔符都要支持 * x × X —— 1688 规格名里最常见的是「（17*7*3）」
    const m = String(name).match(/(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = [Number(m[1]), Number(m[2]), Number(m[3])].filter((x) => x > 0);
    if (n.length !== 3) return null;
    if (!usableDims(n[0], n[1], n[2])) return null;
    n.sort((a, b) => b - a);
    return { l: n[0], w: n[1], h: n[2] };
  }

  /** 归一化文本（&gt; 之类实体还原 + 空白压缩） */
  function txt(s) {
    return String(s || '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
  }

  /**
   * 页面上「商品件重尺」那张表：找包含该文案的最小容器，再取里面的 table，
   * 按表头（长(cm)/宽(cm)/高(cm)/体积(cm³)/重量(g)）把数据行的值对齐出来。
   * 返回 { l, w, h, volume, weightG, raw }
   */
  function readPackTable() {
    try {
      const KEY = '商品件重尺';
      const nodes = document.querySelectorAll('div,section,td,th,span');
      let host = null;
      let hostLen = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const t = el.textContent || '';
        if (t.indexOf(KEY) < 0 || t.length > 4000) continue;
        if (t.length < hostLen) {
          hostLen = t.length;
          host = el;
        }
      }
      if (!host) return null;
      let table = host.querySelector('table');
      let p = host;
      while (!table && p && p !== document.body) {
        p = p.parentElement;
        if (p) table = p.querySelector('table');
      }
      if (!table) return null;

      const rows = [].slice.call(table.querySelectorAll('tr'));
      if (rows.length < 2) return null;

      // 表头：优先带 th 的那一行，否则第一行
      let headRow = null;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].querySelector('th')) {
          headRow = rows[i];
          break;
        }
      }
      if (!headRow) headRow = rows[0];
      const headCells = [].slice.call(headRow.querySelectorAll('th,td'));
      const heads = headCells.map((c) => txt(c.textContent));

      const mapAt = (kw) => {
        for (let i = 0; i < heads.length; i++) {
          for (let k = 0; k < kw.length; k++) if (heads[i].indexOf(kw[k]) >= 0) return i;
        }
        return -1;
      };
      const iL = mapAt(['长']);
      const iW = mapAt(['宽']);
      const iH = mapAt(['高']);
      const iV = mapAt(['体积']);
      const iG = mapAt(['重量', '重']);

      // 数据行：取第一个「能解析出数字」的行
      const out = [];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row === headRow) continue;
        const cells = [].slice.call(row.querySelectorAll('td,th'));
        if (!cells.length) continue;
        const vals = cells.map((c) => cleanNum(txt(c.textContent)));
        const rec = {
          l: iL >= 0 ? vals[iL] : null,
          w: iW >= 0 ? vals[iW] : null,
          h: iH >= 0 ? vals[iH] : null,
          volume: iV >= 0 ? vals[iV] : null,
          weightG: iG >= 0 ? vals[iG] : null,
          rowText: txt(row.textContent).slice(0, 120),
        };
        if (rec.l || rec.w || rec.h || rec.weightG) out.push(rec);
      }
      if (!out.length) return null;
      // 优先用尺寸可用的那一行
      const good = out.find((r) => usableDims(r.l, r.w, r.h, r.volume));
      return good || out[0];
    } catch (e) {
      return null;
    }
  }

  /** 可见文案里的尺寸兜底：包装尺寸 24×19×7 / 长 24cm 宽 19cm 高 7cm / 24*19*7cm */
  function parseDimsFromText(t) {
    if (!t) return null;
    const tri = String(t).match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米|CM)?/);
    if (tri) {
      const n = [Number(tri[1]), Number(tri[2]), Number(tri[3])];
      if (usableDims(n[0], n[1], n[2])) {
        n.sort((a, b) => b - a);
        return { l: n[0], w: n[1], h: n[2] };
      }
    }
    const L = String(t).match(/长[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米)?/);
    const W = String(t).match(/宽[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米)?/);
    const H = String(t).match(/高[度]?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米)?/);
    if (L && W && H) {
      const n = [Number(L[1]), Number(W[1]), Number(H[1])];
      if (usableDims(n[0], n[1], n[2])) {
        n.sort((a, b) => b - a);
        return { l: n[0], w: n[1], h: n[2] };
      }
    }
    return null;
  }

  /** 可见文案里的重量兜底 → 统一转 g */
  function parseWeightGFromText(t) {
    if (!t) return null;
    let m = String(t).match(/(?:净重|毛重|单件重量|件重|重[量]?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|千克|KG)/i);
    if (m) return Math.round(Number(m[1]) * 1000);
    m = String(t).match(/(?:净重|毛重|单件重量|件重|重[量]?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:g|克|G)(?![a-zA-Z])/);
    if (m) return Math.round(Number(m[1]));
    return null;
  }

  window.__dsCollect1688 = function (cache) {
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

      /* ───────── 包装信息（商品件重尺） ───────── */
      const pack = {
        weightG: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        volumeCm3: null,
        source: '', // packInfo | table | text | name | cache | ''
        placeholder: false, // 1688 返回的是 1×1×1 占位值
        rows: [],
      };

      const packRows = [];
      const pushRow = (r) => {
        if (!r) return;
        packRows.push({
          name: r.name || '',
          skuId: r.skuId || '',
          weightG: num(r.weightG),
          l: num(r.l),
          w: num(r.w),
          h: num(r.h),
          volume: num(r.volume),
          placeholder: isPlaceholderPack(r.l, r.w, r.h, r.volume),
        });
      };

      // 1) 内联 JSON：productPackInfo → fields.pieceWeightScale.pieceWeightScaleInfo
      let unitWeightKg = null; // fields.unitWeight（kg），只用来兜底重量
      for (const seg of sliceAllBalanced(html, 'productPackInfo')) {
        try {
          const obj = JSON.parse(seg);
          const f = (obj && obj.fields) || {};
          if (f.unitWeight != null) {
            const kg = num(f.unitWeight);
            if (kg != null && kg > 0) unitWeightKg = kg;
          }
          const info = f.pieceWeightScale && f.pieceWeightScale.pieceWeightScaleInfo;
          (Array.isArray(info) ? info : []).forEach((x) => {
            pushRow({
              name: String((x && (x.sku1 || x.skuName)) || '').trim(),
              skuId: String((x && x.skuId) || ''),
              weightG: num(x && x.weight),
              l: num(x && x.length),
              w: num(x && x.width),
              h: num(x && x.height),
              volume: num(x && x.volume),
            });
          });
        } catch (e) {
          /* 结构变了就走下一个源 */
        }
      }
      // 1b) 退化：页面里散落的 pieceWeightScaleInfo
      if (!packRows.length) {
        for (const seg of sliceAllBalanced(html, 'pieceWeightScaleInfo')) {
          try {
            const arr = JSON.parse(seg);
            (Array.isArray(arr) ? arr : []).forEach((x) => {
              pushRow({
                name: String((x && (x.sku1 || x.skuName)) || '').trim(),
                skuId: String((x && x.skuId) || ''),
                weightG: num(x && x.weight),
                l: num(x && x.length),
                w: num(x && x.width),
                h: num(x && x.height),
                volume: num(x && x.volume),
              });
            });
          } catch (e) {
            /* ignore */
          }
        }
      }
      pack.rows = packRows;

      // 2) 从内联数据里挑一条能用的（多 SKU 时优先长宽高齐全且非占位的）
      const goodRow = packRows.find((r) => usableDims(r.l, r.w, r.h, r.volume));
      const wtRow = packRows.find((r) => r.weightG != null && r.weightG > 0);
      if (goodRow) {
        pack.lengthCm = goodRow.l;
        pack.widthCm = goodRow.w;
        pack.heightCm = goodRow.h;
        pack.volumeCm3 = goodRow.volume != null ? goodRow.volume : Math.round(goodRow.l * goodRow.w * goodRow.h * 1000) / 1000;
        pack.source = 'packInfo';
      } else if (packRows.length) {
        pack.placeholder = true; // 有数据，但全是 1×1×1 占位
      }
      if (wtRow) pack.weightG = wtRow.weightG;
      else if (unitWeightKg != null) pack.weightG = Math.round(unitWeightKg * 1000);
      if (pack.weightG != null && !pack.source) pack.source = 'unitWeight';

      // 3) 页面上渲染出来的「商品件重尺」表格（内联数据是占位时，这里通常也是；但保留作为二次校验）
      if (!usableDims(pack.lengthCm, pack.widthCm, pack.heightCm, pack.volumeCm3)) {
        const tb = readPackTable();
        if (tb) {
          if (usableDims(tb.l, tb.w, tb.h, tb.volume)) {
            pack.lengthCm = tb.l;
            pack.widthCm = tb.w;
            pack.heightCm = tb.h;
            pack.volumeCm3 = tb.volume != null ? tb.volume : Math.round(tb.l * tb.w * tb.h * 1000) / 1000;
            pack.source = 'table';
          }
          if (pack.weightG == null && tb.weightG != null && tb.weightG > 0) {
            pack.weightG = tb.weightG;
            if (!pack.source) pack.source = 'table';
          }
        }
      }

      // 4) 可见文案兜底（包装尺寸 / 长宽高 / 重量）
      const bodyText = document.body ? document.body.innerText || '' : '';
      if (bodyText) {
        if (!usableDims(pack.lengthCm, pack.widthCm, pack.heightCm, pack.volumeCm3)) {
          const d = parseDimsFromText(bodyText);
          if (d) {
            pack.lengthCm = d.l;
            pack.widthCm = d.w;
            pack.heightCm = d.h;
            pack.volumeCm3 = Math.round(d.l * d.w * d.h * 1000) / 1000;
            pack.source = 'text';
            pack.placeholder = false;
          }
        }
        if (pack.weightG == null) {
          const g = parseWeightGFromText(bodyText);
          if (g != null && g > 0) {
            pack.weightG = g;
            if (!pack.source) pack.source = 'text';
          }
        }
      }

      /* ───────── 价格：规格价 vs 阶梯价（区间价） ─────────
       * 1688 有两种定价方式，必须都兼容：
       *   a) 按规格定价 —— 价格在 skuMap/skuInfoMap 的 price/discountPrice 里（老商品常见）
       *   b) 按购买数量阶梯定价 —— skuPriceType:"rangePrice"，规格列表里【没有】价格字段
       *      （只有 priceAmount = 档位数，不是钱！），价格在 offerPriceRanges / currentPrices
       *      / skuRangePrices 里；页面上每个规格行显示的是「最小起批量那一档」的价。
       * 之前只读规格价 → 遇到 (b) 类商品价格全空，选完尺码也填不出成本。
       */
      const priceRanges = [];
      const addRanges = (arr) => {
        (Array.isArray(arr) ? arr : []).forEach((x) => {
          const p = num(x && (x.discountPrice != null ? x.discountPrice : x.price));
          if (p == null || p <= 0) return;
          const rec = {
            price: p,
            beginAmount: num(x.beginAmount) || 1,
            endAmount: num(x.endAmount) || 0,
          };
          if (priceRanges.some((r) => r.price === rec.price && r.beginAmount === rec.beginAmount)) return;
          priceRanges.push(rec);
        });
      };
      for (const key of ['offerPriceRanges', 'currentPrices', 'skuRangePrices']) {
        for (const seg of sliceAllBalanced(html, key)) {
          try {
            addRanges(JSON.parse(seg));
          } catch (e) {
            /* currentPrices 可能是 {"$ref":…} 占位，跳过 */
          }
        }
        if (priceRanges.length) break;
      }
      // 起批量最小的那档 = 页面上规格行显示的单价（也是这个货品「选完规格就看到」的价格）
      priceRanges.sort((a, b) => a.beginAmount - b.beginAmount);
      let basePrice = priceRanges.length ? priceRanges[0].price : null;
      // 价格区间："skuPriceScale":"2.96-3.50"（最低价-最高价）
      let priceMin = null;
      let priceMax = null;
      const scaleM = html.match(/"skuPriceScale"\s*:\s*"([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)"/);
      if (scaleM) {
        priceMin = num(scaleM[1]);
        priceMax = num(scaleM[2]);
      }
      if (priceMin == null) {
        const mn = html.match(/"offerMinPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
        const mx = html.match(/"offerMaxPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
        if (mn) priceMin = num(mn[1]);
        if (mx) priceMax = num(mx[1]);
      }
      // 最后兜底：页面上的 priceDisplay（规格行价）/ 可见的 ¥ 数字
      if (basePrice == null) {
        const pd = html.match(/"priceDisplay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)"/);
        if (pd) basePrice = num(pd[1]);
      }

      // ---- 规格与价格：skuMap / skuMapOriginal / skuInfoMap ----
      const skus = [];
      const seen = new Set();
      const packBySkuId = new Map();
      const packByName = new Map();
      packRows.forEach((r) => {
        if (r.skuId && !packBySkuId.has(r.skuId)) packBySkuId.set(r.skuId, r);
        if (r.name && !packByName.has(r.name)) packByName.set(r.name, r);
      });

      const pushSku = (name, price, skuId) => {
        const nm = txt(name); // 规格名里有 &gt; 之类的实体（"藏青色&gt;女款37-41码"），顺手还原
        if (!nm || seen.has(nm)) return;
        seen.add(nm);
        const row = packBySkuId.get(String(skuId || '')) || packByName.get(nm);
        const nameDims = parseDimsFromName(nm); // 规格名里的尺寸最贴近实际包装（17*7*3）
        const rowDims = row && usableDims(row.l, row.w, row.h, row.volume) ? { l: row.l, w: row.w, h: row.h } : null;
        const dims = nameDims || rowDims || null;
        skus.push({
          name: nm.slice(0, 120),
          skuId: String(skuId || ''),
          // 规格自带价优先；区间价商品规格里没价 → 用「最小起批量那档」的价（页面上显示的就是它）
          price: price != null ? price : basePrice,
          weightG: (row && row.weightG) || pack.weightG || null,
          lengthCm: dims ? dims.l : null,
          widthCm: dims ? dims.w : null,
          heightCm: dims ? dims.h : null,
        });
      };
      ['skuMap', 'skuMapOriginal'].forEach((key) => {
        for (const seg of sliceAllBalanced(html, key)) {
          try {
            const arr = JSON.parse(seg);
            (Array.isArray(arr) ? arr : []).forEach((x) => {
              // 注意：priceAmount 是「阶梯价档位数」不是价格（很多页面里它就是 1），别拿来当价格
              const p = x && (x.discountPrice != null ? x.discountPrice : x.price);
              pushSku(x && (x.specAttrs || x.skuName || x.name), num(p), x && x.skuId);
            });
          } catch (e) {
            /* 单个源解析失败不影响其他源 */
          }
        }
      });
      for (const seg of sliceAllBalanced(html, 'skuInfoMap')) {
        try {
          const obj = JSON.parse(seg);
          Object.keys(obj || {}).forEach((k) => {
            const x = obj[k] || {};
            const p = x.discountPrice != null ? x.discountPrice : x.price;
            pushSku(k, num(p), x.skuId);
          });
        } catch (e) {
          /* ignore */
        }
      }

      // ---- 另需运费 ----
      let freightYuan = null;
      const fm = html.match(/"totalCost"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
      if (fm) freightYuan = num(fm[1]);

      // ---- 页面上可见的价格兜底 ----
      let textPrice = null;
      if (bodyText) {
        const pm = bodyText.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
        if (pm) textPrice = num(pm[1]);
      }

      // 0) 本地缓存：这个货品以前手填过尺寸的话，优先用（1688 自己没填时这是唯一可信来源）
      let cacheHit = null;
      try {
        const ck = offerId ? String(offerId) : '';
        const c = (cache && ck && cache[ck]) || null;
        if (c && usableDims(c.l, c.w, c.h)) {
          cacheHit = c;
          pack.lengthCm = Number(c.l);
          pack.widthCm = Number(c.w);
          pack.heightCm = Number(c.h);
          pack.volumeCm3 = Math.round(Number(c.l) * Number(c.w) * Number(c.h) * 1000) / 1000;
          if (c.weightG > 0) pack.weightG = Number(c.weightG);
          pack.source = 'cache';
          pack.placeholder = false;
        }
      } catch (e) {
        /* ignore */
      }

      // 规格列表里缺尺寸的，用整体包装信息兜底
      const dimsOk = usableDims(pack.lengthCm, pack.widthCm, pack.heightCm, pack.volumeCm3);
      if (skus.length && dimsOk) {
        skus.forEach((s) => {
          if (!s.lengthCm && !s.widthCm && !s.heightCm) {
            s.lengthCm = pack.lengthCm;
            s.widthCm = pack.widthCm;
            s.heightCm = pack.heightCm;
          }
          if (s.weightG == null) s.weightG = pack.weightG;
        });
      }

      // 没有任何规格时，用页面文案 + 标题拼一条
      if (!skus.length) {
        skus.push({
          name: title ? title.slice(0, 60) : '默认',
          skuId: '',
          price: textPrice != null ? textPrice : basePrice,
          weightG: pack.weightG,
          lengthCm: dimsOk ? pack.lengthCm : null,
          widthCm: dimsOk ? pack.widthCm : null,
          heightCm: dimsOk ? pack.heightCm : null,
        });
        warnings.push('没读到规格列表，用页面上的价格/件重尺兜底（请核对）');
      }

      // ---- 提示 ----
      if (cacheHit) warnings.push('包装尺寸用了你上次手填的值（1688 页面本身没有）');
      else if (!dimsOk) {
        warnings.push(
          pack.placeholder
            ? '1688 没填包装尺寸（页面上是默认的 1×1×1），请在下面手填长宽高'
            : '没读到包装尺寸，请在下面手填长宽高',
        );
      }
      if (!skus.some((s) => s.price != null)) warnings.push('没读到价格，请在弹窗里手填');
      if (!skus.some((s) => s.weightG != null)) warnings.push('没读到重量，请在弹窗里手填');
      if (priceRanges.length > 1 && basePrice != null && priceMin != null && priceMin < basePrice) {
        const tiers = priceRanges.map((r) => `≥${r.beginAmount}件 ¥${r.price}`).join(' / ');
        warnings.push(`这是按数量阶梯定价：${tiers} —— 已按最小起批量 ¥${basePrice} 填成本，买得多会更便宜`);
      }

      return {
        ok: true,
        offerId,
        title,
        offerUrl: location.href,
        freightYuan,
        // 价格：basePrice = 最小起批量那档（页面上规格行显示的价）；priceRanges = 完整阶梯价
        basePrice,
        priceMin,
        priceMax,
        priceRanges,
        minOrderQuantity: priceRanges.length ? priceRanges[0].beginAmount : null,
        pack: {
          weightG: pack.weightG,
          lengthCm: dimsOk ? pack.lengthCm : null,
          widthCm: dimsOk ? pack.widthCm : null,
          heightCm: dimsOk ? pack.heightCm : null,
          volumeCm3: dimsOk ? pack.volumeCm3 : null,
          source: dimsOk ? pack.source : '',
          placeholder: pack.placeholder && !dimsOk,
          rows: packRows,
        },
        skus,
        warnings,
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
})();
