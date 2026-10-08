/**
 * 任务：拿一张商品图 → 1688 图搜 → 返回候选 → 人工挑选 → 得到 offer 链接。
 *
 * 这一环是整个核价流程里最需要「人眼」和「真实浏览器」的部分：
 *   - 1688 风控严，headless / 无登录态基本走不通；
 *   - 图搜结果需要人判断哪个才是真同款。
 * 所以这里用真实 Chrome 做；其余（抓价、算价、落库）走 ds 后端 API，稳定又不触发风控。
 *
 * 导出两个入口：
 *   - runFind      ：CLI 用，带终端 stdin 人工挑选（保留原 `find --apply` 行为）。
 *   - findCandidates：网页/后端用，非交互（登录失效/验证码直接抛错，不卡 stdin）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import {
  connect,
  openPage,
  humanPause,
  humanBrowse,
  shot,
  detectCaptcha,
  is1688LoggedIn,
  extractOffers,
  getDsToken,
  inject1688Cookies,
  waitForHuman,
  step,
  ok,
  warn,
  fail,
  log,
} from '../browser.mjs';

const IMAGE_SEARCH_URL = 'https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch';

/* ------------------------------ 取图 ------------------------------ */

/** webp/其他格式统一转成 jpg（1688 上传更认 jpg/png） */
function toJpeg(src, dest) {
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', src, '--out', dest], { stdio: 'ignore' });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  } catch {}
  // macOS 13 及以下 sips 不认 webp，直接沿用原文件
  fs.copyFileSync(src, dest);
  return dest;
}

/** 从 ds 取商品信息（带出主图、现价、尺寸） */
async function fetchProduct(browser, sku, apiBase) {
  step(`从 ds 取商品 ${sku} 的信息`);
  const tk = await getDsToken(browser);
  const headers = tk ? { Authorization: `Bearer ${tk.token}` } : {};
  const r = await fetch(`${apiBase}/pricing/from-product/${sku}`, { headers });
  if (!r.ok) {
    throw new Error(
      `取商品信息失败 HTTP ${r.status}。` +
        (tk
          ? ''
          : ' 没找到 ds 登录 token —— 请先在浏览器里打开并登录 ds（localhost:3100 或 ozon.qinxianty.com）。'),
    );
  }
  const d = await r.json();
  ok(`${d.title}  |  ${d.priceRub}₽  |  ${d.weightKg}kg  |  ${d.lengthCm}×${d.widthCm}×${d.heightCm}cm`);
  return d;
}

