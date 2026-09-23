/**
 * 后台服务（MV3 service worker，ES module）。
 *
 * 核心思路：**不用调试模式的 Chrome**。插件跑在用户自己的正常浏览器里，
 * 用的是真实 profile 和登录态 —— Ozon 不会像对调试实例那样每次导航先甩一张
 * 「Antibot Challenge Page」，所以采集速度和你手动打开网页一样快。
 *
 * 两种用法：
 *   1. 采集当前页：在任意 Ozon 商品页点插件 → 「采集当前页」
 *   2. 批量采集：点「批量采集」→ 从 ds 后端拉待补清单 → 复用同一个标签页逐个访问并上报
 *      （已补上的商品会自动从待补清单里消失，所以中断后重跑天然是"断点续跑"，不会重复劳动）
 */
import { collectProduct, probeReady, collectList, scrollDown } from './collector-lib.js';

const DEFAULT_API = 'http://localhost:3101';
const STATE_KEY = 'ds_state';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 规范化后端地址：没写协议就补 http://，去掉尾部斜杠（漏写协议是连不上的常见原因） */
function normalizeApi(v) {
  let s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return DEFAULT_API;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}

async function getApi() {
  const s = await chrome.storage.local.get(['apiBase']);
  return normalizeApi(s.apiBase);
}

async function getState() {
  const s = await chrome.storage.local.get([STATE_KEY]);
  return s[STATE_KEY] || { running: false, done: 0, total: 0, current: '', logs: [], lastError: '' };
}

async function setState(patch) {
  const cur = await getState();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function log(line) {
  const cur = await getState();
  const logs = [line, ...(cur.logs || [])].slice(0, 60);
  await setState({ logs });
}

/* ─────────────── 与 ds 后端通信 ─────────────── */

const NET_ERR = '连不上后端：请确认 ds 后端已启动（bash scripts/start.sh），且弹窗里的地址正确';

/**
 * 在中继页面（localhost:3100 前端）的上下文里执行 fetch。
 * 为什么需要中继：Chrome 142+ 的「本地网络访问」(LNA) 策略会拦「扩展 → localhost」的请求，
 * 且扩展的 service worker 无法触发授权弹窗（Chrome 限制）。
 * 但 Chrome 明确豁免「本地 → 本地」的请求：所以在 localhost:3100 的页面里发 fetch 到 3101
 * 完全不受 LNA 管，而 3100 又在后端 CORS 白名单里（FRONTEND_URL）。
 */
function relayFetchFn(url, method, body) {
  return fetch(url, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body || undefined,
  })
    .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.text() }))
    .catch((e) => ({ ok: false, status: 0, body: '', error: String((e && e.message) || e) }));
}

/** 找/开一个 localhost:3100 的中继标签页（放后台，不打扰用户） */
async function ensureRelayTab() {
  const tabs = await chrome.tabs.query({ url: ['http://localhost:3100/*', 'http://127.0.0.1:3100/*'] });
  if (tabs.length) return tabs[0];
  const api = await getApi();
  // 中继页 = 后端同主机的 3100 端口（ds 前端）
  const relayBase = api.replace(/:3101\/?$/, ':3100');
  const tab = await chrome.tabs.create({ url: relayBase + '/', active: false });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const t = await chrome.tabs.get(tab.id);
      if (t.status === 'complete') return tab;
    } catch (e) { /* ignore */ }
  }
  return tab;
}

/** 把中继结果包装成 Response 的样子，供现有代码（res.ok / res.json() / res.text()）直接用 */
function fakeResponse(r) {
  return {
    ok: !!r.ok,
    status: r.status || 0,
    json: async () => JSON.parse(r.body),
    text: async () => r.body,
  };
}

/**
 * fetch 包装：先直连（带 targetAddressSpace 声明）；被 LNA 拦时自动落到 localhost 中继。
 */
async function safeFetch(url, opts) {
  try {
    return await fetch(url, { ...opts, targetAddressSpace: 'local' });
  } catch (e) {
    // 大概率是 LNA 拦截 → 走中继（本地→本地，Chrome 豁免）
    const tab = await ensureRelayTab();
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: relayFetchFn,
      args: [url, (opts && opts.method) || 'GET', (opts && opts.body) || null],
    });
    if (!res || !res.result) throw new Error(NET_ERR);
    if (res.result.error) throw new Error(`${NET_ERR}（中继也失败：${String(res.result.error).slice(0, 80)}）`);
    return fakeResponse(res.result);
  }
}

