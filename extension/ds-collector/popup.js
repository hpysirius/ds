/** 弹窗交互：状态显示 + 触发采集 */
const $ = (id) => document.getElementById(id);

// 常用后端地址一键填入：本地开发 / 已部署的服务器（服务器走 nginx，接口都在 /api 下）
const PRESET_LOCAL = 'http://localhost:3101';
const PRESET_SERVER = 'http://ozon.qinxianty.com/api';

async function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: '无响应' }));
  });
}

async function refresh() {
  const r = await send({ type: 'DS_STATUS' });
  const st = (r.state || {});
  // 正在输入时绝不覆盖输入框的值 —— 否则每 2s 的状态刷新会把用户打到一半的地址冲掉
  if (document.activeElement !== $('api')) {
    $('api').value = r.api || '';
  }
  const total = st.total || 0;
  const done = st.done || 0;
  $('bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0';

  const logs = st.logs || [];
  $('logs').innerHTML = logs.length
    ? logs.map((l) => `<div>${escapeHtml(l)}</div>`).join('')
    : '<div>（暂无日志）</div>';

  $('batch').disabled = !!st.running;
  $('stop').disabled = !st.running;
  $('batch').textContent = st.running ? `补详情中 ${done}/${total}` : '补详情(批量)';

  // 采集归属：内容脚本从 ds 网页读到的当前登录身份，决定数据归到哪个店铺
  const idn = r.identity || {};
  if (idn.token) {
    const who = idn.nickname || idn.username || '已登录';
    const where = idn.storeName
      ? idn.storeName
      : idn.storeId == null
        ? '全部店铺'
        : `店铺#${idn.storeId}`;
    $('identity').textContent = `${who} · ${where}`;
    $('identity').style.color = '#16a34a';
  } else {
    $('identity').textContent = '未登录（归超管「全部」）· 请在浏览器打开 ds 系统页面';
    $('identity').style.color = '#d97706';
  }

  // 后端连通性 + 待补数量（统一走 background，popup 自己不再直接 fetch）
  const p = await send({ type: 'DS_PING' });
  $('dot').className = `dot ${p.ok ? 'on' : 'off'}`;
  if (p.ok) {
    $('apiState').textContent = `已连接 ${p.api}`;
    $('remaining').textContent = p.remaining != null ? p.remaining : '-';
  } else {
    // 错误信息由 background 给出（本地/远程提示不同），这里原样展示，避免"连不上后端（连不上后端…）"套娃
    $('apiState').textContent = p.error || `HTTP ${p.status}`;
    $('remaining').textContent = '-';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let timer = null;

$('saveApi').onclick = async () => {
  const btn = $('saveApi');
  btn.disabled = true;
  btn.textContent = '保存中…';
  await send({ type: 'DS_SET_API', api: $('api').value.trim() });
  // 主动失焦，让下一次状态刷新能同步显示最新地址
  $('api').blur();
  await refresh();
  btn.disabled = false;
  btn.textContent = '已保存 ✓';
  setTimeout(() => { btn.textContent = '保存'; }, 1500);
};

// 一键填入常用地址（填完直接保存，省一次点击）
async function usePreset(v) {
  $('api').value = v;
  $('api').blur();
  await send({ type: 'DS_SET_API', api: v });
  await refresh();
}
$('useLocal').onclick = () => usePreset(PRESET_LOCAL);
$('useServer').onclick = () => usePreset(PRESET_SERVER);

// 采集规则管理页（新增/编辑/启停规则，采集时自动按规则打标签）
$('rules').onclick = () => chrome.runtime.openOptionsPage();

// 过滤模式：开启后采集时只保留命中规则的商品（存本地，background 采集时读取）
const FILTER_KEY = 'ds_filter_mode';
chrome.storage.local.get([FILTER_KEY]).then((s) => {
  $('filterMode').checked = !!s[FILTER_KEY];
});
$('filterMode').onchange = async () => {
  await chrome.storage.local.set({ [FILTER_KEY]: $('filterMode').checked });
};

$('collect').onclick = async () => {
  $('collect').disabled = true;
  $('collect').textContent = '采集中…';
  const r = await send({ type: 'DS_COLLECT_CURRENT' });
  $('collect').disabled = false;
  $('collect').textContent = '采集当前商品页';
  if (!r.ok) {
    alert(r.error || '采集失败');
  } else if (r.result) {
    const x = r.result;
    if (x.ok) {
      const fields = x.fields || [];
      alert(
        `${x.created ? '✅ 已录入新商品' : '✅ 已更新商品'}：${x.sku}\n` +
          `写入 ${fields.length} 个字段：${fields.join('、').slice(0, 160) || '（无）'}\n\n` +
          `${fields.length ? '去商品库页面就能看到这条。' : '⚠️ 页面没读到可用字段，刷新页面后重试。'}`,
      );
    } else {
      alert(`⚠️ 未写入：${x.reason || '无可用字段'}`);
    }
  }
  await refresh();
};

$('collectList').onclick = async () => {
  const btn = $('collectList');
  btn.disabled = true;
  btn.textContent = '抓取中…';
  const r = await send({ type: 'DS_COLLECT_LIST', scrolls: Number($('scrolls').value) || 0 });
  btn.disabled = false;
  btn.textContent = '采集当前列表页';
  if (!r.ok) alert(r.error || '采集失败');
  else if (r.result) {
    const x = r.result;
    const c = x.coverage;
    const covLine = c
      ? `\n\n字段覆盖（共 ${x.total}）：\n` +
        `  名称 ${c.title} · 价格 ${c.price} · 主图 ${c.image} · 评论 ${c.reviews}\n` +
        `  经营指标 ${c.card}${c.card ? '' : '（无：月销/加购率/退货率/广告占比/上架天 需要中实ERP选品插件的浮层）'}\n` +
        `  类目/品牌/发货 需点商品库的「补信息」用详情页补`
      : '';
    alert(
      `抓到 ${x.total} 个商品\n新建 ${x.created} 个\n更新 ${x.updated} 个` +
        covLine +
        (x.aborted ? `\n\n⚠️ 滚动中途页面出错（已停止），但已抓到并上传了 ${x.total} 个。\n原因：${x.aborted}` : ''),
    );
  }
  await refresh();
};

$('batch').onclick = async () => {
  await send({ type: 'DS_START_BATCH', limit: Number($('limit').value) || 20 });
  timer = setInterval(refresh, 1500);
  await refresh();
};

$('stop').onclick = async () => {
  await send({ type: 'DS_STOP' });
  clearInterval(timer);
  await refresh();
};

/* ─────────────── 1688 采集 → 回填核价页 ─────────────── */

let supply1688 = null; // 最近一次抓到的 1688 货品数据

/** 规格下拉里的一行：名称 + 价格 + 重量 + 尺寸（尺寸为占位/缺失时不显示，避免误导） */
function fmtSku(s) {
  const bits = [];
  if (s.price != null) bits.push('¥' + s.price);
  if (s.weightG != null) bits.push((s.weightG / 1000).toFixed(3) + 'kg');
  if (s.lengthCm && s.widthCm && s.heightCm) bits.push(`${s.lengthCm}×${s.widthCm}×${s.heightCm}`);
  else bits.push('尺寸待填');
  const tail = bits.length ? ' — ' + bits.join(' · ') : '';
  return (s.name || '默认') + tail;
}

/** 把某个规格的数值写进下面那排输入框（成本 = 规格价 + 另需运费） */
function applySkuToForm(s) {
  if (!s) return;
  const fr = supply1688 && supply1688.freightYuan != null && $('addFreight').checked ? Number(supply1688.freightYuan) : 0;
  if (s.price != null) $('fCost').value = Number((Number(s.price) + fr).toFixed(2));
  $('fWt').value = s.weightG != null ? Number((Number(s.weightG) / 1000).toFixed(4)) : '';
  // 1688 商家没填尺寸时会返回占位值 1×1×1，采集脚本已经把它判成缺失 —— 这里千万别填 1 进去
  $('fL').value = s.lengthCm != null ? s.lengthCm : '';
  $('fW').value = s.widthCm != null ? s.widthCm : '';
  $('fH').value = s.heightCm != null ? s.heightCm : '';
  $('fFr').value = supply1688 && supply1688.freightYuan != null ? supply1688.freightYuan : '';
  markMissingDims();
}

/** 缺尺寸时把长宽高输入框标黄，提醒手填 */
function markMissingDims() {
  ['fL', 'fW', 'fH'].forEach((id) => {
    const el = $(id);
    const empty = el.value === '' || Number(el.value) <= 1;
    el.style.borderColor = empty ? '#d97706' : '';
    el.style.background = empty ? '#fffbeb' : '';
  });
}

function showFillInfo(html) {
  const el = $('fillInfo');
  el.style.display = html ? 'block' : 'none';
  el.innerHTML = html || '';
}

$('grab1688').onclick = async () => {
  const btn = $('grab1688');
  btn.disabled = true;
  btn.textContent = '抓 1688 中…';
  try {
    const r = await send({ type: 'DS_COLLECT_1688' });
    if (!r.ok) throw new Error(r.error || '采集失败');
    supply1688 = r.result;
    const skus = supply1688.skus || [];
    $('skuSel').innerHTML = skus.map((s, i) => `<option value="${i}">${escapeHtml(fmtSku(s))}</option>`).join('');
    // 默认选最便宜的那个（通常是单件最低配）
    let idx = 0;
    let best = Infinity;
    skus.forEach((s, i) => {
      if (s.price != null && s.price < best) {
        best = s.price;
        idx = i;
      }
    });
    $('skuSel').value = String(idx);
    applySkuToForm(skus[idx]);
    const w = supply1688.warnings || [];
    const pk = supply1688.pack || {};
    const SRC = {
      packInfo: '1688 商品件重尺',
      table: '页面件重尺表格',
      text: '页面文案',
      unitWeight: '1688 单件重量',
      cache: '你上次填的',
    };
    const pr = supply1688.priceRanges || [];
    const priceLine =
      pr.length > 1
        ? `<div style="margin-top:3px">阶梯价：${pr
            .map((r) => `≥${r.beginAmount}件 ¥${r.price}`)
            .join(' / ')} <span style="color:#6b7280">（按最小起批量 ¥${supply1688.basePrice} 填的成本，可手改）</span></div>`
        : '';
    const packLine =
      pk.lengthCm && pk.widthCm && pk.heightCm
        ? `<div style="margin-top:3px">包装 ${pk.lengthCm}×${pk.widthCm}×${pk.heightCm}cm` +
          (pk.volumeCm3 != null ? ` · 体积 ${pk.volumeCm3}` : '') +
          (pk.weightG != null ? ` · ${pk.weightG}g` : '') +
          (pk.source ? ` <span style="color:#6b7280">（${escapeHtml(SRC[pk.source] || pk.source)}）</span>` : '') +
          `</div>`
        : `<div style="margin-top:3px">包装尺寸 <b style="color:#d97706">缺失</b>${
            pk.placeholder ? '（1688 页面上是默认的 1×1×1，商家没填）' : ''
          }${pk.weightG != null ? ` · 重量 ${pk.weightG}g` : ''}</div>`;
    showFillInfo(
      `<div><b>${escapeHtml((supply1688.title || '').slice(0, 40))}</b></div>` +
        `<div style="margin-top:3px">抓到 ${skus.length} 个规格${
          supply1688.freightYuan != null ? ` · 另需运费 ¥${supply1688.freightYuan}` : ''
        }</div>` +
        priceLine +
        packLine +
        (w.length ? `<div style="margin-top:3px;color:#d97706">⚠ ${w.map(escapeHtml).join('；')}</div>` : ''),
    );
  } catch (e) {
    showFillInfo(`<div style="color:#dc2626">${escapeHtml(e.message)}</div>`);
  } finally {
    btn.disabled = false;
    btn.textContent = '抓当前 1688 页';
  }
};

$('skuSel').onchange = () => {
  const skus = (supply1688 && supply1688.skus) || [];
  applySkuToForm(skus[Number($('skuSel').value)]);
};

// 勾上/取消「加运费」时重算成本
$('addFreight').onchange = () => {
  const skus = (supply1688 && supply1688.skus) || [];
  applySkuToForm(skus[Number($('skuSel').value)]);
};

// 手填尺寸时实时取消黄色告警
['fL', 'fW', 'fH'].forEach((id) => {
  $(id).addEventListener('input', markMissingDims);
});

$('fillBtn').onclick = async () => {
  const url = $('target').value.trim();
  if (!url) {
    alert('请先填核价页地址，例如 http://ozon.qinxianty.com/pricing?sku=5611145930');
    return;
  }
  const btn = $('fillBtn');
  btn.disabled = true;
  btn.textContent = '回填中…';
  try {
    await chrome.storage.local.set({ pricingUrl: url });
    // 手填/微调过的包装尺寸记下来：1688 自己没填时，下次抓同一货品能自动带上
    if (supply1688 && supply1688.offerId) {
      await send({
        type: 'DS_SAVE_PACK',
        offerId: supply1688.offerId,
        pack: {
          l: $('fL').value,
          w: $('fW').value,
          h: $('fH').value,
          weightG: $('fWt').value != null && $('fWt').value !== '' ? Number($('fWt').value) * 1000 : 0,
        },
      });
    }
    const r = await send({
      type: 'DS_FILL_PRICING',
      url,
      data: {
        purchaseCost: $('fCost').value,
        weightKg: $('fWt').value,
        lengthCm: $('fL').value,
        widthCm: $('fW').value,
        heightCm: $('fH').value,
        supplyUrl: supply1688 ? supply1688.offerUrl : '',
        title: supply1688 ? supply1688.title : '',
      },
    });
    if (!r.ok) throw new Error(r.error || '回填失败');
    showFillInfo('<div style="color:#16a34a">✓ 已回填，核价页已打开/刷新</div>');
  } catch (e) {
    showFillInfo(`<div style="color:#dc2626">${escapeHtml(e.message)}</div>`);
  } finally {
    btn.disabled = false;
    btn.textContent = '回填到核价页';
  }
};

// 记住上次填的核价页地址（和 api 一样，别被定时刷新冲掉）
chrome.storage.local.get(['pricingUrl']).then((s) => {
  if (s.pricingUrl) $('target').value = s.pricingUrl;
});

// 打开弹窗时把采集规则同步一份到后台系统（后台「规则标签管理」页展示用）。
// 静默执行：同步失败只在日志里留一行，不影响采集。
send({ type: 'DS_SYNC_RULES' });

/* ─────────── 记一笔（自采购备忘录）─────────── */

let memoPackText = ''; // 最近一次从 1688 抓到的「包装信息原文」，保存时一并上报
let memoSpecName = ''; // 记一笔规格下拉里当前选中的 1688 规格名，保存时存 specName
let memoOzonData = null; // 最近一次从 Ozon 抓到的数据（跟卖价 / 主图 …），保存时一并上报

/**
 * 从 Ozon 链接解析 SKU（与后端 extractOzonSku 同逻辑）。
 * SKU 是这条记录关联 Ozon ↔ 1688 的标识，能自动带出就别手填。
 */
function extractOzonSku(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const q = u.searchParams.get('sku');
    if (q && /^\d{4,20}$/.test(q)) return q;
    const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
    const m = seg.match(/(\d{4,20})$/);
    if (m) return m[1];
  } catch (e) {
    /* 不是完整 URL，走下面兜底 */
  }
  const q2 = raw.match(/[?&]sku=(\d{4,20})/);
  if (q2) return q2[1];
  const seg2 = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '';
  const m2 = seg2.match(/(\d{4,20})$/);
  return m2 ? m2[1] : null;
}

/**
 * 站点识别：决定「取当前页」把地址填进哪个框。
 * ⚠ 必须区分！Ozon 地址填进「1688 货源链接」= 存错字段（2026-10-09 用户报）。
 */
function detectSite(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    host = '';
  }

  // 先排除 ds 自己的页面 —— 线上域名 ozon.qinxianty.com 里也含 "ozon"，别误判成 Ozon 商品页
  const isSelf =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '114.132.99.141' ||
    /(^|\.)qinxianty\.com$/.test(host);
  if (isSelf) return 'self';

  // 严格按域名后缀判断，不用 includes（防误判）
  const isOzon = /(^|\.)ozon\.(ru|by|kz|uz|ge|am|com)$/.test(host);
  const is1688 =
    /(^|\.)1688\.com$/.test(host) ||
    /(^|\.)(taobao|tmall|alibaba|alicdn)\.(com|cn)$/.test(host);

  if (isOzon) return 'ozon';
  if (is1688) return '1688';
  return 'other';
}

/**
 * 抓当前 Ozon 商品页的「跟卖价」（页面在售价）并填进表单。
 *
 * ⚠ 币种：Ozon 会按账号语言把价格渲染成 ¥ —— 这里**原样**把数值 + 符号填进表单
 * （符号显示在「跟卖价」标签上），由后端按汇率折成 ₽ 存库，别在这里自作主张换算。
 */
async function grabOzonPrice() {
  const r = await send({ type: 'DS_COLLECT_OZON' });
  if (!r.ok) throw new Error(r.error || '采集失败');
  const d = r.result || {};
  if (d.price == null) throw new Error('没读到价格');
  memoOzonData = d;
  $('memoRetail').value = d.price;
  $('memoRetailSym').textContent = d.symbol === '¥' ? '¥' : '₽';
  if (d.title && !$('memoName').value) $('memoName').value = String(d.title).slice(0, 200);
  if (d.url) $('memoOzon').value = d.url;
  if (d.sku && !$('memoSku').value) $('memoSku').value = d.sku;
  return d;
}

// 「取当前页」：自动识别当前页是 Ozon 还是 1688，把地址填进对应字段（标题顺带填入）
$('memoFromPage').onclick = async () => {
  const btn = $('memoFromPage');
  const orig = btn.textContent;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const url = tab.url || '';
    if (!url) return;

    const site = detectSite(url);
    if (site === 'self') {
      btn.textContent = '当前是 ds 后台页';
      return; // 别把自家域名当商品链接填进去
    }
    // 标题：去掉平台后缀，只留商品名（1688 是「xxx - 阿里巴巴」；Ozon 是「xxx | Ozon」）
    let title = (tab.title || '').trim();
    if (site === '1688') title = title.replace(/\s*[-|–—]\s*(1688|阿里巴巴|Alibaba).*$/i, '').trim();
    if (site === 'ozon') title = title.replace(/\s*[-|–—]\s*(Ozon|OZON|Озон|ОЗОН).*$/i, '').trim();

    if (site === 'ozon') {
      $('memoOzon').value = url; // Ozon 页面 → 填「Ozon 链接」
      if (title && !$('memoName').value) $('memoName').value = title.slice(0, 200);
      // 顺手把 SKU 解析出来（没解析到就留空让人手填）
      const sku = extractOzonSku(url);
      if (sku && !$('memoSku').value) $('memoSku').value = sku;
      // 在 Ozon 页「取当前页」就顺带把跟卖价带上（读不到不影响填链接，静默略过）
      let tail = sku ? `✓ SKU ${sku}` : '✓ 已填 Ozon 链接';
      try {
        const d = await grabOzonPrice();
        tail += ` · ${d.price}${d.symbol || ''}`;
      } catch (e) {
        /* 没读到价格就算了，别挡着填链接 */
      }
      btn.textContent = tail;
    } else {
      $('memoUrl').value = url; // 1688 / 淘宝 / 天猫 → 填「货源链接」
      if (title && !$('memoName').value) $('memoName').value = title.slice(0, 200);
      btn.textContent = site === '1688' ? '✓ 已填 1688 货源' : '✓ 已填到货源链接';
    }
  } catch (e) {
    btn.textContent = '取当前页失败';
  } finally {
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  }
};

