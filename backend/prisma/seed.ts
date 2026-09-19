import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_RULES } from '../src/modules/screening/rules';

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
