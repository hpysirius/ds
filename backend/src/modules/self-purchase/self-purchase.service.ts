import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import {
  clampPage,
  clampPageSize,
  currentStoreId,
  inStoreScope,
  storeWhereClause,
} from '../../common/constants/permissions';
import {
  CreateSelfPurchaseDto,
  QuerySelfPurchaseDto,
  UpdateSelfPurchaseDto,
} from './dto/self-purchase.dto';

/**
 * 自采购（选购备忘录）。
 *
 * 与「跟单比价」采集库（products）完全隔离：这里记的是「自己觉得好卖、打算自己采购」的品，
 * 不需要 Ozon 跟卖 / 竞品比价，核心是 1688 货源链接 + 采购成本 + 规格。
 *
 * 「算物流、算定价」不在这里重算 —— 前端直接调既有的 `POST /pricing/price`
 * （同一个核价引擎），算完把结果快照回填到本表，列表直接展示。
 */

/** 需要 Decimal → number 的字段（Prisma Decimal 直接序列化会给前端字符串/对象） */
const DECIMAL_FIELDS = [
  'purchaseCost',
  'weightKg',
  'lengthCm',
  'widthCm',
  'heightCm',
  'sellPrice',
  'sellPriceRub',
  'shippingFee',
  'billWeightKg',
  'grossProfit',
  'netProfit',
  'profitRate',
  'markupRate',
  'retailPriceRub',
  'retailPriceCny',
] as const;

/** 允许写入的字段白名单（避免把 storeId/userId/source 等被前端伪造成越权字段） */
const WRITABLE_FIELDS = [
  'sku',
  'name',
  'specName',
  'status',
  'supplyUrl',
  'retailUrl',
  'imageUrl',
  'packageText',
  'retailPriceRub',
  'retailPriceCny',
  'titleRu',
  'descRu',
  'tagsRu',
  'purchaseCost',
  'weightKg',
  'lengthCm',
  'widthCm',
  'heightCm',
  'weightText',
  'sizeText',
  'country',
  'vendor',
  'category',
  'channelId',
  'channelName',
  'shipMode',
  'logistics',
  'sellPrice',
  'sellPriceRub',
  'shippingFee',
  'billWeightKg',
  'grossProfit',
  'netProfit',
  'profitRate',
  'markupRate',
  'remark',
] as const;

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 从 Ozon 链接里解析 SKU —— 不手填也能拿到 Ozon ↔ 1688 的关联 id。
 * 支持：
 *   ?sku=3920720492（优先）
 *   /product/3920720492/
 *   /product/detskiy-stul-30x18-3920720492/   ← 末段以数字结尾
 * 取不到返回 null（不瞎猜）。
 */
export function extractOzonSku(url?: string): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const q = u.searchParams.get('sku');
    if (q && /^\d{4,20}$/.test(q)) return q;
    const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
    const m = seg.match(/(\d{4,20})$/);
    if (m) return m[1];
  } catch (e) {
    // 不是完整 URL（可能只有 path），走下面兜底
  }

  const q2 = raw.match(/[?&]sku=(\d{4,20})/);
  if (q2) return q2[1];
  const m2 = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '';
  const m3 = m2.match(/(\d{4,20})$/);
  return m3 ? m3[1] : null;
}

