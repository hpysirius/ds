/**
 * 浏览器操作层：连接本机**真实** Chrome（CDP），提供「像人一样」的操作原语。
 *
 * 设计原则：
 *  1. 不新装浏览器 —— 用你自己的 Chrome，登录态 / 插件 / 指纹全都在，最不容易被风控识别。
 *  2. 真人化 —— 随机延迟、先滚动进视口再点、鼠标移动、像人一样停顿。
 *  3. 人在回路 —— 遇到验证码、登录失效、页面异常时，停下来等人处理，绝不硬闯。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

export const SHOTS_DIR = path.resolve(process.cwd(), 'shots');
const DEFAULT_CDP = 'http://127.0.0.1:9222';

/* ------------------------------ 基础工具 ------------------------------ */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 人类节奏：在 [min, max] 之间随机停顿 */
export const humanPause = (min = 600, max = 1800) => sleep(min + Math.random() * (max - min));

export function log(...a) {
  console.log('  ', ...a);
}

export function step(msg) {
  console.log(`\n▶ ${msg}`);
}

export function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

export function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

export function fail(msg) {
  console.log(`  ❌ ${msg}`);
}

/** 暂停，等人在终端按回车（用于验证码、登录态失效等必须人处理的场景） */
export async function waitForHuman(reason) {
  console.log(`\n⏸  需要你手动处理：${reason}`);
  console.log('    处理完，回到这里按 Enter 继续（输入 q 回车则放弃）');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('    > ')).trim().toLowerCase();
  rl.close();
  if (ans === 'q') throw new Error('用户放弃：' + reason);
  return true;
}

/* ------------------------------ 连接 ------------------------------ */

/**
 * 连接到已开启调试端口的 Chrome。
 * 注意：这里必须用「你自己的 Chrome 默认 profile」启动（不要加 --user-data-dir），
 * 否则登录态和插件都会丢失。
 */
export async function connect({ cdp = DEFAULT_CDP } = {}) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: cdp, defaultViewport: null });
  } catch (e) {
    throw new Error(
      `连不上 Chrome 调试端口 ${cdp}。\n` +
        `    请先完全退出 Chrome（⌘Q），再执行：\n` +
        `      open -a "Google Chrome" --args --remote-debugging-port=9222\n` +
        `    然后重跑本命令。原始错误：${e.message}`,
    );
  }
  return browser;
}

/** 取一个可用页面：优先复用已打开的 ds / 1688 标签，否则新建 */
export async function openPage(browser, url) {
  const pages = await browser.pages();
  const target = pages.find((p) => !p.url().startsWith('chrome://')) || null;
  const page = target || (await browser.newPage());
  if (url && page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await humanPause(1200, 2500);
  }
  return page;
}

/* ------------------------------ 真人化操作 ------------------------------ */

/** 把元素滚进视口，稍作停顿（人看一眼再点） */
async function scrollIntoView(page, handle) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await humanPause(400, 900);
}

/** 像人一样点击：滚动 → 鼠标移过去 → 停顿 → 按下 */
export async function humanClick(page, selectorOrHandle, { timeout = 15000 } = {}) {
  let handle = selectorOrHandle;
  if (typeof selectorOrHandle === 'string') {
    try {
      await page.waitForSelector(selectorOrHandle, { timeout, visible: true });
    } catch {
      throw new Error(`找不到可点击元素：${selectorOrHandle}`);
    }
    handle = await page.$(selectorOrHandle);
  }
  if (!handle) throw new Error('点击目标为空');
  await scrollIntoView(page, handle);
  const box = await handle.boundingBox();
  if (box) {
    // 在元素内随机取一个点（不总点正中心，更像人）
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 12) });
    await humanPause(150, 400);
    await page.mouse.click(x, y);
  } else {
    await handle.click();
  }
  await humanPause();
}

/** 像人一样输入：逐字符敲，带随机间隔 */
export async function humanType(page, selector, text, { clear = true } = {}) {
  await page.waitForSelector(selector, { timeout: 15000, visible: true });
  const el = await page.$(selector);
  await humanClick(page, el);
  if (clear) {
    await page.click(selector, { clickCount: 3 }); // 三击全选
    await page.keyboard.press('Backspace');
    await sleep(200);
  }
  for (const ch of String(text)) {
    await page.keyboard.type(ch, { delay: 60 + Math.random() * 140 });
  }
  await humanPause(300, 700);
}

/** 模拟真人滚动浏览结果列表 */
export async function humanBrowse(page, times = 3) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy({ top: 400 + Math.random() * 500, behavior: 'smooth' }));
    await humanPause(700, 1600);
  }
}

/**
 * 从浏览器里拿 ds 的登录 token。
 * 你在 ds 页面登录过的话，token 就存在 localStorage.ds_token 里，
 * 直接读出来用，省去让用户输入账号密码。
 */
export async function getDsToken(browser) {
  // 环境变量优先，方便无头/自动化场景（例如本地自签 token）
  if (process.env.DS_TOKEN) {
    return {
      token: process.env.DS_TOKEN.replace(/^Bearer\s+/i, ''),
      from: 'env',
      apiBase: process.env.DS_API || 'http://localhost:3101',
    };
  }
  const pages = await browser.pages();
  for (const p of pages) {
    let url = '';
    try {
      url = p.url();
    } catch {
      continue;
    }
    if (!/localhost:3100|127\.0\.0\.1:3100|ozon\.qinxianty\.com|114\.132\.99\.141/.test(url)) continue;
    try {
      const t = await p.evaluate(() => localStorage.getItem('ds_token') || localStorage.getItem('token') || '');
      if (t) return { token: t.replace(/^Bearer\s+/i, ''), from: url, apiBase: dsApiBaseFrom(url) };
    } catch {}
  }
  return null;
}