/** 下载商品主图（经 ds 图片代理，绕开 Ozon 防盗链） */
async function downloadImage(product, dest) {
  const res = await fetch(
    `${process.env.DS_API || 'http://localhost:3101'}/pricing/sourcing/image-proxy?url=${encodeURIComponent(product.imageUrl)}`,
  );
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`);
  const raw = dest.replace(/\.jpg$/, '') + '-raw';
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  const out = toJpeg(raw, dest);
  ok(`主图已存 ${out}（${(fs.statSync(out).size / 1024).toFixed(1)} KB）`);
  return out;
}

/* ------------------------------ 1688 图搜 ------------------------------ */

/**
 * 1688 图搜页：上传图片后会出现「搜索图片」按钮，**必须点它才真正发起图搜**。
 * 按钮 class 是动态 hash（search-btn--xxx），用可见文本定位最稳。
 */
async function clickSearchImage(page) {
  const isSearchBtn = (el) => (el.innerText || '').trim() === '搜索图片';
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('div,button,a,span')].some(
          (e) => (e.innerText || '').trim() === '搜索图片',
        ),
      { timeout: 15000 },
    )
    .catch(() => warn('没等到「搜索图片」按钮出现，仍尝试点击'));
  const handle = await page.evaluateHandle(() =>
    [...document.querySelectorAll('div,button,a,span')].find(
      (e) => (e.innerText || '').trim() === '搜索图片',
    ) || null,
  );
  const el = handle.asElement();
  if (el) {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await humanPause(300, 600);
    const box = await el.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await el.click();
    ok('已点击「搜索图片」');
    return true;
  }
  const alt = await page.$('[class*="search-btn"], [class*="searchBtn"]');
  if (alt) {
    await alt.click();
    ok('已点击「搜索图片」(search-btn)');
    return true;
  }
  warn('没找到「搜索图片」按钮（页面结构可能又变了）');
  return false;
}

async function uploadImage(page, imgPath, { interactive = true } = {}) {
  step('打开 1688 图搜页');
  await page.goto(IMAGE_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanPause(1500, 3000);

  if (!(await is1688LoggedIn(page))) {
    step('浏览器里没检测到 1688 登录态，尝试用 ds 里保存的 cookie 自动补上');
    const n = await inject1688Cookies(page, process.env.DS_API || 'http://localhost:3101');
    if (n) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await humanPause(1500, 2500);
    }
    if (await is1688LoggedIn(page)) {
      ok(`已注入 ${n} 个 cookie，登录态恢复`);
    } else if (interactive) {
      await shot(page, '1688-need-login');
      await waitForHuman('1688 未登录（cookie 可能已过期）。请在浏览器里登录 1688 后回来按 Enter');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await humanPause(1500, 2500);
    } else {
      throw new Error('1688 未登录且无法自动注入 cookie。请先在浏览器登录 1688，再点「开始图搜」。');
    }
  }

  const inputs = await page.$$('input[type="file"]');
  if (!inputs.length) {
    await shot(page, '1688-no-file-input');
    if (interactive) {
      await waitForHuman(`没找到上传控件，请手动把图片拖进去：${imgPath}`);
      return;
    }
    throw new Error('1688 图搜页没找到上传控件（页面结构可能变了）');
  }
  step('上传图片');
  await inputs[0].uploadFile(imgPath);
  ok('已上传，等待 1688 识别');

  await humanPause(2000, 3500);

  // 上传后 1688 会出现「搜索图片」按钮 —— 必须点它才真正发起图搜
  step('点击「搜索图片」发起图搜');
  await clickSearchImage(page);
  await humanPause(4000, 6000);
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
  await humanPause(1500, 3000);

  if (await detectCaptcha(page)) {
    await shot(page, '1688-captcha');
    if (interactive) {
      await waitForHuman('检测到滑块/验证码。请在浏览器里手动过验证，通过后按 Enter');
      await humanPause(2500, 4000);
    } else {
      throw new Error('1688 触发了滑块验证，请在浏览器手动过一次滑块后重试');
    }
  }
}

/* ------------------------------ 图搜主体 ------------------------------ */

/**
 * 取图 → 打开 1688 图搜 → 上传 → 解析候选。
 * interactive=true 时遇到登录失效/验证码会停下来等人（CLI）；false 时直接抛错（网页/后端调用）。
 */
async function doImageSearch(browser, { sku, image, apiBase, interactive = true }) {
  const tmpImg = image || path.join(os.tmpdir(), `ds-1688-${sku || Date.now()}.jpg`);
  let product = null;
  if (!image) {
    if (!sku) throw new Error('需要 --sku 或 --image');
    product = await fetchProduct(browser, sku, apiBase);
    await downloadImage(product, tmpImg);
  } else {
    ok(`使用本地图片 ${image}`);
  }

  // 新开一个标签页做图搜，避免复用/覆盖用户当前的工作台页面
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  page.setDefaultTimeout(30000);
  await uploadImage(page, tmpImg, { interactive });

  await humanBrowse(page, 2);

  let offers = await extractOffers(page);
  if (!offers.length) {
    await shot(page, '1688-no-result');
    warn('没解析到商品卡片，可能还在加载，或页面结构变了');
    offers = [];
  }
  await shot(page, '1688-results');
  return { product, candidates: offers };
}

/**
 * 非交互入口：网页/后端用。连上 Chrome 做完图搜，返回 { ok, product, candidates }。
 * 不在终端等输入 —— 登录失效/验证码都直接抛错，由调用方（前端）提示用户去浏览器处理。
 */
export async function findCandidates({ sku, image }) {
  const browser = await connect();
  try {
    const tk = await getDsToken(browser);
    const apiBase = tk ? tk.apiBase : process.env.DS_API || 'http://localhost:3101';
    const { product, candidates } = await doImageSearch(browser, { sku, image, apiBase, interactive: false });
    return {
      ok: true,
      product: product
        ? {
            sku: product.sku,
            title: product.title,
            priceRub: product.priceRub,
            weightKg: product.weightKg,
            imageUrl: product.imageUrl,
          }
        : null,
      candidates,
    };
  } finally {
    await browser.disconnect();
  }
}

/* ------------------------------ 回填核价（CLI 用） ------------------------------ */

/** 抓 1688 价格/重量 → 算价 → 生成定价记录 */
export async function applyToDs(browser, sku, offer, apiBase, { sellPrice, dryRun = false } = {}) {
  const tk = await getDsToken(browser);
  const headers = { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk.token}` } : {}) };

  step('抓取 1688 价格 / 包装信息');
  const r1 = await fetch(`${apiBase}/pricing/sourcing/offer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: offer.url, allowBrowser: false }),
  });
  const src = await r1.json().catch(() => null);
  if (!r1.ok || !src) {
    fail(`抓取失败 HTTP ${r1.status}`);
    return null;
  }
  const purchaseCost = Number(src.price ?? src.priceCny ?? src.purchasePrice ?? 0) || 0;
  const weightG = Number(src.weightG ?? src.weight ?? 0) || 0;
  ok(`采购价 ¥${purchaseCost}　重量 ${weightG}g`);
  if (!purchaseCost) {
    warn('没抓到采购价，后续算价会不准，建议改用手填。');
  }

  step('读取核价参数');
  const st = await fetch(`${apiBase}/pricing/settings`, { headers }).then((r) => r.json());
  const product = await fetchProduct(browser, sku, apiBase);

  const weightKg = weightG ? weightG / 1000 : product.weightKg;
  const sellPriceRub = sellPrice ? Math.round(sellPrice / st.exchangeRate) : product.priceRub;
  const finalSellPrice = sellPrice ?? Number((sellPriceRub * st.exchangeRate).toFixed(2));

  step('算价');
  const r2 = await fetch(`${apiBase}/pricing/calc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      country: st.defaultCountry,
      vendor: st.defaultVendor,
      weightKg,
      lengthCm: product.lengthCm || 20,
      widthCm: product.widthCm || 20,
      heightCm: product.heightCm || 20,
      purchaseCost,
      sellPriceRub,
      exchangeRate: st.exchangeRate,
      labelFee: st.labelFee,
      commissionRate: st.commissionRate,
      agentRate: st.agentRate,
      withdrawRate: st.withdrawRate,
    }),
  });
  const calc = await r2.json().catch(() => null);
  if (!r2.ok || !calc?.best) {
    fail(`算价失败 HTTP ${r2.status} ${calc?.message || ''}`);
    return null;
  }
  const b = calc.best;
  ok(`${b.name} · ${b.shipMode}　运费 ¥${b.shippingFee}　毛利 ¥${b.grossProfit}（利润率 ${(b.profitRate * 100).toFixed(1)}%）`);
  log(`建议售价 ¥${b.suggestedSellPrice}（${b.suggestedSellPriceRub}₽）`);

  step(dryRun ? '试算结果（dry-run，不写库）' : '生成定价记录');
  const payload = {
    name: product.title,
    sku,
    purchaseCost,
    weightKg,
    lengthCm: product.lengthCm || 20,
    widthCm: product.widthCm || 20,
    heightCm: product.heightCm || 20,
    sellPrice: finalSellPrice,
    sellPriceRub: sellPriceRub || Math.round(finalSellPrice / st.exchangeRate),
    exchangeRate: st.exchangeRate,
    labelFee: st.labelFee,
    commissionRate: st.commissionRate,
    agentRate: st.agentRate,
    withdrawRate: st.withdrawRate,
    country: st.defaultCountry,
    vendor: st.defaultVendor,
    channelId: b.channelId,
    channelName: b.name,
    shipMode: b.shipMode,
    logistics: b.shipMode,
    shippingFee: b.shippingFee,
    billWeightKg: b.billWeightKg,
    supplyUrl: offer.url,
    retailUrl: product.productUrl,
    imageUrl: product.imageUrl,
    offer1688Title: src.title || offer.title,
    weightSource: weightG ? '1688' : 'ds',
    remark: product.title,
  };
  if (dryRun) {
    console.log('\n' + JSON.stringify(payload, null, 2));
    ok('dry-run 完成，未写入数据库');
    return payload;
  }
  const r3 = await fetch(`${apiBase}/pricing/records?storeId=1`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const rec = await r3.json().catch(() => null);
  if (!r3.ok) {
    fail(`保存失败 HTTP ${r3.status} ${rec?.message || ''}`);
    return null;
  }
  ok(`已生成定价记录 #${rec.id}　售价 ¥${rec.sellPrice}（${rec.sellPriceRub}₽）　毛利 ¥${rec.grossProfit}`);
  return rec;
}

