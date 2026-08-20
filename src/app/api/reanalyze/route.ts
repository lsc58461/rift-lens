import { NextResponse, type NextRequest } from "next/server";
import { cache } from "@/lib/cache";
import { canon } from "@/lib/identity";
import {
  getDeepJob,
  getFreshDeepResult,
  getFreshQuickResult,
  getLatestMatchId,
  isJobStale,
} from "@/lib/mmr/deep-jobs";
import { PLATFORM_LABELS, type PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";

const COOLDOWN_SECONDS = 60;

// 매치 목록 캐시(10분)를 우회해 최신 경기를 강제 확인하고,
// 실제로 새 경기가 있을 때만 재분석이 필요하다고 알려준다.
// (분석 자체는 페이지 리로드 시 기존 흐름이 수행)
// 쿨다운은 소환사 단위로 서버(캐시 DB)에서 관리한다 — 클라이언트 우회 불가,
// 같은 소환사를 여러 사람이 연타해도 60초에 1번만 확인한다.
export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const region = sp.get("region") ?? "";
  const gameName = sp.get("gameName") ?? "";
  const tagLine = sp.get("tagLine") ?? "";
  if (!(region in PLATFORM_LABELS) || !gameName || !tagLine) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  const platform = region as PlatformRegion;

  // 정밀 분석이 진행 중이면 쿨다운을 태우지 않고 차단 — 어차피 곧 최신 결과가 나온다
  const job = await getDeepJob(platform, gameName, tagLine);
  if (job?.state === "running" && !isJobStale(job)) {
    return NextResponse.json({ changed: false, cooldown: 0, deepRunning: true });
  }

  const cdKey = `reanalyze-cd:${platform}:${canon(gameName)}#${canon(tagLine)}`;
  const startedAt = await cache.get<number>(cdKey);
  if (startedAt !== null) {
    const remaining = Math.max(
      1,
      Math.ceil((startedAt + COOLDOWN_SECONDS * 1000 - Date.now()) / 1000),
    );
    return NextResponse.json({ changed: false, cooldown: remaining });
  }
  await cache.set(cdKey, Date.now(), COOLDOWN_SECONDS);

  try {
    const latestMatchId = await getLatestMatchId(
      platform,
      gameName,
      tagLine,
      true, // 캐시 우회 — 방금 끝난 게임도 즉시 감지
    );
    const upToDate =
      (await getFreshDeepResult(platform, gameName, tagLine, latestMatchId)) !==
        null ||
      (await getFreshQuickResult(platform, gameName, tagLine, latestMatchId)) !==
        null;
    return NextResponse.json({
      changed: !upToDate,
      cooldown: COOLDOWN_SECONDS,
    });
  } catch {
    return NextResponse.json({ error: "riot api error" }, { status: 502 });
  }
}
