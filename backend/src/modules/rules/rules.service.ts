import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inStoreScope, storeWhereClause } from '../../common/constants/permissions';
import { RULE_DEFS, conditionsOf, sanitizeRule } from './rule-defs';

/**
 * 采集规则（标签规则）。
 *
 * 数据来源：插件弹窗里「🏷 采集规则」维护的规则，存在 chrome.storage.local，
 * 由插件调 `POST /rules/sync` 全量上报到这里落库。后台只读展示，不做编辑下发。
 *
 * 另一层来源：商品 `raw.tags` 里已经打上的标签。老数据（或规则被删后）标签还在商品上，
 * 列表会把「商品里有、规则表里没有」的标签作为 `source: 'product'` 的条目补出来，
 * 避免后台一片空白。
 */
@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 从插件带上来的 Authorization 解析归属店铺。
   * 与 `SourcingService.resolveStoreId` 同语义：员工 → 本店；超管/未登录/无效 token → null。
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
   * 插件全量上报规则（@Public，可带 token 归店）。
   * 以 (storeId, ruleId) 做幂等：存在就更新，不存在就新建。上报里没带的规则不动
   * （插件删规则后，后台仍保留历史条目，商品上的老标签也还对得上）。
   */
  async sync(dto: any, authHeader?: string) {
    const storeId = await this.resolveStoreId(authHeader);
    const items = Array.isArray(dto?.rules) ? dto.rules : [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of items) {
      const clean = sanitizeRule(raw);
      if (!clean) {
        skipped++;
        continue;
      }
      const data: any = {
        name: clean.name,
        tag: clean.tag,
        color: clean.color,
        priority: clean.priority,
        enabled: clean.enabled,
        brand: clean.brand,
        brandText: clean.brandText,
        salesSchema: clean.salesSchema,
        conds: clean.conds ?? Prisma.DbNull,
        condText: clean.condText,
      };
      // 不用 upsert：@@unique 里含可空的 storeId，MySQL 唯一索引对 NULL 不生效，
      // 传 storeId=null 时 findUnique 可能匹配到多行直接报错。统一走 findFirst。
      const exist = await this.prisma.collectRule.findFirst({
        where: { storeId, ruleId: clean.ruleId },
        select: { id: true },
      });
      if (exist) {
        await this.prisma.collectRule.update({ where: { id: exist.id }, data });
        updated++;
      } else {
        await this.prisma.collectRule.create({ data: { ...data, ruleId: clean.ruleId, storeId } });
        created++;
      }
    }
    return { total: items.length, created, updated, skipped, storeId };
  }

  /**
   * 统计各标签命中了多少商品（按当前可见范围）。
   *
   * 用 MySQL 8 的 JSON_TABLE 在库里聚合，比把几百上千条 raw JSON 拉进内存再遍历便宜得多。
   * 环境不支持 JSON_TABLE（MySQL < 8.0.4）时静默返回空 —— 商品数只是辅助信息，不该让整页报错。
   */
  private async tagProductCounts(scope: any): Promise<Record<string, number>> {
    const sid = scope?.storeId;
    const storeClause = sid === undefined ? '' : sid === null ? 'AND p.storeId IS NULL' : 'AND p.storeId = ?';
    const args = sid === undefined || sid === null ? [] : [sid];
    const sql = `
      SELECT jt.n AS name, COUNT(*) AS c
      FROM products p
      JOIN JSON_TABLE(p.raw, '$.tags[*]' COLUMNS (n VARCHAR(40) PATH '$.name')) jt
      WHERE p.raw IS NOT NULL AND jt.n IS NOT NULL AND jt.n <> ''
      ${storeClause}
      GROUP BY jt.n`;
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...args);
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r.name)] = Number(r.c) || 0;
      return out;
    } catch (e) {
      return {};
    }
  }

  /** 规则标签列表：规则表 + 商品标签兜底合并 */
  async findAll(user: any, reqStoreId?: string | number | null) {
    const scope = storeWhereClause(user, reqStoreId);
    const [rules, counts] = await Promise.all([
      this.prisma.collectRule.findMany({
        where: scope,
        orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      }),
      this.tagProductCounts(scope),
    ]);

    const list: any[] = rules.map((r) => ({
      id: r.id,
      source: 'plugin',
      ruleId: r.ruleId,
      name: r.name,
      tag: r.tag,
      color: r.color,
      priority: r.priority,
      enabled: r.enabled,
      condText: r.condText,
      conditions: conditionsOf(r),
      productCount: counts[r.tag] ?? 0,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    }));

    // 商品里有、规则表里没有的标签（老数据 / 规则已删）→ 补一条只读条目
    const known = new Set(list.map((r) => r.tag));
    for (const [tag, count] of Object.entries(counts)) {
      if (known.has(tag)) continue;
      list.push({
        id: null,
        source: 'product',
        ruleId: null,
        name: null,
        tag,
        color: null,
        priority: null,
        enabled: null,
        condText: null,
        conditions: [],
        productCount: count,
        updatedAt: null,
        createdAt: null,
      });
    }
    // 有商品的排前面，再按规则优先级
    list.sort((a, b) => (b.productCount || 0) - (a.productCount || 0) || (a.priority ?? 999) - (b.priority ?? 999));

    const totalProducts = Object.values(counts).reduce((s, n) => s + n, 0);
    return { list, total: list.length, taggedProducts: totalProducts, defs: RULE_DEFS };
  }

  /** 单个规则详情（含条件明细与命中商品数） */
  async findOne(id: number, user: any) {
    const r = await this.prisma.collectRule.findUnique({ where: { id } });
    if (!r || !inStoreScope(user, r.storeId ?? null)) throw new NotFoundException('规则不存在');
    const scope = storeWhereClause(user, r.storeId ?? undefined);
    const counts = await this.tagProductCounts(scope);
    return {
      id: r.id,
      source: 'plugin',
      ruleId: r.ruleId,
      name: r.name,
      tag: r.tag,
      color: r.color,
      priority: r.priority,
      enabled: r.enabled,
      brand: r.brand,
      brandText: r.brandText,
      salesSchema: r.salesSchema,
      conds: r.conds,
      condText: r.condText,
      conditions: conditionsOf(r),
      productCount: counts[r.tag] ?? 0,
      storeId: r.storeId,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    };
  }

  /**
   * 按标签名查规则 —— 商品库列表里点标签名时用。
   * 同一个标签名可能对应多条规则（不同规则可以打同一个标签），全部返回。
   */
  async findByTag(tag: string, user: any, reqStoreId?: string | number | null) {
    const name = String(tag || '').trim();
    if (!name) return { tag: name, rules: [], productCount: 0 };
    const scope = storeWhereClause(user, reqStoreId);
    const [rules, counts] = await Promise.all([
      this.prisma.collectRule.findMany({ where: { ...scope, tag: name }, orderBy: [{ priority: 'asc' }] }),
      this.tagProductCounts(scope),
    ]);
    return {
      tag: name,
      productCount: counts[name] ?? 0,
      rules: rules.map((r) => ({
        id: r.id,
        source: 'plugin',
        ruleId: r.ruleId,
        name: r.name,
        tag: r.tag,
        color: r.color,
        priority: r.priority,
        enabled: r.enabled,
        condText: r.condText,
        conditions: conditionsOf(r),
        updatedAt: r.updatedAt,
      })),
    };
  }
}
