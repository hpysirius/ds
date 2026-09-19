import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_RULES, GRADE_TEXT, ScreeningRules, judge } from './rules';
import { CreatePresetDto } from './dto/create-preset.dto';
import { UpdatePresetDto } from './dto/update-preset.dto';
import { RunScreeningDto } from './dto/run-screening.dto';
import { QueryRunDto } from './dto/query-run.dto';

@Injectable()
export class ScreeningService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 规则预设 ----------------

  async listPresets() {
    const list = await this.prisma.filterPreset.findMany({ orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    if (list.length === 0) {
      const created = await this.prisma.filterPreset.create({
        data: { name: '默认规则（零评论 · 无品牌 · FBS · 零广告）', isDefault: true, rules: DEFAULT_RULES as any },
      });
      return [created];
    }
    return list;
  }

  async createPreset(dto: CreatePresetDto, userId?: number) {
    const rules = { ...DEFAULT_RULES, ...(dto.rules || {}) } as ScreeningRules;
    if (dto.isDefault) {
      await this.prisma.filterPreset.updateMany({ data: { isDefault: false } });
    }
    return this.prisma.filterPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        rules: rules as any,
        userId: userId ?? null,
      },
    });
  }

  async updatePreset(id: number, dto: UpdatePresetDto) {
    const exists = await this.prisma.filterPreset.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('规则预设不存在');
    const rules = dto.rules ? ({ ...(exists.rules as any), ...dto.rules } as ScreeningRules) : undefined;
    if (dto.isDefault) await this.prisma.filterPreset.updateMany({ data: { isDefault: false } });
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

  async removePreset(id: number) {
    await this.prisma.filterPreset.delete({ where: { id } });
    return { id };
  }

  defaultRules() {
    return DEFAULT_RULES;
  }

  // ---------------- 执行筛选 ----------------

  /**
   * 对商品库执行一轮筛选。
   * 可传 taskId 只筛某次采集涉及的品，也可传 4 个快速阈值做临时筛选。
   */
  async run(dto: RunScreeningDto) {
    let rules: ScreeningRules;
    let presetId: number | null = null;
    let presetName = '临时筛选';

    if (dto.presetId) {
      const preset = await this.prisma.filterPreset.findUnique({ where: { id: dto.presetId } });
      if (!preset) throw new NotFoundException('规则预设不存在');
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
    if (dto.taskId) {
      const metrics = await this.prisma.productMetric.findMany({
        where: { taskId: dto.taskId },
        select: { productId: true },
        distinct: ['productId'],
      });
      candidateIds = metrics.map((m) => m.productId);
      if (candidateIds.length === 0) throw new BadRequestException('该采集任务没有商品数据');
    }

    const products = await this.prisma.product.findMany({
      where: candidateIds ? { id: { in: candidateIds } } : {},
    });
    if (products.length === 0) throw new BadRequestException('商品库为空，请先执行采集');

    const run = await this.prisma.screeningRun.create({
      data: {
        presetId,
        taskId: dto.taskId ?? null,
        presetName,
        rules: rules as any,
        total: products.length,
      },
    });

    const counts = [0, 0, 0, 0];
    const items: any[] = [];
    for (const p of products) {
      const r = judge(p, rules);
      counts[r.grade]++;
      items.push({
        runId: run.id,
        productId: p.id,
        score: r.score,
        grade: r.grade,
        tier: r.tier,
        hardRules: r.hard as any,
        reasons: r.plus as any,
        notes: r.notes as any,
      });
    }

    // 分批写入，避免单条 SQL 过大
    for (let i = 0; i < items.length; i += 200) {
      await this.prisma.screeningItem.createMany({ data: items.slice(i, i + 200) });
    }

    await this.prisma.screeningRun.update({
      where: { id: run.id },
      data: { counts: { total: products.length, follow: counts[1], watch: counts[2], observe: counts[3], out: counts[0] } as any },
    });

    return {
      runId: run.id,
      presetName,
      total: products.length,
      counts: { 淘汰: counts[0], 优先跟进: counts[1], 可跟进: counts[2], 观察: counts[3] },
    };
  }

  async listRuns(q: QueryRunDto) {
    const [list, total] = await Promise.all([
      this.prisma.screeningRun.findMany({
        orderBy: { id: 'desc' },
        skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 20),
        take: q.pageSize ?? 20,
      }),
      this.prisma.screeningRun.count(),
    ]);
    return { list, total };
  }

  async runDetail(id: number, q: QueryRunDto) {
    const run = await this.prisma.screeningRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('筛选批次不存在');

    const where: any = { runId: id };
    if (q.grade !== undefined && q.grade !== null && q.grade !== ('' as any)) where.grade = Number(q.grade);

    const [items, total] = await Promise.all([
      this.prisma.screeningItem.findMany({
        where,
        include: { product: true },
        orderBy: [{ grade: 'asc' }, { score: 'desc' }],
        skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 50),
        take: q.pageSize ?? 50,
      }),
      this.prisma.screeningItem.count({ where }),
    ]);

    return { run, list: items, total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
  }

  /** 导出 CSV（UTF-8 BOM，Excel 直接打开不乱码） */
  async exportCsv(id: number, grade?: string) {
    const run = await this.prisma.screeningRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('筛选批次不存在');

    const where: any = { runId: id };
    if (grade !== undefined && grade !== '' && grade !== null) where.grade = Number(grade);

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