async function fetchPending(limit) {
  const api = await getApi();
  const res = await safeFetch(`${api}/pricing/extension/pending?limit=${limit}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`拉取待采清单失败 HTTP ${res.status}（后端起来了吗？）`);
  return res.json();
}

async function ingest(payload) {
  const api = await getApi();
  const res = await safeFetch(`${api}/pricing/extension/product-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  if (!res.ok) throw new Error(`上报失败 HTTP ${res.status}：${text.slice(0, 160)}`);
  return json;
}

/* ─────────────── 标签页操作 ─────────────── */

/** 找一个可复用的标签页（优先上次用过的），没有就新建 —— 全程只用一个标签页，不堆标签 */
async function findOrCreateTab() {
  const s = await chrome.storage.local.get(['tabId']);
  if (s.tabId) {
    try {
      const t = await chrome.tabs.get(s.tabId);
      if (t && t.id) return t;
    } catch (e) { /* 标签已关闭 */ }
  }
  const tab = await chrome.tabs.create({ url: 'https://www.ozon.ru/', active: true });
  await chrome.storage.local.set({ tabId: tab.id });
  return tab;
}

async function evalInTab(tabId, fn) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fn });
  return r ? r.result : null;
}

/**
 * 等页面真正就绪。
 * 关键：必须等 URL 里出现当前 sku 再判定 ready —— 否则会把上一个商品的数据当成当前商品上报。
 * 也顺带识别「商品失效被 Ozon 302 到搜索页」的情况，直接放弃不空等。
 */
async function waitReady(tabId, sku, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = 'loading';
    let href = '';
    try {
      state = await evalInTab(tabId, probeReady);
      const t = await chrome.tabs.get(tabId);
      href = t.url || '';
    } catch (e) {
      // 页面正在导航 / 脚本还没注入，继续等
      await sleep(800);
      continue;
    }
    if (href.indexOf('/search/') >= 0 && href.indexOf('/product/') < 0) return 'invalid';
    if (href.indexOf(sku) >= 0 && state === 'ready') return 'ready';
    await sleep(1000);
  }
  return 'timeout';
}

/* ─────────────── 任务 ─────────────── */

/** 从 URL 里抠出商品 id：/product/xxx-1234567890/ 或直接 ?sku=123 */
function extractSku(url) {
  const s = String(url || '');
  const m = s.match(/\/product\/[^/]*?(\d{6,})/) || s.match(/[?&](?:sku|product_id)=(\d{6,})/);
  return m ? m[1] : '';
}

/**
 * 采集当前页。
 * 判定放宽：只要是 Ozon 的页面就试着采（用户可能是从搜索页、卖家页、或带各种参数的详情页过来的），
 * 真实门槛放在「能不能解析出商品 id」和「有没有采到数据」上，而不是死板地匹配 /product/ 路径。
 */
async function collectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/ozon\.(ru|com|kz|by)/i.test(tab.url || '')) {
    throw new Error('当前页面不是 Ozon（请先在 Ozon 上打开商品，再点插件采集）');
  }
  const data = await evalInTab(tab.id, collectProduct);
  if (!data || (!data.title && !data.price && !data.imageUrl)) {
    throw new Error('没读到商品数据：页面可能还没加载完，刷新后再试');
  }
  // sku 优先用页面里的真实 URL，其次用地址栏
  const sku = extractSku(data.url) || extractSku(tab.url);
  if (!sku) {
    throw new Error('没能从当前页面识别出商品 ID（请在商品详情页 ozon.ru/product/… 上采集）');
  }
  const r = await ingest({ ...data, sku });
  await log(`✅ 当前页 ${sku}：${(data.title || '').slice(0, 22)}… → ${r && r.fields ? r.fields.length : 0} 个字段`);
  return r;
}

/* ─────────────── 列表页批量采集 ─────────────── */

/** 分批上报，避免一次 POST 太大被拒 */
async function ingestListChunked(sourceUrl, items) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const SIZE = 50;
  for (let i = 0; i < items.length; i += SIZE) {
    const chunk = items.slice(i, i + SIZE);
    const r = await ingestList({ sourceUrl, items: chunk });
    created += r.created || 0;
    updated += r.updated || 0;
    skipped += r.skipped || 0;
  }
  return { created, updated, skipped, total: items.length };
}

