import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserService } from '../browser/browser.service';
import { CdpClient } from '../collect/lib/cdp.client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DESKTOP_UA,
  SearchItem,
  cacheGet,
  cacheSet,
  httpGet,
  isPunished,
  markPunished,
  parseOfferHtml,
  parseSearchCards,
  punishLeftMs,
} from './sourcing.http';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1688 搜索用的分类路径片段（实测这个 slug 与关键词无关，仅作入口） */
const SEARCH_PATH = '-6BE2.html';

export interface ImageSearchItem {
  offerId: string;
  title: string;
  price: number | null;
  imageUrl: string | null;
  offerUrl: string;
  priceText?: string | null;
  shop?: string | null;
  salesText?: string | null;
  repurchase?: string | null;
}

export interface OfferInfo {
  offerId: string;
  title: string;
  price: number | null;
  priceMax: number | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  fromPackTab: boolean; // 包装信息是否抓到
  packSkuCount?: number; // 包装信息里有多少个 SKU（颜色）
  minOrderQuantity?: number | null; // 起订量
  companyName?: string | null;
  source?: string; // http / browser
  warnings: string[];
}

/**
 * 1688 找货源服务：以图搜款 + 货品信息抓取。
 *
 * 全部通过「浏览器接管」的调试 Chrome（带用户登录态）走 CDP 完成：
 *  - 以图搜款：打开 1688 以图搜页 → 把商品主图塞进 <input type=file> → 等结果 → 抓款
 *  - 货品信息：打开 offer 页 → 抓标题价格 → 点「包装信息」抓 长宽高/重量
 *
 * 1688 页面结构经常变，这里全部用宽松匹配 + 多重兜底，抓不到的字段返回 null，
 * 由前端提示用户手动补填，绝不阻塞定价主流程。
 */
@Injectable()
export class SourcingService {
  private readonly logger = new Logger(SourcingService.name);