/**
 * 由 ds 前端地址推导后端 API 地址。
 * 这很重要：线上 token 打本地后端（或反之）会因为 JWT_SECRET 不同而 401。
 */
export function dsApiBaseFrom(frontendUrl) {
  if (/localhost:3100|127\.0\.0\.1:3100/.test(frontendUrl)) return 'http://localhost:3101';
  const m = frontendUrl.match(/^(https?:\/\/[^/]+)/);
  return m ? `${m[1]}/api` : 'http://localhost:3101';
}

/**
 * 从 ds 后端取已保存的 1688 cookie，注入到浏览器。
 * 场景：ds 里同步过 1688 登录态，但当前浏览器没登录 —— 就不用再手动登一次。
 */
export async function inject1688Cookies(page, dsBase = 'http://localhost:3101') {
  let raw = process.env.ALI1688_COOKIE || '';

  // 兜底 1：ds 后端若提供可读接口则用之
  if (!raw) {
    const r = await fetch(`${dsBase}/pricing/sourcing/cookie`).catch(() => null);
    if (r && r.ok) {
      raw = await r.text();
      try {
        const j = JSON.parse(raw);
        raw = j.cookies || j.cookie || j.data?.cookies || '';
      } catch {}
    }
  }

  // 兜底 2：本机 docker 里的 ds 库直接读（本地开发机适用）
  if (!raw) {
    try {
      raw = execFileSync(
        'docker',
        ['exec', 'playlish-mysql', 'mysql', '-uroot', '-proot123', '-N', '-B', '-e',
         'select ali1688Cookie from ds.pricing_settings limit 1'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 },
      ).trim();
    } catch {}
  }

  if (!raw) return 0;

  const list = [];
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (!p || !p.includes('=')) continue;
    const i = p.indexOf('=');
    list.push({
      name: p.slice(0, i).trim(),
      value: p.slice(i + 1).trim(),
      domain: '.1688.com',
      path: '/',
    });
  }
  if (!list.length) return 0;
  try {
    await page.browser().setCookie(...list);
    return list.length;
  } catch (e) {
    log(`注入 cookie 失败：${e.message}`);
    return 0;
  }
}

/* ------------------------------ 观测 ------------------------------ */

export async function shot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`截图已存：${path.relative(process.cwd(), file)}`);
  return file;
}

/** 页面是否出现滑块 / 验证码 */
export async function detectCaptcha(page) {
  const signals = ['baxia-dialog', 'nc_1_wrapper', '#nc_1__scale_text', '.baxia-dialog', 'punish', 'captcha'];
  for (const s of signals) {
    try {
      if (await page.$(s)) return true;
    } catch {}
  }
  const txt = await page.evaluate(() => document.body.innerText || '');
  return /滑块|向右拖动|请完成安全验证|验证码/.test(txt);
}

/**
 * 是否已登录 1688。
 *
 * 注意：不能用「页面文案里有没有『请登录』」来判断 —— 1688 首页的登录态是 JS 异步渲染的，
 * 未登录时那块文案压根不在初始 DOM 里，curl / 无头渲染都抓不到，会误判成「已登录」。
 * 最可靠的判据是**读 cookie**：登录后会写入 cookie2 / _tb_token_ / unb。
 */
export async function is1688LoggedIn(page) {
  const url = page.url();
  if (url.includes('login.1688.com') || url.includes('passport.1688.com') || url.includes('login.taobao.com')) {
    return false;
  }
  try {
    const cookies = await page.browser().cookies();
    const ali = cookies.filter((c) => c.domain && c.domain.includes('1688.com'));
    const names = new Set(ali.map((c) => c.name));
    // cookie2 + unb 同时存在，基本可确认是登录态
    return names.has('cookie2') && names.has('unb');
  } catch {
    return false;
  }
}

/** 兼容旧命名的反向判断 */
export async function is1688LoggedOut(page) {
  return !(await is1688LoggedIn(page));
}

/**
 * 从当前页提取 1688 图搜结果卡片。
 *
 * 新版（2026-10）图搜结果卡片形如：
 *   <div class="searchOfferItem--xxx ..." data-renderkey="1_0_p4p_hyhxmj_44237855048" data-tracker="offer">
 * offerId 就在 data-renderkey 的最后一段；卡片内**没有** detail.1688.com/offer 链接，需自建。
 * 字段：titleText / priceItem / shopName / img。
 */
export async function extractOffers(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const num = (s) => {
      const m = String(s || '').replace(/\s+/g, '').match(/(\d+(?:\.\d+)?)/);
      return m ? m[1] : '';
    };
    document.querySelectorAll('[data-renderkey]').forEach((card) => {
      const rk = card.getAttribute('data-renderkey') || '';
      const offerId = rk.split('_').pop();
      if (!offerId || !/^\d{6,}$/.test(offerId)) return;
      if (seen.has(offerId)) return;
      seen.add(offerId);
      const titleEl = card.querySelector('[class*="titleText"], [class*="title"], [class*="Title"]');
      const priceEl = card.querySelector('[class*="priceItem"], [class*="price"]');
      const shopEl = card.querySelector('[class*="shopName"]');
      const imgEl = card.querySelector('img');
      out.push({
        offerId,
        title: (titleEl?.innerText || '').replace(/\s+/g, ' ').trim(),
        price: num(priceEl?.innerText || ''),
        shop: (shopEl?.innerText || '').trim(),
        img: imgEl?.src || '',
        url: `https://detail.1688.com/offer/${offerId}.html`,
      });
    });
    return out;
  });
}