async function ingestList(payload) {
  const api = await getApi();
  const res = await safeFetch(`${api}/pricing/extension/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  if (!res.ok) throw new Error(`列表上报失败 HTTP ${res.status}：${text.slice(0, 160)}`);
  return json || {};
}

/**
 * 采集当前列表页：抓完当前屏 → 往下滚 → 再抓，重复 scrolls 次（Ozon 是无限滚动，
 * 实测一屏约 36 个商品，滚几屏就能拿到几百个）。全程按 sku 去重。
 */
async function collectListPage(scrolls) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/ozon\.(ru|com|kz|by)/i.test(tab.url || '')) {
    throw new Error('当前页面不是 Ozon（请先在 Ozon 列表页上点采集）');
  }

  const seen = new Map();
  const rounds = Math.max(0, Math.min(scrolls || 0, 30));
  for (let i = 0; i <= rounds; i++) {
    const items = (await evalInTab(tab.id, collectList)) || [];
    items.forEach((it) => { if (it && it.sku) seen.set(it.sku, it); });
    await log(`📄 第 ${i + 1} 屏抓到 ${items.length} 个（累计去重 ${seen.size}）`);
    if (i < rounds) {
      await evalInTab(tab.id, scrollDown);
      await sleep(1800); // 等无限滚动把下一屏加载出来
    }
  }

  const items = [...seen.values()].filter((it) => it.title || it.price || it.imageUrl);
  if (!items.length) throw new Error('没抓到任何商品卡片（页面加载完了吗？）');

  const r = await ingestListChunked(tab.url, items);
  await log(`✅ 列表采集完成：抓到 ${items.length} 个 → 新建 ${r.created} / 更新 ${r.updated}`);
  return r;
}

async function runBatch(limit) {
  const pending = await fetchPending(limit);
  const items = pending.items || [];
  if (!items.length) {
    await setState({ running: false, total: 0, done: 0, current: '', lastError: '' });
    await log('🎉 没有待补的商品了');
    return { done: 0, total: 0 };
  }

  await setState({ running: true, total: items.length, done: 0, current: '', lastError: '' });
  await log(`🚀 开始批量采集 ${items.length} 个（剩余待补 ${pending.remaining}）`);

  const tab = await findOrCreateTab();
  let done = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const st = await getState();
    if (!st.running) {
      await log('⏹ 已手动停止');
      break;
    }
    const it = items[i];
    await setState({ current: it.sku });
    try {
      await chrome.tabs.update(tab.id, { url: it.url, active: true });
      const ready = await waitReady(tab.id, it.sku);
      if (ready === 'invalid') {
        failed++;
        await log(`⚠️ ${it.sku} 链接失效/已下架，跳过`);
        continue;
      }
      if (ready !== 'ready') {
        failed++;
        await log(`⚠️ ${it.sku} 页面未就绪（${ready}），跳过`);
        continue;
      }
      const data = await evalInTab(tab.id, collectProduct);
      const payload = { ...(data || {}), sku: it.sku };
      const r = await ingest(payload);
      if (r && r.ok) {
        done++;
        await log(`✅ ${it.sku} → ${(r.fields || []).join('、').slice(0, 60)}`);
      } else {
        failed++;
        await log(`⚠️ ${it.sku} 未写入：${(r && r.reason) || '无可用字段'}`);
      }
    } catch (e) {
      failed++;
      await log(`❌ ${it.sku} 失败：${String((e && e.message) || e).slice(0, 100)}`);
    }
    await setState({ done, failed });
    await sleep(400);
  }

  await setState({ running: false, current: '' });
  await log(`🏁 本轮完成：成功 ${done} / 失败 ${failed}`);
  return { done, failed };
}

/* ─────────────── 消息入口 ─────────────── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'DS_PING': {
          const api = await getApi();
          try {
            const res = await safeFetch(`${api}/pricing/extension/pending?limit=1`);
            let remaining = null;
            let err = null;
            if (res.ok) {
              try { remaining = (await res.json()).remaining; } catch (e) { /* ignore */ }
            } else if (res.status === 404) {
              // 能收到 404 说明网络是通的，只是地址不对 —— 最常见的就是把前端(3100)当成了后端(3101)
              err = `地址能连通但没有插件接口（404）——3100 是前端页面，请改填后端 ${api.replace(/:3100$/, ':3101')}`;
            } else {
              err = `HTTP ${res.status}`;
            }
            sendResponse({ ok: res.ok, api, status: res.status, remaining, error: err });
          } catch (e) {
            sendResponse({ ok: false, api, error: NET_ERR });
          }
          break;
        }
        case 'DS_COLLECT_CURRENT':
          sendResponse({ ok: true, result: await collectActiveTab() });
          break;
        case 'DS_COLLECT_LIST':
          sendResponse({ ok: true, result: await collectListPage(msg.scrolls) });
          break;
        case 'DS_START_BATCH':
          sendResponse({ ok: true, result: await runBatch(msg.limit || 20) });
          break;
        case 'DS_STOP':
          await setState({ running: false });
          sendResponse({ ok: true });
          break;
        case 'DS_STATUS':
          sendResponse({ ok: true, state: await getState(), api: await getApi() });
          break;
        case 'DS_SET_API':
          await chrome.storage.local.set({ apiBase: normalizeApi(msg.api) });
          sendResponse({ ok: true, api: await getApi() });
          break;
        case 'DS_CLEAR':
          await setState({ logs: [], done: 0, failed: 0, current: '' });
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: '未知指令' });
      }
    } catch (e) {
      const message = String((e && e.message) || e);
      await log(`❌ ${message.slice(0, 120)}`);
      sendResponse({ ok: false, error: message });
    }
  })();
  return true; // 保持消息通道（异步响应）
});
