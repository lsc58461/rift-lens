// 관리자용 소환사 목록 — 기록된 소환사에 분석 보유·스테일 상태를 붙인다.
//
// 스테일 판정은 저장 데이터 간 비교(정밀 vs 빠른의 매치 기준, 알고리즘 버전,
// 분석 경과 시간)로 하며 라이엇 API를 호출하지 않는다 — 실제 새 경기 여부까지는
// 알 수 없지만 캐시 건강 상태를 보는 데는 충분하다.

import "server-only";
import { canon } from "@/lib/identity";
import { ALGO_VERSION } from "@/lib/mmr/estimate";
import { getRecentSearches } from "@/lib/recent";
import { listAnalysesMeta } from "@/lib/store";

export type AnalysisState =
  | "deep"
  | "deep-stale"
  | "quick"
  | "quick-stale"
  | "none";

export interface SummonerRow {
  region: string;
  name: string;
  currentLabel: string | null;
  estimatedLabel: string | null;
  searchedAt: number;
  analysis: AnalysisState;
}

interface StoredMeta {
  latestMatchId?: string | null;
  algoVersion?: number;
  analyzedAt?: number;
}

const FRESH_AGE_MS = 72 * 60 * 60_000;
const HARD_LIMIT = 1000;

/** 기록된 소환사 전체에 분석 상태를 매겨 최신 검색 순으로 반환 */
export async function listSummonerStates(): Promise<SummonerRow[]> {
  const now = Date.now();
  const [recent, metas] = await Promise.all([
    getRecentSearches(HARD_LIMIT),
    listAnalysesMeta(),
  ]);

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

  const isCurrent = (m: StoredMeta) =>
    (m.algoVersion ?? 0) === ALGO_VERSION &&
    now - (m.analyzedAt ?? 0) <= FRESH_AGE_MS;

  return recent.map((r) => {
    const id = `${r.region}:${canon(r.gameName)}#${canon(r.tagLine)}`;
    const quick = quickMap.get(id);
    const deep = deepMap.get(id);
    let analysis: AnalysisState;
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
}

export interface SummonerPage {
  items: SummonerRow[];
  total: number; // 검색·필터 적용 후 개수
  totalAll: number; // 전체 기록 수
  counts: Record<AnalysisState, number>; // 상태별 개수(필터 칩용, 검색만 반영)
  page: number;
  size: number;
}

/**
 * 검색·상태 필터를 적용한 뒤 한 페이지만 잘라 반환한다.
 * 브라우저로는 페이지 분량만 내려가므로 목록이 커져도 화면이 무거워지지 않는다.
 */
export async function getSummonerPage(opts: {
  page?: number;
  size?: number;
  q?: string;
  filter?: AnalysisState | "all";
}): Promise<SummonerPage> {
  const size = Math.min(100, Math.max(10, Math.floor(opts.size ?? 50)));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = (opts.q ?? "").trim().toLowerCase();
  const filter = opts.filter ?? "all";

  const all = await listSummonerStates();
  const searched = q
    ? all.filter((s) => s.name.toLowerCase().includes(q))
    : all;

  const counts: Record<AnalysisState, number> = {
    deep: 0,
    "deep-stale": 0,
    quick: 0,
    "quick-stale": 0,
    none: 0,
  };
  for (const s of searched) counts[s.analysis] += 1;

  const filtered =
    filter === "all" ? searched : searched.filter((s) => s.analysis === filter);
  const start = (page - 1) * size;

  return {
    items: filtered.slice(start, start + size),
    total: filtered.length,
    totalAll: all.length,
    counts,
    page,
    size,
  };
}
