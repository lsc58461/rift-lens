// MMR 추정 파이프라인.
// 1) 최근 솔로랭크 매치를 가져와 리메이크(5분 미만)를 제외하고
// 2) 각 매치에서 팀별로 고르게 뽑은 참가자들의 "현재 랭크"로 로비 절사평균을 구한 뒤
// 3) 오래된 경기부터 순서대로 [로비 관측 보정 → Elo 승패 업데이트]를 반복해
//    최종 레이팅을 추정한다. 로비 평균 = 매치메이커가 본 내 실력, Elo = 기대 대비 승패 성과.
//
// 개발용 API 키(2분당 100회) 안에서 동작하도록 매치 수와 참가자 샘플 수를 제한한다.

import "server-only";
import {
  getAccountByRiotId,
  getLeagueEntries,
  getMatch,
  getRankedMatchIds,
  getSummoner,
} from "@/lib/riot/client";
import type { LeagueEntry, MatchInfo, PlatformRegion } from "@/lib/riot/types";
import { pointsToRank, rankToPoints, type RankLabel } from "./rank";

// 알고리즘이 바뀔 때 올린다 — 저장된 분석 결과의 버전이 다르면 재분석된다
// v4: 듀오 금지 구간(한국 마스터+, 전서버 그마+)은 듀오 감지 비활성화
export const ALGO_VERSION = 4;

const MIN_GAME_DURATION = 300; // 5분 미만은 리메이크로 간주하고 제외
const OBS_WEIGHT = 0.35; // 로비 평균(매치메이커 관측)을 레이팅에 반영하는 비율
const ELO_K = 32; // Elo 승패 업데이트 K-팩터 (디비전 100pt 스케일 기준)
const DUO_APPEARANCE_THRESHOLD = 2; // 같은 팀에 이 횟수 이상 등장하면 듀오로 간주
const MIN_MATCHES_AFTER_DUO_FILTER = 4; // 듀오 제외 후 이보다 적게 남으면 제외 포기

export interface AnalysisDepth {
  matches: number; // 분석할 경기 수
  samplesPerTeam: number; // 매치당 팀별 랭크 조회 인원
}

// 빠른 추정: 개발 키(2분당 100회)로도 수 초 안에 끝나는 표본
export const QUICK_DEPTH: AnalysisDepth = { matches: 8, samplesPerTeam: 3 };
// 정밀 분석: 30경기 × 팀당 5명(매치당 10명).
// 원래 Vercel 300초 제한 때문에 20경기×3명으로 깎았던 값을, 자체 서버로 옮겨
// 타임아웃이 사라지고(50:10 한도·매치 저장 재분석) 정확도를 되올린 값.
//  - samplesPerTeam 5: 경기별 로비 평균의 표본오차를 직접 줄인다(정확도 최대 레버).
//  - matches 30: 관측을 늘려 신뢰구간을 좁히고 추이 그래프를 길게 한다.
// 비용은 상대 랭크 조회가 늘어 정밀 분석 소요가 길어지지만, 빠른 추정이 먼저
// 화면을 채우므로 유저 체감 지연은 없다(정밀 결과만 늦게 갱신).
export const DEEP_DEPTH: AnalysisDepth = { matches: 30, samplesPerTeam: 5 };

/** 리메이크 제외분을 감안해 여유 있게 조회할 매치 ID 수 */
export function fetchCountFor(depth: AnalysisDepth): number {
  return Math.min(depth.matches + Math.ceil(depth.matches / 4), 100);
}

export interface MatchSample {
  matchId: string;
  gameCreation: number;
  win: boolean;
  championName: string;
  kda: string;
  lobbyPoints: number | null; // 로비 절사평균 MMR 포인트 (표본 없으면 null)
  sampleSize: number;
  ratingAfter: number | null; // 이 경기까지 반영한 추정 레이팅 (그래프용)
  suspectedDuo: boolean; // 듀오 추정 경기 — 분석에서 제외됨
}

