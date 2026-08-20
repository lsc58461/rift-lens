import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  ensureQueuedAndSchedule,
  getDeepJob,
  getFreshDeepResult,
  getLatestMatchId,
  isJobStale,
  runDeepAnalysis,
} from "@/lib/mmr/deep-jobs";
import { PLATFORM_LABELS, type PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";
// 정밀 분석은 개발 키 기준 3~4분 — after() 백그라운드 작업도 이 제한을 따른다
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const region = sp.get("region") ?? "";
  const gameName = sp.get("gameName") ?? "";
  const tagLine = sp.get("tagLine") ?? "";
  if (!(region in PLATFORM_LABELS) || !gameName || !tagLine) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  const platform = region as PlatformRegion;

  try {
    const latestMatchId = await getLatestMatchId(platform, gameName, tagLine);
    if (await getFreshDeepResult(platform, gameName, tagLine, latestMatchId)) {
      return NextResponse.json({ state: "done", progress: 1 });
    }

    const job = await getDeepJob(platform, gameName, tagLine);
    if (job && !isJobStale(job)) {
      if (job.state === "running") {
        return NextResponse.json({ state: "running", progress: job.progress });
      }
      if (job.state === "error") {
        return NextResponse.json({ state: "error", progress: 0 });
      }
      // done인데 신선한 결과가 없으면 새 경기가 생긴 것 — 아래로 내려가 재시작
    }

    // 대기열 등록 + 스케줄링: 락이 비어 있으면 (내 것이든 아니든) 헤드의 잡을 시작
    const sched = await ensureQueuedAndSchedule(
      platform,
      gameName,
      tagLine,
      (p, g, t) => after(() => runDeepAnalysis(p, g, t)),
    );
    if (sched.selfStarted) {
      return NextResponse.json({ state: "running", progress: 0 });
    }
    return NextResponse.json({
      state: "queued",
      progress: 0,
      ahead: sched.ahead,
    });
  } catch {
    return NextResponse.json({ state: "error", progress: 0 });
  }
}
