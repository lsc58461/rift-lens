export type PlatformRegion = "kr" | "na1" | "euw1" | "eun1" | "jp1";
export type RoutingRegion = "asia" | "americas" | "europe";

export const PLATFORM_TO_ROUTING: Record<PlatformRegion, RoutingRegion> = {
  kr: "asia",
  jp1: "asia",
  na1: "americas",
  euw1: "europe",
  eun1: "europe",
};

export const PLATFORM_LABELS: Record<PlatformRegion, string> = {
  kr: "한국",
  jp1: "일본",
  na1: "북미",
  euw1: "유럽 서부",
  eun1: "유럽 동북",
};

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface LeagueEntry {
  queueType: string; // RANKED_SOLO_5x5 | RANKED_FLEX_SR
  tier: string; // IRON..CHALLENGER
  rank: string; // I..IV
  leaguePoints: number;
  wins: number;
  losses: number;
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
}

export interface MatchInfo {
  matchId: string;
  gameCreation: number;
  gameDuration: number;
  queueId: number;
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
