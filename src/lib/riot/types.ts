// 한국 서버 전용 서비스 — 다른 리전을 다시 열려면 여기에 추가하면
// 라우트 검증(`region in PLATFORM_LABELS`)까지 자동으로 풀린다.
export type PlatformRegion = "kr";
export type RoutingRegion = "asia";

export const PLATFORM_TO_ROUTING: Record<PlatformRegion, RoutingRegion> = {
  kr: "asia",
};

export const PLATFORM_LABELS: Record<PlatformRegion, string> = {
  kr: "한국",
};

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface LeagueEntry {
  queueType: string; // RANKED_SOLO_5x5 | RANKED_FLEX_SR | 그 외(프리메이드·이벤트)
  tier: string; // IRON..CHALLENGER
  rank: string; // I..IV
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak?: boolean;
  veteran?: boolean;
  freshBlood?: boolean;
  inactive?: boolean;
}

export interface MatchParticipant {
  puuid: string;
  riotIdGameName: string;
  riotIdTagline: string;
  teamId: number;
  win: boolean;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  teamPosition: string;
  // 전적 상세 (구버전 저장 매치엔 없을 수 있어 옵셔널)
  champLevel?: number;
  cs?: number;
  goldEarned?: number;
  damage?: number; // 챔피언 대상 딜량
  visionScore?: number;
  spell1Id?: number;
  spell2Id?: number;
  items?: number[]; // item0~6 (0은 빈 칸)
  keystone?: number; // 핵심룬 perk id — 룬 저장 도입(2026-08-22) 이전 매치엔 없음
  subStyle?: number; // 보조 룬 트리 style id
  perks?: number[]; // 주 트리 선택 4개 (핵심룬 포함, 순서대로)
  subPerks?: number[]; // 보조 트리 선택 2개
  statPerks?: number[]; // 능력치 파편 3개 (공격/유연/방어)

  // ── 확장 필드(2026-08-24~) — 이후 지표를 재수집 없이 뽑기 위한 선캡처.
  //    전부 옵셔널이라 도입 전 매치엔 없다. participants가 jsonb라 마이그레이션 불필요.
  championId?: number; // 숫자 챔피언 id (밴·매핑용, 이름과 별개)
  individualPosition?: string; // 개인 포지션(teamPosition과 다를 수 있음)
  csTotal?: number; // 미니언
  csJungle?: number; // 정글 몹 (csTotal과 합이 cs)
  goldSpent?: number;
  damageTaken?: number; // 받은 피해
  damageMitigated?: number; // 방어로 경감한 피해
  damageToObjectives?: number;
  damageToTurrets?: number;
  totalHeal?: number;
  healOnTeammates?: number;
  shieldOnTeammates?: number;
  ccScore?: number; // timeCCingOthers
  turretKills?: number;
  inhibitorKills?: number;
  dragonKills?: number;
  baronKills?: number;
  objectivesStolen?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  controlWardsBought?: number;
  largestKillingSpree?: number;
  largestMultiKill?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  firstBloodKill?: boolean;
  firstTowerKill?: boolean;
  killParticipation?: number; // challenges.killParticipation (0~1)
  soloKills?: number; // challenges.soloKills
  gameEndedInSurrender?: boolean;
  gameEndedInEarlySurrender?: boolean;
}

/** 팀별 오브젝트 요약 — 매치당 2팀(100/200) */
export interface MatchTeam {
  teamId: number;
  win: boolean;
  firstBlood?: boolean;
  firstTower?: boolean;
  dragon?: number;
  herald?: number;
  baron?: number;
  tower?: number;
  inhibitor?: number;
  atakhan?: number; // 신규 오브젝트 대비(있을 때만)
}

export interface MatchInfo {
  matchId: string;
  gameCreation: number;
  gameDuration: number;
  queueId: number;
  /** 패치 버전 앞 두 자리 (예: "15.16") — 저장 도입 전 매치엔 없음 */
  patch?: string;
  /** 양 팀 밴 챔피언 id 목록(밴 없으면 제외) — 밴률 집계용. 캡처 전 매치엔 없음 */
  bans?: number[];
  /** 팀별 오브젝트 요약 — 캡처 전 매치엔 없음 */
  teams?: MatchTeam[];
  /** 팀별 밴 상세(픽 순서) — match_bans 저장용. 옛 매치(플랫 bans만 있음)엔 없음 */
  teamBans?: { teamId: number; championId: number; pickTurn: number }[];
  participants: MatchParticipant[];
}

export class RiotApiError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`Riot API ${status}: ${url}`);
    this.name = "RiotApiError";
  }
}
