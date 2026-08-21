import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { listSummonerStates } from "@/lib/admin-summoners";
import { getRunnerStatus, listQueue } from "@/lib/mmr/deep-jobs";
import { getRateLimitStatus } from "@/lib/riot/rate-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 실행 중·대기열은 deep-jobs가 제공한다 — 어드민이 규칙을 따로 구현하면
  // 실제 스케줄러가 보는 대기열과 어긋난다(하트비트 끊긴 상위 순번이 숨는 문제)
  const [running, waiting, rate, summonerStates] = await Promise.all([
    getRunnerStatus(),
    listQueue(),
    getRateLimitStatus(),
    listSummonerStates(),
  ]);

  // 대시보드에는 개요만 싣는다 — 전체 목록은 /api/admin/summoners에서
  // 페이지 단위로 받아 목록이 커져도 응답이 무거워지지 않게 한다
  const summoners = summonerStates.slice(0, 10);
  const summonerCounts = summonerStates.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.analysis] = (acc[s.analysis] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return NextResponse.json({
    running,
    waiting,
    rate,
    summoners,
    summonerTotal: summonerStates.length,
    summonerCounts,
    serverTime: Date.now(),
  });
}
