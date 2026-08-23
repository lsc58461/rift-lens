import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { runRefreshSweep } from "@/lib/refresh-sweep";
import { purgeExpiredCache } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 새벽(트래픽 없는 시간) 크론 — 기록된 소환사 중 스테일한 결과를
// 실제 검색 흐름과 동일하게(빠른 추정 → 이어서 정밀 분석) 미리 갱신한다.
//
// Hobby 플랜은 크론 2개 한도라, 새벽 창(3~7시 KST)은 셀프 체이닝으로 커버한다:
// 작업이 남아 있으면 응답 후 자기 자신을 다시 호출해 릴레이를 잇고,
// 창이 끝나거나(22시 UTC) 할 일이 없으면 스스로 멈춘다.
// vercel.json crons: 18:00/19:00 UTC = 새벽 3시/4시 KST (19시는 체인 사망 대비 재시동)
const TIME_BUDGET_MS = 240_000; // maxDuration(300s)에서 여유를 둔 작업 예산
const DEEP_START_DEADLINE_MS = 45_000; // 이 시점 이후엔 정밀을 새로 시작하지 않음(시간 초과 방지)
const MAX_REFRESH = 10;
const CHAIN_WINDOW_UTC = { start: 18, end: 22 }; // KST 새벽 3시~7시

function inChainWindow(): boolean {
  const h = new Date().getUTCHours();
  return h >= CHAIN_WINDOW_UTC.start && h < CHAIN_WINDOW_UTC.end;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? MAX_REFRESH),
    MAX_REFRESH,
  );

  const started = Date.now();
  const sweep = await runRefreshSweep({
    limit,
    budgetMs: TIME_BUDGET_MS,
    deepDeadlineMs: DEEP_START_DEADLINE_MS,
  });
  const { quickRefreshed, deepCompleted, deepBlocked, deepPending, brokeEarly, skipped, failed } = sweep;

  // 셀프 체이닝: 실제로 일을 했고(무한 스핀 방지), 작업이 남았고, 새벽 창 안이면
  // 응답을 보낸 뒤 자기 자신을 다시 호출해 릴레이를 잇는다.
  const didWork = quickRefreshed.length > 0 || deepCompleted > 0;
  const workRemaining = brokeEarly || deepPending;
  const chained = didWork && workRemaining && inChainWindow();
  if (chained) {
    // 주의: req origin은 해시 붙은 배포 URL이라 Vercel 인증 보호에 막힌다 —
    // 반드시 공개 도메인으로 재호출해야 체인이 이어진다 (로컬 테스트만 예외)
    const origin =
      req.nextUrl.hostname === "localhost"
        ? req.nextUrl.origin
        : "https://rift-lens.xyz";
    const url = new URL("/api/cron/refresh", origin);
    const secret = process.env.CRON_SECRET;
    after(() =>
      fetch(url, {
        headers: { authorization: `Bearer ${secret}` },
      }).catch(() => {}),
    );
  }

  // 만료된 캐시 행 정리 (누적 방지 — API 호출 없음)
  // 방문 로그는 지우지 않는다 — 데이터는 영구 보관이 원칙 (2026-08-22).
  // 만료 캐시는 데이터가 아니라 재계산 가능한 잔여물이라 청소 유지.
  // Redis 캐시 환경에선 cache_entries를 쓰지 않으므로(TTL 자체 만료) 건너뛴다.
  const cachePurged = process.env.REDIS_URL
    ? 0
    : await purgeExpiredCache().catch(() => 0);

  return NextResponse.json({
    cachePurged,
    quickRefreshed,
    deepCompleted,
    deepBlocked,
    deepPending,
    brokeEarly,
    remaining: brokeEarly || deepPending,
    skipped,
    failed,
    chained,
    tookMs: Date.now() - started,
  });
}
