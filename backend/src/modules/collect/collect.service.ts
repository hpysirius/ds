import { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BrowserService } from '../browser/browser.service';
import { CdpClient, sleep } from './lib/cdp.client';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';

/** 从插件注入的属性里读商品数据的 JS 片段 */
const GRAB_JS = `JSON.stringify([].slice.call(document.querySelectorAll('[data-s2-card-data-json]')).map(function(e){
  try{
    var d = JSON.parse(e.getAttribute('data-s2-card-data-json'));
    var p = e, url = '', name = '';
    for (var i = 0; i < 10 && p; i++) {
      var as = p.querySelectorAll ? p.querySelectorAll('a[href*="/product/"]') : [];
      var best = null;
      for (var k = 0; k < as.length; k++) {
        var tx = ((as[k].getAttribute('aria-label') || as[k].innerText || '') + '').trim();
        if (!best || tx.length > best.length) best = tx;
        if (!url) url = as[k].href || '';
      }
      if (best) name = best;
      if (url) break;
      p = p.parentElement;
    }
    var q = e, img = null;
    for (var j = 0; j < 10 && q; j++) {
      img = q.querySelector ? q.querySelector('img[alt]') : null;
      if (img) break;
      q = q.parentElement;
    }
    var alt = img ? (img.getAttribute('alt') || '').trim() : '';
    if (alt.length > 12 && alt.length > (name || '').length) name = alt;
    d.__title = name || '';
    d.__url = url || '';
    /*
     * 主图：插件数据里只有部分商品带 imageUrl，这里从卡片 DOM 兜底抓一次。
     * 踩过的坑：直接取 img.src 会抓到
     *   - 懒加载占位图：data:image/png;base64,...（一大串 base64 存进库，界面显示不出）
     *   - 采集插件自己的图标：chrome-extension://xxx/new.png
     * 所以必须：优先 srcset/data-src、只接受 http(s)、排除 data:/chrome-extension:/blob:。
     */
    try {
      if (!d.imageUrl && img) {
        var cand = img.getAttribute('srcset') || img.getAttribute('data-src') || img.getAttribute('src') || '';
        var first = cand ? cand.split(',')[0].trim().split(' ')[0] : '';
        if (first && /^https?:\/\//.test(first) === false && first.indexOf('//') === 0) first = 'https:' + first;
        if (first && /^https?:\/\//i.test(first) && !/chrome-extension:|data:|blob:/i.test(first)) {
          d.__image = first;
        }
      }
    } catch (e2) {}
    return d;
  } catch (err) { return null }
}).filter(Boolean))`;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[%\s,]/g, ''));
  return Number.isNaN(n) ? null : n;
};

const str = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, 480);
};