/** 「抓当前 Ozon 页」：把在售价（跟卖价）+ 标题 + 链接 + SKU 填进备忘录表单 */
$('memoGrabOzon').onclick = async () => {
  const btn = $('memoGrabOzon');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '抓 Ozon 中…';
  try {
    const d = await grabOzonPrice();
    btn.textContent = `✓ ${d.price}${d.symbol || ''}`;
  } catch (e) {
    btn.textContent = '抓取失败';
    alert(`抓 Ozon 失败：${(e && e.message) || e}`);
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = orig;
    }, 1800);
  }
};

/** 把记一笔下拉选中的规格数值写进成本/重量/长宽高（与回填核价区的 applySkuToForm 同款口径） */
function applySpecToMemo(s) {
  if (!s) return;
  if (s.price != null) $('memoCost').value = Number(s.price);
  if (s.weightG != null) $('memoWt').value = Number((Number(s.weightG) / 1000).toFixed(4));
  // 1688 没填尺寸时是占位 1×1×1，别填进去误导
  $('memoL').value = s.lengthCm != null && s.lengthCm > 1 ? s.lengthCm : '';
  $('memoW').value = s.widthCm != null && s.widthCm > 1 ? s.widthCm : '';
  $('memoH').value = s.heightCm != null && s.heightCm > 1 ? s.heightCm : '';
}

