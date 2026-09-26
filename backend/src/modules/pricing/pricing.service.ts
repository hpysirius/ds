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
  suggestSellPrice,
  vendorLabel,
} from './pricing.calc';
import { parsePricingSheet } from './excel-import';
import {
  CalcDto,
  CreateRecordDto,
  QueryRecordDto,
  QuoteDto,
  PriceDto,
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
      markupRate: num(row.markupRate),
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
      // 定价表里的运费是两位小数（表内以 ROUNDUP 后的值参与利润计算），这里同样取两位
      const shippingFee =
        dto.manualShippingFee != null ? dto.manualShippingFee : r2(q.shippingFee);
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

  // ==================== 定价工作流 ====================
  /**
   * 按选定渠道 / 全部渠道定价：
   *   1. 算运费（计费重量 → 渠道资费）
   *   2. 建议定价 = ceil((成本×(1+加价率) + 运费 + 贴单费) / (1 − 平台佣金 − 代理佣金))
   *   3. 用定价表公式算毛利 / 净利 / 利润率 / 运费利润比 / 加35%
   */
  async price(dto: PriceDto) {
    const s = await this.getSettings();
    const rate = dto.exchangeRate != null ? dto.exchangeRate : s.exchangeRate;
    const params = {
      purchaseCost: dto.purchaseCost ?? 0,
      labelFee: dto.labelFee ?? s.labelFee,
      commissionRate: dto.commissionRate ?? s.commissionRate,
      agentRate: dto.agentRate ?? s.agentRate,
      withdrawRate: dto.withdrawRate ?? s.withdrawRate,
    };
    const markup = dto.markupRate != null ? dto.markupRate : num(s.markupRate) || 0.1;

    const valueRub =
      dto.valueRub != null
        ? dto.valueRub
        : dto.sellPriceRub != null
          ? dto.sellPriceRub
          : dto.sellPriceCny != null
            ? cnyToRub(dto.sellPriceCny, rate)
            : 0;

    const input = {
      weightKg: dto.weightKg ?? 0,
      lengthCm: dto.lengthCm ?? 0,
      widthCm: dto.widthCm ?? 0,
      heightCm: dto.heightCm ?? 0,
      valueRub,
    };

    let channels = await this.listChannels({
      country: dto.country,
      vendor: dto.vendor,
      category: dto.category,
    });
    if (dto.channelId) channels = channels.filter((c) => c.id === dto.channelId);

    const results = channels.map((c) => {
      const q = quoteChannel(input, c);
      // 定价表里的运费是两位小数（表内以 ROUNDUP 后的值参与利润计算），这里同样取两位
      const shippingFee =
        dto.manualShippingFee != null ? dto.manualShippingFee : r2(q.shippingFee);
      const suggested = suggestSellPrice({ ...params, shippingFee, markupRate: markup });
      const sellPriceCny =
        dto.manualSellPrice != null
          ? dto.manualSellPrice
          : dto.sellPriceCny != null && !dto.channelId
            ? dto.sellPriceCny
            : suggested;
      const p = calcPricing({ sellPriceCny, shippingFee, ...params });
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
        sellPrice: r2(sellPriceCny),
        sellPriceRub: cnyToRub(sellPriceCny, rate),
        markup35: p.markup35,
        grossProfit: p.grossProfit,
        netProfit: p.netProfit,
        profitRate: p.profitRate,
        freightProfitRatio: p.freightProfitRatio,
        grossMargin: p.grossMargin,
        netMargin: p.netMargin,
        suggestedSellPrice: suggested,
        suggestedSellPriceRub: cnyToRub(suggested, rate),
      };
    });

    const ok = results.filter((r) => r.ok).sort((a, b) => a.shippingFee - b.shippingFee);
    const fail = dto.includeUnavailable ? results.filter((r) => !r.ok) : [];
    const list = [...ok, ...fail];
    const pick = dto.channelId ? list[0] : ok[0] || fail[0] || null;

    return {
      input: {
        ...input,
        ...params,
        markupRate: markup,
        exchangeRate: rate,
        weightG: r2((dto.weightKg ?? 0) * 1000),
      },
      best: pick,
      selected: pick,
      total: channels.length,
      available: ok.length,
      list,
    };
  }

  /** 商品库检索：供定价工作台选品 */
  async searchProducts(keyword: string, limit = 20) {
    const kw = (keyword || '').trim();
    const where: any = kw
      ? {
          OR: [
            { sku: { contains: kw } },
            { title: { contains: kw } },
            { categoryPath: { contains: kw } },
          ],
        }
      : {};
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    });
    return rows.map((p) => ({
      sku: p.sku,
      title: p.title,
      brand: p.brand,
      categoryPath: p.categoryPath,
      category3Name: p.category3Name,
      priceRub: p.price != null ? num(p.price) : 0,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      soldCount: p.soldCount,
      convToCartPdp: p.convToCartPdp != null ? num(p.convToCartPdp) : null,
      cancelRate: p.cancelRate != null ? num(p.cancelRate) : null,
      reviewsCount: p.reviewsCount,
      createDays: p.createDays,
      salesSchema: p.salesSchema,
      weightKg: p.sizeWeightG ? r4(p.sizeWeightG / 1000) : 0,
      lengthCm: p.sizeLengthMm ? r2(p.sizeLengthMm / 10) : 0,
      widthCm: p.sizeWidthMm ? r2(p.sizeWidthMm / 10) : 0,
      heightCm: p.sizeHeightMm ? r2(p.sizeHeightMm / 10) : 0,
      supplyUrl: p.supplyUrl,
    }));
  }

  /** 回写商品库主图（以图搜款抓到后保存，避免重复抓取） */
  async setProductImage(sku: string, imageUrl: string) {
    await this.prisma.product.updateMany({ where: { sku }, data: { imageUrl } });
    return { sku, imageUrl };
  }

  // ==================== 定价记录 ====================
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
      markupRate: num(r.markupRate),
      weightG: r2(num(r.weightKg) * 1000),
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
      markupRate: dto.markupRate ?? (num(s.markupRate) || 0.1),
      imageUrl: dto.imageUrl ?? null,
      categoryPath: dto.categoryPath ?? null,
      offer1688Title: dto.offer1688Title ?? null,
      weightSource: dto.weightSource ?? null,
      mark: dto.mark ?? null,
      weightText: dto.weightText ?? null,
      sizeText: dto.sizeText ?? null,
      source: dto.source ?? 'workbench',
      excelRef: dto.excelRef ?? null,
      userId: userId ?? null,
    };
    const data = this.recompute(base);
    const row = await this.prisma.pricingRecord.create({ data });
    // 1688 货源链接回写到商品库：下次选品/核价自动带出，不用再粘一遍
    if (dto.sku && dto.supplyUrl) {
      await this.prisma.product
        .updateMany({ where: { sku: dto.sku }, data: { supplyUrl: dto.supplyUrl } })
        .catch(() => undefined);
    }
    return this.fmtRecord(row);
  }

  /**
   * 从《9月定价表》这类 Excel 导入「定价表」工作表 → 定价记录。
   * 幂等：按 excelRef（工作表!行号）判重，重复导入只跳过、不重复插入。
   * 表里已有的净利润/毛利润/利润率等**以表为准**（原表才是用户的口径），表里没有才算。
   */
  async importPricingExcel(filePath: string, sheetName = '定价表', replace = false) {
    const settings = await this.getSettings();
    // 重导：先清掉之前从 Excel 导进来的记录（工作台手工存的记录不动）
    const removed = replace ? (await this.prisma.pricingRecord.deleteMany({ where: { source: 'excel' } })).count : 0;
    const rate = num(settings.exchangeRate) || 0.0862;
    const rows = parsePricingSheet(filePath, sheetName);
    let created = 0;
    let skipped = 0;
    const samples: any[] = [];

    for (const r of rows) {
      const exists = await this.prisma.pricingRecord.findFirst({ where: { excelRef: r.excelRef } });
      if (exists) {
        skipped++;
        continue;
      }
      const purchaseCost = r.purchaseCost ?? 0;
      const sellPrice = r.sellPrice ?? 0;
      const commissionRate = r.commissionRate ?? 0.12;
      const agentRate = r.agentRate ?? 0.035;
      const shippingFee = r.shippingFee ?? 0;
      const labelFee = r.labelFee ?? 2;
      // 反推加价率，让记录和我们的模型一致（算不出来就用默认值）
      let markupRate = 0.1;
      if (purchaseCost > 0) {
        const m = (sellPrice * (1 - commissionRate - agentRate) - shippingFee - labelFee) / purchaseCost - 1;
        if (Number.isFinite(m) && m > -0.9 && m < 3) markupRate = Number(m.toFixed(4));
      }

      const base: any = {
        name: r.remark ?? null,
        sku: r.sku ?? null,
        purchaseCost,
        weightKg: r.weightKg ?? 0,
        lengthCm: r.lengthCm ?? 0,
        widthCm: r.widthCm ?? 0,
        heightCm: r.heightCm ?? 0,
        sellPrice,
        sellPriceRub: sellPrice > 0 ? Number((sellPrice / rate).toFixed(2)) : 0,
        exchangeRate: rate,
        markupRate,
        labelFee,
        commissionRate,
        agentRate,
        withdrawRate: r.withdrawRate ?? 0.012,
        shippingFee,
        billWeightKg: r.weightKg ?? 0,
        logistics: r.logistics ?? null,
        shipMode: r.logistics ?? null,
        country: 'RU',
        supplyUrl: r.supplyUrl ?? null,
        retailUrl: r.retailUrl ?? null,
        remark: r.remark ?? null,
        categoryPath: r.remark ?? null,
        offer1688Title: r.offer1688Title ?? null,
        weightSource: '定价表(Excel)',
        mark: r.mark ?? null,
        weightText: r.weightText ?? null,
        sizeText: r.sizeText ?? null,
        source: 'excel',
        excelRef: r.excelRef,
      };

      const data = this.recompute(base);
      // 表里有值就用表里的
      const keep: Array<[string, number | null | undefined]> = [
        ['grossProfit', r.grossProfit],
        ['netProfit', r.netProfit],
        ['profitRate', r.profitRate],
        ['freightProfitRatio', r.freightProfitRatio],
        ['markup35', r.markup35],
      ];
      for (const [k, v] of keep) if (v != null) data[k] = v;

      const row = await this.prisma.pricingRecord.create({ data });
      created++;
      if (samples.length < 3) {
        samples.push({
          row: r.row,
          sku: r.sku,
          sellPrice,
          purchaseCost,
          weightText: r.weightText,
          sizeText: r.sizeText,
        });
      }
    }

    return {
      sheet: sheetName,
      file: filePath,
      removed,
      total: rows.length,
      created,
      skipped,
      samples,
    };
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
    // 编辑时改了货源链接也同步回商品库
    if (exists.sku && dto.supplyUrl) {
      await this.prisma.product
        .updateMany({ where: { sku: exists.sku }, data: { supplyUrl: dto.supplyUrl } })
        .catch(() => undefined);
    }
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
      '加价率',
      '货源标题',
      '重量(原文)',
      '尺寸(原文)',
      '来源',
      '原表位置',
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
          r.mark || i + 1,
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
          r.weightText || (r.weightG ? `${r.weightG}g` : `${num(r.weightKg)}kg`),
          r.sizeText || size,
          r.name || '',
          r.retailUrl || '',
          r.supplyUrl || '',
          num(r.markupRate),
          r.offer1688Title || '',
          r.source || '',
          r.excelRef || '',
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
