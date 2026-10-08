#!/usr/bin/env node
/**
 * ds-browser-agent —— 用你自己的 Chrome，像正常用户一样完成核价里的「人工环节」。
 *
 * 用法：
 *   node src/agent.mjs doctor                    自检：Chrome 连接 / 1688 登录态 / ds 服务
 *   node src/agent.mjs find --sku 3920720492     拿 ds 商品图去 1688 图搜，人工挑一个
 *   node src/agent.mjs find --sku X --apply      挑完自动调 ds 抓价
 *   node src/agent.mjs find --image /tmp/a.jpg   用本地图片搜
 *   node src/agent.mjs candidates --sku X        非交互图搜，结尾打印 @@RESULT@@<json>（给网页/后端调用）
 *   node src/agent.mjs shot --url <url>          打开页面并截图
 */
import { connect, openPage, shot, is1688LoggedIn, getDsToken, step, ok, warn, fail, log, sleep } from './browser.mjs';
import { runFind, findCandidates } from './tasks/find1688.mjs';

const DS_BASE = process.env.DS_API || 'http://localhost:3101';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}

async function doctor() {
  console.log('\n=== ds-browser-agent 自检 ===');

  step('检查 ds 后端');
  try {
    const r = await fetch(`${DS_BASE}/pricing/sourcing/cookie-status`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    ok(`ds 后端在线，1688 cookie：${d.hasCookie ? `${d.cookieCount} 个（${d.syncedAt}）` : '未同步'}`);
  } catch (e) {
    fail(`ds 后端连不上（${DS_BASE}）：${e.message}。先跑 bash restart.sh`);
  }

  step('检查 Chrome 调试端口');
  let browser;
  try {
    browser = await connect();
    const v = await browser.version();
    ok(`已连上真实 Chrome：${v}`);
  } catch (e) {
    fail(e.message);
    console.log(`
  启动方式：完全退出 Chrome（⌘Q）后执行：
    open -a "Google Chrome" --args --remote-debugging-port=9222
  注意：不要用 --user-data-dir，否则登录态和插件都会丢。`);
    return;
  }

  try {
    const page = await openPage(browser, 'https://www.1688.com/');
    await sleep(2500);
    const loggedIn = await is1688LoggedIn(page);
    if (loggedIn) {
      ok('1688 登录态正常');
    } else {
      warn('1688 未登录（或登录态过期）—— 用浏览器 agent 前请先登录 1688');
    }
    await shot(page, 'doctor-1688-home');

    step('检查 ds 登录 token');
    const tk = await getDsToken(browser);
    if (tk) {
      ok(`已从浏览器拿到 ds token（来源 ${tk.from}）→ API ${tk.apiBase}`);
    } else {
      warn('浏览器里没找到 ds token —— 请先打开并登录 ds 页面，否则取不到商品图');
    }
  } catch (e) {
    warn('打开 1688 失败：' + e.message);
  } finally {
    await browser.disconnect();
  }
  console.log('\n自检完成。');
}

async function shotCmd(args) {
  const browser = await connect();
  try {
    const page = await openPage(browser, args.url || null);
    await sleep(2000);
    const f = await shot(page, args.name || 'shot');
    ok(f);
  } finally {
    await browser.disconnect();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === 'doctor') return await doctor();
    if (cmd === 'shot') return await shotCmd(args);
    if (cmd === 'candidates') {
      try {
        const res = await findCandidates({ sku: args.sku, image: args.image });
        console.log('\n@@RESULT@@' + JSON.stringify(res));
      } catch (e) {
        console.log('\n@@RESULT@@' + JSON.stringify({ ok: false, error: e.message }));
        process.exitCode = 1;
      }
      return;
    }
    if (cmd === 'find')
      return await runFind({
        sku: args.sku,
        image: args.image,
        apply: !!args.apply,
        sellPrice: args['sell-price'] ? Number(args['sell-price']) : null,
      });
    console.log('可用命令：doctor / find / candidates / shot');
  } catch (e) {
    fail(e.message);
    process.exitCode = 1;
  }
}

main();
