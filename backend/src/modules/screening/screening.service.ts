import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_RULES, GRADE_TEXT, ScreeningRules, judge } from './rules';
import { CreatePresetDto } from './dto/create-preset.dto';
import { UpdatePresetDto } from './dto/update-preset.dto';
import { RunScreeningDto } from './dto/run-screening.dto';
import { QueryRunDto } from './dto/query-run.dto';
import { clampPage, clampPageSize, currentStoreId, inStoreScope, storeWhereClause } from '../../common/constants/permissions';

@Injectable()
export class ScreeningService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 规则预设 ----------------

  async listPresets(user?: any, storeId?: number | string | null) {
    const scope = storeWhereClause(user, storeId);
    const list = await this.prisma.filterPreset.findMany({
      where: scope,
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    if (list.length === 0 && scope.storeId != null) {
      // 该店铺还没有预设 → 自动建一个默认规则（仅当已限定到具体店铺）
      const created = await this.prisma.filterPreset.create({
        data: {
          name: '默认规则（零评论 · 无品牌 · FBS · 零广告）',
          isDefault: true,
          rules: DEFAULT_RULES as any,
          storeId: scope.storeId,
        },
      });
      return [created];
    }
    return list;
  }

  async createPreset(dto: CreatePresetDto, userId?: number, storeId?: number | null) {
    const rules = { ...DEFAULT_RULES, ...(dto.rules || {}) } as ScreeningRules;
    if (dto.isDefault) {
      await this.prisma.filterPreset.updateMany({ where: { storeId: storeId ?? null }, data: { isDefault: false } });
    }
    return this.prisma.filterPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        rules: rules as any,
        userId: userId ?? null,
        storeId: storeId ?? null,
      },
    });
  }

  async updatePreset(id: number, dto: UpdatePresetDto, user?: any) {
    const exists = await this.prisma.filterPreset.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('规则预设不存在');
    if (!this.inScope(user, exists.storeId ?? null)) throw new NotFoundException('规则预设不存在');
    const rules = dto.rules ? ({ ...(exists.rules as any), ...dto.rules } as ScreeningRules) : undefined;
    if (dto.isDefault) await this.prisma.filterPreset.updateMany({ where: { storeId: exists.storeId ?? null }, data: { isDefault: false } });
    return this.prisma.filterPreset.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault,
        ...(rules ? { rules: rules as any } : {}),
      },
    });
  }

  async removePreset(id: number, user?: any) {
    const exists = await this.prisma.filterPreset.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('规则预设不存在');
    if (!this.inScope(user, exists.storeId ?? null)) throw new NotFoundException('规则预设不存在');
    await this.prisma.filterPreset.delete({ where: { id } });
    return { id };
  }

  private inScope(user: any, storeId: number | null): boolean {
    return inStoreScope(user, storeId);
  }

  defaultRules() {
    return DEFAULT_RULES;
  }

  // ---------------- 执行筛选 ----------------

  /**
   * 对商品库执行一轮筛选。
   * 可传 taskId 只筛某次采集涉及的品，也可传 4 个快速阈值做临时筛选。
   * 结果按店铺隔离：taskId 优先取任务的店铺；否则取当前账号/前端指定的店铺。
   */
  async run(dto: RunScreeningDto, user?: any, storeId?: number | string | null) {
    let rules: ScreeningRules;
    let presetId: number | null = null;
    let presetName = '临时筛选';

    if (dto.presetId) {
      const preset = await this.prisma.filterPreset.findUnique({ where: { id: dto.presetId } });
      if (!preset) throw new NotFoundException('规则预设不存在');
      // 不能拿别的店铺的规则来跑（越权一律 404，不暴露该 id 是否存在）
      if (!this.inScope(user, preset.storeId ?? null)) throw new NotFoundException('规则预设不存在');
      rules = { ...DEFAULT_RULES, ...(preset.rules as any) } as ScreeningRules;
      presetId = preset.id;
      presetName = preset.name;
    } else if (dto.rules) {
      rules = { ...DEFAULT_RULES, ...dto.rules } as ScreeningRules;
    } else {
      throw new BadRequestException('请指定规则预设，或直接传入规则');
    }

    // 沿用原系统习惯：先按任务圈定范围，再整体筛
    let candidateIds: number[] | null = null;
    let runStoreId: number | null = currentStoreId(user, storeId);
    if (dto.taskId) {
      const task = await this.prisma.collectTask.findUnique({ where: { id: dto.taskId } });
      if (!task) throw new BadRequestException('采集任务不存在');
      // 不能指定别的店铺的采集任务（否则能用它把作用域带到他店）
      if (!this.inScope(user, task.storeId ?? null)) throw new NotFoundException('采集任务不存在');
      const metrics = await this.prisma.productMetric.findMany({
        where: { taskId: dto.taskId },
        select: { productId: true },
        distinct: ['productId'],
      });
      candidateIds = metrics.map((m) => m.productId);
      if (candidateIds.length === 0) throw new BadRequestException('该采集任务没有商品数据');
      runStoreId = task.storeId ?? runStoreId;
    }

    /*
     * 统一走 storeWhereClause，不要写成 `runStoreId != null ? { storeId: runStoreId } : {}`：
     * 后者在「未挂店账号 / 未指定店铺」时会退化成不加任何过滤，等于扫全平台商品库。
     * storeWhereClause 对这类账号返回 storeId:-1（必然查不到），语义才是对的。
     */
    const products = await this.prisma.product.findMany({
      where: {
        ...(candidateIds ? { id: { in: candidateIds } } : {}),
        ...storeWhereClause(user, storeId),
      },
    });
    if (products.length === 0) throw new BadRequestException('商品库为空，请先执行采集');

    // 打分是纯内存计算，放事务外做，避免长事务占着连接
    const counts = [0, 0, 0, 0];
    const judged = products.map((p) => {
      const r = judge(p, rules);
      counts[r.grade]++;
      return r;
    });

    /*
     * run + items + counts 三步必须同生共死：
     * 之前分开写，中途失败会留下「total 有值但明细为空、counts 是空」的脏批次。
     */
    const runId = await this.prisma.$transaction(async (tx) => {
      const run = await tx.screeningRun.create({
        data: {
          presetId,
          taskId: dto.taskId ?? null,
          storeId: runStoreId,
          presetName,
          rules: rules as any,
          total: products.length,
        },
      });
      const items = judged.map((r, i) => ({
        runId: run.id,
        productId: products[i].id,
        score: r.score,
        grade: r.grade,
        tier: r.tier,
        hardRules: r.hard as any,
        reasons: r.plus as any,
        notes: r.notes as any,
      }));
      // 分批写入，避免单条 SQL 过大
      for (let i = 0; i < items.length; i += 200) {
        await tx.screeningItem.createMany({ data: items.slice(i, i + 200) });
      }
      await tx.screeningRun.update({
        where: { id: run.id },
        data: { counts: { total: products.length, follow: counts[1], watch: counts[2], observe: counts[3], out: counts[0] } as any },
      });
      return run.id;
    });

    return {
      runId,
      presetName,
      total: products.length,
      counts: { 淘汰: counts[0], 优先跟进: counts[1], 可跟进: counts[2], 观察: counts[3] },
    };
  }

  async listRuns(q: QueryRunDto, user?: any) {
    const scope = storeWhereClause(user, (q as any).storeId);
    const [list, total] = await Promise.all([
      this.prisma.screeningRun.findMany({
        where: scope,
        orderBy: { id: 'desc' },
        skip: (clampPage(q.page) - 1) * clampPageSize(q.pageSize),
        take: clampPageSize(q.pageSize),
      }),
      this.prisma.screeningRun.count({ where: scope }),
    ]);
    return { list, total };
  }

  async runDetail(id: number, q: QueryRunDto, user?: any) {
    const run = await this.prisma.screeningRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('筛选批次不存在');
    if (!this.inScope(user, run.storeId ?? null)) throw new NotFoundException('筛选批次不存在');

    const where: any = { runId: id };
    // grade 是任意 query 字符串，直接 Number() 会得到 NaN 并让 Prisma 报错（500），这里只认整数
    if (q.grade !== undefined && q.grade !== null && q.grade !== ('' as any)) {
      const g = Number(q.grade);
      if (Number.isInteger(g)) where.grade = g;
    }

    const [items, total] = await Promise.all([
      this.prisma.screeningItem.findMany({
        where,
        include: { product: true },
        orderBy: [{ grade: 'asc' }, { score: 'desc' }],
        skip: (clampPage(q.page) - 1) * clampPageSize(q.pageSize, 50),
        take: clampPageSize(q.pageSize, 50),
      }),
      this.prisma.screeningItem.count({ where }),
    ]);

    return { run, list: items, total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
  }

  /** 导出 CSV（UTF-8 BOM，Excel 直接打开不乱码） */
  async exportCsv(id: number, grade?: string, user?: any) {
    const run = await this.prisma.screeningRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('筛选批次不存在');
    if (!this.inScope(user, run.storeId ?? null)) throw new NotFoundException('筛选批次不存在');

    const where: any = { runId: id };
    if (grade !== undefined && grade !== '' && grade !== null) {
      const g = Number(grade);
      if (Number.isInteger(g)) where.grade = g;
    }

    const items = await this.prisma.screeningItem.findMany({
      where,
      include: { product: true },
      orderBy: [{ grade: 'asc' }, { score: 'desc' }],
      take: 5000,
    });

    const head = ['SKU', '商品', '类目', '品牌', '月销', '上架天', '加购%', '退货%', '评论', '广告%', '发货', '档位', '得分', '分级', '判定依据', '链接'];
    const q = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

    const lines = [head.join(',')].concat(
      items.map((it) => {
        const p: any = it.product;
        const reasons = [
          ...((it.hardRules as any[]) || []).map((t) => 'X:' + t),
          ...((it.reasons as any[]) || []),
          ...((it.notes as any[]) || []),
        ].join(' ');
        return [
          p.sku,
          p.title,
          p.category3Name || p.categoryPath,
          p.brand,
          p.soldCount,
          p.createDays,
          p.convToCartPdp,
          p.cancelRate,
          p.reviewsCount,
          p.drr,
          p.salesSchema,
          it.tier,
          it.score,
          GRADE_TEXT[it.grade] || '淘汰',
          reasons,
          p.productUrl,
        ]
          .map(q)
          .join(',');
      }),
    );
    return '\ufeff' + lines.join('\n');
  }
}
