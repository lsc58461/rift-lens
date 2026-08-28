// 티어/디비전/LP ↔ 단일 수치(포인트) 변환.
// 아이언4 0LP = 0pt, 디비전당 100pt, 티어당 400pt. 마스터 이상은 2800 + LP.

const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
] as const;

const APEX_TIERS = ["MASTER", "GRANDMASTER", "CHALLENGER"] as const;
const APEX_BASE = TIERS.length * 400; // 2800

const DIVISIONS: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };

export const TIER_LABELS: Record<string, string> = {
  IRON: "아이언",
  BRONZE: "브론즈",
  SILVER: "실버",
  GOLD: "골드",
  PLATINUM: "플래티넘",
  EMERALD: "에메랄드",
  DIAMOND: "다이아몬드",
  MASTER: "마스터",
  GRANDMASTER: "그랜드마스터",
  CHALLENGER: "챌린저",
};

const DIVISION_LABELS: Record<number, string> = { 0: "4", 1: "3", 2: "2", 3: "1" };

/** 랭크 정보를 MMR 포인트로 변환 */
export function rankToPoints(tier: string, division: string, lp: number): number {
  const apexIndex = (APEX_TIERS as readonly string[]).indexOf(tier);
  if (apexIndex >= 0) return APEX_BASE + lp;
  const tierIndex = (TIERS as readonly string[]).indexOf(tier);
  if (tierIndex < 0) return 0;
  return tierIndex * 400 + (DIVISIONS[division] ?? 0) * 100 + Math.min(lp, 99);
}

export interface RankLabel {
  tier: string; // 영문 티어 키 (아이콘/색상용)
  label: string; // "골드 2 · 47LP" 같은 표시용 문자열
}

/** MMR 포인트를 표시용 랭크로 역변환 */
export function pointsToRank(points: number): RankLabel {
  const p = Math.max(0, Math.round(points));
  if (p >= APEX_BASE) {
    // 마스터 이상은 구간을 나누지 않고 LP로만 표기
    const lp = p - APEX_BASE;
    const tier = lp >= 1000 ? "CHALLENGER" : lp >= 500 ? "GRANDMASTER" : "MASTER";
    return { tier, label: `${TIER_LABELS[tier]} ${lp}LP` };
  }
  const tierIndex = Math.min(Math.floor(p / 400), TIERS.length - 1);
  const withinTier = p - tierIndex * 400;
  const division = Math.floor(withinTier / 100);
  const lp = withinTier - division * 100;
  const tier = TIERS[tierIndex];
  return {
    tier,
    label: `${TIER_LABELS[tier]} ${DIVISION_LABELS[division]} · ${lp}LP`,
  };
}

// "플3", "에1" 같은 커뮤니티식 축약 표기 (모바일 차트 축 등 좁은 공간용)
export const TIER_SHORT: Record<string, string> = {
  IRON: "아",
  BRONZE: "브",
  SILVER: "실",
  GOLD: "골",
  PLATINUM: "플",
  EMERALD: "에",
  DIAMOND: "다",
  MASTER: "마",
  GRANDMASTER: "그마",
  CHALLENGER: "챌",
};

/** MMR 포인트를 "플3" 형태의 축약 라벨로 변환 */
export function pointsToShortLabel(points: number): string {
  const p = Math.max(0, Math.round(points));
  const { tier } = pointsToRank(p);
  const short = TIER_SHORT[tier] ?? tier;
  if (p >= 2800) return short; // 마스터 이상은 티어만
  const division = Math.floor((p - Math.floor(p / 400) * 400) / 100);
  return `${short}${DIVISION_LABELS[division]}`;
}

export const TIER_COLORS: Record<string, string> = {
  IRON: "#7b7b73",
  BRONZE: "#a46628",
  SILVER: "#95a1a5",
  GOLD: "#e7c04c",
  PLATINUM: "#4d9e94",
  EMERALD: "#2ea25e",
  DIAMOND: "#5e8de0",
  MASTER: "#a75ce0",
  GRANDMASTER: "#d94848",
  CHALLENGER: "#e8b45e",
};