export interface MmrEstimate {
  algoVersion: number;
  analyzedAt?: number; // 분석 시각 — 신선도 판정(24h)용, 구버전 결과엔 없음
  account: { gameName: string; tagLine: string };
  latestMatchId: string | null; // 분석 시점의 최신 경기 ID — 재분석 필요 여부 판단용
  profileIconId?: number | null; // 구버전 저장 결과에는 없을 수 있음
  summonerLevel?: number | null;
  soloEntry: LeagueEntry | null;
  currentPoints: number | null;
  currentRank: RankLabel | null;
  estimatedPoints: number | null;
  estimatedRank: RankLabel | null;
  errorMargin: number | null; // 로비 표본 분산 기반 95% 오차범위(±pt)
  gap: number | null; // 추정 - 현재 (양수면 티어보다 실력이 높다는 뜻)
  recentWinrate: number | null;
  recentStreak: number; // 최근 연승(+)/연패(-)
  matches: MatchSample[];
  sampledPlayers: number;
  duoExcludedCount: number; // 분석에서 제외된 듀오 추정 경기 수
  confidence: "high" | "medium" | "low";
}

function soloQueueEntry(entries: LeagueEntry[]): LeagueEntry | null {
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
}

/** 매치에서 본인을 제외하고 팀별로 고르게 참가자를 샘플링 */
function sampleParticipants(
  match: MatchInfo,
  selfPuuid: string,
  samplesPerTeam: number,
) {
  const others = match.participants.filter((p) => p.puuid !== selfPuuid);
  const byTeam = new Map<number, typeof others>();
  for (const p of others) {
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  return [...byTeam.values()].flatMap((team) => team.slice(0, samplesPerTeam));
}

/** 절사평균: 표본이 5명 이상이면 최고/최저 1명씩 제외 (부캐·복귀 유저 이상치 완화) */
function trimmedMean(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

/**
 * 분석 창 선택: 풀 전체에서 듀오(같은 팀 반복 등장)를 감지하고,
 * 최신 경기부터 비듀오 경기가 목표 수에 도달할 때까지의 구간을 반환한다.
 * (구간 안의 듀오 경기는 플래그와 함께 포함돼 표시용으로 쓰인다)
 */
function selectAnalysisWindow(
  pool: MatchInfo[],
  selfPuuid: string,
  targetNonDuo: number,
): { window: MatchInfo[]; duoFlags: boolean[] } {
  const teammateCounts = new Map<string, number>();
  for (const m of pool) {
    const self = m.participants.find((p) => p.puuid === selfPuuid);
    if (!self) continue;
    for (const p of m.participants) {
      if (p.puuid !== selfPuuid && p.teamId === self.teamId) {
        teammateCounts.set(p.puuid, (teammateCounts.get(p.puuid) ?? 0) + 1);
      }
    }
  }
  const duoPuuids = new Set(
    [...teammateCounts]
      .filter(([, count]) => count >= DUO_APPEARANCE_THRESHOLD)
      .map(([puuid]) => puuid),
  );
  const isDuo = (m: MatchInfo): boolean => {
    const self = m.participants.find((p) => p.puuid === selfPuuid);
    if (!self) return false;
    return m.participants.some(
      (p) =>
        p.puuid !== selfPuuid &&
        p.teamId === self.teamId &&
        duoPuuids.has(p.puuid),
    );
  };

  const window: MatchInfo[] = [];
  const duoFlags: boolean[] = [];
  let nonDuo = 0;
  for (const m of pool) {
    const duo = isDuo(m);
    window.push(m);
    duoFlags.push(duo);
    if (!duo && ++nonDuo >= targetNonDuo) break;
  }
  return { window, duoFlags };
}

export async function estimateMmr(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  depth: AnalysisDepth = QUICK_DEPTH,
  onProgress?: (done: number, total: number) => void,
): Promise<MmrEstimate> {
  const account = await getAccountByRiotId(platform, gameName, tagLine);
  const [entries, matchIds, summoner] = await Promise.all([
    // 본인 랭크는 캐시 우회 — 표시되는 "현재 티어"는 항상 최신이어야 한다
    getLeagueEntries(platform, account.puuid, true),
    getRankedMatchIds(platform, account.puuid, fetchCountFor(depth)),
    getSummoner(platform, account.puuid).catch(() => null),
  ]);

  const solo = soloQueueEntry(entries);
  const currentPoints = solo
    ? rankToPoints(solo.tier, solo.rank, solo.leaguePoints)
    : null;

  // 라이엇이 일부 매치를 빈 껍데기(404 처리)로 주는 경우가 있다 — 그 경기
  // 하나 때문에 분석 전체가 실패하지 않도록 개별 실패는 건너뛴다
  const allMatches = (
    await Promise.all(
      matchIds.map((id) => getMatch(platform, id).catch(() => null)),
    )
  ).filter((m): m is NonNullable<typeof m> => m !== null);
  let pool = allMatches.filter((m) => m.gameDuration >= MIN_GAME_DURATION);

  // 듀오 감지 비활성화 구간: 한국 서버는 마스터+, 전 서버 그랜드마스터+가
  // 듀오 금지라 반복 등장 = 좁은 최상위 풀에서의 자연스러운 재매칭(오탐)이다.
  const noDuoTiers =
    platform === "kr"
      ? ["MASTER", "GRANDMASTER", "CHALLENGER"]
      : ["GRANDMASTER", "CHALLENGER"];
  const duoDetectionEnabled = !(solo && noDuoTiers.includes(solo.tier));

  let matches: MatchInfo[];
  let duoFlags: boolean[];
  if (!duoDetectionEnabled) {
    matches = pool.slice(0, depth.matches);
    duoFlags = matches.map(() => false);
  } else {
    // 듀오 경기는 로비가 파트너 MMR에 영향을 받아 추정을 오염시키므로 분석에서 뺀다.
    // 비듀오 경기가 목표 수에 못 미치면 풀을 2배로 늘려(백필) 더 과거 경기로 채운다.
    ({ window: matches, duoFlags } = selectAnalysisWindow(
      pool,
      account.puuid,
      depth.matches,
    ));
    const nonDuoCount = () => duoFlags.filter((d) => !d).length;
    if (nonDuoCount() < depth.matches) {
      const maxPool = Math.min(fetchCountFor(depth) * 2, 100);
      const moreIds = await getRankedMatchIds(platform, account.puuid, maxPool);
      if (moreIds.length > matchIds.length) {
        const extra = (
          await Promise.all(
            moreIds
              .slice(matchIds.length)
              .map((id) => getMatch(platform, id).catch(() => null)),
          )
        ).filter((m): m is NonNullable<typeof m> => m !== null);
        pool = [
          ...pool,
          ...extra.filter((m) => m.gameDuration >= MIN_GAME_DURATION),
        ];
        ({ window: matches, duoFlags } = selectAnalysisWindow(
          pool,
          account.puuid,
          depth.matches,
        ));
      }
    }
    // 백필 후에도 비듀오 표본이 너무 적으면(상시 듀오 유저) 제외를 포기한다
    if (nonDuoCount() < MIN_MATCHES_AFTER_DUO_FILTER) {
      matches = pool.slice(0, depth.matches);
      duoFlags = matches.map(() => false);
    }
  }

  // 조회할 참가자 puuid를 매치 전체에서 모아 중복 제거 후 한 번씩만 조회
  // (듀오 제외 경기는 랭크 조회도 생략해 API 호출을 아낀다)
  const sampledByMatch = matches.map((m, i) =>
    duoFlags[i] ? [] : sampleParticipants(m, account.puuid, depth.samplesPerTeam),
  );
  const uniquePuuids = [...new Set(sampledByMatch.flat().map((p) => p.puuid))];

  const pointsByPuuid = new Map<string, number>();
  let progressDone = 0;
  await Promise.all(
    uniquePuuids.map(async (puuid) => {
      try {
        const entry = soloQueueEntry(await getLeagueEntries(platform, puuid));
        if (entry) {
          pointsByPuuid.set(
            puuid,
            rankToPoints(entry.tier, entry.rank, entry.leaguePoints),
          );
        }
      } catch {
        // 일부 참가자 조회 실패는 표본에서 제외하고 계속 진행
      } finally {
        onProgress?.(++progressDone, uniquePuuids.length);
      }
    }),
  );

  // match-v5는 최신순 반환 — 표시용 배열도 최신순 유지
  const matchSamples: MatchSample[] = matches.map((m, i) => {
    const self = m.participants.find((p) => p.puuid === account.puuid);
    const sampled = sampledByMatch[i]
      .map((p) => pointsByPuuid.get(p.puuid))
      .filter((v): v is number => v !== undefined);
    return {
      matchId: m.matchId,
      gameCreation: m.gameCreation,
      win: self?.win ?? false,
      championName: self?.championName ?? "",
      kda: self ? `${self.kills}/${self.deaths}/${self.assists}` : "",
      lobbyPoints: trimmedMean(sampled),
      sampleSize: sampled.length,
      ratingAfter: null,
      suspectedDuo: duoFlags[i],
    };
  });

  // 오래된 경기부터 순차 추정:
  //  - 로비 평균이 있으면 관측 보정(레이팅을 로비 쪽으로 OBS_WEIGHT만큼 이동)
  //  - 이어서 Elo 업데이트: 로비가 강할수록 승리 가치가 커진다
  let rating: number | null = null;
  for (const s of [...matchSamples].reverse()) {
    if (s.suspectedDuo) {
      // 듀오 추정 경기는 레이팅 업데이트 없이 이전 값을 유지
      s.ratingAfter = rating !== null ? Math.round(rating) : null;
      continue;
    }
    if (s.lobbyPoints !== null) {
      rating =
        rating === null
          ? s.lobbyPoints
          : rating + OBS_WEIGHT * (s.lobbyPoints - rating);
    }
    if (rating !== null) {
      const opponent = s.lobbyPoints ?? rating;
      const expected = 1 / (1 + Math.pow(10, (opponent - rating) / 400));
      rating += ELO_K * ((s.win ? 1 : 0) - expected);
    }
    s.ratingAfter = rating !== null ? Math.round(rating) : null;
  }
  const estimatedPoints = rating;

  // 로비 평균들의 표준오차 기반 95% 오차범위
  const lobbies = matchSamples
    .map((s) => s.lobbyPoints)
    .filter((v): v is number => v !== null);
  let errorMargin: number | null = null;
  if (lobbies.length >= 2) {
    const mean = lobbies.reduce((a, b) => a + b, 0) / lobbies.length;
    const variance =
      lobbies.reduce((a, v) => a + (v - mean) ** 2, 0) / (lobbies.length - 1);
    errorMargin = Math.round((1.96 * Math.sqrt(variance)) / Math.sqrt(lobbies.length));
  }

  const analyzed = matchSamples.filter((s) => !s.suspectedDuo);
  const played = analyzed.length;
  const wins = analyzed.filter((s) => s.win).length;
  const recentWinrate = played ? wins / played : null;

  // 최근 연승/연패 — 최신 경기부터 연속 (양수=연승, 음수=연패)
  let recentStreak = 0;
  for (const s of matchSamples) {
    if (recentStreak === 0) recentStreak = s.win ? 1 : -1;
    else if (s.win && recentStreak > 0) recentStreak++;
    else if (!s.win && recentStreak < 0) recentStreak--;
    else break;
  }

  const totalSamples = matchSamples.reduce((a, s) => a + s.sampleSize, 0);
  // 표본 최대치가 커졌으므로(30경기×팀당5=매치당10 → 최대 ~300) 신뢰도 임계도
  // 비례 상향한다. 예전 30/15는 옛 최대(120) 기준이라 지금은 거의 항상 high였다.
  const confidence =
    totalSamples >= 80 ? "high" : totalSamples >= 40 ? "medium" : "low";

  return {
    algoVersion: ALGO_VERSION,
    analyzedAt: Date.now(),
    account: { gameName: account.gameName, tagLine: account.tagLine },
    latestMatchId: matchIds[0] ?? null,
    profileIconId: summoner?.profileIconId ?? null,
    summonerLevel: summoner?.summonerLevel ?? null,
    soloEntry: solo,
    currentPoints,
    currentRank: currentPoints !== null ? pointsToRank(currentPoints) : null,
    estimatedPoints,
    estimatedRank:
      estimatedPoints !== null ? pointsToRank(estimatedPoints) : null,
    errorMargin,
    gap:
      estimatedPoints !== null && currentPoints !== null
        ? Math.round(estimatedPoints - currentPoints)
        : null,
    recentWinrate,
    recentStreak,
    matches: matchSamples,
    sampledPlayers: pointsByPuuid.size,
    duoExcludedCount: duoFlags.filter(Boolean).length,
    confidence,
  };
}