/* ------------------------------ CLI 入口 ------------------------------ */

export async function runFind({ sku, image, apply = false, sellPrice = null }) {
  const browser = await connect();
  try {
    const tk = await getDsToken(browser);
    const apiBase = tk ? tk.apiBase : process.env.DS_API || 'http://localhost:3101';
    const { product, candidates } = await doImageSearch(browser, { sku, image, apiBase, interactive: true });

    if (!candidates.length) {
      fail('仍未解析到结果。已截图 shots/1688-results-*.png，可手动看页面。');
      return null;
    }

    console.log(`\n找到 ${candidates.length} 个候选（按页面顺序）：`);
    candidates.slice(0, 12).forEach((o, i) => {
      console.log(`  [${i}] ¥${o.price || '?'}  ${(o.title || '').slice(0, 42)}  ...${o.offerId}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question('\n选哪个？（输入序号，或 q 放弃）> ')).trim();
    rl.close();
    if (ans.toLowerCase() === 'q') {
      warn('已放弃');
      return null;
    }
    const pick = candidates[Number(ans)];
    if (!pick) throw new Error('序号无效');
    ok(`已选：${pick.title}\n     ${pick.url}`);

    if (apply) {
      if (!sku) warn('--apply 需要 --sku 才能带出商品尺寸/现价，已跳过');
      else await applyToDs(browser, sku, pick, apiBase, { sellPrice });
    } else {
      log('如需自动抓价并生成定价记录，下次加 --apply');
    }
    return pick;
  } finally {
    await browser.disconnect();
  }
}
