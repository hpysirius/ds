import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_RULES } from '../src/modules/screening/rules';
import { CHANNEL_SEED } from '../src/modules/pricing/channels.data';

const prisma = new PrismaClient();

async function main() {
  // 默认管理员
  const username = 'admin';
  const exists = await prisma.user.findUnique({ where: { username } });
  if (!exists) {
    await prisma.user.create({
      data: {
        username,
        password: await bcrypt.hash('admin123', 10),
        nickname: '管理员',
        role: 'admin',
      },
    });
    console.log('✅ 已创建默认管理员 admin / admin123');
  } else {
    console.log('ℹ️ 管理员已存在，跳过');
  }

  // 默认筛选规则预设
  const presetCount = await prisma.filterPreset.count();
  if (presetCount === 0) {
    await prisma.filterPreset.create({
      data: {
        name: '默认规则（零评论 · 无品牌 · FBS · 零广告）',
        description: '月销 2-20（5-10 最优）；加购率 ≥10（红线 5）；退货 ≤20%；上架 45-75 天；广告占比 0',
        isDefault: true,
        rules: DEFAULT_RULES as any,
      },
    });
    await prisma.filterPreset.create({
      data: {
        name: '放宽版（容许有广告，需卷价格）',
        description: '同默认规则，但接受广告费占比 > 0 的商品，归入 D 档',
        isDefault: false,
        rules: { ...DEFAULT_RULES, allowAds: true, daysMax: 120 } as any,
      },
    });
    console.log('✅ 已创建 2 个默认规则预设');
  } else {
    console.log('ℹ️ 规则预设已存在，跳过');
  }

  // 核价默认参数
  const setting = await prisma.pricingSetting.findUnique({ where: { id: 1 } });
  if (!setting) {
    await prisma.pricingSetting.create({ data: { id: 1 } });
    console.log('✅ 已创建核价默认参数（汇率 0.0862、贴单费 2、佣金 12% / 代理 3.5% / 提现 1.2%）');
  } else {
    console.log('ℹ️ 核价默认参数已存在，跳过');
  }

  // 物流渠道（来自定价表模版）
  const channelCount = await prisma.logisticsChannel.count();
  if (channelCount === 0) {
    for (const c of CHANNEL_SEED) {
      await prisma.logisticsChannel.create({
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
    console.log(`✅ 已导入 ${CHANNEL_SEED.length} 条物流渠道（GUOO / 兴远 XY，俄白哈吉四国）`);
  } else {
    console.log('ℹ️ 物流渠道已存在，跳过');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