/** 「抓当前 1688 页」：把货品信息填进备忘录表单（成本 / 重量 / 尺寸 / 包装） */
$('memoGrab1688').onclick = async () => {
  const btn = $('memoGrab1688');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '抓 1688 中…';
  try {
    const r = await send({ type: 'DS_COLLECT_1688' });
    if (!r.ok) throw new Error(r.error || '采集失败');
    const d = r.result || {};
    supply1688 = d; // 与「回填核价页」区共享，保存时按「抓取录入」留痕
    const skus = d.skus || [];

    // 规格下拉：和「回填核价页」的 skuSel 同款，默认选最便宜的规格（通常是单件最低配）
    const sel = $('memoSkuSel');
    sel.innerHTML = skus.length
      ? skus.map((x, i) => `<option value="${i}">${escapeHtml(fmtSku(x))}</option>`).join('')
      : '<option value="">（没抓到规格，手填数值）</option>';
    let idx = 0;
    let best = Infinity;
    skus.forEach((x, i) => {
      if (x.price != null && x.price < best) {
        best = x.price;
        idx = i;
      }
    });
    sel.value = String(idx);

    if (d.title && !$('memoName').value) $('memoName').value = String(d.title).slice(0, 200);
    if (d.offerUrl) $('memoUrl').value = d.offerUrl;
    const s = skus[idx];
    applySpecToMemo(s);
    memoSpecName = s && s.name ? String(s.name).slice(0, 255) : '';

    // 拼一份包装信息原文（存进 self_purchases.packageText）
    const pk = d.pack || {};
    const bits = [];
    if (pk.weightG != null) bits.push(`${pk.weightG}g`);
    if (pk.lengthCm && pk.widthCm && pk.heightCm) bits.push(`${pk.lengthCm}*${pk.widthCm}*${pk.heightCm}cm`);
    memoPackText = bits.join(' ');

    btn.textContent = `✓ 抓到 ${skus.length} 个规格`;
  } catch (e) {
    btn.textContent = '抓取失败';
    alert(`抓 1688 失败：${(e && e.message) || e}`);
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = orig;
    }, 1800);
  }
};

