import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryProductDto } from './dto/query-product.dto';

const SORTABLE = ['lastSeenAt', 'soldCount', 'convToCartPdp', 'createDays', 'cancelRate', 'reviewsCount', 'price'];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(q: QueryProductDto) {
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
      if (q.minSold !== undefined) where.soldCount.gte = q.minSold;
      if (q.maxSold !== undefined) where.soldCount.lte = q.maxSold;
    }
    if (q.minCart !== undefined) where.convToCartPdp = { gte: q.minCart };
    if (q.maxCancel !== undefined) where.cancelRate = { lte: q.maxCancel };
    if (q.maxDays !== undefined) where.createDays = { lte: q.maxDays };

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

  async remove(id: number) {
    await this.prisma.product.delete({ where: { id } });
    return { id };
  }
}
