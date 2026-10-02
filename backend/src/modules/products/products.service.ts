import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryProductDto } from './dto/query-product.dto';
import { clampPage, clampPageSize, inStoreScope, storeWhereClause } from '../../common/constants/permissions';

const SORTABLE = ['lastSeenAt', 'soldCount', 'convToCartPdp', 'createDays', 'cancelRate', 'reviewsCount', 'price'];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 把查询条件（列表页的筛选表单）翻译成 Prisma where —— 列表查询和「按筛选删除」共用同一套语义 */
  private buildWhere(q: any) {
    const where: any = {};
    if (q.keyword) {
      where.OR = [{ title: { contains: q.keyword } }, { sku: { contains: q.keyword } }];
    }
    if (q.category3Name) where.category3Name = { contains: q.category3Name };
    if (q.brand) where.brand = { contains: q.brand };
    if (q.salesSchema) where.salesSchema = q.salesSchema;
    if (q.onlyNoReview) where.reviewsCount = 0;

    if (q.minSold !== undefined || q.maxSold !== undefined) {
      where.soldCount = {};
      if (q.minSold !== undefined) where.soldCount.gte = Number(q.minSold);
      if (q.maxSold !== undefined) where.soldCount.lte = Number(q.maxSold);
    }
    if (q.minCart !== undefined) where.convToCartPdp = { gte: Number(q.minCart) };
    if (q.maxCancel !== undefined) where.cancelRate = { lte: Number(q.maxCancel) };
    if (q.maxDays !== undefined) where.createDays = { lte: Number(q.maxDays) };
    return where;
  }

  /** 当前账号可访问的店铺过滤（员工只看自己店；超管按前端 storeId 过滤或看全部） */
  private scope(user: any, storeId?: number | string | null) {
    return storeWhereClause(user, storeId);
  }

  /** 单条记录是否在该账号可见范围内（用于删除/详情的越权保护） */
  private inScope(user: any, storeId: number | null): boolean {
    return inStoreScope(user, storeId);
  }

  async findAll(q: QueryProductDto, user?: any) {
    const where = { ...this.buildWhere(q), ...this.scope(user, (q as any).storeId) };

    const page = clampPage(q.page);
    const pageSize = clampPageSize(q.pageSize);
    const sortBy = SORTABLE.includes(q.sortBy) ? q.sortBy : 'lastSeenAt';

    // 按规则标签筛选：tags 存在 raw Json 里（[{name,color,priority,rule}]）。
    // Prisma 的 Json 过滤器对「对象数组的子集匹配」支持不稳定（会把候选对象当数组元素做严格相等比较，多字段就漏匹配），
    // 这里改为应用层过滤：先取全部命中其它条件的商品，再按 raw.tags[].name 过滤分页。
    // 当前商品量（数百~数千）内存过滤足够；若未来量级变大再迁移到 JSON_CONTAINS 原生 SQL。
    if (q.tag) {
      const all = await this.prisma.product.findMany({
        where,
        orderBy: { [sortBy]: q.order || 'desc' },
        take: 5000,
      });
      const filtered = (all as any[]).filter(
        (p) => Array.isArray((p.raw as any)?.tags) && (p.raw as any).tags.some((t: any) => t.name === q.tag),
      );
      const total = filtered.length;
      const list = filtered
        .slice((page - 1) * pageSize, page * pageSize)
        .map((p) => ({
          ...p,
          tags: Array.isArray((p.raw as any).tags) ? (p.raw as any).tags : [],
        }));
      return { list, total, page, pageSize };
    }

    const [list, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { [sortBy]: q.order || 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    // 把 raw.tags 提取到顶层，方便前端展示/筛选（不返回整个 raw，减小 payload）
    const listWithTags = (list as any[]).map((p) => ({
      ...p,
      tags: p.raw && Array.isArray((p.raw as any).tags) ? (p.raw as any).tags : [],
    }));
    return { list: listWithTags, total, page, pageSize };
  }

  async findOne(sku: string, user?: any) {
    const product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product) throw new NotFoundException('商品不存在');
    if (!this.inScope(user, product.storeId ?? null)) throw new NotFoundException('商品不存在');
    return product;
  }

  /** 指标历史：看清一个品的月销/加购率变化趋势 */
  async history(sku: string, user?: any) {
    const product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product) throw new NotFoundException('商品不存在');
    if (!this.inScope(user, product.storeId ?? null)) throw new NotFoundException('商品不存在');
    const metrics = await this.prisma.productMetric.findMany({
      where: { productId: product.id },
      orderBy: { capturedAt: 'asc' },
      take: 200,
    });
    return { product, metrics };
  }

  async categories(user?: any, storeId?: number | string | null) {
    const rows = await this.prisma.product.groupBy({
      by: ['category3Name'],
      where: this.scope(user, storeId),
      _count: { _all: true },
      orderBy: { _count: { category3Name: 'desc' } },
      take: 60,
    });
    return rows
      .filter((r) => r.category3Name)
      .map((r) => ({ name: r.category3Name, count: r._count._all }));
  }

  /** 删除单个商品（指标历史 product_metrics 是 Cascade，跟着一起删） */
  async remove(id: number, user?: any) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: { id: true, sku: true, storeId: true } });
    if (!p) throw new NotFoundException('商品不存在（可能已被删除）');
    if (!this.inScope(user, p.storeId ?? null)) throw new NotFoundException('商品不存在');
    await this.prisma.product.delete({ where: { id } });
    return { ok: true, id, sku: p.sku };
  }

  /**
   * 批量删除：
   *   - 传 ids：只删这几个（列表页勾选的行）
   *   - 不传 ids、传 filter：按当前筛选条件删（"删除筛选结果"用）
   * 两个都不传 → 拒绝，避免一个误操作清空整库。
   */
  async removeMany(dto: { ids?: number[]; filter?: any; storeId?: number }, user?: any, storeId?: number | string | null) {
    const scope = this.scope(user, storeId ?? dto?.storeId);
    const ids = (dto?.ids || []).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) {
      const r = await this.prisma.product.deleteMany({ where: { id: { in: ids }, ...scope } });
      return { ok: true, deleted: r.count, mode: 'ids' };
    }
    if (dto?.filter && Object.keys(dto.filter).length) {
      const where = { ...this.buildWhere(dto.filter), ...scope };
      const r = await this.prisma.product.deleteMany({ where });
      return { ok: true, deleted: r.count, mode: 'filter' };
    }
    throw new BadRequestException('请传入要删除的商品 id 或筛选条件');
  }
}
