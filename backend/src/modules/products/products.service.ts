import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryProductDto } from './dto/query-product.dto';

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

  async findAll(q: QueryProductDto) {
    const where = this.buildWhere(q);

    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 20, 200);
    const sortBy = SORTABLE.includes(q.sortBy) ? q.sortBy : 'lastSeenAt';

    const [list, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { [sortBy]: q.order || 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async findOne(sku: string) {
    const product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product) throw new NotFoundException('商品不存在');
    return product;
  }

  /** 指标历史：看清一个品的月销/加购率变化趋势 */
  async history(sku: string) {
    const product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product) throw new NotFoundException('商品不存在');
    const metrics = await this.prisma.productMetric.findMany({
      where: { productId: product.id },
      orderBy: { capturedAt: 'asc' },
      take: 200,
    });
    return { product, metrics };
  }

  async categories() {
    const rows = await this.prisma.product.groupBy({
      by: ['category3Name'],
      _count: { _all: true },
      orderBy: { _count: { category3Name: 'desc' } },
      take: 60,
    });
    return rows
      .filter((r) => r.category3Name)
      .map((r) => ({ name: r.category3Name, count: r._count._all }));
  }

  /** 删除单个商品（指标历史 product_metrics 是 Cascade，跟着一起删） */
  async remove(id: number) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: { id: true, sku: true } });
    if (!p) throw new NotFoundException('商品不存在（可能已被删除）');
    await this.prisma.product.delete({ where: { id } });
    return { ok: true, id, sku: p.sku };
  }

  /**
   * 批量删除：
   *   - 传 ids：只删这几个（列表页勾选的行）
   *   - 不传 ids、传 filter：按当前筛选条件删（"删除筛选结果"用）
   * 两个都不传 → 拒绝，避免一个误操作清空整库。
   */
  async removeMany(dto: { ids?: number[]; filter?: any }) {
    const ids = (dto?.ids || []).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) {
      const r = await this.prisma.product.deleteMany({ where: { id: { in: ids } } });
      return { ok: true, deleted: r.count, mode: 'ids' };
    }
    if (dto?.filter && Object.keys(dto.filter).length) {
      const where = this.buildWhere(dto.filter);
      if (!Object.keys(where).length) throw new BadRequestException('没有筛选条件，拒绝整库删除');
      const r = await this.prisma.product.deleteMany({ where });
      return { ok: true, deleted: r.count, mode: 'filter' };
    }
    throw new BadRequestException('请传入要删除的商品 id 或筛选条件');
  }
}
