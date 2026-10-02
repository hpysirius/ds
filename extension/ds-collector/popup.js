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

refresh();
timer = setInterval(refresh, 2000);
