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
export class CollectService {
  private readonly logger = new Logger(CollectService.name);
  private running = new Set<number>();

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

      const targets = await cdp.send('Target.getTargets');
      let target = targets.result.targetInfos.find(
        (x: any) => x.type === 'page' && /ozon\.ru/.test(x.url || ''),
      );
      let sessionId: string;

      if (!target) {
        await this.appendLog(taskId, '未找到 Ozon 标签页，新建一个');
        const created = await cdp.send('Target.createTarget', { url: task.url });
        const attached = await cdp.send('Target.attachToTarget', {
          targetId: created.result.targetId,
          flatten: true,
        });
        sessionId = attached.result.sessionId;
        await sleep(15000);
      } else {
        const attached = await cdp.send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        sessionId = attached.result.sessionId;
        const base = task.url.split('?')[0];
        if (!(target.url || '').startsWith(base)) {
          await this.appendLog(taskId, '跳转到目标页面');
          await cdp.send('Page.navigate', { url: task.url }, sessionId);
          await sleep(12000);
        }
      }

      const ev = async (expr: string): Promise<any> => {
        try {
          const r = await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
          return r.result?.result?.value;
        } catch (e) {
          return '__TIMEOUT__';
        }
      };

      await this.appendLog(taskId, '当前页面: ' + String(await ev('location.href')).slice(0, 80));

      // 反爬验证页兜底：等待人工通过
      const isCaptcha = await ev(`/captcha|antibot|робот|подтвердите/i.test(document.body.innerText)`);
      if (isCaptcha === true) {
        await this.appendLog(taskId, '⚠️ 页面出现验证码，请在 Chrome 窗口手动通过（最多等 90 秒）');
        for (let i = 0; i < 18; i++) {
          await sleep(5000);
          const still = await ev(`/captcha|antibot/i.test(document.body.innerText)`);
          if (still === false) {
            await this.appendLog(taskId, '验证已通过，继续采集');
            break;
          }
        }
      }

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
        await ev(`window.scrollBy(0, ${task.step}); true`);
        await sleep(1400);
        const n = await grab();
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
      if (cdp) cdp.close();
      this.running.delete(taskId);
    }
  }

  /** 商品 upsert + 指标历史落库 */
  private async persist(taskId: number, items: any[]) {
    let count = 0;
    for (const it of items) {
      const sku = String(it.sku);
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
        imageUrl: str(it.imageUrl),
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
        update: data,
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
