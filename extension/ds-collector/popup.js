/** 弹窗交互：状态显示 + 触发采集 */
const $ = (id) => document.getElementById(id);

// 常用后端地址一键填入：本地开发 / 已部署的服务器（服务器走 nginx，接口都在 /api 下）
const PRESET_LOCAL = 'http://localhost:3101';
const PRESET_SERVER = 'http://114.132.99.141/api';

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
    alert(`抓到 ${x.total} 个商品\n新建 ${x.created} 个\n更新 ${x.updated} 个`);
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

refresh();
timer = setInterval(refresh, 2000);
