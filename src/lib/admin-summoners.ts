// 관리자용 소환사 목록 — 상태 판정·검색·필터·페이징을 모두 SQL에서 끝낸다.
//
// 예전엔 전체 행을 앱으로 끌어와 JS에서 계산했는데, 목록이 커지자 어드민
// 대시보드(5초 폴링)가 매번 전량을 훑어 매우 느려졌다.

import "server-only";
import { ALGO_VERSION } from "@/lib/mmr/estimate";
import {
  adminSummonerCounts,
  adminSummonerPage,
  hourlyVisitStats,
  tierDistribution,
  type AdminAnalysisState,
  type AdminSummonerRow,
} from "@/lib/store";

export type AnalysisState = AdminAnalysisState;
export type SummonerRow = AdminSummonerRow;

export interface SummonerPage {
  items: SummonerRow[];
  total: number; // 검색·필터 적용 후 개수
  totalAll: number; // 검색만 적용한 전체 개수
  counts: Record<string, number>;
  page: number;
  size: number;
}

export async function getSummonerPage(opts: {
  page?: number;
  size?: number;
  q?: string;
  filter?: AnalysisState | "all";
}): Promise<SummonerPage> {
  const size = Math.min(100, Math.max(10, Math.floor(opts.size ?? 50)));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = (opts.q ?? "").trim();
  const filter = opts.filter ?? "all";

  const [{ rows, total }, counts] = await Promise.all([
    adminSummonerPage(ALGO_VERSION, q, filter, size, (page - 1) * size),
    adminSummonerCounts(ALGO_VERSION, q),
  ]);

  return {
    items: rows,
    total,
    totalAll: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    page,
    size,
  };
}

// 대시보드 통계는 5초 폴링에 비해 훨씬 느리게 변한다 — 인스턴스 메모리에
// 잠깐 캐시해 폴링마다 집계 쿼리가 도는 것을 막는다.
const STATS_TTL_MS = 60_000;
let statsCache: {
  at: number;
  tiers: Awaited<ReturnType<typeof tierDistribution>>;
  hourly: Awaited<ReturnType<typeof hourlyVisitStats>>;
} | null = null;

export async function getDashboardStats() {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
    return { tiers: statsCache.tiers, hourly: statsCache.hourly };
  }
  const [tiers, hourly] = await Promise.all([
    tierDistribution().catch(() => []),
    hourlyVisitStats(30).catch(() => []),
  ]);
  statsCache = { at: Date.now(), tiers, hourly };
  return { tiers, hourly };
}