@Injectable()
export class SelfPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly pricing: PricingService,
  ) {}

  /** Decimal → number，让前端拿到真正的数字 */
  private fmt(rec: any) {
    if (!rec) return rec;
    const out: any = { ...rec };
    for (const f of DECIMAL_FIELDS) out[f] = num(rec[f]);
    return out;
  }

  /**
   * 复用现成核价引擎（PricingService.price）算出「运费 + 建议定价 + 利润」。
   *
   * ⚠ 关键坑：渠道是否可用要看「货值（卢布）」，而货值正是还没算出来的定价 ——
   * 跟单比价那套直接用 Ozon 跟卖价当货值，自采购没有跟卖价，传 0 会被所有渠道判
   * 「货值低于渠道下限」→ best=null。所以跑两遍：
   *   ① 用「成本×(1+加价率)」折成卢布当种子货值，先拿到定价；
   *   ② 用第①遍的真实定价当货值再算一遍，收敛出真正匹配的渠道与运费。
   */
  private async computePrice(input: {
    purchaseCost?: any;
    weightKg?: any;
    lengthCm?: any;
    widthCm?: any;
    heightCm?: any;
    country?: string | null;
    vendor?: string | null;
    category?: string | null;
    markupRate?: any;
    /** 手填过定价 → 按它核算利润，不覆盖 */
    manualSellPrice?: any;
  }): Promise<any | null> {
    const cost = num(input.purchaseCost) ?? 0;
    const weightKg = num(input.weightKg) ?? 0;
    // 没成本算不出种子货值、没重量算不出运费 —— 缺一个就不算，等补齐后再算
    if (cost <= 0 || weightKg <= 0) return null;

    const settings = await this.pricing.getSettings();
    const rate = Number(settings?.exchangeRate) || 0.0788;
    const markup = num(input.markupRate) ?? num(settings?.markupRate) ?? 0.1;

    const base: any = {
      country: input.country || 'RU',
      vendor: input.vendor || 'GUOO',
      category: input.category || undefined,
      weightKg,
      lengthCm: num(input.lengthCm) ?? 0,
      widthCm: num(input.widthCm) ?? 0,
      heightCm: num(input.heightCm) ?? 0,
      purchaseCost: cost,
      markupRate: markup,
      // 必须带：否则没有可用渠道时连回退结果都拿不到
      includeUnavailable: true,
    };
    const manual = num(input.manualSellPrice);
    if (manual != null && manual > 0) base.manualSellPrice = manual;

    // ① 种子货值
    const seedRub = (cost * (1 + markup)) / rate;
    const r1: any = await this.pricing.price({ ...base, valueRub: seedRub });
    const first = r1?.best || null;

    // ② 用第①遍的定价当真实货值收敛（手填了定价就用手填值）
    const finalRub =
      manual != null && manual > 0 ? manual / rate : first?.sellPriceRub || seedRub;
    const r2: any = await this.pricing.price({ ...base, valueRub: finalRub });
    const best = r2?.best || first || null;
    // 记下本次实际用的加价率（引擎返回体里没有该字段，落库时要用）
    if (best) best.markupRate = markup;
    return best;
  }

  /**
   * 自动算价：一条记录只要「有采购成本 + 有重量」，落库时就把物流费 / 定价 / 利润直接算出来。
   *
   * 这样插件在 1688 页「抓当前页」带回成本与重量后，后台「自采购」列表直接就是核好价的数据，
   * 不用再逐条点「算定价」。已有核价快照（netProfit / shippingFee）的记录不覆盖，
   * 保护手工点过「算定价」或手填定价的结果。
   */
  private async autoPriceRecord(rec: any) {
    if (!rec) return rec;
    if (rec.netProfit != null || rec.shippingFee != null) return rec;

    const best = await this.computePrice({
      purchaseCost: rec.purchaseCost,
      weightKg: rec.weightKg,
      lengthCm: rec.lengthCm,
      widthCm: rec.widthCm,
      heightCm: rec.heightCm,
      country: rec.country,
      vendor: rec.vendor,
      category: rec.category,
      markupRate: rec.markupRate,
      manualSellPrice: rec.sellPrice,
    });
    if (!best) return rec;

    // ⚠ 引擎返回体里渠道名在 `name` 字段（不是 channelName），别直接透传
    const patch: any = {
      pricedAt: new Date(),
      sellPrice: best.sellPrice,
      sellPriceRub: best.sellPriceRub,
      shippingFee: best.shippingFee,
      billWeightKg: best.billWeightKg,
      grossProfit: best.grossProfit,
      netProfit: best.netProfit,
      profitRate: best.profitRate,
      markupRate: best.markupRate,
      channelId: best.channelId,
      channelName: best.name,
      shipMode: best.shipMode,
    };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    return this.prisma.selfPurchase.update({ where: { id: rec.id }, data: patch });
  }

  /** 定价预览（页面「算定价」按钮）：只算不落库，逻辑与自动算价完全一致，避免两处漂移 */
  async previewPrice(dto: CreateSelfPurchaseDto) {
    const best = await this.computePrice({
      purchaseCost: dto.purchaseCost,
      weightKg: dto.weightKg,
      lengthCm: dto.lengthCm,
      widthCm: dto.widthCm,
      heightCm: dto.heightCm,
      country: dto.country,
      vendor: dto.vendor,
      category: dto.category,
      markupRate: dto.markupRate,
      manualSellPrice: dto.sellPrice,
    });
    return { best };
  }

  /**
   * 插件上报用的 @Public 接口：从 Authorization 解析归属店铺。
   * 与 RulesService / SourcingService 同语义：员工 → 本店；超管 / 未登录 / 无效 token → null。
   */
  private async resolveStoreId(authHeader?: string): Promise<number | null> {
    const token = String(authHeader || '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!token) return null;
    try {
      const payload: any = await this.jwt.verifyAsync(token);
      const id = Number(payload?.sub);
      if (!Number.isInteger(id) || id <= 0) return null;
      const u = await this.prisma.user.findUnique({
        where: { id },
        select: { storeId: true, status: true },
      });
      if (!u || u.status !== 1) return null;
      return u.storeId ?? null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 跟卖价归一化。
   *
   * 插件在 Ozon 商品页抓到的「跟卖价」可能是 ¥ —— Ozon 会按账号语言把价格渲染成人民币
   * （products.price 就这么混存过一次，导致 608 条数据整体错一个汇率）。
   * 所以插件必须连币种符号一起上报，这里统一折算成「卢布 + 元」两个字段再落库。
   *
   * 返回要写进 data 的补丁（含 retailPriceAt 留痕）；没有跟卖价时返回 null。
   */
  private async normalizeRetail(dto: any): Promise<any | null> {
    const s: any = await this.pricing.getSettings();
    const rate =
      Number(s?.exchangeRate) ||
      (Number(s?.rubPerCny) > 0 ? 1 / Number(s?.rubPerCny) : 0.0788);
    if (!(rate > 0)) return null;

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const raw = num(dto?.retailPrice);
    const patch: any = {};

    if (raw != null && raw > 0) {
      const sym = String(dto?.retailPriceSymbol || '');
      const isCny = /¥|CNY/i.test(sym);
      patch.retailPriceRub = isCny ? r2(raw / rate) : r2(raw);
      patch.retailPriceCny = isCny ? r2(raw) : r2(raw * rate);
    } else {
      // 直接传了卢布 / 元（页面手填），缺的那一个按汇率补上
      const rub = num(dto?.retailPriceRub);
      const cny = num(dto?.retailPriceCny);
      if (rub == null && cny == null) return null;
      patch.retailPriceRub = rub != null ? r2(rub) : r2((cny as number) / rate);
      patch.retailPriceCny = cny != null ? r2(cny) : r2((rub as number) * rate);
    }

    patch.retailPriceAt = new Date();
    return patch;
  }

  /** 只挑白名单字段，undefined 的不写（Prisma 会把显式 undefined 当「不更新」，但对齐更省心） */
  private pickData(dto: any): any {
    const data: any = {};
    for (const f of WRITABLE_FIELDS) {
      if (dto?.[f] !== undefined) data[f] = dto[f];
    }
    return data;
  }

  /**
   * 留痕打点。
   * - 从 1688 抓取录入（fromCapture）→ 记 caughtAt
   * - 状态发生变化 → 记 statusAt；变成「已上架」时另记 listedAt
   */
  private applyTrace(data: any, prevStatus: string | null | undefined, fromCapture?: boolean) {
    if (fromCapture) data.caughtAt = new Date();
    if (data.status !== undefined) {
      const before = prevStatus ?? 'editing';
      if (data.status !== before) {
        data.statusAt = new Date();
        if (data.status === 'listed') data.listedAt = new Date();
      }
    }
    return data;
  }

  /**
   * 同 SKU 合并。
   *
   * SKU 是这条记录关联 Ozon ↔ 1688 的主标识，所以同一个店铺下「一个 SKU 只应有一条记录」：
   * 先在 1688 页记一笔、又在 Ozon 页记一笔，后者应**补进**前者，而不是新开一条。
   *
   * 合并规则：**只补空字段，绝不覆盖已有非空值**（保护已手填/已核价的数据）；
   * 名称 / 货源链接 / Ozon 链接 这三个标识字段两边不同时，把新的那个记进备注，避免信息丢失。
   */
  private async mergeBySku(storeId: number | null, data: any, fromCapture?: boolean) {
    const sku = data?.sku;
    if (!sku) return null;

    const existing = await this.prisma.selfPurchase.findFirst({
      where: { sku, storeId },
      orderBy: { id: 'asc' },
    });
    if (!existing) return null;

    const patch: any = {};
    const extra: string[] = [];
    for (const f of WRITABLE_FIELDS) {
      if (f === 'sku' || f === 'remark') continue;
      const incoming = data[f];
      if (incoming === undefined || incoming === null || incoming === '') continue;
      const cur = (existing as any)[f];
      const isEmpty = cur === null || cur === undefined || cur === '';
      if (isEmpty) {
        patch[f] = incoming;
      } else if (
        ['name', 'supplyUrl', 'retailUrl'].includes(f) &&
        String(cur) !== String(incoming)
      ) {
        const label = f === 'name' ? '别名' : f === 'supplyUrl' ? '备选货源' : 'Ozon 备选';
        extra.push(`${label}：${incoming}`);
      }
    }

    if (data.remark && !existing.remark) patch.remark = data.remark;
    if (fromCapture) patch.caughtAt = new Date();
    if (extra.length) {
      const add = extra.join(' | ');
      const prev = String(patch.remark ?? existing.remark ?? '');
      if (!prev.includes(add)) {
        patch.remark = [prev, add].filter(Boolean).join(' | ').slice(0, 500);
      }
    }

    if (patch.sellPrice != null) patch.pricedAt = new Date();
    if (patch.retailPriceRub != null) patch.retailPriceAt = new Date();
    const merged = Object.keys(patch).length > 0;
    const rec = merged
      ? await this.prisma.selfPurchase.update({ where: { id: existing.id }, data: patch })
      : existing;

    // 交回「原始记录」给调用方做自动算价 / 格式化
    return { raw: rec, merged, fields: Object.keys(patch) };
  }

  /** 列表：按账号可见店铺过滤 + 关键词模糊 */
  async findAll(q: QuerySelfPurchaseDto, user?: any) {
    const where: any = { ...storeWhereClause(user, q.storeId) };
    if (q.status) where.status = q.status;
    if (q.keyword) {
      where.OR = [
        { name: { contains: q.keyword } },
        { sku: { contains: q.keyword } },
        { supplyUrl: { contains: q.keyword } },
        { retailUrl: { contains: q.keyword } },
        { titleRu: { contains: q.keyword } },
        { remark: { contains: q.keyword } },
      ];
    }

    const page = clampPage(q.page);
    const pageSize = clampPageSize(q.pageSize);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.selfPurchase.count({ where }),
      this.prisma.selfPurchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, list: rows.map((r) => this.fmt(r)) };
  }

  /** 后台页面新增 */
  async create(dto: CreateSelfPurchaseDto, user?: any) {
    // 没填 SKU 就从 Ozon 链接里解析，保证 Ozon ↔ 1688 之间有可关联的 id
    if (!dto.sku && dto.retailUrl) dto.sku = extractOzonSku(dto.retailUrl) ?? undefined;
    if (!dto.name && !dto.supplyUrl && !dto.retailUrl && !dto.sku) {
      throw new BadRequestException('至少填写「SKU」「商品名称」「1688 货源链接」或「Ozon 链接」');
    }
    const data = this.pickData(dto);
    Object.assign(data, (await this.normalizeRetail(dto)) || {});
    this.applyTrace(data, 'editing', dto.fromCapture);
    const storeId = currentStoreId(user, dto.storeId);

    // 同 SKU 已有记录 → 合并进那条（只补空字段），不再新开一条
    const hit = await this.mergeBySku(storeId, data, dto.fromCapture);
    if (data.sellPrice != null) data.pricedAt = new Date();
    const rec = hit
      ? hit.raw
      : await this.prisma.selfPurchase.create({
          data: { ...data, storeId, userId: user?.id ?? null },
        });

    // 有成本 + 重量就当场把定价算出来，不用再手动点「算定价」
    const priced = await this.autoPriceRecord(rec);
    return { ...this.fmt(priced), merged: !!hit && hit.merged, mergedFields: hit?.fields || [] };
  }

  /**
   * 插件「记一笔」备忘录上报。
   * @Public，靠 token 归店（与插件采集商品同一套归属逻辑）；
   * 无 token → storeId=null（只在超管「全部」视图可见）。
   */
  async memo(dto: CreateSelfPurchaseDto, authHeader?: string) {
    // 插件只贴了个 Ozon 链接也能拿到 SKU
    if (!dto.sku && dto.retailUrl) dto.sku = extractOzonSku(dto.retailUrl) ?? undefined;
    if (!dto?.name && !dto?.supplyUrl && !dto?.retailUrl && !dto?.sku) {
      throw new BadRequestException('至少填写「SKU」「商品名称」「1688 货源链接」或「Ozon 链接」');
    }
    const storeId = await this.resolveStoreId(authHeader);
    const data = this.pickData(dto);
    // 插件在 Ozon 页抓的跟卖价（可能带 ¥ 符号）→ 折算成 ₽ / ¥ 两个口径再落库
    Object.assign(data, (await this.normalizeRetail(dto)) || {});
    this.applyTrace(data, 'editing', dto.fromCapture);

    // 同 SKU 已有记录 → 合并（在 1688 页记的补进 Ozon 页记的那条，或反过来）
    const hit = await this.mergeBySku(storeId, data, dto.fromCapture);
    if (data.sellPrice != null) data.pricedAt = new Date();
    const rec = hit
      ? hit.raw
      : await this.prisma.selfPurchase.create({
          data: { ...data, source: 'plugin', storeId, userId: null },
        });

    // 插件「抓当前 1688 页」已带回成本 + 重量 → 直接算好定价
    const priced = await this.autoPriceRecord(rec);
    return { ...this.fmt(priced), merged: !!hit && hit.merged, mergedFields: hit?.fields || [] };
  }

  /** 编辑：先按店铺越权校验，再更新 */
  async update(id: number, dto: UpdateSelfPurchaseDto, user?: any) {
    const rec = await this.prisma.selfPurchase.findUnique({ where: { id } });
    if (!rec || !inStoreScope(user, rec.storeId)) {
      throw new NotFoundException('记录不存在');
    }
    // 改了 Ozon 链接但没填 SKU → 顺手补上
    if (!dto.sku && dto.retailUrl) dto.sku = extractOzonSku(dto.retailUrl) ?? undefined;
    // 改完的 SKU 不能和别的记录撞车（同店铺下 SKU 唯一，撞了应该去编辑那一条）
    if (dto.sku && dto.sku !== rec.sku) {
      const clash = await this.prisma.selfPurchase.findFirst({
        where: { sku: dto.sku, storeId: rec.storeId, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          `SKU ${dto.sku} 已有记录（#${clash.id}），请直接编辑那一条，避免重复`,
        );
      }
    }
    const data = this.pickData(dto);
    Object.assign(data, (await this.normalizeRetail(dto)) || {});
    this.applyTrace(data, rec.status, dto.fromCapture);
    if (data.sellPrice != null) data.pricedAt = new Date();

    const updated = await this.prisma.selfPurchase.update({ where: { id }, data });
    // 改了成本 / 重量等参数后仍未核价的记录，顺手把价算出来（已核价的不覆盖）
    const priced = await this.autoPriceRecord(updated);
    return this.fmt(priced);
  }

  /** 删除：同样先做越权校验 */
  async remove(id: number, user?: any) {
    const rec = await this.prisma.selfPurchase.findUnique({ where: { id } });
    if (!rec || !inStoreScope(user, rec.storeId)) {
      throw new NotFoundException('记录不存在');
    }
    await this.prisma.selfPurchase.delete({ where: { id } });
    return { id };
  }

  /**
   * 导出 CSV：列头覆盖 货源 / 包装 / 定价 / 俄语文案 / 状态 / 留痕，方便直接拿去流水化作业。
   * 与列表用同一套筛选（keyword / status / 店铺隔离）。
   */
  async exportCsv(q: QuerySelfPurchaseDto = {}, user?: any) {
    const where: any = { ...storeWhereClause(user, q.storeId) };
    if (q.status) where.status = q.status;
    if (q.keyword) {
      where.OR = [
        { name: { contains: q.keyword } },
        { sku: { contains: q.keyword } },
        { supplyUrl: { contains: q.keyword } },
        { retailUrl: { contains: q.keyword } },
        { titleRu: { contains: q.keyword } },
        { remark: { contains: q.keyword } },
      ];
    }
    const rows = await this.prisma.selfPurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100000,
    });

    const STATUS_TEXT: Record<string, string> = {
      editing: '编辑中',
      listed: '已上架',
      delisted: '已下架',
    };

    const head = [
      'SKU',
      '商品名称',
      '规格',
      '上架状态',
      '俄语标题',
      '俄语内容',
      '俄语标签',
      '1688货源链接',
      'Ozon链接',
      '包装信息',
      '采购成本(元)',
      '跟卖价(₽)',
      '跟卖价(¥)',
      '重量(kg)',
      '尺寸(cm)',
      '物流渠道',
      '国际运费(元)',
      '定价(元)',
      '定价(卢布)',
      '毛利润(元)',
      '净利润(元)',
      '利润率',
      '运费利润比',
      '加35%(元)',
      '上架时间',
      '抓取时间',
      '核价时间',
      '备注',
      '来源',
      '创建时间',
    ];

    // 以 = + - @ 开头的值会被 Excel 当公式执行（CSV 注入），前面补单引号挡掉
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const dt = (v: any) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : '');

    const lines = [head.join(',')];
    rows.forEach((r: any) => {
      const f = this.fmt(r);
      const size =
        f.lengthCm != null || f.widthCm != null || f.heightCm != null
          ? `${f.lengthCm ?? 0}*${f.widthCm ?? 0}*${f.heightCm ?? 0}`
          : '';
      lines.push(
        [
          f.sku || '',
          f.name || '',
          f.specName || '',
          STATUS_TEXT[f.status] || f.status || '',
          f.titleRu || '',
          f.descRu || '',
          f.tagsRu || '',
          f.supplyUrl || '',
          f.retailUrl || '',
          f.packageText || f.sizeText || '',
          f.purchaseCost ?? '',
          f.retailPriceRub ?? '',
          f.retailPriceCny ?? '',
          f.weightKg ?? '',
          f.sizeText || size,
          f.channelName || f.logistics || '',
          f.shippingFee ?? '',
          f.sellPrice ?? '',
          f.sellPriceRub ?? '',
          f.grossProfit ?? '',
          f.netProfit ?? '',
          f.profitRate != null ? `${(Number(f.profitRate) * 100).toFixed(1)}%` : '',
          f.shippingFee > 0 && f.netProfit != null
            ? `${((Number(f.netProfit) / Number(f.shippingFee)) * 100).toFixed(1)}%`
            : '',
          f.sellPrice != null ? (Number(f.sellPrice) / 0.65).toFixed(2) : '',
          dt(f.listedAt),
          dt(f.caughtAt),
          dt(f.pricedAt),
          f.remark || '',
          f.source === 'plugin' ? '插件' : '手动',
          dt(f.createdAt),
        ]
          .map(esc)
          .join(','),
      );
    });
    return `\uFEFF${lines.join('\n')}`;
  }
}
