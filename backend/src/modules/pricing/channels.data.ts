/**
 * 物流渠道种子数据 —— 全部来自《定价表模版最新.xlsx》
 *
 * - GUOO realFBS 资费试算表（俄罗斯）  → country RU, vendor GUOO
 * - 白俄专线 / 哈萨克斯坦专线          → country BY / KZ, vendor GUOO
 * - 俄罗斯公式 / 吉尔吉斯公式          → country RU / KG, vendor XY（兴远国际）
 *
 * XY 采用 ROUNDUP(x,2)，GUOO 不做向上取整。
 * pricePerKg 对应表里「运价系数 F」（= 元/克 × 1000），pricePerOrder 对应「挂号费 G」。
 */

import { ChannelLike } from './pricing.calc';

export type ChannelSeed = Omit<ChannelLike, 'id'>;

interface Lim {
  minWeightKg: number;
  maxWeightKg: number;
  minValueRub: number;
  maxValueRub: number;
  maxSumCm: number;
  maxSideLongCm: number;
  maxSideShortCm: number;
  volumetric: boolean;
}

const base = {
  divisor: 12000,
  enabled: true,
  etaDays: null,
  battery: null,
  note: null,
  priceText: null,
};

// ---------- 各国家/品类的限制 ----------
const LIM_RU: Record<string, Lim> = {
  'Extra Small': { minWeightKg: 0.001, maxWeightKg: 0.55, minValueRub: 0, maxValueRub: 1600, maxSumCm: 90, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Budget: { minWeightKg: 0.501, maxWeightKg: 30, minValueRub: 0, maxValueRub: 1600, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Small: { minWeightKg: 0.001, maxWeightKg: 2.2, minValueRub: 1501, maxValueRub: 7200, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Big: { minWeightKg: 2.201, maxWeightKg: 30, minValueRub: 1501, maxValueRub: 7200, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
  'Premium Small': { minWeightKg: 0.001, maxWeightKg: 5.5, minValueRub: 7000, maxValueRub: 250000, maxSumCm: 250, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: false },
  'Premium Big': { minWeightKg: 5.501, maxWeightKg: 30, minValueRub: 7000, maxValueRub: 250000, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
};

const LIM_KG: Record<string, Lim> = {
  'Extra Small': { minWeightKg: 0.001, maxWeightKg: 0.5, minValueRub: 0, maxValueRub: 1600, maxSumCm: 90, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Budget: { minWeightKg: 0.501, maxWeightKg: 30, minValueRub: 0, maxValueRub: 1600, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Small: { minWeightKg: 0.001, maxWeightKg: 2, minValueRub: 1501, maxValueRub: 7200, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Big: { minWeightKg: 2.001, maxWeightKg: 30, minValueRub: 1501, maxValueRub: 7200, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
  'Premium Small': { minWeightKg: 0.001, maxWeightKg: 5, minValueRub: 7000, maxValueRub: 18000, maxSumCm: 250, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: false },
  'Premium Big': { minWeightKg: 5.001, maxWeightKg: 30, minValueRub: 7000, maxValueRub: 18000, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
};

const LIM_GUOO_RU: Record<string, Lim> = {
  'Extra Small': { minWeightKg: 0.001, maxWeightKg: 0.5, minValueRub: 1, maxValueRub: 1500, maxSumCm: 90, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Budget: { minWeightKg: 0.5, maxWeightKg: 30, minValueRub: 1, maxValueRub: 1500, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Small: { minWeightKg: 0.001, maxWeightKg: 2, minValueRub: 1501, maxValueRub: 7000, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Big: { minWeightKg: 2, maxWeightKg: 30, minValueRub: 1501, maxValueRub: 7000, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 80, volumetric: true },
  'Premium Small': { minWeightKg: 0.001, maxWeightKg: 5, minValueRub: 7001, maxValueRub: 250000, maxSumCm: 250, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: false },
  'Premium Big': { minWeightKg: 5.001, maxWeightKg: 30, minValueRub: 7001, maxValueRub: 250000, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 80, volumetric: true },
};

const LIM_GUOO_BYKZ: Record<string, Lim> = {
  'Extra Small': { minWeightKg: 0.001, maxWeightKg: 0.5, minValueRub: 1, maxValueRub: 1500, maxSumCm: 90, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Budget: { minWeightKg: 0.501, maxWeightKg: 35, minValueRub: 1, maxValueRub: 1500, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Small: { minWeightKg: 0.001, maxWeightKg: 2, minValueRub: 1501, maxValueRub: 7000, maxSumCm: 150, maxSideLongCm: 60, maxSideShortCm: 60, volumetric: false },
  Big: { minWeightKg: 2.001, maxWeightKg: 35, minValueRub: 1501, maxValueRub: 7000, maxSumCm: 250, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
  'Premium Small': { minWeightKg: 0.001, maxWeightKg: 5, minValueRub: 7001, maxValueRub: 500000, maxSumCm: 250, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: false },
  'Premium Big': { minWeightKg: 5.001, maxWeightKg: 35, minValueRub: 7001, maxValueRub: 500000, maxSumCm: 310, maxSideLongCm: 150, maxSideShortCm: 150, volumetric: true },
};

// ---------- 构造器 ----------
let seq = 0;
const nextSort = () => ++seq;

const CAT_ORDER = ['Extra Small', 'Budget', 'Small', 'Big', 'Premium Small', 'Premium Big'];
const MODE_ORDER = ['Express', 'Standard', 'Economy', '空运', '陆空联运', '陆运'];

function sortOf(category: string, shipMode: string) {
  const c = CAT_ORDER.indexOf(category);
  const m = MODE_ORDER.indexOf(shipMode);
  return (c < 0 ? 99 : c) * 10 + (m < 0 ? 9 : m);
}

function make(
  country: string,
  vendor: string,
  category: string,
  shipMode: string,
  name: string,
  pricePerKg: number,
  pricePerOrder: number,
  lim: Lim,
  extra: Partial<ChannelSeed> = {},
): ChannelSeed {
  return {
    ...base,
    country,
    vendor,
    category,
    shipMode,
    name,
    delivery: null,
    pricePerKg,
    pricePerOrder,
    ...lim,
    roundUp: vendor === 'XY',
    sort: sortOf(category, shipMode),
    ...extra,
  } as ChannelSeed;
}

const rows: ChannelSeed[] = [];

/** 兴远 XY：PUDO / Courier 各一行 */
function xy(
  country: string,
  lim: Record<string, Lim>,
  category: string,
  shipMode: string,
  channelName: string,
  f: number,
  g: number,
  extra: Partial<ChannelSeed> = {},
) {
  const eta =
    shipMode === 'Economy' ? '13-18天' : shipMode === 'Standard' ? '10-15天' : null;
  for (const delivery of ['PUDO', 'Courier']) {
    rows.push(
      make(country, 'XY', category, shipMode, channelName, f, g, lim[category], {
        ...extra,
        delivery,
        etaDays: eta,
        sort: sortOf(category, shipMode) * 2 + (delivery === 'PUDO' ? 0 : 1),
      }),
    );
  }
}

/** GUOO：到点 / 到门合并为一行 */
function guoo(
  country: string,
  lim: Record<string, Lim>,
  category: string,
  shipMode: string,
  name: string,
  f: number,
  g: number,
  extra: Partial<ChannelSeed> = {},
) {
  rows.push(make(country, 'GUOO', category, shipMode, name, f, g, lim[category], extra));
}

// ============================================================
// 1. GUOO realFBS —— 俄罗斯
// ============================================================
const R = LIM_GUOO_RU;
guoo('RU', R, 'Extra Small', '空运', 'GUOO Express Extra Small', 50.55, 3.37, {
  note: '特快超级轻小件到点/到门',
  priceText: '50.55元/千克+3.37元/票',
  battery: '只接普货（不接带电、带磁、液体、粉末、刀具、仿牌等）',
});
guoo('RU', R, 'Extra Small', '陆空联运', 'GUOO Standard Extra Small', 39.3, 3.37, {
  note: '标准超级轻小件到点/到门',
  priceText: '39.3元/千克+3.37元/票',
  battery: '内置小容量电池可发，配套电池禁运',
});
guoo('RU', R, 'Extra Small', '陆运', 'GUOO Economy Extra Small', 28.1, 3.37, {
  note: '经济超级轻小件到点/到门',
  priceText: '28.1元/千克+3.37元/票',
});

guoo('RU', R, 'Budget', '陆空联运', 'GUOO Standard Budget', 26, 23.92, {
  note: '标准低客单价到点/到门',
  priceText: '26元/千克+23.92元/票',
});
guoo('RU', R, 'Budget', '陆运', 'GUOO Economy Budget', 19.1, 25.83, {
  note: '经济低客单价到点/到门',
  priceText: '19.1元/千克+25.83元/票',
});

guoo('RU', R, 'Small', '空运', 'GUOO Express Small', 50.5, 17.97, {
  note: '特快轻小件到点/到门',
  priceText: '50.5元/千克+17.97元/票',
  battery: '只接普货（不接带电、带磁、液体、粉末、刀具、仿牌等）',
});
guoo('RU', R, 'Small', '陆空联运', 'GUOO Standard Small', 39.3, 17.97, {
  note: '标准轻小件到点/到门',
  priceText: '39.3元/千克+17.97元/票',
});
guoo('RU', R, 'Small', '陆运', 'GUOO Economy Small', 28.1, 17.97, {
  note: '经济轻小件到点/到门',
  priceText: '28.1元/千克+17.97元/票',
  battery: '可运内置电池，无需 MSDS',
});

guoo('RU', R, 'Big', '陆空联运', 'GUOO Standard Big', 28.1, 40.44, {
  note: '标准大件到点/到门（收抛）',
  priceText: '28.1元/千克+40.44元/票',
  battery: '不可运纯电池；内置电池可；最大 160Wh',
});
guoo('RU', R, 'Big', '陆运', 'GUOO Economy Big', 19.1, 40.44, {
  note: '经济大件到点/到门（收抛）',
  priceText: '19.1元/千克+40.44元/票',
});

guoo('RU', R, 'Premium Small', '空运', 'GUOO Express Premium Small', 50.5, 24.71, {
  note: '特快高客单价轻小件到点/到门',
  priceText: '50.5元/千克+24.71元/票',
});
guoo('RU', R, 'Premium Small', '陆空联运', 'GUOO Standard Premium Small', 39.3, 24.71, {
  note: '标准高客单价轻小件到点/到门',
  priceText: '39.3元/千克+24.71元/票',
});
guoo('RU', R, 'Premium Small', '陆运', 'GUOO Economy Premium Small', 28.1, 24.71, {
  note: '经济高客单价轻小件到点/到门',
  priceText: '28.1元/千克+24.71元/票',
});

guoo('RU', R, 'Premium Big', '陆空联运', 'GUOO Standard Premium Big', 31.4, 69.64, {
  note: '标准高客单价大件到点/到门（收抛）',
  priceText: '31.4元/千克+69.64元/票',
});
guoo('RU', R, 'Premium Big', '陆运', 'GUOO Economy Premium Big', 25.8, 69.64, {
  note: '经济高客单价大件到点/到门（收抛）',
  priceText: '25.8元/千克+69.64元/票',
});

// ============================================================
// 2. GUOO —— 白俄罗斯 / 哈萨克斯坦（价格一致，仅渠道名不同）
// ============================================================
for (const [country, prefix] of [
  ['BY', 'GUOO Belarus'],
  ['KZ', 'GUOO Kazakhstan'],
] as const) {
  const L = LIM_GUOO_BYKZ;
  guoo(country, L, 'Extra Small', '陆空联运', `${prefix} Standard Extra Small`, 36.4, 3.12, {
    note: '超级轻小件',
    priceText: '36.4元/千克+3.12元/票',
  });
  guoo(country, L, 'Extra Small', '陆运', `${prefix} Economy Extra Small`, 26, 3.12, {
    note: '超级轻小件',
    priceText: '26元/千克+3.12元/票',
  });
  guoo(country, L, 'Budget', '陆空联运', `${prefix} Standard Budget`, 26, 23.92, {
    note: '低客单轻小件',
    priceText: '26元/千克+23.92元/票',
  });
  guoo(country, L, 'Budget', '陆运', `${prefix} Economy Budget`, 17.68, 23.92, {
    note: '低客单轻小件',
    priceText: '17.68元/千克+23.92元/票',
  });
  guoo(country, L, 'Small', '陆空联运', `${prefix} Standard Small`, 36.4, 16.64, {
    note: '轻小件',
    priceText: '36.4元/千克+16.64元/票',
  });
  guoo(country, L, 'Small', '陆运', `${prefix} Economy Small`, 26, 16.64, {
    note: '轻小件',
    priceText: '26元/千克+16.64元/票',
  });
  guoo(country, L, 'Big', '陆空联运', `${prefix} Standard Big`, 26, 37.44, {
    note: '大件（收抛）',
    priceText: '26元/千克+37.44元/票',
  });
  guoo(country, L, 'Big', '陆运', `${prefix} Economy Big`, 17.68, 37.44, {
    note: '大件（收抛）',
    priceText: '17.68元/千克+37.44元/票',
  });
  guoo(country, L, 'Premium Small', '陆空联运', `${prefix} Standard Premium Small`, 36.4, 22.88, {
    note: '高客单轻小件',
    priceText: '36.4元/千克+22.88元/票',
  });
  guoo(country, L, 'Premium Small', '陆运', `${prefix} Economy Premium Small`, 26, 22.88, {
    note: '高客单轻小件',
    priceText: '26元/千克+22.88元/票',
  });
  guoo(country, L, 'Premium Big', '陆空联运', `${prefix} Standard Premium Big`, 29.12, 64.48, {
    note: '高客单大件（收抛）',
    priceText: '29.12元/千克+64.48元/票',
  });
  guoo(country, L, 'Premium Big', '陆运', `${prefix} Economy Premium Big`, 23.92, 64.48, {
    note: '高客单大件（收抛）',
    priceText: '23.92元/千克+64.48元/票',
  });
}

// ============================================================
// 3. 兴远国际 XY —— 俄罗斯
// ============================================================
const L = LIM_RU;
xy('RU', L, 'Extra Small', 'Economy', 'XY Economy Extra Small', 28.1, 3.37, {
  priceText: '¥3.37元+ ¥0.0281/克',
});
xy('RU', L, 'Extra Small', 'Standard', 'XY Extra Small Standard', 39.3, 3.37, {
  priceText: '¥3.37元+ ¥0.0393/克',
});
xy('RU', L, 'Extra Small', 'Express', 'XY Express Extra Small', 45, 3.12, {
  priceText: '¥3元+ ¥0.045/克',
  maxWeightKg: 0.5,
});
xy('RU', L, 'Budget', 'Economy', 'XY Economy Budget', 19.1, 25.83, {
  priceText: '¥25.83元+ ¥0.0191/1克',
});
xy('RU', L, 'Budget', 'Standard', 'XY Standard Budget', 28.1, 25.83, {
  priceText: '¥25.83元+ ¥0.0281/克',
});
xy('RU', L, 'Budget', 'Express', 'XY Express Budget', 33, 23.92, {
  priceText: '¥23元+ ¥0.033/1克',
});
xy('RU', L, 'Small', 'Economy', 'XY Economy Small', 28.1, 17.97, {
  priceText: '¥17.97元+ ¥0.0281/克',
});
xy('RU', L, 'Small', 'Standard', 'XY Standard Small', 39.3, 17.97, {
  priceText: '¥17.97元+ ¥0.0393/克',
});
xy('RU', L, 'Small', 'Express', 'XY Express Small', 16, 16.64, {
  priceText: '¥16元+ ¥0.045/克',
  maxWeightKg: 2,
  note: '原表运价系数填的是 16（与「¥0.045/克」不符，疑为笔误），如需修正请到渠道管理里改成 45',
});
xy('RU', L, 'Big', 'Economy', 'XY Economy Big', 19.1, 40.44, {
  priceText: '¥40.44元+ ¥0.0191/1克',
});
xy('RU', L, 'Big', 'Standard', 'XY Standard Big', 28.1, 40.44, {
  priceText: '¥40.44元+ ¥0.0281/克',
});
xy('RU', L, 'Big', 'Express', 'XY Express Big', 33, 37.44, {
  priceText: '¥36元+ ¥0.033/1克',
});
xy('RU', L, 'Premium Small', 'Economy', 'XY Economy Premium Small', 28.1, 24.71, {
  priceText: '¥24.71元+ ¥0.0281/克',
});
xy('RU', L, 'Premium Small', 'Standard', 'XY Standard Premium Small', 39.3, 24.71, {
  priceText: '¥24.71元+ ¥0.0393/克',
});
xy('RU', L, 'Premium Small', 'Express', 'XY Express Premium Small', 26, 22.88, {
  priceText: '¥22元+ ¥0.045/克',
  maxWeightKg: 5,
  note: '原表运价系数填的是 26（与「¥0.045/克」不符，疑为笔误），如需修正请到渠道管理里改成 45',
});
xy('RU', L, 'Premium Big', 'Economy', 'XY Economy Premium Big', 25.8, 69.64, {
  priceText: '¥69.64元+ ¥0.0258/克',
});
xy('RU', L, 'Premium Big', 'Standard', 'XY Standard Premium Big', 31.4, 69.64, {
  priceText: '¥69.64元+0.0314/克',
});
xy('RU', L, 'Premium Big', 'Express', 'XY Express Premium Big', 33, 64.48, {
  priceText: '¥62元+ ¥0.033/1克',
  minWeightKg: 5.001,
});

// ============================================================
// 4. 兴远国际 XY —— 吉尔吉斯斯坦
// ============================================================
const K = LIM_KG;
xy('KG', K, 'Extra Small', 'Economy', 'XY Economy Extra Small', 26, 3.12, {
  priceText: '¥3.12元+ ¥0.026/克',
});
xy('KG', K, 'Extra Small', 'Standard', 'XY Extra Small Standard', 39.3, 3.37, {
  priceText: '¥3.37元+¥0.0393/克',
});
xy('KG', K, 'Extra Small', 'Express', 'XY Express Extra Small', 45, 3.12, {
  priceText: '¥3元+ ¥0.045/克',
});
xy('KG', K, 'Budget', 'Economy', 'XY Economy Budget', 17.68, 23.92, {
  priceText: '¥23.92元+ ¥0.01768/1克',
});
xy('KG', K, 'Budget', 'Standard', 'XY Standard Budget', 28.1, 23.83, {
  priceText: '¥23.83元+¥0.0281/克',
});
xy('KG', K, 'Budget', 'Express', 'XY Express Budget', 33, 23.92, {
  priceText: '¥23元+ ¥0.033/1克',
});
xy('KG', K, 'Small', 'Economy', 'XY Economy Small', 26, 16.64, {
  priceText: '¥16.64元+ ¥0.026/克',
});
xy('KG', K, 'Small', 'Standard', 'XY Standard Small', 39.3, 17.97, {
  priceText: '¥17.97元+¥0.0393/克',
});
xy('KG', K, 'Small', 'Express', 'XY Express Small', 16, 16.64, {
  priceText: '¥16元+ ¥0.045/克',
  note: '原表运价系数填的是 16（与「¥0.045/克」不符，疑为笔误），如需修正请到渠道管理里改成 45',
});
xy('KG', K, 'Big', 'Economy', 'XY Economy Big', 17.68, 37.44, {
  priceText: '¥37.44元+ ¥0.01768/1克',
});
xy('KG', K, 'Big', 'Standard', 'XY Standard Big', 28.1, 40.44, {
  priceText: '¥40.44元+¥0.0281/克',
});
xy('KG', K, 'Big', 'Express', 'XY Express Big', 33, 37.44, {
  priceText: '¥36元+ ¥0.033/1克',
});
xy('KG', K, 'Premium Small', 'Economy', 'XY Economy Premium Small', 26, 22.88, {
  priceText: '¥22.88元+ ¥0.026/克',
});
xy('KG', K, 'Premium Small', 'Standard', 'XY Standard Premium Small', 39.3, 24.71, {
  priceText: '¥24.71元+¥0.0393/克',
});
xy('KG', K, 'Premium Small', 'Express', 'XY Express Premium Small', 26, 22.88, {
  priceText: '¥22元+ ¥0.045/克',
  maxValueRub: 250000,
});
xy('KG', K, 'Premium Big', 'Economy', 'XY Economy Premium Big', 23.92, 64.48, {
  priceText: '¥64.48元+ ¥0.02392/1克',
});
xy('KG', K, 'Premium Big', 'Standard', 'XY Standard Premium Big', 31.4, 69.64, {
  priceText: '¥69.64元+¥0.0314/克',
});
xy('KG', K, 'Premium Big', 'Express', 'XY Express Premium Big', 33, 64.48, {
  priceText: '¥62元+ ¥0.033/1克',
  maxValueRub: 250000,
});

export const CHANNEL_SEED: ChannelSeed[] = rows;
