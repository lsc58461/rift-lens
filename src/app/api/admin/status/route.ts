import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getDashboardStats, getSummonerPage } from "@/lib/admin-summoners";
import { getRunnerStatus, listQueue } from "@/lib/mmr/deep-jobs";
import { getRateLimitStatus } from "@/lib/riot/rate-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 이 라우트는 대시보드가 2초마다 폴링한다 — 무거운 집계를 넣지 말 것.
  // 목록은 최근 10명만, 상태별 개수는 SQL 집계, 통계는 60초 캐시를 쓴다.
  const [running, waiting, rate, top, stats] = await Promise.all([
    getRunnerStatus(),
    listQueue(),
    getRateLimitStatus(),
    getSummonerPage({ page: 1, size: 10 }),
    getDashboardStats(),
  ]);

  return NextResponse.json({
    running,
    waiting,
    rate,
    summoners: top.items,
    summonerTotal: top.totalAll,
    summonerCounts: top.counts,
    tiers: stats.tiers,
    hourly: stats.hourly,
    serverTime: Date.now(),
  });
}
