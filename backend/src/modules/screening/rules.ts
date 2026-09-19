/**
 * 选品规则引擎
 *
 * 分两层：
 *  1. 硬性红线 —— 命中任意一条直接淘汰，不看分数（无评论、退货率、加购率地板、品牌、发货方式、上架时长、广告）
 *  2. 加权打分 —— 加购率权重最高，其次月销区间、零广告、上架天数落区
 *
 * 四档含义：
 *  A 主筛（月销 2–20，5–10 最优）
 *  B 新品首单（月销 1 且上架 ≤N 天）
 *  C 自然流爆款（月销 ≥N 且零广告）
 *  D 有广告，需卷价格
 */
export interface ScreeningRules {
  salesMin: number;
  salesMax: number;
  sweetMin: number;
  sweetMax: number;
  allowNewbie: boolean;
  newbieMaxDays: number;
  allowOrganic: boolean;
  organicMinSales: number;
  cartHardMin: number;
  cartGood: number;
  cartGreat: number;
  returnMax: number;
  reviewsMax: number;
  daysMax: number;
  daysPreferredMin: number;
  daysPreferredMax: number;
  allowAds: boolean;
  adMax: number;
  requireNoBrand: boolean;
  requireFbs: boolean;
  scoreFollow: number;
  scoreWatch: number;
  scoreObserve: number;
}

export const DEFAULT_RULES: ScreeningRules = {
  salesMin: 2,
  salesMax: 20,
  sweetMin: 5,
  sweetMax: 10,
  allowNewbie: true,
  newbieMaxDays: 4,
  allowOrganic: true,
  organicMinSales: 70,
  cartHardMin: 5,
  cartGood: 10,
  cartGreat: 15,
  returnMax: 20,
  reviewsMax: 0,
  daysMax: 100,
  daysPreferredMin: 45,
  daysPreferredMax: 75,
  allowAds: false,
  adMax: 30,
  requireNoBrand: true,
  requireFbs: true,
  scoreFollow: 70,
  scoreWatch: 50,
  scoreObserve: 30,
};

export const GRADE_TEXT = ['淘汰', '优先跟进', '可跟进', '观察'];

export interface JudgeResult {
  hard: string[];
  plus: string[];
  notes: string[];
  score: number;
  grade: number;
  tier: 'A' | 'B' | 'C' | 'D';
}

const toNum = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[%\s,]/g, ''));
  return Number.isNaN(n) ? null : n;
};

export function judge(p: any, R: ScreeningRules): JudgeResult {
  const hard: string[] = [];
  const plus: string[] = [];
  const notes: string[] = [];
  let score = 0;
  let tier: 'A' | 'B' | 'C' | 'D' = 'A';

  const sold = toNum(p.soldCount);
  const days = toNum(p.createDays);
  const cart = toNum(p.convToCartPdp);
  const cancel = toNum(p.cancelRate);
  const drr = toNum(p.drr);
  const reviews = toNum(p.reviewsCount) ?? 0;
  const brand = String(p.brand || '').trim();
  const schema = String(p.salesSchema || '').trim();

  // ---------- 硬性红线 ----------
  if (reviews > R.reviewsMax) hard.push(`有评论 ${reviews}`);
  if (cancel !== null && cancel > R.returnMax) hard.push(`退货率 ${cancel}%`);
  if (cart !== null && cart < R.cartHardMin) hard.push(`加购率 ${cart}%`);
  if (days !== null && days > R.daysMax) hard.push(`上架 ${days} 天`);
  if (R.requireNoBrand && brand && !/无品牌|^无$|^-|no ?brand|без бренда/i.test(brand)) {
    hard.push(`有品牌 ${brand}`);
  }
  if (R.requireFbs && schema && !/FBS/i.test(schema)) hard.push(`非 FBS ${schema}`);
  if (!R.allowAds && drr !== null && drr > 0) hard.push(`有广告 ${drr}%`);

  // ---------- 加权打分 ----------
  if (cart !== null) {
    if (cart >= R.cartGreat) {
      score += 35;
      plus.push(`加购 ${cart}%`);
    } else if (cart >= R.cartGood) {
      score += 30;
      plus.push(`加购 ${cart}%`);
    } else {
      score += 10;
      plus.push(`加购偏低 ${cart}%`);
    }
  }

  if (sold !== null) {
    if (R.allowOrganic && sold >= R.organicMinSales && (drr === 0 || drr === null)) {
      score += 30;
      tier = 'C';
      plus.push(`月销 ${sold} 自然流`);
    } else if (R.allowNewbie && sold === 1 && days !== null && days <= R.newbieMaxDays) {
      score += 30;
      tier = 'B';
      plus.push('新品首单');
    } else if (sold >= R.sweetMin && sold <= R.sweetMax) {
      score += 30;
      plus.push(`月销 ${sold} 黄金区`);
    } else if (sold >= R.salesMin && sold <= R.salesMax) {
      score += 15;
      plus.push(`月销 ${sold}`);
    } else if (sold > R.salesMax && sold <= 40) {
      plus.push(`月销 ${sold} 偏高`);
    } else if (sold > 40) {
      score -= 10;
      plus.push(`月销 ${sold} 过热`);
    }
  }

  if (drr !== null) {
    if (drr === 0) {
      score += 20;
      plus.push('零广告');
    } else if (drr <= 5) {
      score += 5;
      tier = 'D';
      plus.push(`轻广告 ${drr}%`);
    } else {
      score -= 5;
      tier = 'D';
      plus.push(`重广告 ${drr}%`);
    }
  }
  if (tier === 'D') notes.push('需卷价格');

  if (days !== null) {
    if (days >= R.daysPreferredMin && days <= R.daysPreferredMax) {
      score += 20;
      plus.push(`上架 ${days} 天成熟期`);
    } else if ((days >= 30 && days < R.daysPreferredMin) || (days > R.daysPreferredMax && days <= 90)) {
      score += 10;
      plus.push(`上架 ${days} 天`);
    } else if (days <= 7) {
      score += 5;
      plus.push(`新上架 ${days} 天`);
    } else if (days < 30) {
      score += 10;
      plus.push(`上架 ${days} 天早期`);
    } else {
      score -= 5;
      plus.push(`上架 ${days} 天偏老`);
    }
  }

  const grade = hard.length
    ? 0
    : score >= R.scoreFollow
      ? 1
      : score >= R.scoreWatch
        ? 2
        : score >= R.scoreObserve
          ? 3
          : 0;

  return { hard, plus, notes, score, grade, tier };
}
