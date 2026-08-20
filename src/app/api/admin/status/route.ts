import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { canon } from "@/lib/identity";
import { getRunnerStatus, listQueue } from "@/lib/mmr/deep-jobs";
import { ALGO_VERSION } from "@/lib/mmr/estimate";
import { getRecentSearches } from "@/lib/recent";
import { getRateLimitStatus } from "@/lib/riot/rate-status";
import { listAnalysesMeta } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  // 실행 중·대기열은 deep-jobs가 제공한다 — 어드민이 규칙을 따로 구현하면
  // 실제 스케줄러가 보는 대기열과 어긋난다(하트비트 끊긴 상위 순번이 숨는 문제)
  const [running, waiting, rate, recent] = await Promise.all([
    getRunnerStatus(),
    listQueue(),
    getRateLimitStatus(),
    getRecentSearches(),
  ]);

  // 기록된 소환사 전체(최근 검색 기준) + 분석 보유·스테일 상태.
  // 스테일 판정은 저장 데이터 간 비교(정밀 vs 빠른의 매치 기준, 알고리즘 버전)로,
  // 라이엇 API 호출 없이 계산한다 — 실제 새 경기 여부까지는 알 수 없음.
  interface StoredMeta {
    latestMatchId?: string | null;
    algoVersion?: number;
    analyzedAt?: number;
  }
  const metas = await listAnalysesMeta();
  const quickMap = new Map<string, StoredMeta>();
  const deepMap = new Map<string, StoredMeta>();
  for (const m of metas) {
    const id = `${m.platform}:${m.game_name_lower}#${m.tag_line_lower}`;
    const meta: StoredMeta = {
      latestMatchId: m.latest_match_id,
      algoVersion: m.algo_version ?? undefined,
      analyzedAt: m.analyzed_at ? new Date(m.analyzed_at).getTime() : undefined,
    };
    (m.kind === "deep" ? deepMap : quickMap).set(id, meta);
  }

  const summoners = recent.map((r) => {
    const id = `${r.region}:${canon(r.gameName)}#${canon(r.tagLine)}`;
    const quick = quickMap.get(id);
    const deep = deepMap.get(id);
    const FRESH_AGE_MS = 72 * 60 * 60_000;
    const isCurrent = (m: StoredMeta) =>
      (m.algoVersion ?? 0) === ALGO_VERSION &&
      now - (m.analyzedAt ?? 0) <= FRESH_AGE_MS;
    let analysis: "deep" | "deep-stale" | "quick" | "quick-stale" | "none";
    if (deep) {
      // 정밀이 빠른보다 나중에 분석됐으면 정밀이 최신 — 매치 ID가 달라도 스테일 아님.
      // 빠른이 더 나중이고 매치 기준까지 다를 때만 정밀이 뒤처진 것으로 본다.
      const behindQuick =
        !!quick &&
        (quick.analyzedAt ?? 0) > (deep.analyzedAt ?? 0) &&
        quick.latestMatchId !== deep.latestMatchId;
      analysis = isCurrent(deep) && !behindQuick ? "deep" : "deep-stale";
    } else if (quick) {
      analysis = isCurrent(quick) ? "quick" : "quick-stale";
    } else {
      analysis = "none";
    }
    return {
      region: r.region,
      name: `${r.gameName}#${r.tagLine}`,
      currentLabel: r.currentLabel,
      estimatedLabel: r.estimatedLabel,
      searchedAt: r.searchedAt,
      analysis,
    };
  });

  return NextResponse.json({
    running,
    waiting,
    rate,
    summoners,
    serverTime: now,
  });
}
