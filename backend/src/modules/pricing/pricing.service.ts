import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CHANNEL_SEED } from './channels.data';
import {
  CATEGORY_LABEL,
  CATEGORIES,
  COUNTRIES,
  ChannelLike,
  VENDORS,
  calcPricing,
  cnyToRub,
  countryLabel,
  quoteChannel,
  r2,
  r4,
  rubToCny,
  solveSellPrice,
  vendorLabel,
} from './pricing.calc';
import {
  CalcDto,
  CreateRecordDto,
  QueryRecordDto,
  QuoteDto,
  UpdateChannelDto,
  UpdateRecordDto,
  UpdateSettingDto,
  UpsertChannelDto,
} from './dto/pricing.dto';

const num = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 元数据 ====================
  meta() {
    return {
      countries: COUNTRIES,
      vendors: VENDORS,
      categories: CATEGORIES.map((v) => ({ value: v, label: `${v}（${CATEGORY_LABEL[v] || v}）` })),
    };
  }

  // ==================== 渠道 ====================
  private toChannel(row: any): ChannelLike {
    return {
      ...row,
      pricePerKg: num(row.pricePerKg),
      pricePerOrder: num(row.pricePerOrder),
      minWeightKg: num(row.minWeightKg),
      maxWeightKg: num(row.maxWeightKg),
      minValueRub: num(row.minValueRub),
      maxValueRub: num(row.maxValueRub),
      enabled: !!row.enabled,
      volumetric: !!row.volumetric,
      roundUp: !!row.roundUp,
    };
  }

  async listChannels(query: { country?: string; vendor?: string; category?: string } = {}) {
    const where: any = {};
    if (query.country) where.country = query.country;
    if (query.vendor) where.vendor = query.vendor;
    if (query.category) where.category = query.category;

    let rows = await this.prisma.logisticsChannel.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    if (!rows.length) {
      await this.seedChannels();
      rows = await this.prisma.logisticsChannel.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      });
    }
    return rows.map((r) => this.toChannel(r));
  }

  /** 首次使用时把内置渠道写进库（渠道表为空才写） */
  async seedChannels() {
    const count = await this.prisma.logisticsChannel.count();
    if (count > 0) return count;
    for (const c of CHANNEL_SEED) {
      await this.prisma.logisticsChannel.create({
        data: {
          country: c.country,
          vendor: c.vendor,
          category: c.category,
          name: c.name,
          shipMode: c.shipMode ?? null,
          delivery: c.delivery ?? null,
          pricePerKg: c.pricePerKg,
          pricePerOrder: c.pricePerOrder,
          priceText: c.priceText ?? null,
          minWeightKg: c.minWeightKg,
          maxWeightKg: c.maxWeightKg,
          minValueRub: c.minValueRub,
          maxValueRub: c.maxValueRub,
          maxSumCm: c.maxSumCm,
          maxSideLongCm: c.maxSideLongCm,
          maxSideShortCm: c.maxSideShortCm,
          volumetric: !!c.volumetric,
          divisor: c.divisor || 12000,
          roundUp: !!c.roundUp,
          etaDays: c.etaDays ?? null,
          battery: c.battery ?? null,
          note: c.note ?? null,
          enabled: c.enabled !== false,
          sort: c.sort ?? 0,
        },
      });
    }
    return CHANNEL_SEED.length;
  }

  async createChannel(dto: UpsertChannelDto) {
    const row = await this.prisma.logisticsChannel.create({ data: dto as any });
    return this.toChannel(row);
  }

  async updateChannel(id: number, dto: UpdateChannelDto) {
    const exists = await this.prisma.logisticsChannel.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('渠道不存在');
    const row = await this.prisma.logisticsChannel.update({ where: { id }, data: dto as any });
    return this.toChannel(row);
  }

  async removeChannel(id: number) {
    const exists = await this.prisma.logisticsChannel.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('渠道不存在');
    await this.prisma.logisticsChannel.delete({ where: { id } });
    return { id };
  }

  /** 恢复内置渠道（删除现有全部后重建），用于渠道被改乱时重置 */
  async resetChannels() {
    await this.prisma.logisticsChannel.deleteMany({});
    return this.seedChannels();
  }

  // ==================== 参数 ====================
  async getSettings() {
    let row = await this.prisma.pricingSetting.findUnique({ where: { id: 1 } });
    if (!row) {
      row = await this.prisma.pricingSetting.create({ data: { id: 1 } });
    }
    return {
      exchangeRate: num(row.exchangeRate),
      rubPerCny: num(row.rubPerCny),
      labelFee: num(row.labelFee),
      commissionRate: num(row.commissionRate),
      agentRate: num(row.agentRate),
      withdrawRate: num(row.withdrawRate),
      defaultCountry: row.defaultCountry,
      defaultVendor: row.defaultVendor,
    };
  }

  async updateSettings(dto: UpdateSettingDto) {
    await this.getSettings();
    const row = await this.prisma.pricingSetting.update({ where: { id: 1 }, data: dto as any });
    return {
      exchangeRate: num(row.exchangeRate),
      rubPerCny: num(row.rubPerCny),
      labelFee: num(row.labelFee),
      commissionRate: num(row.commissionRate),
      agentRate: num(row.agentRate),
      withdrawRate: num(row.withdrawRate),
      defaultCountry: row.defaultCountry,
      defaultVendor: row.defaultVendor,
    };
  }

  // ==================== 运费试算 ====================
  async quote(dto: QuoteDto) {
    const channels = await this.listChannels({
      country: dto.country,
      vendor: dto.vendor,
      category: dto.category,
    });
    const input = {
      weightKg: dto.weightKg ?? 0,
      lengthCm: dto.lengthCm ?? 0,
      widthCm: dto.widthCm ?? 0,
      heightCm: dto.heightCm ?? 0,
      valueRub: dto.valueRub ?? 0,
    };
    const list = channels.map((c) => {
      const q = quoteChannel(input, c);
      return {
        channelId: c.id,
        name: c.name,
        country: c.country,
        countryLabel: countryLabel(c.country),
        vendor: c.vendor,
        vendorLabel: vendorLabel(c.vendor),
        category: c.category,
        categoryLabel: CATEGORY_LABEL[c.category] || c.category,
        shipMode: c.shipMode,
        delivery: c.delivery,
        etaDays: c.etaDays,
        pricePerKg: c.pricePerKg,
        pricePerOrder: c.pricePerOrder,
        priceText: c.priceText,
        ok: q.ok,
        reason: q.reason,
        billWeightKg: q.billWeightKg,
        volumetricWeightKg: q.volumetricWeightKg,
        shippingFee: q.shippingFee,
      };
    });

    const ok = list.filter((r) => r.ok).sort((a, b) => a.shippingFee - b.shippingFee);
    return {
      input,
      total: list.length,
      available: ok.length,
      list: dto.includeUnavailable ? [...ok, ...list.filter((r) => !r.ok)] : ok,
    };
  }

  // ==================== 核价 ====================
  async calc(dto: CalcDto) {
    const s = await this.getSettings();
    const rate = dto.exchangeRate != null ? dto.exchangeRate : s.exchangeRate;

    const sellPriceCny =
      dto.sellPriceCny != null
        ? dto.sellPriceCny
        : dto.sellPriceRub != null
          ? rubToCny(dto.sellPriceRub, rate)
          : 0;
    const sellPriceRub = dto.sellPriceRub != null ? dto.sellPriceRub : cnyToRub(sellPriceCny, rate);

    const params = {
      purchaseCost: dto.purchaseCost ?? 0,
      labelFee: dto.labelFee ?? s.labelFee,
      commissionRate: dto.commissionRate ?? s.commissionRate,
      agentRate: dto.agentRate ?? s.agentRate,
      withdrawRate: dto.withdrawRate ?? s.withdrawRate,
    };
    const targetProfitRate = dto.targetProfitRate ?? 0.35;

    const input = {
      weightKg: dto.weightKg ?? 0,
      lengthCm: dto.lengthCm ?? 0,
      widthCm: dto.widthCm ?? 0,
      heightCm: dto.heightCm ?? 0,
      valueRub: dto.valueRub != null ? dto.valueRub : sellPriceRub,
    };

    let channels = await this.listChannels({
      country: dto.country,
      vendor: dto.vendor,
      category: dto.category,
    });
    if (dto.channelId) channels = channels.filter((c) => c.id === dto.channelId);

    const results = channels.map((c) => {
      const q = quoteChannel(input, c);
      const shippingFee = dto.manualShippingFee != null ? dto.manualShippingFee : q.shippingFee;
      const p = calcPricing({ sellPriceCny, shippingFee, ...params });
      const suggested =
        q.ok || dto.manualShippingFee != null
          ? solveSellPrice({ ...params, shippingFee, targetProfitRate })
          : 0;
      return {
        channelId: c.id,
        name: c.name,
        country: c.country,
        countryLabel: countryLabel(c.country),
        vendor: c.vendor,
        vendorLabel: vendorLabel(c.vendor),
        category: c.category,
        categoryLabel: CATEGORY_LABEL[c.category] || c.category,
        shipMode: c.shipMode,
        delivery: c.delivery,
        etaDays: c.etaDays,
        pricePerKg: c.pricePerKg,
        pricePerOrder: c.pricePerOrder,
        priceText: c.priceText,
        note: c.note,
        ok: q.ok,
        reason: q.reason,
        billWeightKg: q.billWeightKg,
        volumetricWeightKg: q.volumetricWeightKg,
        shippingFee: r2(shippingFee),
        ...p,
        suggestedSellPrice: suggested,
        suggestedSellPriceRub: cnyToRub(suggested, rate),
      };
    });

    const ok = results.filter((r) => r.ok).sort((a, b) => b.netProfit - a.netProfit);
    const fail = dto.includeUnavailable ? results.filter((r) => !r.ok) : [];
    const list = [...ok, ...fail];

    const manual =
      dto.manualShippingFee != null
        ? {
            ...calcPricing({ sellPriceCny, shippingFee: dto.manualShippingFee, ...params }),
            shippingFee: r2(dto.manualShippingFee),
            suggestedSellPrice: solveSellPrice({ ...params, shippingFee: dto.manualShippingFee, targetProfitRate }),
          }
        : null;

    return {
      input: {
        ...input,
        purchaseCost: params.purchaseCost,
        labelFee: params.labelFee,
        commissionRate: params.commissionRate,
        agentRate: params.agentRate,
        withdrawRate: params.withdrawRate,
        exchangeRate: rate,
        sellPriceCny: r2(sellPriceCny),
        sellPriceRub: r2(sellPriceRub),
        targetProfitRate,
      },
      manual,
      total: channels.length,
      available: ok.length,
      best: ok[0] || null,
      list,
    };
  }

  // ==================== 核价记录 ====================
  async listRecords(query: QueryRecordDto = {}) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const where: any = {};
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { sku: { contains: query.keyword } },
        { channelName: { contains: query.keyword } },
        { remark: { contains: query.keyword } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.pricingRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pricingRecord.count({ where }),
    ]);
    return { list: rows.map((r) => this.fmtRecord(r)), total, page, pageSize };
  }

  private fmtRecord(r: any) {
    return {
      ...r,
      purchaseCost: num(r.purchaseCost),
      weightKg: num(r.weightKg),
      lengthCm: num(r.lengthCm),
      widthCm: num(r.widthCm),
      heightCm: num(r.heightCm),
      sellPrice: num(r.sellPrice),
      sellPriceRub: num(r.sellPriceRub),
      exchangeRate: num(r.exchangeRate),
      labelFee: num(r.labelFee),
      commissionRate: num(r.commissionRate),
      agentRate: num(r.agentRate),
      withdrawRate: num(r.withdrawRate),
      shippingFee: num(r.shippingFee),
      billWeightKg: num(r.billWeightKg),
      grossProfit: num(r.grossProfit),
      netProfit: num(r.netProfit),
      profitRate: num(r.profitRate),
      freightProfitRatio: num(r.freightProfitRatio),
      markup35: num(r.markup35),
    };
  }

  /** 保存前把利润相关字段重算一遍，避免前端手改参数后结果对不上 */
  private recompute(d: any) {
    const p = {
      sellPriceCny: num(d.sellPrice),
      purchaseCost: num(d.purchaseCost),
      shippingFee: num(d.shippingFee),
      labelFee: num(d.labelFee),
      commissionRate: num(d.commissionRate),
      agentRate: num(d.agentRate),
      withdrawRate: num(d.withdrawRate),
    };
    const r = calcPricing(p);
    // 只写回有落库的字段；grossMargin / netMargin / costTotal 仅供接口返回
    return {
      ...d,
      grossProfit: r.grossProfit,
      netProfit: r.netProfit,
      profitRate: r.profitRate,
      freightProfitRatio: r.freightProfitRatio,
      markup35: r.markup35,
    };
  }

  async createRecord(dto: CreateRecordDto, userId?: number) {
    const s = await this.getSettings();
    const base: any = {
      name: dto.name ?? null,
      sku: dto.sku ?? null,
      purchaseCost: dto.purchaseCost ?? 0,
      weightKg: dto.weightKg ?? 0,
      lengthCm: dto.lengthCm ?? 0,
      widthCm: dto.widthCm ?? 0,
      heightCm: dto.heightCm ?? 0,
      sellPrice: dto.sellPrice ?? 0,
      sellPriceRub: dto.sellPriceRub ?? 0,
      exchangeRate: dto.exchangeRate ?? s.exchangeRate,
      labelFee: dto.labelFee ?? s.labelFee,
      commissionRate: dto.commissionRate ?? s.commissionRate,
      agentRate: dto.agentRate ?? s.agentRate,
      withdrawRate: dto.withdrawRate ?? s.withdrawRate,
      country: dto.country ?? null,
      vendor: dto.vendor ?? null,
      channelId: dto.channelId ?? null,
      channelName: dto.channelName ?? null,
      shipMode: dto.shipMode ?? null,
      logistics: dto.logistics ?? null,
      shippingFee: dto.shippingFee ?? 0,
      billWeightKg: dto.billWeightKg ?? 0,
      supplyUrl: dto.supplyUrl ?? null,
      retailUrl: dto.retailUrl ?? null,
      remark: dto.remark ?? null,
      userId: userId ?? null,
    };
    const data = this.recompute(base);
    const row = await this.prisma.pricingRecord.create({ data });
    return this.fmtRecord(row);
  }

  async updateRecord(id: number, dto: UpdateRecordDto) {
    const exists = await this.prisma.pricingRecord.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('核价记录不存在');
    const merged: any = { ...this.fmtRecord(exists) };
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) merged[k] = v;
    }
    delete merged.id;
    delete merged.createdAt;
    delete merged.updatedAt;
    delete merged.userId;
    const data = this.recompute(merged);
    const row = await this.prisma.pricingRecord.update({ where: { id }, data });
    return this.fmtRecord(row);
  }

  async removeRecord(id: number) {
    const exists = await this.prisma.pricingRecord.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('核价记录不存在');
    await this.prisma.pricingRecord.delete({ where: { id } });
    return { id };
  }

  /** 导出成与《定价表模版》列头一致的 CSV */
  async exportCsv() {
    const { list } = await this.listRecords({ pageSize: 100000 });
    const head = [
      '序号',
      '加35%',
      '定价',
      '采购成本',
      '国际运费',
      '贴单费',
      '平台佣金',
      'Ozon代理佣金',
      '提现费率',
      '净利润',
      '毛利润',
      '利润率',
      '运费利润比',
      '物流方式',
      '重量',
      '尺寸',
      '产品备注',
      '跟卖链接',
      '货源链接',
    ];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(',')];
    list.forEach((r: any, i: number) => {
      const size = `${num(r.lengthCm)}*${num(r.widthCm)}*${num(r.heightCm)}`;
      lines.push(
        [
          i + 1,
          num(r.markup35).toFixed(2),
          num(r.sellPrice).toFixed(2),
          num(r.purchaseCost).toFixed(2),
          num(r.shippingFee).toFixed(2),
          num(r.labelFee).toFixed(2),
          num(r.commissionRate),
          num(r.agentRate),
          num(r.withdrawRate),
          num(r.netProfit).toFixed(2),
          num(r.grossProfit).toFixed(2),
          num(r.profitRate).toFixed(4),
          num(r.freightProfitRatio).toFixed(4),
          r.logistics || r.shipMode || '',
          `${num(r.weightKg)}kg`,
          size,
          r.name || '',
          r.retailUrl || '',
          r.supplyUrl || '',
        ]
          .map(esc)
          .join(','),
      );
    });
    return `\uFEFF${lines.join('\n')}`;
  }

  /** 从商品库带出重量/尺寸/价格，供核价页一键填充 */
  async fromProduct(sku: string) {
    const p = await this.prisma.product.findUnique({ where: { sku } });
    if (!p) throw new NotFoundException('商品库里没有这个 SKU');
    return {
      sku: p.sku,
      title: p.title,
      priceRub: p.price != null ? num(p.price) : 0,
      weightKg: p.sizeWeightG ? r4(p.sizeWeightG / 1000) : 0,
      lengthCm: p.sizeLengthMm ? r2(p.sizeLengthMm / 10) : 0,
      widthCm: p.sizeWidthMm ? r2(p.sizeWidthMm / 10) : 0,
      heightCm: p.sizeHeightMm ? r2(p.sizeHeightMm / 10) : 0,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
    };
  }
}