@Injectable()
export class CollectService implements OnModuleInit {
  private readonly logger = new Logger(CollectService.name);
  private running = new Set<number>();
  /** 超时被中止的任务（看门狗置位，主流程会尽快退出） */
  private aborted = new Set<number>();
  /** 单次采集最长允许多久（毫秒），超了就判定失败，避免界面永远卡在"采集中" */
  private static readonly TIMEOUT_MS = 6 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly browser: BrowserService,
  ) {}

  async createTask(dto: CreateTaskDto, userId?: number) {
    const task = await this.prisma.collectTask.create({
      data: {
        name: dto.name || '采集 ' + new Date().toLocaleString('zh-CN'),
        url: dto.url,
        scrolls: dto.scrolls ?? 20,
        step: dto.step ?? 900,
        userId: userId ?? null,
        status: 'pending',
      },
    });
    // 立即返回，后台执行
    this.run(task.id).catch((e) => this.logger.error('采集任务异常: ' + e.message));
    return task;
  }

  async findAll(query: QueryTaskDto) {
    const where: any = {};
    if (query.status) where.status = query.status;
    const [list, total] = await Promise.all([
      this.prisma.collectTask.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20),
        take: query.pageSize ?? 20,
      }),
      this.prisma.collectTask.count({ where }),
    ]);
    return { list, total, page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
  }

  async findOne(id: number) {
    const task = await this.prisma.collectTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('采集任务不存在');
    const metrics = await this.prisma.productMetric.count({ where: { taskId: id } });
    return { ...task, productCount: metrics, isRunning: this.running.has(id) };
  }

  async remove(id: number) {
    await this.prisma.productMetric.deleteMany({ where: { taskId: id } });
    await this.prisma.collectTask.delete({ where: { id } });
    return { id };
  }

  async runningIds() {
    return [...this.running];
  }

  // ---------------- 采集主流程 ----------------

  private async appendLog(taskId: number, line: string) {
    const cur = await this.prisma.collectTask.findUnique({ where: { id: taskId } });
    const logs = (cur?.logs || '') + `[${new Date().toLocaleTimeString('zh-CN')}] ${line}\n`;
    await this.prisma.collectTask.update({
      where: { id: taskId },
      data: { logs: logs.slice(-60000) },
    });
    this.logger.log(`[任务${taskId}] ${line}`);
  }

  /** 服务启动时，把上次进程被杀导致的「采集中」僵尸任务收掉，否则界面永远转圈 */
  async onModuleInit() {
    try {
      const r = await this.prisma.collectTask.updateMany({
        where: { status: 'running' },
        data: { status: 'failed', error: '服务重启导致中断，请重新采集', finishedAt: new Date() },
      });
      if (r.count) this.logger.warn(`清理了 ${r.count} 个中断的采集任务`);
    } catch (e) {
      /* 忽略 */
    }
  }

  async run(taskId: number) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);

    const task = await this.prisma.collectTask.findUnique({ where: { id: taskId } });
    if (!task) {
      this.running.delete(taskId);
      return;
    }

    await this.prisma.collectTask.update({
      where: { id: taskId },
      data: { status: 'running', startedAt: new Date(), logs: '', error: null },
    });

    let cdp: CdpClient | null = null;
    // 看门狗：超时后置位中止标记，主流程会在下一个检查点退出
    const watchdog = setTimeout(() => {
      this.aborted.add(taskId);
      this.logger.warn(`采集任务 ${taskId} 超时，已标记中止`);
    }, CollectService.TIMEOUT_MS);
    const checkAbort = () => {
      if (this.aborted.has(taskId)) throw new Error('任务超时（超过 6 分钟）已中止，请稍后重试或减少滚动屏数');
    };
    try {
      const st = await this.browser.status();
      if (!st.portUp) {
        throw new Error(
          '调试端口未就绪。请先在「浏览器接管」里点启动，并确保 Chrome 已退出后由本系统拉起。',
        );
      }

      await this.appendLog(taskId, '已连接浏览器: ' + (st.browser || 'Chrome'));
      const ver = await this.browser.version();
      cdp = new CdpClient(new URL(ver.webSocketDebuggerUrl));
      await cdp.connect();

      /*
       * 打开/复用 Ozon 标签。
       * 两个血泪教训：
       *  1) Ozon 页面很重，CDP 求值经常几秒没响应；所以**不要用固定 sleep 猜加载时间**，
       *     要用「轮询到卡片出现」来判断就绪（见 waitReady）。
       *  2) 标签如果不是最前的那个，Chrome 会节流甚至冻住渲染进程 —— 必须 Page.bringToFront。
       */
      const targets = await cdp.send('Target.getTargets', {}, undefined, 8000);
      const existing = targets.result.targetInfos.find(
        (x: any) => x.type === 'page' && /ozon\.ru/.test(x.url || ''),
      );
      const base = task.url.split('?')[0];
      let sessionId: string;

      if (existing && (existing.url || '').startsWith(base)) {
        await this.appendLog(taskId, '复用已打开的 Ozon 标签页');
        const attached = await cdp.send(
          'Target.attachToTarget',
          { targetId: existing.targetId, flatten: true },
          undefined,
          10000,
        );
        sessionId = attached.result.sessionId;
      } else {
        await this.appendLog(taskId, existing ? '已有 Ozon 标签但页面不同，跳转过去' : '新建 Ozon 标签页');
        const targetId = existing
          ? existing.targetId
          : (
              await cdp.send('Target.createTarget', { url: task.url }, undefined, 20000)
            ).result.targetId;
        const attached = await cdp.send(
          'Target.attachToTarget',
          { targetId, flatten: true },
          undefined,
          10000,
        );
        sessionId = attached.result.sessionId;
        if (existing) {
          await cdp.send('Page.navigate', { url: task.url }, sessionId, 15000).catch(() => undefined);
        }
      }

      // 让标签到最前，避免后台节流
      await cdp.send('Page.bringToFront', {}, sessionId, 8000).catch(() => undefined);

      const ev = async (expr: string, timeout = 8000): Promise<any> => {
        try {
          const r = await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId, timeout);
          return r.result?.result?.value;
        } catch (e) {
          return '__TIMEOUT__';
        }
      };

      /*
       * 快速预检：Ozon 的反爬挑战会把渲染进程 CPU 占满，表现是所有 CDP 求值全部超时。
       * 先花十几秒确认渲染进程活不活，比傻等 75 秒×2 友好得多。
       */
      const ping = async (timeout: number) => {
        try {
          const r = await cdp!.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, sessionId, timeout);
          return r.result?.result?.value === 2;
        } catch (e) {
          return false;
        }
      };
      if (!(await ping(6000))) {
        /*
         * 实测：Ozon 榜单页首次加载要跑约 90 秒的重度 JS（期间渲染进程忙到完全不回 CDP），
         * 然后才 readyState=complete、插件把卡片注入进来。所以这里**不能判死**，只能耐心等。
         */
        await this.appendLog(taskId, '页面正在跑 Ozon 的重度 JS（首次加载约 1.5 分钟，期间无法响应），继续等…');
      }

      /** 轮询等待页面就绪：卡片出现 或 判定为验证页；返回状态 */
      const waitReady = async (budgetMs: number, label: string) => {
        const t0 = Date.now();
        let last = '';
        let lastLog = 0;
        let busy = 0;
        while (Date.now() - t0 < budgetMs) {
          const probe = await ev(
            `JSON.stringify({
              rs: document.readyState,
              cards: document.querySelectorAll('[data-s2-card-data-json]').length,
              title: (document.title || '').slice(0, 50),
              url: location.href,
              captcha: /captcha|antibot|робот|подтвердите|доступ ограничен/i.test((document.body && document.body.innerText || '').slice(0, 4000))
            })`,
            6000,
          );
          if (probe === '__TIMEOUT__') {
            busy++;
            last = '渲染进程无响应（页面还在跑重 JS）';
            // 每 15 秒给用户一行进度，避免看起来像卡死
            if (Date.now() - t0 - lastLog > 15000) {
              lastLog = Date.now() - t0;
              await this.appendLog(
                taskId,
                `${label} 进行中… ${Math.round((Date.now() - t0) / 1000)}s（Ozon 页面重度 JS 执行中，属正常）`,
              );
            }
          } else {
            try {
              const p = JSON.parse(probe);
              last = `${p.rs} 卡片${p.cards}`;
              if (p.captcha) return { ok: false, captcha: true, cards: 0, title: '', url: p.url };
              if (p.cards > 0) return { ok: true, captcha: false, cards: p.cards, title: p.title, url: p.url };
            } catch (err) {
              last = '解析探测结果失败';
            }
          }
          await sleep(1500);
        }
        await this.appendLog(taskId, `${label} 等待超时（最后状态：${last}）`);
        return { ok: false, captcha: false, cards: 0, title: '', url: '' };
      };

      await this.appendLog(taskId, '等待页面加载出商品卡片…');
      let ready = await waitReady(180000, '首次加载');

      // 首次没出来 → 刷新重试一次（Ozon 偶发抽风；刷新往往能救回来）
      if (!ready.ok && !ready.captcha) {
        await this.appendLog(taskId, '⚠️ 首次加载没出卡片，刷新重试一次…');
        await cdp.send('Page.reload', { ignoreCache: false }, sessionId, 15000).catch(() => undefined);
        ready = await waitReady(180000, '刷新后加载');
      }

      if (ready.captcha) {
        await this.appendLog(taskId, '⚠️ 页面出现验证码/风控，请在 Chrome 窗口手动通过（最多等 90 秒）');
        for (let i = 0; i < 18; i++) {
          await sleep(5000);
          const r2 = await waitReady(6000, '验证等待');
          if (r2.ok) {
            ready = r2;
            await this.appendLog(taskId, '✔ 验证已通过，继续采集');
            break;
          }
        }
      }

      if (!ready.ok) {
        throw new Error(
          '等了 3 分钟 Ozon 页面还是没渲染出商品卡片。八成是被反爬校验挡住了（页面 JS 占满渲染进程）：' +
            '请切到调试 Chrome 窗口，手动打开这个榜单页，确认能看到商品列表后再点「开始采集」。' +
            '另外不要短时间内批量刷 Ozon 商品详情页（会触发校验）。',
        );
      }

      await this.appendLog(taskId, `✔ 页面就绪：${ready.title || ''}（已渲染 ${ready.cards} 张卡片）`);

      const collected = new Map<string, any>();
      const grab = async () => {
        const raw = await ev(GRAB_JS);
        if (typeof raw !== 'string') return 0;
        let arr: any[] = [];
        try {
          arr = JSON.parse(raw);
        } catch (e) {
          return 0;
        }
        arr.forEach((x) => x && x.sku && collected.set(String(x.sku), x));
        return arr.length;
      };

      await grab();
      for (let i = 0; i < task.scrolls; i++) {
        checkAbort();
        const before = collected.size;
        /*
         * 滚动要"滚到底 + 找页面里最大的可滚动容器一起滚"：
         * Ozon 榜单页的商品列表在**内层容器**里，只 window.scrollBy 是加载不出下一页的（实测滚 3 屏还是 16 条）。
         */
        await ev(
          `(function(){
            var el = document.scrollingElement || document.documentElement;
            window.scrollTo(0, el.scrollHeight);
            var best = null, bestRange = 0;
            var all = document.querySelectorAll('div');
            for (var i = 0; i < all.length; i++) {
              var d = all[i];
              var range = d.scrollHeight - d.clientHeight;
              if (range > 300 && d.clientHeight > 250 && range > bestRange) { best = d; bestRange = range; }
            }
            if (best) best.scrollTop = best.scrollHeight;
            return JSON.stringify({y: window.scrollY, inner: best ? best.scrollTop : -1});
          })()`,
          8000,
        );
        // 等"新卡片出现"最多 8 秒（比固定 sleep 又快又稳：出来了就立刻继续）
        const t0 = Date.now();
        let n = 0;
        while (Date.now() - t0 < 8000) {
          await sleep(1200);
          n = await grab();
          if (n > before || collected.size > before) break;
        }
        await this.appendLog(taskId, `第 ${i + 1}/${task.scrolls} 屏 · 本屏 ${n} 条 · 累计 ${collected.size}`);
        await this.prisma.collectTask.update({
          where: { id: taskId },
          data: { total: collected.size },
        });
      }

      const items = [...collected.values()];
      await this.appendLog(taskId, `滚动结束，开始入库 ${items.length} 条`);
      const saved = await this.persist(taskId, items);

      await this.prisma.collectTask.update({
        where: { id: taskId },
        data: { status: 'success', total: saved, finishedAt: new Date() },
      });
      await this.appendLog(taskId, `✅ 入库完成，新增/更新 ${saved} 条商品`);
    } catch (e: any) {
      await this.appendLog(taskId, '❌ 采集失败: ' + e.message);
      await this.prisma.collectTask.update({
        where: { id: taskId },
        data: { status: 'failed', error: e.message, finishedAt: new Date() },
      });
    } finally {
      clearTimeout(watchdog);
      this.aborted.delete(taskId);
      if (cdp) cdp.close();
      this.running.delete(taskId);
    }
  }

  /**
   * 判断是不是"真正的商品图地址"：
   * 只认 http(s) + 已知图床域名；data:/chrome-extension:/blob: 一律不认。
   */
  private isRealImage(u: any): boolean {
    const v = String(u || '');
    if (!/^https?:\/\//i.test(v)) return false;
    if (/chrome-extension:|^data:|^blob:/i.test(v)) return false;
    return /(ozonstatic|ozone\.ru|ozon\.ru|alicdn|1688\.com)/i.test(v);
  }

  /** 商品 upsert + 指标历史落库 */
  private async persist(taskId: number, items: any[]) {
    let count = 0;
    for (const it of items) {
      const sku = String(it.sku);
      const incomingImage = this.isRealImage(it.imageUrl)
        ? str(it.imageUrl)
        : this.isRealImage(it.__image)
          ? str(it.__image)
          : this.isRealImage(it.images)
            ? str(it.images)
            : null;

      const data = {
        title: str(it.__title || it.title),
        brand: str(it.brand),
        categoryPath: str(it.category),
        category3Name: str(it.category3Name || it.categoryDisplayName),
        price: num(it.currentPrice ?? it.cardPrice),
        sellerId: str(it.sellerId),
        sellerName: str(it.sellerName),
        sellerCountry: str(it.sellerCountryName),
        isChinaSeller: Boolean(it.isChinaSeller),
        // 图：只认真正的商品图；抓不到就留空，靠 update 分支保证不覆盖旧值
        imageUrl: incomingImage,
        productUrl: str(it.__url || it.productUrl) || `https://www.ozon.ru/product/${sku}`,
        rating: num(it.rating),
        reviewsCount: num(it.reviewsCount) ?? 0,
        salesSchema: str(it.salesSchema),
        sizeLengthMm: num(it.sizeLengthMm),
        sizeWidthMm: num(it.sizeWidthMm),
        sizeHeightMm: num(it.sizeHeightMm),
        sizeWeightG: num(it.sizeWeightG),
        soldCount: num(it.soldCount),
        soldSum: num(it.soldSum),
        drr: num(it.drr),
        daysWithTrafarets: num(it.daysWithTrafarets),
        convToCartPdp: num(it.convToCartPdp),
        convToCartSearch: num(it.convToCartSearch),
        cancelRate: num(it.cancelRate),
        createDays: num(it.createDays),
        daysInPromo: num(it.daysInPromo),
        discount: num(it.discount),
        raw: it,
        lastSeenAt: new Date(),
      };

      const product = await this.prisma.product.upsert({
        where: { sku },
        create: { sku, ...data },
        /*
         * 关键：update 时如果这次没抓到真图，就**不要把 imageUrl 传进去**（传 null 会把上次的好图覆盖掉，
         * 之前就是这么把 53 个商品的图搞没的）。Prisma 里字段为 undefined 表示"不更新这一列"。
         */
        update: { ...data, imageUrl: incomingImage ? incomingImage : undefined },
      });

      await this.prisma.productMetric.create({
        data: {
          productId: product.id,
          taskId,
          soldCount: data.soldCount,
          soldSum: data.soldSum,
          drr: data.drr,
          daysWithTrafarets: data.daysWithTrafarets,
          convToCartPdp: data.convToCartPdp,
          convToCartSearch: data.convToCartSearch,
          cancelRate: data.cancelRate,
          createDays: data.createDays,
          rating: data.rating,
          reviewsCount: data.reviewsCount,
        },
      });
      count++;
    }
    return count;
  }
}
