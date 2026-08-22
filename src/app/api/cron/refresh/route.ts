import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  ensureQueuedAndSchedule,
  getFreshDeepResult,
  getFreshQuickResult,
  getLatestMatchId,
  runDeepAnalysis,
  runQuickAnalysis,
} from "@/lib/mmr/deep-jobs";
import { getRecentSearches } from "@/lib/recent";
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
  const elapsed = () => Date.now() - started;
  // 상한을 두면 그 뒤 소환사는 자동 갱신에서 영영 빠진다 — 전량 순회한다
  const recent = await getRecentSearches(Infinity); // 최근 검색 순

  const quickRefreshed: string[] = [];
  let deepCompleted = 0;
  let deepBlocked = false; // 러너 락이 다른 분석에 잡혀 있으면 이번 실행에선 정밀 생략
  let deepPending = false; // 시간 게이트에 걸려 정밀을 못 돌린 스테일 소환사가 남음
  let brokeEarly = false; // 예산/상한으로 순회를 중단함 — 다음 링크에서 이어서
  let skipped = 0;
  let failed = 0;

  for (const r of recent) {
    if (elapsed() > TIME_BUDGET_MS || quickRefreshed.length >= limit) {
      brokeEarly = true;
      break;
    }
    const name = `${r.gameName}#${r.tagLine}`;
    try {
      const latest = await getLatestMatchId(r.region, r.gameName, r.tagLine);
      if (await getFreshDeepResult(r.region, r.gameName, r.tagLine, latest)) {
        skipped++;
        continue;
      }

      // 1) 실제 흐름처럼 빠른 추정 먼저
      const quickFresh = await getFreshQuickResult(
        r.region,
        r.gameName,
        r.tagLine,
        latest,
      );
      if (!quickFresh) {
        await runQuickAnalysis(r.region, r.gameName, r.tagLine);
        quickRefreshed.push(name);
      }

      // 2) 이어서 정밀 분석 — 완료까지 기다린 뒤 다음 소환사로 (러너 락 존중)
      if (!deepBlocked && elapsed() < DEEP_START_DEADLINE_MS) {
        let deepRun: Promise<void> | null = null;
        await ensureQueuedAndSchedule(r.region, r.gameName, r.tagLine, (p, g, t) => {
          // 크론 갱신에서도 마일스톤 변화가 있으면 알림 발송
          deepRun = runDeepAnalysis(p, g, t);
        });
        if (deepRun) {
          await deepRun;
          deepCompleted++;
        } else {
          deepBlocked = true;
          deepPending = true;
        }
      } else {
        deepPending = true; // 이 소환사의 정밀은 다음 링크가 처리
      }
    } catch {
      failed++;
    }
  }

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
  const cachePurged = await purgeExpiredCache().catch(() => 0);

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
    tookMs: elapsed(),
  });
}