  constructor(
    private readonly browser: BrowserService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 补商品主图：先把已有 raw JSON 里的 imageUrl 捡回来（免费、瞬时），
   * 剩下的再用调试浏览器打开 Ozon 商品页抓 og:image（慢，每次约 10 秒，所以按 limit 分批）。
   */
  async fillMissingProductImages(limit = 5) {
    // ① 从 raw 里捡（插件数据其实带图，只是没见过列的映射）
    let fromRaw = 0;
    try {
      fromRaw = await this.prisma.$executeRawUnsafe(
        `UPDATE products SET imageUrl = JSON_UNQUOTE(JSON_EXTRACT(raw, '$.imageUrl'))
         WHERE imageUrl IS NULL AND JSON_EXTRACT(raw, '$.imageUrl') IS NOT NULL`,
      );
    } catch (e) {
      /* 忽略 */
    }

    // ② 还缺的，用浏览器抓
    const rows = await this.prisma.product.findMany({
      where: { imageUrl: null },
      orderBy: { id: 'desc' },
      take: Math.max(0, Math.min(limit, 20)),
      select: { id: true, sku: true, productUrl: true },
    });
    // 先把之前残留的 Ozon 商品标签关掉（只留榜单页），否则标签越堆越多、渲染进程不够用
    try {
      const ver0 = await this.browser.version();
      const cdp0 = new CdpClient(new URL(ver0.webSocketDebuggerUrl));
      await cdp0.connect();
      const tg0 = await cdp0.send('Target.getTargets', {}, undefined, 8000);
      let kept = 0;
      for (const t of tg0.result?.targetInfos || []) {
        if (t.type !== 'page' || !/ozon\.ru\/product\//.test(t.url || '')) continue;
        if (kept++ === 0) continue; // 留一个
        await cdp0.send('Target.closeTarget', { targetId: t.targetId }, undefined, 5000).catch(() => undefined);
      }
      cdp0.close();
    } catch (e) {
      /* ignore */
    }

    const filled: string[] = [];
    const failed: string[] = [];
    const failedDetail: Array<{ sku: string; reason: string }> = [];
    if (rows.length) await this.ensureBrowser();
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      // 每次打开 Ozon 商品页之间歇一下：连续快速请求会触发 Ozon 反爬，导致后续页面渲染进程卡死
      if (i > 0) await sleep(3000);
      try {
        const url = p.productUrl || `https://www.ozon.ru/product/${p.sku}/`;
        const r = await this.fetchProductImage(url);
        // 再校验一次：只写真正的商品图，脏地址（data:/chrome-extension:）绝不入库
        const ok =
          !!r.imageUrl && /^https?:\/\//i.test(r.imageUrl) && !/chrome-extension:|^data:|^blob:/i.test(r.imageUrl);
        if (ok) {
          await this.prisma.product.update({ where: { id: p.id }, data: { imageUrl: r.imageUrl } });
          filled.push(p.sku);
        } else {
          failed.push(p.sku);
          if (failedDetail.length < 3) failedDetail.push({ sku: p.sku, reason: r.reason || '未读到主图' });
        }
      } catch (e: any) {
        failed.push(p.sku);
        if (failedDetail.length < 3) failedDetail.push({ sku: p.sku, reason: String(e.message || e).slice(0, 120) });
      }
    }
    const remaining = await this.prisma.product.count({ where: { imageUrl: null } });
    return { fromRaw, filled, failed, failedDetail, remaining };
  }

  /**
   * 图片代理：Ozon / 1688 的图都有防盗链或跨域限制，前端要「复制图片到剪贴板」
   * 得先从同源接口拿到 blob，所以这里帮忙转一手。
   */
  async proxyImage(url: string): Promise<{ contentType: string; body: Buffer }> {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) throw new BadRequestException('图片地址不合法');
    const res = await fetch(u, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: /ozon/.test(u) ? 'https://www.ozon.ru/' : 'https://www.1688.com/',
      },
    });
    if (!res.ok) throw new BadRequestException(`图片拉取失败 HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(contentType)) throw new BadRequestException('不是图片内容');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new BadRequestException('图片过大（>8MB）');
    return { contentType, body: buf };
  }

  /**
   * 需要调试浏览器时自动拉起（幂等）。
   * 配置已经复制过的情况下，不会要求你退出正在运行的 Chrome —— 调试实例是独立目录。
   */
  private async ensureBrowser(): Promise<{ started: boolean }> {
    const st = await this.browser.status();
    if (st.portUp) return { started: false };
    const r = await this.browser.ensure();
    if (!r.ok) throw new BadRequestException(r.msg);
    return { started: true };
  }

  // ==================== 1688 登录态（cookie） ====================

  /** 读取存库的 1688 cookie */
  private async getCookie(): Promise<string | null> {
    const row = await this.prisma.pricingSetting.findUnique({ where: { id: 1 } });
    return row?.ali1688Cookie || null;
  }

  async cookieStatus() {
    const row = await this.prisma.pricingSetting.findUnique({ where: { id: 1 } });
    const cookie = row?.ali1688Cookie || '';
    return {
      hasCookie: !!cookie,
      cookieCount: cookie ? cookie.split(';').filter((x) => x.includes('=')).length : 0,
      syncedAt: row?.ali1688CookieAt || null,
    };
  }

  /**
   * 从「浏览器接管」的调试 Chrome 里把 1688 登录态同步过来（一次性动作）。
   *
   * 坑：Chrome 的 cookie 库是**懒加载**的 —— 新启动的实例直接读 `Storage.getCookies`
   * 会返回 0 条，必须先打开一个 1688 页面把它唤醒（实测：唤醒后 1600+ 条，其中 1688 有 31 条）。
   */
  async syncCookieFromChrome(): Promise<{ ok: boolean; cookieCount: number; msg: string }> {
    // 需要浏览器时自动拉起（配置已就绪的情况下不用退出你自己的 Chrome）
    await this.ensureBrowser();
    const ver = await this.browser.version();
    const cdp = new CdpClient(new URL(ver.webSocketDebuggerUrl));
    await cdp.connect();
    try {
      const readAll = async (): Promise<any[]> => {
        try {
          const res = await cdp.send('Storage.getCookies', {}, undefined, 15000);
          return res.result?.cookies || [];
        } catch (e) {
          return [];
        }
      };

      /** 打开一个 1688 页面，唤醒 cookie 库 */
      const wake = async () => {
        const tg = await cdp.send('Target.getTargets', {}, undefined, 8000);
        const has1688 = (tg.result?.targetInfos || []).some(
          (t: any) => t.type === 'page' && /1688\.com/.test(t.url || ''),
        );
        if (has1688) return false;
        await cdp.send('Target.createTarget', { url: 'https://www.1688.com/' }, undefined, 8000);
        return true;
      };

      let cookies = await readAll();
      if (!cookies.some((c) => /(^|\.)1688\.com$/.test(String(c.domain || '')))) {
        if (await wake()) await sleep(6000);
        cookies = await readAll();
      }

      // 还读不到就退到「页面级」的 Network.getCookies
      if (!cookies.some((c) => /(^|\.)1688\.com$/.test(String(c.domain || '')))) {
        const tg = await cdp.send('Target.getTargets', {}, undefined, 8000);
        const page =
          (tg.result?.targetInfos || []).find((t: any) => t.type === 'page' && /1688/.test(t.url || '')) ||
          (tg.result?.targetInfos || []).find((t: any) => t.type === 'page');
        if (page) {
          const at = await cdp.send(
            'Target.attachToTarget',
            { targetId: page.targetId, flatten: true },
            undefined,
            8000,
          );
          const r = await cdp.send(
            'Network.getCookies',
            { urls: ['https://www.1688.com', 'https://m.1688.com', 'https://detail.1688.com', 'https://s.1688.com'] },
            at.result.sessionId,
            12000,
          );
          cookies = r.result?.cookies || [];
        }
      }

      const ali = cookies.filter((c) => /(^|\.)1688\.com$/.test(String(c.domain || '')));
      if (!ali.length) {
        throw new BadRequestException(
          '调试 Chrome 里没有 1688 的 cookie：请在弹出的调试 Chrome 窗口里打开并登录 1688，再同步一次。',
        );
      }
      const header = ali.map((c) => `${c.name}=${c.value}`).join('; ');
      await this.prisma.pricingSetting.upsert({
        where: { id: 1 },
        create: { id: 1, ali1688Cookie: header, ali1688CookieAt: new Date() },
        update: { ali1688Cookie: header, ali1688CookieAt: new Date() },
      });
      return { ok: true, cookieCount: ali.length, msg: `已同步 ${ali.length} 条 1688 cookie，之后搜款/抓详情都不用浏览器了` };
    } finally {
      try {
        cdp.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /** 手动粘贴 cookie（从 DevTools 复制 Cookie 请求头） */
  async saveCookie(raw: string) {
    const cookie = String(raw || '').trim();
    if (!cookie) throw new BadRequestException('cookie 为空');
    await this.prisma.pricingSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ali1688Cookie: cookie, ali1688CookieAt: new Date() },
      update: { ali1688Cookie: cookie, ali1688CookieAt: new Date() },
    });
    return await this.cookieStatus();
  }

  // ==================== 1688 搜款 / 抓详情（纯 HTTP）====================

  /**
   * 关键词搜同款：m.1688.com 的 SSR 页面一次返回 20 张卡片，0.5 秒左右。
   * 需要 1688 登录态 cookie（否则被踢到登录页，会明确报错并提示同步）。
   */
  async searchByKeyword(
    keyword: string,
  ): Promise<{ items: SearchItem[]; warnings: string[]; keyword: string; needCookie: boolean }> {
    const kw = String(keyword || '').trim();
    if (!kw) throw new BadRequestException('请填写搜索关键词（比如商品的中文类目名）');

    // 同关键词 5 分钟内直接命中缓存（既提速，也避免把 1688 打急）
    const ck = `kw:${kw}`;
    const cached = cacheGet<{ items: SearchItem[]; warnings: string[]; keyword: string; needCookie: boolean }>(ck, 5 * 60 * 1000);
    if (cached) return { ...cached, warnings: [...cached.warnings, '（缓存结果，5 分钟内同关键词不重复请求）'] };

    if (isPunished()) {
      return {
        items: [],
        warnings: [`1688 风控冷却中（还有 ${Math.ceil(punishLeftMs() / 1000)} 秒）：刚才请求太密被滑块拦了，等冷却结束再试。详情抓取不受影响，可直接粘贴 1688 链接继续。`],
        keyword: kw,
        needCookie: false,
      };
    }
    const cookie = await this.getCookie();
    const url = `https://m.1688.com/offer_search/${SEARCH_PATH}?keywords=${encodeURIComponent(kw)}`;
    const res = await httpGet(url, { cookie, mobile: true, timeoutMs: 12000, referer: 'https://m.1688.com/' });
    if (res.punished) {
      markPunished(3 * 60 * 1000);
      return {
        items: [],
        warnings: [
          '1688 触发了风控（滑块验证）：短时间内请求太密了。等几分钟再试；平时点「搜同款」不要连点，系统已加了节流与缓存。',
        ],
        keyword: kw,
        needCookie: false,
      };
    }
    if (res.needsLogin) {
      return {
        items: [],
        warnings: [
          cookie
            ? '1688 登录态已失效，请点「同步 1688 登录态」或「粘贴 Cookie」重新来一次。'
            : '1688 搜索需要登录态：请点「同步 1688 登录态」或「粘贴 Cookie」（一次性，之后全程不需要浏览器）。',
        ],
        keyword: kw,
        needCookie: true,
      };
    }
    const items = parseSearchCards(res.body);
    const warnings: string[] = [];
    if (!items.length) warnings.push('没解析到商品卡片（1688 页面结构可能变了，或关键词太偏）');
    const payload = { items, warnings, keyword: kw, needCookie: false };
    if (items.length) cacheSet(ck, payload);
    return payload;
  }

  /**
   * 抓货品详情（价格 + 包装信息）：detail 页是 SSR，匿名都能抓，0.6 秒。
   * 先用 HTTP，HTTP 拿不到关键字段时再考虑走浏览器。
   */
  async fetchOfferHttp(offerUrl: string): Promise<OfferInfo | null> {
    const m = String(offerUrl).match(/offer\/(\d+)\.html/) || String(offerUrl).match(/^(\d{8,})$/);
    const offerId = m ? m[1] : '';
    if (!offerId) throw new BadRequestException('不是有效的 1688 商品链接（需要包含 detail.1688.com/offer/<id>.html）');
    const ck = `offer:${offerId}`;
    const cached = cacheGet<OfferInfo>(ck, 30 * 60 * 1000);
    if (cached) return { ...cached, warnings: [...(cached.warnings || []), '（30 分钟内同一货品用缓存）'] };
    const cookie = await this.getCookie();
    const url = `https://detail.1688.com/offer/${offerId}.html`;
    const res = await httpGet(url, { cookie, timeoutMs: 12000 });
    if (res.punished) throw new BadRequestException('1688 触发了风控（滑块），等几分钟再试');
    if (res.status !== 200) throw new BadRequestException(`1688 货品页返回 HTTP ${res.status}`);
    const d = parseOfferHtml(res.body, offerId);
    if (!d.title && d.price == null && !d.fromPackInfo) return null;
    const payload: OfferInfo = {
      offerId,
      title: d.title,
      price: d.price,
      priceMax: d.priceMax,
      weightG: d.weightG,
      lengthCm: d.lengthCm,
      widthCm: d.widthCm,
      heightCm: d.heightCm,
      fromPackTab: d.fromPackInfo,
      packSkuCount: d.packSkuCount,
      minOrderQuantity: d.minOrderQuantity,
      companyName: d.companyName,
      source: 'http',
      warnings: d.warnings,
    };
    cacheSet(ck, payload);
    return payload;
  }

  private async withPage<T>(
    url: string,
    fn: (cdp: CdpClient, sessionId: string, ev: (expr: string, tries?: number) => Promise<any>) => Promise<T>,
    settleMs = 8000,
  ): Promise<T> {
    await this.ensureBrowser();
    const ver = await this.browser.version();
    const cdp = new CdpClient(new URL(ver.webSocketDebuggerUrl));
    await cdp.connect();
    let openedTargetId: string | null = null;
    try {
      const created = await cdp.send('Target.createTarget', { url }, undefined, 20000);
      openedTargetId = created.result?.targetId || null;
      const attached = await cdp.send(
        'Target.attachToTarget',
        { targetId: created.result.targetId, flatten: true },
        undefined,
        8000,
      );
      const sessionId = attached.result.sessionId;

      // 域开关要趁早开：页面加载约 10 秒后渲染进程会被插件 / 风控脚本占满，
      // 那时候连 Page.enable 都不回包了（实测过，等 12 秒再求值必超时）
      try {
        await cdp.send('Page.enable', {}, sessionId, 5000);
        await cdp.send('DOM.enable', {}, sessionId, 5000);
      } catch (e) {
        /* ignore */
      }

      /*
       * 必须把它切到最前！Chrome 会节流/冻结"后台标签"的渲染进程，
       * 表现就是 Runtime.evaluate 一直超时 —— 补主图失败、采集卡死都是这个原因。
       */
      await cdp.send('Page.bringToFront', {}, sessionId, 8000).catch(() => undefined);

      /**
       * 页面 JS 求值。踩过的坑：Ozon / 1688 这种重页面（还带插件注入）渲染进程会忙到
       * 让 Runtime.evaluate 长时间不回包。单次求值可能要 7-8 秒，所以 timeout 必须给到
       * 12 秒（原来只给 6 秒 → 必超时 → readImage 一直拿 null → 补图失败，实测对比过）。
       */
      const rawEval = async (expr: string, timeoutMs = 12000): Promise<any> => {
        const r = await cdp.send(
          'Runtime.evaluate',
          { expression: expr, returnByValue: true },
          sessionId,
          timeoutMs,
        );
        return r.result?.result?.value;
      };
      const ev = async (expr: string, tries = 3): Promise<any> => {
        for (let i = 0; i < tries; i++) {
          try {
            return await rawEval(expr);
          } catch (e) {
            await sleep(800);
          }
        }
        return undefined;
      };

      // 不要一上来就睡十几秒：一边等一边轮询，页面一能求值就继续。
      // 注意：这里的超时必须 catch 住，否则单次超时会直接把整个 withPage 打挂
      // （5800250870 的 "CDP 命令超时: Runtime.evaluate" 就是这里漏了 try/catch）。
      for (let i = 0; i < 20; i++) {
        try {
          const state = await rawEval('document.readyState', 6000);
          if (state) break;
        } catch (e) {
          /* 页面还在跑重 JS，继续等 */
        }
        await sleep(800);
      }

      // 登录 / 风控检测
      const login = await ev(
        `/login\\.taobao|login\\.1688|扫码登录|请登录|会员登录/.test(location.href + document.body.innerText.slice(0,3000))`,
      );
      if (login === true) {
        throw new BadRequestException('1688 要求登录：请在弹出的调试 Chrome 窗口里登录 1688 后重试。');
      }

      return await fn(cdp, sessionId, ev);
    } finally {
      /*
       * 用完就把标签关掉。踩过的坑：每次抓图都新开一个 Ozon 商品页且不关，
       * 十来个重页面把渲染进程池占满后，新标签直接不响应（求值全部抛异常 → 补图失败）。
       */
      if (openedTargetId) {
        await cdp.send('Target.closeTarget', { targetId: openedTargetId }, undefined, 6000).catch(() => undefined);
      }
      try {
        cdp.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /** 等待某个 JS 条件成立 */
  private async waitFor(
    ev: (expr: string) => Promise<any>,
    expr: string,
    timeoutMs: number,
    intervalMs = 1200,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await ev(expr)) === true) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  /**
   * 以图搜款（组合式，三步都确定可用）：
   *   1. prepareImageSearch：打开 1688 图搜页并把主图塞进上传框
   *   2. triggerImageSearch：尽力自动点一下「搜索图片」（合成点击在重 SPA 上不稳，失败不影响）
   *   3. 反复 scanTabs：把浏览器里任何 1688 标签页上的货源卡片收回来
   *
   * 哪怕第 2 步没点成，用户在浏览器里点一下再调 scanTabs 也能拿到结果。
   */
  async searchByImage(imageUrl: string): Promise<{ items: ImageSearchItem[]; warnings: string[] }> {
    const warnings: string[] = [];
    const prep = await this.prepareImageSearch(imageUrl);
    warnings.push(...prep.warnings);

    // 尽力自动触发搜索
    await this.triggerImageSearch().catch(() => undefined);

    // 轮询收结果（用户手动点完搜索也能被这里捞到）
    let items: ImageSearchItem[] = [];
    for (let i = 0; i < 10; i++) {
      const scan = await this.scanTabs();
      if (scan.items.length) {
        items = scan.items;
        break;
      }
      await sleep(5000);
    }

    if (!items.length) {
      warnings.push(
        prep.uploaded
          ? '图片已经放进 1688 图搜框了：请在浏览器里点一下「搜索图片」，等结果出来后回系统点「读取 1688 结果」，或者直接把货源链接粘到下面。'
          : '没能在 1688 自动搜款，请在浏览器里手动搜款后，把货源链接粘到下面。',
      );
    }
    return { items, warnings };
  }

  /** 找到 1688 图搜标签页，取「搜索图片」按钮坐标并用 Input 域点一下（不依赖渲染进程 JS） */
  async triggerImageSearch(): Promise<{ clicked: boolean; msg: string }> {
    const st = await this.browser.status();
    if (!st.portUp) return { clicked: false, msg: '调试 Chrome 未就绪' };
    const ver = await this.browser.version();
    const cdp = new CdpClient(new URL(ver.webSocketDebuggerUrl));
    await cdp.connect();
    try {
      const targets = await cdp.send('Target.getTargets', {}, undefined, 8000);
      const page = (targets.result?.targetInfos || []).find(
        (t: any) => t.type === 'page' && /1688-search|youyuan/i.test(t.url || ''),
      );
      if (!page) return { clicked: false, msg: '没找到 1688 图搜标签页' };
      const attached = await cdp.send(
        'Target.attachToTarget',
        { targetId: page.targetId, flatten: true },
        undefined,
        8000,
      );
      const sid = attached.result.sessionId;
      const ev = async (expr: string, to = 5000) => {
        try {
          const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid, to);
          return r.result?.result?.value;
        } catch (e) {
          return undefined;
        }
      };
      // 重页面有 10~25 秒「假死」窗口，按钮坐标要反复问
      for (let i = 0; i < 20; i++) {
        const raw = await ev(
          `(() => {
            const el = [...document.querySelectorAll('button,div,span,a')].find(e => (e.innerText || '').trim() === '搜索图片');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;
            return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
          })()`,
        );
        if (raw && raw !== 'null') {
          const { x, y } = JSON.parse(String(raw));
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
            try {
              await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid, 6000);
            } catch (e) {
              /* ignore */
            }
          }
          return { clicked: true, msg: '已自动点击「搜索图片」' };
        }
        await sleep(2000);
      }
      return { clicked: false, msg: '没找到「搜索图片」按钮（可能图片还没准备好）' };
    } finally {
      try {
        cdp.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /** 结果页抓 offer 卡片（图 + 标题 + 价格 + 链接） */
  private async scrapeOffers(ev: (expr: string, tries?: number) => Promise<any>): Promise<ImageSearchItem[]> {
    const raw = await ev(`(() => {
        const out = new Map();
        document.querySelectorAll('a[href*="detail.1688.com/offer/"]').forEach((a) => {
          const m = (a.getAttribute('href') || '').match(/offer\\/(\\d+)\\.html/);
          if (!m) return;
          const id = m[1];
          if (out.has(id)) return;
          const box = a.closest('div[class]') || a;
          const txt = (box.innerText || '') + ' ' + (a.innerText || '');
          const pm = txt.replace(/,/g, '').match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/);
          const img = a.querySelector('img') || box.querySelector('img');
          const src = img
            ? img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazyload-src') || ''
            : '';
          out.set(id, {
            offerId: id,
            title: (a.getAttribute('title') || img?.getAttribute('alt') || a.innerText || '').trim().slice(0, 200),
            price: pm ? parseFloat(pm[1]) : null,
            imageUrl: src.startsWith('//') ? ('https:' + src) : src,
            offerUrl: 'https://detail.1688.com/offer/' + id + '.html',
          });
        });
        return JSON.stringify([...out.values()].slice(0, 24));
      })()`, 2);
    try {
      return (JSON.parse(raw || '[]') || []).filter((x: any) => x?.offerId);
    } catch (e) {
      return [];
    }
  }

  /**
   * 把商品主图注入 1688 图搜页的上传框（不触发搜索）。
   *
   * 为什么不做成一键搜完：1688 图搜是个重型 SPA，实测合成点击 / 粘贴触发搜索不稳定，
   * 所以这一步只做到「图片已进入上传框」，剩下让页面上的真人点一下「搜索图片」，
   * 再用 scanTabs() 把结果收回来 —— 这样整条链路的每一步都是确定可用的。
   */
  async prepareImageSearch(imageUrl: string): Promise<{ pageUrl: string; uploaded: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    const ext = /\.(png|webp|jpeg)(\?|$)/i.test(imageUrl) ? RegExp.$1 : 'jpg';
    const file = path.join(os.tmpdir(), `1688_search_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`);
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.ozon.ru/' },
    });
    if (!res.ok) throw new BadRequestException(`商品图片下载失败 HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const b64 = fs.readFileSync(file).toString('base64');

    // 浏览器刚被自动拉起时，profile + 插件还在加载，CDP 求值会大量超时，先预热一下
    const { started } = await this.ensureBrowser();
    if (started) {
      warnings.push('调试浏览器是刚启动的，等它稳定 8 秒…');
      await sleep(8000);
    }

    const pageUrl = 'https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch';
    const uploaded = await this.withPage(
      pageUrl,
      async (_cdp, _sessionId, ev) => {
        const injectJs = `(() => {
          const b64 = 'REPLACE_B64';
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const dt = new DataTransfer();
          dt.items.add(new File([arr], 'search.jpg', { type: 'image/jpeg' }));
          const inputs = [...document.querySelectorAll('input[type=file]')];
          let n = 0;
          inputs.forEach((inp) => {
            try { inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); n++; } catch (e) {}
          });
          return n;
        })()`;

        // 探测上传框 + 注入，整体预算 60 秒；注入失败会重试（重页面求值经常超时，不能只试一次）
        const deadline = Date.now() + 60000;
        let injected = 0;
        let sawInput = false;
        while (Date.now() < deadline) {
          const has = await ev(`!!document.querySelector('input[type=file]')`, 2);
          if (has !== true) {
            await sleep(600);
            continue;
          }
          sawInput = true;
          const n = Number(await ev(injectJs.replace('REPLACE_B64', b64), 3));
          if (n > 0) {
            injected = n;
            break;
          }
          await sleep(2500); // 页面正忙，缓一下再试
        }
        if (!sawInput) warnings.push('没找到上传入口，请在浏览器里手动上传图片搜款。');
        else if (!injected) warnings.push('图片没能塞进上传框，请在浏览器里手动上传。');
        return injected > 0;
      },
      0,
    );
    return { pageUrl, uploaded, warnings };
  }

  /**
   * 扫描当前 Chrome 里所有 1688 标签页，把货源链接收集回来。
   * 用于：用户在浏览器里点完「搜索图片」后，系统把结果取走。
   */
  async scanTabs(): Promise<{ items: ImageSearchItem[]; warnings: string[]; tabs: string[] }> {
    const st = await this.browser.status();
    if (!st.portUp) {
      throw new BadRequestException(
        '调试浏览器还没在运行：点一下「以图搜款」会自动启动它（首次需要退出 Chrome 复制配置，之后不用）。',
      );
    }
    const ver = await this.browser.version();
    const cdp = new CdpClient(new URL(ver.webSocketDebuggerUrl));
    await cdp.connect();
    const warnings: string[] = [];
    const tabs: string[] = [];
    const found = new Map<string, ImageSearchItem>();
    try {
      const targets = await cdp.send('Target.getTargets', {}, undefined, 8000);
      const pages = (targets.result?.targetInfos || [])
        .filter((t: any) => t.type === 'page' && /1688\.com/.test(t.url || ''))
        .slice(0, 6);
      const deadline = Date.now() + 60000; // 整体预算，别让某个卡死的页面拖垮接口
      for (const t of pages) {
        if (Date.now() > deadline) break;
        tabs.push(t.url);
        // offer 详情页：直接拿 URL 里的 id
        const m = String(t.url).match(/offer\/(\d+)\.html/);
        if (m) {
          found.set(m[1], {
            offerId: m[1],
            title: '',
            price: null,
            imageUrl: null,
            offerUrl: `https://detail.1688.com/offer/${m[1]}.html`,
          });
        }
        try {
          const attached = await cdp.send(
            'Target.attachToTarget',
            { targetId: t.targetId, flatten: true },
            undefined,
            8000,
          );
          const sid = attached.result.sessionId;
          const ev = async (expr: string, to = 8000) => {
            try {
              const r = await cdp.send(
                'Runtime.evaluate',
                { expression: expr, returnByValue: true },
                sid,
                to,
              );
              return r.result?.result?.value;
            } catch (e) {
              return undefined;
            }
          };
          const raw = await ev(`(() => {
            const out = [];
            document.querySelectorAll('a[href*="detail.1688.com/offer/"]').forEach((a) => {
              const m = (a.getAttribute('href') || '').match(/offer\\/(\\d+)\\.html/);
              if (!m) return;
              const box = a.closest('div[class]') || a;
              const txt = (box.innerText || '') + ' ' + (a.innerText || '');
              const pm = txt.replace(/,/g, '').match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/);
              const img = a.querySelector('img') || box.querySelector('img');
              const src = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
              out.push({
                offerId: m[1],
                title: (a.getAttribute('title') || img?.getAttribute('alt') || a.innerText || '').trim().slice(0, 200),
                price: pm ? parseFloat(pm[1]) : null,
                imageUrl: src.startsWith('//') ? ('https:' + src) : src,
                offerUrl: 'https://detail.1688.com/offer/' + m[1] + '.html',
              });
            });
            return JSON.stringify(out.slice(0, 40));
          })()`);
          try {
            const arr = JSON.parse(raw || '[]');
            (Array.isArray(arr) ? arr : []).forEach((it: any) => {
              if (!it?.offerId) return;
              const prev = found.get(it.offerId);
              found.set(it.offerId, {
                ...it,
                title: it.title || prev?.title || '',
                price: it.price ?? prev?.price ?? null,
                imageUrl: it.imageUrl || prev?.imageUrl || null,
              });
            });
          } catch (e) {
            /* ignore */
          }
        } catch (e: any) {
          warnings.push(`有个 1688 标签页读不了：${e.message}`);
        }
      }
      if (!pages.length) warnings.push('没找到打开的 1688 标签页。');
      if (pages.length && !found.size) {
        warnings.push('1688 页面已打开但没读到货源卡片：请在浏览器里点一下「搜索图片」，等结果出来后再读一次。');
      }

      // 拿到 offer 链接后，标题/价格这些直接走纯 HTTP 补全（快，不用碰浏览器）
      const items = [...found.values()];
      for (const it of items.slice(0, 6)) {
        {
          if (it.title && it.price != null) return;
          try {
            const d = await this.fetchOfferHttp(it.offerUrl);
            if (d) {
              it.title = it.title || d.title;
              it.price = it.price ?? d.price;
              it.priceText = d.price != null ? `¥${d.price}` : null;
              (it as any).weightG = d.weightG;
              (it as any).packText = d.weightG ? `${d.lengthCm || '-'}×${d.widthCm || '-'}×${d.heightCm || '-'}cm · ${d.weightG}g` : null;
            }
          } catch (e) {
            /* 补全失败不影响主流程 */
          }
        }
      }
      return { items, warnings, tabs };
    } finally {
      try {
        cdp.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /**
   * 抓 Ozon 商品主图（插件数据里没有图片，需要打开商品页拿 og:image / 首图）
   * 拿到后回写商品库，下次直接用。
   */
  async fetchProductImage(target: string): Promise<{ imageUrl: string | null; reason?: string }> {
    let url = String(target || '').trim();
    if (!url) throw new BadRequestException('缺少商品链接或 SKU');
    if (/^\d{6,}$/.test(url)) {
      url = `https://www.ozon.ru/product/${url}/`;
    } else if (url.includes('ozon.')) {
      /*
       * 关键：必须把 URL 规范成干净形式 https://www.ozon.ru/product/<id>/。
       * 分享/带跟踪参数的链接（?_bctx=...&at=...）会被 Ozon 送进反爬校验页，
       * 表现就是等 90 秒也读不到 og:image（补图失败的真凶，实测对比过）。
       */
      const id = (url.match(/-(\d{6,})\/?(\?|$)/) || url.match(/product\/(\d{6,})/) || url.match(/(\d{6,})/))?.[1];
      if (id) url = `https://www.ozon.ru/product/${id}/`;
    }

    /*
     * Ozon 商品页要跑约 90 秒重度 JS（期间渲染进程根本不回 CDP），所以必须给足耐心：
     * 轮询 og:image 最多 90 秒。原来只等 12 秒 → 必然失败（"补图失败"就是这么来的）。
     * 同时只接受真正的商品图地址，data:/chrome-extension: 这类占位图/扩展图标一律不要。
     */
    return this.withPage(
      url,
      async (_cdp, _sessionId, ev) => {
        const readImage = async (): Promise<string | null> => {
          /* 单行表达式：多行模板字面量在 CDP 传输时可能出问题（实测 SyntaxError），压成一行最稳 */
          const img = await ev(
            "(function(){var m=document.querySelector('meta[property=\"og:image\"]');var f=m&&m.getAttribute('content');if(f&&/^https?:/i.test(f))return f;var is=[].slice.call(document.querySelectorAll('img')).map(function(i){return i.getAttribute('src')||''}).filter(function(s){return /^https?:\\/\\//i.test(s)&&/ozonstatic|ozone.ru|ozon.ru/.test(s)});if(!is.length)return 'null';return is[0]})()",
          );
          const v = img && img !== 'null' && img !== '__TIMEOUT__' ? String(img) : null;
          if (!v) return null;
          if (!/^https?:\/\//i.test(v)) return null;
          if (/chrome-extension:|^data:|^blob:/i.test(v)) return null;
          return v;
        };

        let tries = 0;
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          tries++;
          const found = await readImage();
          if (found) return { imageUrl: found };
          await sleep(2000);
        }
        return { imageUrl: null, reason: `等了 90 秒仍没读到商品主图（尝试 ${tries} 次）：页面可能在跑反爬校验，或该商品页异常` };
      },
      3000,
    );
  }

  /**
   * 抓 1688 货品信息（对外入口）：**纯 HTTP 优先**。
   * 详情页是 SSR、匿名可抓、0.6 秒返回，所以默认根本不碰浏览器。
   * 只有 HTTP 读不到价格和包装信息、且调用方明确允许时，才退到浏览器兜底。
   */
  async fetchOffer(offerUrl: string, allowBrowser = false): Promise<OfferInfo> {
    let httpErr: any = null;
    try {
      const fast = await this.fetchOfferHttp(offerUrl);
      if (fast && (fast.price != null || fast.fromPackTab)) return fast;
      if (fast) {
        fast.warnings.push('HTTP 只读到部分信息（价格或包装信息缺一项），可手动补填');
        if (!allowBrowser) return fast;
        return fast;
      }
    } catch (e: any) {
      httpErr = e;
    }
    if (!allowBrowser) {
      if (httpErr) throw httpErr;
      throw new BadRequestException('没能从 1688 页面读出价格/包装信息，请检查链接或手动补填');
    }
    return this.fetchOfferByBrowser(offerUrl);
  }

  /**
   * 浏览器兜底版：抓 1688 货品信息（标题、价格、包装信息）
   * 慢且重（十几秒起），只在 HTTP 拿不到时用。
   */
  private async fetchOfferByBrowser(offerUrl: string): Promise<OfferInfo> {
    const m = String(offerUrl).match(/offer\/(\d+)\.html/);
    const offerId = m ? m[1] : '';
    if (!offerId) throw new BadRequestException('不是有效的 1688 商品链接（需要包含 detail.1688.com/offer/<id>.html）');
    const url = `https://detail.1688.com/offer/${offerId}.html`;

    return this.withPage(url, async (_cdp, _sessionId, ev) => {
      const warnings: string[] = [];
      /*
       * 关键：新建标签页一开始停在 about:blank，此时 readyState 就已经是 complete，
       * 如果只等 readyState 会对着空白页抓一通、什么都抓不到（踩过）。
       * 所以先等 URL 真的跳到目标 offer，再等它不再是 loading。
       */
      await this.waitFor(ev, `location.href.includes('${offerId}')`, 12000, 500);
      await this.waitFor(ev, `document.readyState !== 'loading'`, 6000, 700);

      const info: OfferInfo = {
        offerId,
        title: '',
        price: null,
        priceMax: null,
        weightG: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        fromPackTab: false,
        warnings,
      };

      // 标题
      info.title = String(
        (await ev(`document.querySelector('h1,[class*="titleText"],.title-text')?.innerText?.trim() || document.title.split('-')[0]`)) || '',
      ).slice(0, 300);

      /**
       * 价格 + 包装信息：直接从页面 HTML 里的内联 JSON 抠，比爬 DOM 稳得多。
       * 实测结构（detail.1688.com 货品页内联 script）：
       *   "priceDisplay":"18.80"
       *   "productPackInfo":{... "pieceWeightScale":{"pieceWeightScaleInfo":[
       *        {"volume":4620,"sku1":"粉色…","length":14,"width":11,"height":30,"weight":350,"skuId":…} ]}}
       * 解析全在页面里做完，只把结果带回来（HTML 有几 MB，不适合整块传）。
       */
      const raw = await ev(`(() => {
        const html = document.documentElement.innerHTML;
        const out = { prices: [], skus: [] };

        // 价格：优先 priceDisplay（主展示价），退而求其次用 "price"
        const grab = (re) => {
          const list = [...html.matchAll(re)].map((m) => parseFloat(m[1])).filter((n) => n > 0 && n < 1000000);
          return [...new Set(list)];
        };
        let prices = grab(/"priceDisplay"\\s*:\\s*"([0-9]+(?:\\.[0-9]+)?)"/g);
        if (!prices.length) prices = grab(/"price"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)"?/g);
        out.prices = prices.sort((a, b) => a - b);

        // 包装信息：pieceWeightScaleInfo 数组（按括号配对切出完整数组再 JSON.parse）
        const key = 'pieceWeightScaleInfo';
        const keyIdx = html.indexOf(key);
        if (keyIdx >= 0) {
          const start = html.indexOf('[', keyIdx);
          if (start > 0) {
            let depth = 0, end = -1;
            for (let i = start; i < html.length && i < start + 200000; i++) {
              const c = html[i];
              if (c === '[') depth++;
              else if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
            }
            if (end > 0) {
              try {
                const arr = JSON.parse(html.slice(start, end));
                out.skus = (Array.isArray(arr) ? arr : []).map((x) => ({
                  name: x.sku1 || x.skuName || '',
                  length: Number(x.length) || null,
                  width: Number(x.width) || null,
                  height: Number(x.height) || null,
                  volume: Number(x.volume) || null,
                  weight: Number(x.weight) || null,
                }));
              } catch (e) { /* ignore */ }
            }
          }
        }
        return JSON.stringify(out);
      })()`, 3);

      let parsed: any = null;
      try {
        parsed = JSON.parse(raw || 'null');
      } catch (e) {
        /* ignore */
      }
      if (parsed?.prices?.length) {
        info.price = parsed.prices[0];
        info.priceMax = parsed.prices[parsed.prices.length - 1];
      }
      const skuList: any[] = parsed?.skus || [];
      const firstSku = skuList.find((s) => s.weight || (s.length && s.width && s.height)) || skuList[0];
      if (firstSku) {
        info.lengthCm = firstSku.length ?? null;
        info.widthCm = firstSku.width ?? null;
        info.heightCm = firstSku.height ?? null;
        info.weightG = firstSku.weight ?? null;
        info.packSkuCount = skuList.length;
        if (firstSku.weight || (firstSku.length && firstSku.width && firstSku.height)) info.fromPackTab = true;
      }

      let pack = firstSku && firstSku.length ? { l: firstSku.length, w: firstSku.width, h: firstSku.height, wt: firstSku.weight } : null;

      if (!pack) {
        // 兜底：点「包装信息」tab 再抓表格
        const clicked = await ev(`(() => {
          const els = [...document.querySelectorAll('div,span,a,li')].filter(e => (e.innerText||'').trim() === '包装信息' && e.children.length <= 2);
          if (!els.length) return false;
          els[0].click(); return true;
        })()`);
        if (clicked === true) {
          await this.waitFor(
            ev,
            `(() => { const t = document.body.innerText; return /(长|长\\(cm\\)).*(宽|宽\\(cm\\)).*(重量|重量\\(g\\))/.test(t) || /体积\\(cm³\\)/.test(t); })()`,
            8000,
          );
        }
        const packStr: any = await ev(`(() => {
          const num = (s) => { const m = String(s).replace(/,/g,'').match(/([0-9]+(?:\\.[0-9]+)?)/); return m ? parseFloat(m[1]) : null; };
          const tables = [...document.querySelectorAll('table')].filter(t => /长/.test(t.innerText) && /重量/.test(t.innerText));
          for (const tb of tables) {
            const ths = [...tb.querySelectorAll('tr:first-child th, tr:first-child td')].map(x => (x.innerText||'').trim());
            const iL = ths.findIndex(x => x.includes('长')); const iW = ths.findIndex(x => x.includes('宽'));
            const iH = ths.findIndex(x => x.includes('高')); const iWt = ths.findIndex(x => x.includes('重量'));
            const row = tb.querySelectorAll('tr')[1];
            if (!row) continue;
            const tds = [...row.querySelectorAll('td,th')].map(x => x.innerText.trim());
            if (iL < 0 || iW < 0 || iH < 0) continue;
            return JSON.stringify({ l: num(tds[iL]), w: num(tds[iW]), h: num(tds[iH]), wt: iWt >= 0 ? num(tds[iWt]) : null });
          }
          return 'null';
        })()`);
        try {
          pack = JSON.parse(packStr || 'null');
        } catch (e) {
          pack = null;
        }
        if (pack) info.fromPackTab = true;
      }

      if (pack) {
        info.lengthCm = pack.l ?? null;
        info.widthCm = pack.w ?? null;
        info.heightCm = pack.h ?? null;
        info.weightG = pack.wt != null ? pack.wt : null;
      } else if (!info.weightG && !info.lengthCm) {
        warnings.push('未能自动读取「包装信息」（长宽高/重量），请手动查看 1688 页面补填。');
      }
      if (info.price == null) warnings.push('未能自动读取价格，请手动补填采购成本。');
      return info;
    }, 6000);
  }
}
