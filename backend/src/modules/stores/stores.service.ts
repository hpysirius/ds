import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列表（带每个店铺的员工数、商品数、定价记录数，方便管理页展示） */
  async findAll() {
    const stores = await this.prisma.store.findMany({
      orderBy: [{ status: 'desc' }, { id: 'asc' }],
    });
    const ids = stores.map((s) => s.id);
    const [userCounts, productCounts, recordCounts] = await Promise.all([
      this.countByStore('user', ids),
      this.countByStore('product', ids),
      this.countByStore('pricingRecord', ids),
    ]);
    return stores.map((s) => ({
      ...s,
      userCount: userCounts[s.id] || 0,
      productCount: productCounts[s.id] || 0,
      recordCount: recordCounts[s.id] || 0,
    }));
  }

  async findOne(id: number) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('店铺不存在');
    return store;
  }

  async create(dto: CreateStoreDto) {
    if (dto.code) {
      const dup = await this.prisma.store.findUnique({ where: { code: dto.code } });
      if (dup) throw new BadRequestException('店铺编码已存在');
    }
    return this.prisma.store.create({
      data: {
        name: dto.name,
        code: dto.code || null,
        remark: dto.remark || null,
        status: dto.status ?? 1,
      },
    });
  }

  async update(id: number, dto: UpdateStoreDto) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('店铺不存在');
    if (dto.code && dto.code !== store.code) {
      const dup = await this.prisma.store.findUnique({ where: { code: dto.code } });
      if (dup) throw new BadRequestException('店铺编码已存在');
    }
    return this.prisma.store.update({
      where: { id },
      data: {
        name: dto.name ?? store.name,
        code: dto.code !== undefined ? dto.code || null : store.code,
        remark: dto.remark !== undefined ? dto.remark || null : store.remark,
        status: dto.status ?? store.status,
      },
    });
  }

  /** 删除店铺：员工的 storeId、商品、定价等随外键 SetNull 自动解绑（变成未分配），不会误删数据 */
  async remove(id: number) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('店铺不存在');
    await this.prisma.store.delete({ where: { id } });
    return { id };
  }

  private async countByStore(
    model: 'user' | 'product' | 'pricingRecord',
    ids: number[],
  ): Promise<Record<number, number>> {
    if (!ids.length) return {};
    const rows = await (this.prisma as any)[model === 'pricingRecord' ? 'pricingRecord' : model].groupBy({
      by: ['storeId'],
      where: { storeId: { in: ids } },
      _count: { _all: true },
    });
    const out: Record<number, number> = {};
    for (const r of rows) out[r.storeId] = r._count._all;
    return out;
  }
}
