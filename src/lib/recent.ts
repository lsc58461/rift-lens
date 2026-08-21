// 최근 검색 기록 — recent_searches 테이블(소환사당 1행 upsert).

import "server-only";
import {
  listRecentSearches,
  upsertRecentSearch,
  type RecentSearchInput,
} from "./store";
import type { PlatformRegion } from "./riot/types";

export interface RecentEntry {
  region: PlatformRegion;
  gameName: string;
  tagLine: string;
  currentLabel: string | null;
  currentTier: string | null;
  estimatedLabel: string | null;
  estimatedTier: string | null;
  estimatedPoints: number | null;
  searchedAt: number;
}

const MAX_ENTRIES = 50; // 공개 "최근 검색" 페이지 기본 상한
const ADMIN_MAX_ENTRIES = 1000; // 관리자는 전체를 본다

export async function getRecentSearches(
  limit: number = MAX_ENTRIES,
): Promise<RecentEntry[]> {
  try {
    const rows = await listRecentSearches(Math.min(limit, ADMIN_MAX_ENTRIES));
    return rows.map((r) => ({
      region: r.platform,
      gameName: r.game_name,
      tagLine: r.tag_line,
      currentLabel: r.current_label,
      currentTier: r.current_tier,
      estimatedLabel: r.estimated_label,
      estimatedTier: r.estimated_tier,
      estimatedPoints: r.estimated_points,
      searchedAt: new Date(r.searched_at).getTime(),
    }));
  } catch {
    return [];
  }
}

/** 같은 소환사는 최신 기록으로 갱신된다 */
export async function recordSearch(
  entry: Omit<RecentEntry, "searchedAt" | "region"> & {
    region: PlatformRegion;
    puuid?: string | null; // 닉변 승계용 — 있으면 함께 저장
  },
): Promise<void> {
  try {
    const input: RecentSearchInput = {
      platform: entry.region,
      gameName: entry.gameName,
      tagLine: entry.tagLine,
      currentLabel: entry.currentLabel,
      currentTier: entry.currentTier,
      estimatedLabel: entry.estimatedLabel,
      estimatedTier: entry.estimatedTier,
      estimatedPoints: entry.estimatedPoints,
      puuid: entry.puuid ?? null,
    };
    await upsertRecentSearch(input);
  } catch {
    // 기록 실패는 검색 결과 표시에 영향을 주지 않는다
  }
}
