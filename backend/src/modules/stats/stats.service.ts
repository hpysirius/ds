import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const [productTotal, newToday, taskTotal, runningTasks, noReview, fbsCount, avgRow] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { firstSeenAt: { gte: since } } }),
      this.prisma.collectTask.count(),
      this.prisma.collectTask.count({ where: { status: 'running' } }),
      this.prisma.product.count({ where: { reviewsCount: 0 } }),
      this.prisma.product.count({ where: { salesSchema: 'FBS' } }),
      this.prisma.product.aggregate({
        _avg: { soldCount: true, convToCartPdp: true, cancelRate: true },
      }),
    ]);

    const lastRun = await this.prisma.screeningRun.findFirst({ orderBy: { id: 'desc' } });
    const categories = await this.prisma.product.groupBy({
      by: ['category3Name'],
      _count: { _all: true },
      orderBy: { _count: { category3Name: 'desc' } },
      take: 10,
    });

    const buckets = [
      { label: '0 单', min: -1, max: 0 },
      { label: '1 单', min: 1, max: 1 },
      { label: '2-4 单', min: 2, max: 4 },
      { label: '5-10 单', min: 5, max: 10 },
      { label: '11-20 单', min: 11, max: 20 },
      { label: '21-70 单', min: 21, max: 70 },
      { label: '70 单以上', min: 71, max: 1e9 },
    ];
    const salesDistribution = [];
    for (const b of buckets) {
      const count = await this.prisma.product.count({
        where: { soldCount: { gte: b.min < 0 ? 0 : b.min, lte: b.max } },
      });
      salesDistribution.push({ label: b.label, count });
    }

    const topProducts = await this.prisma.product.findMany({
      where: { reviewsCount: 0, salesSchema: 'FBS' },
      orderBy: [{ convToCartPdp: 'desc' }, { soldCount: 'desc' }],
      take: 10,
      select: {
        sku: true, title: true, category3Name: true, soldCount: true,
        convToCartPdp: true, cancelRate: true, createDays: true, productUrl: true, drr: true,
      },
    });

    return {
      productTotal,
      newToday,
      taskTotal,
      runningTasks,
      noReviewRatio: productTotal ? Math.round((noReview / productTotal) * 100) : 0,
      fbsRatio: productTotal ? Math.round((fbsCount / productTotal) * 100) : 0,
      avg: {
        soldCount: Math.round(Number(avgRow._avg.soldCount || 0)),
        convToCartPdp: Math.round(Number(avgRow._avg.convToCartPdp || 0) * 100) / 100,
        cancelRate: Math.round(Number(avgRow._avg.cancelRate || 0) * 100) / 100,
      },
      lastRun: lastRun
        ? { id: lastRun.id, name: lastRun.presetName, counts: lastRun.counts, total: lastRun.total, createdAt: lastRun.createdAt }
        : null,
      categories: categories.filter((c) => c.category3Name).map((c) => ({ name: c.category3Name, count: c._count._all })),
      salesDistribution,
      topProducts,
    };
  }
}