// 切换规格 → 自动带出该规格的成本/重量/尺寸，并记住规格名
$('memoSkuSel').onchange = () => {
  const skus = (supply1688 && supply1688.skus) || [];
  const s = skus[Number($('memoSkuSel').value)];
  applySpecToMemo(s);
  memoSpecName = s && s.name ? String(s.name).slice(0, 255) : '';
};

$('memoSave').onclick = async () => {
  const name = $('memoName').value.trim();
  const supplyUrl = $('memoUrl').value.trim();
  const retailUrl = $('memoOzon').value.trim();
  const sku = $('memoSku').value.trim();
  if (!name && !supplyUrl && !retailUrl && !sku) {
    alert('至少填「SKU / 商品名称 / 1688 货源链接 / Ozon 链接」其中一个');
    return;
  }

  const btn = $('memoSave');
  btn.disabled = true;
  btn.textContent = '记一笔中…';
  try {
    const payload = {
      sku: sku || undefined,
      name: name || undefined,
      supplyUrl: supplyUrl || undefined,
      retailUrl: retailUrl || undefined,
    };
    const cost = $('memoCost').value;
    const wt = $('memoWt').value;
    if (cost !== '') payload.purchaseCost = Number(cost);
    if (wt !== '') {
      payload.weightKg = Number(wt);
      payload.weightText = `${wt}kg`;
    }
    // 尺寸（抓 1688 来的或手填）
    const l = $('memoL').value;
    const w = $('memoW').value;
    const h = $('memoH').value;
    if (l !== '') payload.lengthCm = Number(l);
    if (w !== '') payload.widthCm = Number(w);
    if (h !== '') payload.heightCm = Number(h);
    if (l !== '' || w !== '' || h !== '') payload.sizeText = `${l || 0}*${w || 0}*${h || 0}`;
    if (memoPackText) payload.packageText = memoPackText;
    if (memoSpecName) payload.specName = memoSpecName;
    // 跟卖价：连币种符号一起上报（Ozon 有时渲染成 ¥），后端统一折成 ₽ 存
    const rp = $('memoRetail').value;
    if (rp !== '') {
      payload.retailPrice = Number(rp);
      payload.retailPriceSymbol = $('memoRetailSym').textContent === '¥' ? '¥' : '₽';
    }
    if (memoOzonData && memoOzonData.imageUrl) payload.imageUrl = memoOzonData.imageUrl;
    // 抓过 1688 → 让后端记 caughtAt（采购留痕）
    if (supply1688) payload.fromCapture = true;
    const r = await send({ type: 'DS_MEMO', payload });
    if (!r.ok) throw new Error(r.error || '保存失败');
    // 同 SKU 会被后端合并进已有记录（只补空字段），提示要说明白
    const merged = !!(r.result && r.result.merged);
    btn.textContent = merged ? '✓ 已合并到同 SKU 记录' : '✓ 已记一笔';
    // 清掉输入，方便接着记下一条
    ['memoSku', 'memoName', 'memoUrl', 'memoOzon', 'memoCost', 'memoWt', 'memoRetail', 'memoL', 'memoW', 'memoH'].forEach(
      (id) => {
        $(id).value = '';
      },
    );
    $('memoRetailSym').textContent = '₽';
    memoPackText = '';
    memoSpecName = '';
    memoOzonData = null;
    supply1688 = null;
    $('memoSkuSel').innerHTML = '<option value="">（抓 1688 后选规格）</option>';
  } catch (e) {
    alert(`记一笔失败：${e.message}`);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '记一笔 → 存到「自采购」';
    }, 1200);
  }
};

refresh();
timer = setInterval(refresh, 2000);
