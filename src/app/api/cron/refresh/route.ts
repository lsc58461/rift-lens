import { NextResponse, type NextRequest } from "next/server";
import { runRefreshSweep, type SweepResult } from "@/lib/refresh-sweep";
import { purgeExpiredCache } from "@/lib/store";

export const dynamic = "force-dynamic";

// 새벽(트래픽 없는 시간) 크론 — 기록된 소환사 중 스테일한 결과를
// 실제 검색 흐름과 동일하게(빠른 추정 → 이어서 정밀 분석) 미리 갱신한다.
//
// 자체 서버라 실행 시간 제한이 없으므로, 서버리스 시절의 셀프 체이닝
// (300초 한도 + 크론 2개 한도 우회용 HTTP 릴레이) 대신 핸들러 안에서
// 작업이 끝나거나 새벽 창이 닫힐 때까지 스윕을 반복한다.
// 호출: /etc/cron.d/riftlens → 18:00 UTC(새벽 3시 KST), 넉넉한 타임아웃으로 curl
const SWEEP_BUDGET_MS = 240_000; // 스윕 한 사이클 예산 (내부 페이싱 단위)
const DEEP_START_DEADLINE_MS = 45_000; // 사이클 시작 후 이 시점부턴 정밀을 새로 안 잡음
const MAX_REFRESH = 10; // 사이클당 갱신 상한
const WINDOW_UTC = { start: 18, end: 22 }; // KST 새벽 3시~7시 — 이 창 안에서만 반복

function inWindow(): boolean {
  const h = new Date().getUTCHours();
  return h >= WINDOW_UTC.start && h < WINDOW_UTC.end;
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
  const quickRefreshed: string[] = [];
  let deepCompleted = 0;
  let skipped = 0;
  let failed = 0;
  let cycles = 0;
  let last: SweepResult | null = null;

  // 새벽 창 안에서 작업이 남아 있는 동안 반복. 창 밖(수동 호출)에선 1회만.
  do {
    last = await runRefreshSweep({
      limit,
      budgetMs: SWEEP_BUDGET_MS,
      deepDeadlineMs: DEEP_START_DEADLINE_MS,
    });
    quickRefreshed.push(...last.quickRefreshed);
    deepCompleted += last.deepCompleted;
    skipped += last.skipped;
    failed += last.failed;
    cycles++;
  } while (
    // 실제로 일을 했고(무한 스핀 방지) 작업이 남았고 창 안일 때만 계속
    (last.quickRefreshed.length > 0 || last.deepCompleted > 0) &&
    (last.brokeEarly || last.deepPending) &&
    inWindow()
  );

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
    deepBlocked: last?.deepBlocked ?? false,
    deepPending: last?.deepPending ?? false,
    brokeEarly: last?.brokeEarly ?? false,
    remaining: (last?.brokeEarly || last?.deepPending) ?? false,
    skipped,
    failed,
    cycles,
    tookMs: Date.now() - started,
  });
}
