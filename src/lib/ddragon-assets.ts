// Data Dragon 정적 에셋 URL 헬퍼 (순수 함수 — 클라이언트/서버 공용, server-only 아님).

// match-v5의 championName과 ddragon 파일명이 다른 예외들
export const NAME_QUIRKS: Record<string, string> = {
  FiddleSticks: "Fiddlesticks",
};

export function championIconUrl(version: string, championName: string): string {
  const key = NAME_QUIRKS[championName] ?? championName;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`;
}

export function profileIconUrl(version: string, iconId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`;
}

/** 티어 엠블럼 — CommunityDragon 원본의 투명 여백을 잘라내 public/에 저장해둔 로컬 에셋 */
export function tierEmblemUrl(tier: string): string {
  return `/ranked-emblems/${tier.toLowerCase()}.png`;
}

/** 아이템 아이콘 (id 0이면 빈 칸 → null) */
export function itemIconUrl(version: string, itemId: number): string | null {
  if (!itemId) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

// 소환사 주문 id → ddragon 파일 키
const SPELL_KEYS: Record<number, string> = {
  1: "SummonerBoost", // 정화
  3: "SummonerExhaust", // 탈진
  4: "SummonerFlash", // 점멸
  6: "SummonerHaste", // 유체화
  7: "SummonerHeal", // 회복
  11: "SummonerSmite", // 강타
  12: "SummonerTeleport", // 순간이동
  13: "SummonerMana", // 총명
  14: "SummonerDot", // 점화
  21: "SummonerBarrier", // 방어막
  32: "SummonerSnowball", // 마크(칼바람)
};

/** 소환사 주문 아이콘 */
export function spellIconUrl(version: string, spellId: number): string | null {
  const key = SPELL_KEYS[spellId];
  if (!key) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${key}.png`;
}

export function championNameKo(
  names: Record<string, string>,
  championName: string,
): string {
  return names[NAME_QUIRKS[championName] ?? championName] ?? championName;
}

/** 능력치 파편(StatMods) — runesReforged.json에 없어 정적 매핑 */
export const STAT_MODS: Record<number, { name: string; icon: string }> = {
  5001: { name: "체력 (성장)", icon: "perk-images/StatMods/StatModsHealthScalingIcon.png" },
  5002: { name: "방어력", icon: "perk-images/StatMods/StatModsArmorIcon.png" },
  5003: { name: "마법 저항력", icon: "perk-images/StatMods/StatModsMagicResIcon.MagicResist_Fix.png" },
  5005: { name: "공격 속도", icon: "perk-images/StatMods/StatModsAttackSpeedIcon.png" },
  5007: { name: "스킬 가속", icon: "perk-images/StatMods/StatModsCDRScalingIcon.png" },
  5008: { name: "적응형 능력치", icon: "perk-images/StatMods/StatModsAdaptiveForceIcon.png" },
  5010: { name: "이동 속도", icon: "perk-images/StatMods/StatModsMovementSpeedIcon.png" },
  5011: { name: "체력", icon: "perk-images/StatMods/StatModsHealthPlusIcon.png" },
  5013: { name: "강인함과 회복력", icon: "perk-images/StatMods/StatModsTenacityIcon.png" },
};
