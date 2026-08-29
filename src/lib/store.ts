// 도메인 테이블 저장 계층. 신선도(TTL) 판단은 타임스탬프 컬럼 + 호출부 비교로 한다.
// puuid가 들어가는 테이블(summoners/matches/league_snapshots)은 API 키 지문(fp)으로 스코프.

import "server-only";
import { syncParticipantsFromMatch } from "@/lib/match-participants";
import { getSql } from "./db";
import { canon } from "./identity";
import type { MmrEstimate } from "./mmr/estimate";
import type { LeagueEntry, MatchInfo, PlatformRegion } from "./riot/types";

const fresh = (updatedAt: Date | string, maxAgeMs: number): boolean =>
  Date.now() - new Date(updatedAt).getTime() < maxAgeMs;

// ── 소환사 ──────────────────────────────────────────────

export interface SummonerRow {
  puuid: string;
  game_name: string;
  tag_line: string;
  profile_icon_id: number | null;
  summoner_level: number | null;
  updated_at: string;
}

export async function findSummonerByName(
  fp: string,
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  maxAgeMs: number,
): Promise<SummonerRow | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT puuid, game_name, tag_line, profile_icon_id, summoner_level, updated_at
    FROM summoners
    WHERE fp = ${fp} AND platform = ${platform}
      AND lower(normalize(game_name, NFKC)) = ${canon(gameName)}
      AND lower(normalize(tag_line, NFKC)) = ${canon(tagLine)}`;
  const row = rows[0] as SummonerRow | undefined;
  return row && fresh(row.updated_at, maxAgeMs) ? row : null;
}

export async function findSummonerByPuuid(
  fp: string,
  puuid: string,
): Promise<SummonerRow | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT puuid, game_name, tag_line, profile_icon_id, summoner_level, updated_at
    FROM summoners WHERE fp = ${fp} AND puuid = ${puuid}`;
  return (rows[0] as SummonerRow | undefined) ?? null;
}

export async function upsertSummonerNames(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
  gameName: string,
  tagLine: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO summoners (fp, puuid, platform, game_name, tag_line)
    VALUES (${fp}, ${puuid}, ${platform}, ${gameName}, ${tagLine})
    ON CONFLICT (fp, puuid) DO UPDATE
    SET game_name = EXCLUDED.game_name, tag_line = EXCLUDED.tag_line,
        platform = EXCLUDED.platform, updated_at = now()`;
}

export async function updateSummonerProfile(
  fp: string,
  puuid: string,
  profileIconId: number,
  summonerLevel: number,
): Promise<void> {
  const sql = await getSql();
  await sql`
    UPDATE summoners
    SET profile_icon_id = ${profileIconId}, summoner_level = ${summonerLevel},
        updated_at = now()
    WHERE fp = ${fp} AND puuid = ${puuid}`;
}

// ── 매치 (불변) ─────────────────────────────────────────

export async function getMatchRow(
  fp: string,
  matchId: string,
): Promise<MatchInfo | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT match_id, game_creation, game_duration, queue_id, participants
    FROM matches WHERE fp = ${fp} AND match_id = ${matchId}`;
  const r = rows[0];
  if (!r) return null;
  return {
    matchId: r.match_id as string,
    gameCreation: Number(r.game_creation),
    gameDuration: r.game_duration as number,
    queueId: r.queue_id as number,
    participants: r.participants as MatchInfo["participants"],
  };
}

export async function saveMatchRow(
  fp: string,
  platform: PlatformRegion,
  match: MatchInfo,
): Promise<void> {
  const sql = await getSql();
  const bans = sql.json((match.bans ?? []) as never);
  const teams = sql.json((match.teams ?? []) as never);
  await sql`
    INSERT INTO matches (fp, match_id, platform, game_creation, game_duration, queue_id, participants, patch, bans, teams, fields_captured)
    VALUES (${fp}, ${match.matchId}, ${platform}, ${match.gameCreation},
            ${match.gameDuration}, ${match.queueId}, ${sql.json(match.participants as never)},
            ${match.patch ?? null}, ${bans}, ${teams}, true)
    ON CONFLICT (fp, match_id) DO UPDATE
    SET participants = EXCLUDED.participants,
        patch = coalesce(EXCLUDED.patch, matches.patch),
        -- 밴·팀요약은 새 캡처가 있으면 갱신, 없으면(빈값) 기존 유지
        bans = CASE WHEN EXCLUDED.bans = '[]'::jsonb THEN matches.bans ELSE EXCLUDED.bans END,
        teams = CASE WHEN EXCLUDED.teams = '[]'::jsonb THEN matches.teams ELSE EXCLUDED.teams END,
        fields_captured = true`;
  // 참가자 정규화 테이블에도 함께 기록 (실패해도 원본 저장은 유효 — 백필이 메운다)
  await syncParticipantsFromMatch(fp, platform, match).catch((e) =>
    console.error("[participants] 이중 기록 실패", match.matchId, (e as Error)?.message),
  );
}

// ── 랭크 스냅샷 (히스토리 적재) ─────────────────────────

export async function latestLeagueSnapshot(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
  maxAgeMs: number,
): Promise<LeagueEntry[] | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT entries, created_at FROM league_snapshots
    WHERE fp = ${fp} AND platform = ${platform} AND puuid = ${puuid}
    ORDER BY created_at DESC LIMIT 1`;
  const r = rows[0];
  if (!r || !fresh(r.created_at as string, maxAgeMs)) return null;
  return r.entries as LeagueEntry[];
}

/** 최근 3일 스냅샷에서 그랜드마스터·챌린저의 실제 LP 컷(하위 5%)을 뽑는다.
 *  인원 컷 티어라 LP만으로는 못 정하는데, 표본이 많아 5% 분위수면 안정적이다. */
export async function apexCutoffsFromSnapshots(): Promise<{
  grandmaster: number;
  challenger: number;
} | null> {
  const sql = await getSql();
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (puuid) puuid, solo_tier, solo_lp
      FROM league_snapshots
      WHERE created_at > now() - interval '3 days'
        AND solo_tier IN ('GRANDMASTER', 'CHALLENGER') AND solo_lp IS NOT NULL
      ORDER BY puuid, created_at DESC)
    SELECT solo_tier AS tier, count(*)::int AS n,
           percentile_cont(0.05) WITHIN GROUP (ORDER BY solo_lp) AS cut
    FROM latest GROUP BY 1`;
  const m = new Map(
    (rows as unknown as { tier: string; n: number; cut: number }[]).map((r) => [r.tier, r]),
  );
  const gm = m.get("GRANDMASTER");
  const ch = m.get("CHALLENGER");
  if (!gm || !ch || gm.n < 30 || ch.n < 30) return null; // 표본 부족이면 기본값 유지
  return { grandmaster: Math.round(Number(gm.cut)), challenger: Math.round(Number(ch.cut)) };
}

export interface NearestRankSnap {
  puuid: string;
  at: number; // 요청한 기준 시각(ms)
  tier: string;
  rank: string | null;
  lp: number | null;
  snapAt: number; // 스냅샷 시각(ms)
}

/** (puuid, 경기 시각) 쌍마다 그 시각에 가장 가까운 솔로랭크 스냅샷을 돌려준다.
 *  라이엇은 과거 랭크를 안 주므로 우리가 분석하며 쌓은 스냅샷으로 "그때 티어"를
 *  복원한다 — 경기 전후 어느 쪽이든 가장 가까운 것. 없으면 항목이 빠진다. */
export async function nearestRankSnapshots(
  fp: string,
  platform: PlatformRegion,
  pairs: { puuid: string; at: number }[],
): Promise<Map<string, NearestRankSnap>> {
  const out = new Map<string, NearestRankSnap>();
  if (pairs.length === 0) return out;
  const sql = await getSql();
  const rows = await sql`
    SELECT q.puuid, q.at, s.solo_tier, s.solo_rank, s.solo_lp,
           (extract(epoch from s.created_at) * 1000)::bigint AS snap_at
    FROM jsonb_to_recordset(${sql.json(pairs as never)}) AS q(puuid text, at bigint)
    CROSS JOIN LATERAL (
      SELECT solo_tier, solo_rank, solo_lp, created_at FROM league_snapshots l
      WHERE l.fp = ${fp} AND l.platform = ${platform} AND l.puuid = q.puuid
        AND l.solo_tier IS NOT NULL
      ORDER BY abs(extract(epoch from l.created_at) * 1000 - q.at) LIMIT 1
    ) s`;
  for (const r of rows as unknown as {
    puuid: string; at: string | number; solo_tier: string; solo_rank: string | null;
    solo_lp: number | null; snap_at: string | number;
  }[]) {
    out.set(`${r.puuid}|${r.at}`, {
      puuid: r.puuid,
      at: Number(r.at),
      tier: r.solo_tier,
      rank: r.solo_rank,
      lp: r.solo_lp,
      snapAt: Number(r.snap_at),
    });
  }
  return out;
}

export async function insertLeagueSnapshot(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
  entries: LeagueEntry[],
): Promise<void> {
  const sql = await getSql();
  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  const tier = solo?.tier ?? null;
  const rank = solo?.rank ?? null;
  const lp = solo?.leaguePoints ?? null;
  const wins = solo?.wins ?? null;
  const losses = solo?.losses ?? null;

  // 직전 스냅샷과 값이 같으면 새 행을 만들지 않고 관측 시각만 갱신한다.
  // (변화가 없는데 행을 쌓으면 히스토리에 의미 없는 중복만 늘고,
  //  그렇다고 그냥 건너뛰면 created_at이 낡아 신선도 판정이 깨져 매번 재조회하게 된다)
  const touched = await sql`
    UPDATE league_snapshots SET created_at = now()
    WHERE id = (
      SELECT id FROM league_snapshots
      WHERE fp = ${fp} AND puuid = ${puuid}
      ORDER BY created_at DESC LIMIT 1
    )
      AND solo_tier IS NOT DISTINCT FROM ${tier}
      AND solo_rank IS NOT DISTINCT FROM ${rank}
      AND solo_lp IS NOT DISTINCT FROM ${lp}
      AND solo_wins IS NOT DISTINCT FROM ${wins}
      AND solo_losses IS NOT DISTINCT FROM ${losses}
    RETURNING 1`;
  if (touched.length > 0) return;

  await sql`
    INSERT INTO league_snapshots
      (fp, platform, puuid, solo_tier, solo_rank, solo_lp, solo_wins, solo_losses, entries)
    VALUES (${fp}, ${platform}, ${puuid}, ${tier}, ${rank},
            ${lp}, ${wins}, ${losses},
            ${sql.json(entries as never)})`;
}

export interface LeagueSnapRow {
  solo_tier: string | null;
  solo_rank: string | null;
  solo_lp: number | null;
  solo_wins: number | null;
  solo_losses: number | null;
  created_at: string;
}

/** 가장 최근 스냅샷 (신선도 무관) — 승급/강등 감지 비교용 */
export async function latestLeagueSnapshotAny(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
): Promise<LeagueSnapRow | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT solo_tier, solo_rank, solo_lp, solo_wins, solo_losses, created_at
    FROM league_snapshots
    WHERE fp = ${fp} AND platform = ${platform} AND puuid = ${puuid}
    ORDER BY created_at DESC LIMIT 1`;
  return (rows[0] as LeagueSnapRow | undefined) ?? null;
}

/** 특정 소환사의 랭크 스냅샷 히스토리 (오래된 순) — LP 득실 추적용 */
export async function listLeagueSnapshots(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
  limit = 200,
): Promise<LeagueSnapRow[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT solo_tier, solo_rank, solo_lp, solo_wins, solo_losses, created_at
    FROM league_snapshots
    WHERE fp = ${fp} AND platform = ${platform} AND puuid = ${puuid}
    ORDER BY created_at ASC LIMIT ${limit}`;
  return rows as unknown as LeagueSnapRow[];
}

// ── 분석 결과 ───────────────────────────────────────────

/**
 * 저장된 분석 조회. 닉네임으로 먼저 찾고, 없으면 puuid로 승계 조회한다
 * (닉변 시 이전 분석을 잃지 않도록).
 */
export async function getAnalysis(
  kind: "quick" | "deep",
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  puuid?: string,
): Promise<MmrEstimate | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT result FROM analyses
    WHERE platform = ${platform} AND kind = ${kind}
      AND game_name_lower = ${canon(gameName)}
      AND tag_line_lower = ${canon(tagLine)}`;
  if (rows[0]) return rows[0].result as MmrEstimate;
  if (!puuid) return null;
  const byPuuid = await sql`
    SELECT result FROM analyses
    WHERE puuid = ${puuid} AND kind = ${kind}
    ORDER BY updated_at DESC LIMIT 1`;
  return (byPuuid[0]?.result as MmrEstimate | undefined) ?? null;
}

/** 옛 닉네임으로 저장된 기록에서 puuid를 찾는다 (닉변 역조회용) */
export async function findPuuidByOldName(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  fp?: string,
): Promise<string | null> {
  const sql = await getSql();
  const nameLower = canon(gameName);
  const tagLower = canon(tagLine);
  // summoners는 puuid PK라 옛 이름이 남아 있는 경우가 많다(가장 신뢰도 높은 소스).
  // puuid 컬럼 추가 이전에 저장된 analyses/recent_searches는 puuid가 비어 있을 수 있다.
  // PUUID는 API 키 단위 암호화라, 현재 키 지문(fp)의 행만 유효하다
  const rows = fp
    ? await sql`
        SELECT puuid FROM summoners
        WHERE fp = ${fp} AND platform = ${platform}
          AND lower(normalize(game_name, NFKC)) = ${nameLower}
            AND lower(normalize(tag_line, NFKC)) = ${tagLower}
        ORDER BY updated_at DESC LIMIT 1`
    : await sql`
        SELECT puuid FROM summoners
        WHERE platform = ${platform}
          AND lower(normalize(game_name, NFKC)) = ${nameLower}
            AND lower(normalize(tag_line, NFKC)) = ${tagLower}
        ORDER BY updated_at DESC LIMIT 1`;
  if (rows[0]) return rows[0].puuid as string;

  const fallback = await sql`
    SELECT puuid FROM analyses
    WHERE platform = ${platform} AND puuid IS NOT NULL
      AND game_name_lower = ${nameLower} AND tag_line_lower = ${tagLower}
    UNION ALL
    SELECT puuid FROM recent_searches
    WHERE platform = ${platform} AND puuid IS NOT NULL
      AND game_name_lower = ${nameLower} AND tag_line_lower = ${tagLower}
    LIMIT 1`;
  return (fallback[0]?.puuid as string | undefined) ?? null;
}

/** 닉변 이력 조회 — 옛 이름으로 검색됐을 때 현재 이름 반환 */
export async function findRenamedTo(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<{ gameName: string; tagLine: string } | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT new_game_name, new_tag_line FROM name_history
    WHERE platform = ${platform}
      AND old_name_lower = ${canon(gameName)}
      AND old_tag_lower = ${canon(tagLine)}`;
  const r = rows[0];
  return r
    ? { gameName: r.new_game_name as string, tagLine: r.new_tag_line as string }
    : null;
}

/** 닉변 이력 기록 (옛 이름 → 새 이름) */
export async function recordNameChange(
  platform: PlatformRegion,
  oldGameName: string,
  oldTagLine: string,
  newGameName: string,
  newTagLine: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO name_history
      (platform, old_name_lower, old_tag_lower, new_game_name, new_tag_line)
    VALUES (${platform}, ${canon(oldGameName)}, ${canon(oldTagLine)},
            ${newGameName}, ${newTagLine})
    ON CONFLICT (platform, old_name_lower, old_tag_lower) DO UPDATE
    SET new_game_name = EXCLUDED.new_game_name,
        new_tag_line = EXCLUDED.new_tag_line, changed_at = now()`;
  // 옛 이름이 다른 계정의 새 이름으로 기록돼 있으면 체인이 꼬이므로 정리
  await sql`
    DELETE FROM name_history
    WHERE platform = ${platform}
      AND old_name_lower = ${canon(newGameName)}
      AND old_tag_lower = ${canon(newTagLine)}`;
  // 옛 이름으로 남아 있던 분석·검색 기록 제거. migrateIdentity가 puuid 기준으로
  // 지우지만 puuid 컬럼 도입 이전 행은 비어 있어서 이름 기준으로도 정리한다.
  // (이 시점의 옛 이름은 주인이 없으므로 남의 기록을 지울 위험이 없다)
  const oldName = canon(oldGameName);
  const oldTag = canon(oldTagLine);
  await sql`
    DELETE FROM analyses
    WHERE platform = ${platform}
      AND game_name_lower = ${oldName} AND tag_line_lower = ${oldTag}`;
  await sql`
    DELETE FROM recent_searches
    WHERE platform = ${platform}
      AND game_name_lower = ${oldName} AND tag_line_lower = ${oldTag}`;
}

/**
 * 해당 이름이 실제로 존재하는 계정으로 확인되면 닉변 매핑을 제거한다.
 * 롤 닉네임은 재사용 가능해서, 남이 옛 이름을 가져간 경우 잘못된 리다이렉트를
 * 계속 하게 되므로 검색 성공 시점에 매핑을 무효화한다.
 */
export async function clearRenameMapping(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    DELETE FROM name_history
    WHERE platform = ${platform}
      AND old_name_lower = ${canon(gameName)}
      AND old_tag_lower = ${canon(tagLine)}`;
}

/** 닉변 감지: puuid로 저장된 옛 닉네임 행들을 새 닉네임으로 이관 */
export async function migrateIdentity(
  platform: PlatformRegion,
  puuid: string,
  gameName: string,
  tagLine: string,
): Promise<void> {
  const sql = await getSql();
  const nameLower = canon(gameName);
  const tagLower = canon(tagLine);
  // 같은 puuid인데 이름이 다른 옛 행 제거 후, 새 이름 행으로 puuid를 기록
  await sql`
    DELETE FROM analyses
    WHERE puuid = ${puuid} AND platform = ${platform}
      AND (game_name_lower <> ${nameLower} OR tag_line_lower <> ${tagLower})`;
  await sql`
    DELETE FROM recent_searches
    WHERE puuid = ${puuid} AND platform = ${platform}
      AND (game_name_lower <> ${nameLower} OR tag_line_lower <> ${tagLower})`;
}

export async function saveAnalysis(
  kind: "quick" | "deep",
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  result: MmrEstimate,
  puuid?: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO analyses
      (platform, game_name_lower, tag_line_lower, kind, game_name, tag_line,
       algo_version, latest_match_id, analyzed_at, result, puuid)
    VALUES (${platform}, ${canon(gameName)}, ${canon(tagLine)}, ${kind},
            ${result.account.gameName}, ${result.account.tagLine},
            ${result.algoVersion ?? null}, ${result.latestMatchId ?? null},
            ${result.analyzedAt ? new Date(result.analyzedAt) : null},
            ${sql.json(result as never)}, ${puuid ?? null})
    ON CONFLICT (platform, game_name_lower, tag_line_lower, kind) DO UPDATE
    SET game_name = EXCLUDED.game_name, tag_line = EXCLUDED.tag_line,
        algo_version = EXCLUDED.algo_version, latest_match_id = EXCLUDED.latest_match_id,
        analyzed_at = EXCLUDED.analyzed_at, result = EXCLUDED.result,
        puuid = COALESCE(EXCLUDED.puuid, analyses.puuid), updated_at = now()`;
}

export interface AnalysisMeta {
  platform: string;
  game_name_lower: string;
  tag_line_lower: string;
  kind: "quick" | "deep";
  algo_version: number | null;
  latest_match_id: string | null;
  analyzed_at: string | null;
}

export async function listAnalysesMeta(): Promise<AnalysisMeta[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT platform, game_name_lower, tag_line_lower, kind,
           algo_version, latest_match_id, analyzed_at
    FROM analyses`;
  return rows as unknown as AnalysisMeta[];
}

export interface QuickAnalysisPage {
  platform: string;
  game_name: string;
  tag_line: string;
  analyzed_at: string | null;
}

export async function listQuickAnalysisPages(limit = 50_000, offset = 0): Promise<QuickAnalysisPage[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT platform, game_name, tag_line, analyzed_at
    FROM analyses WHERE kind = 'quick'
    ORDER BY analyzed_at DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}`;
  return rows as unknown as QuickAnalysisPage[];
}

/** 사이트맵 분할용 — 색인 대상 소환사 페이지 수 */
export async function countQuickAnalysisPages(): Promise<number> {
  const sql = await getSql();
  const r = await sql`SELECT count(*)::int AS n FROM analyses WHERE kind = 'quick'`;
  return (r[0]?.n as number) ?? 0;
}

// ── 최근 검색 ───────────────────────────────────────────

export interface RecentSearchInput {
  platform: PlatformRegion;
  gameName: string;
  tagLine: string;
  currentLabel: string | null;
  currentTier: string | null;
  estimatedLabel: string | null;
  estimatedTier: string | null;
  estimatedPoints: number | null;
  puuid?: string | null; // 닉변 승계용
  /** 등록 시각 지정 — 시드 수집이 먼 과거로 박아 실제 검색 뒤에 오게 한다 */
  searchedAt?: Date;
}

export async function upsertRecentSearch(r: RecentSearchInput): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO recent_searches
      (platform, game_name_lower, tag_line_lower, game_name, tag_line,
       current_label, current_tier, estimated_label, estimated_tier, estimated_points,
       puuid, searched_at)
    VALUES (${r.platform}, ${canon(r.gameName)}, ${canon(r.tagLine)},
            ${r.gameName}, ${r.tagLine}, ${r.currentLabel}, ${r.currentTier},
            ${r.estimatedLabel}, ${r.estimatedTier}, ${r.estimatedPoints},
            ${r.puuid ?? null}, ${r.searchedAt ?? new Date()})
    ON CONFLICT (platform, game_name_lower, tag_line_lower) DO UPDATE
    SET game_name = EXCLUDED.game_name, tag_line = EXCLUDED.tag_line,
        current_label = EXCLUDED.current_label, current_tier = EXCLUDED.current_tier,
        estimated_label = EXCLUDED.estimated_label, estimated_tier = EXCLUDED.estimated_tier,
        estimated_points = EXCLUDED.estimated_points,
        puuid = COALESCE(EXCLUDED.puuid, recent_searches.puuid),
        searched_at = GREATEST(recent_searches.searched_at, EXCLUDED.searched_at)`;
}

/** 최근 검색 행에 저장된 puuid — 시드 수집으로 등록된 계정은 summoners 테이블엔
 *  없고 여기에만 puuid가 있다(매치 참가자에서 가져온 값). 닉변 폴백의 2차 소스. */
export async function recentSearchPuuid(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT puuid FROM recent_searches
    WHERE platform = ${platform}
      AND game_name_lower = ${canon(gameName)} AND tag_line_lower = ${canon(tagLine)}
      AND puuid IS NOT NULL
    LIMIT 1`;
  return (rows[0]?.puuid as string | undefined) ?? null;
}

/** 갱신(스윕)이 계산한 최신 랭크로 최근 검색 행의 티어·추정치만 고친다.
 *  searched_at은 건드리지 않는다(검색 순서·홈 칩에 영향 없음). 행이 없으면 no-op —
 *  등록은 유저 검색·시드 수집만 한다. */
export async function updateRecentSearchRank(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  r: {
    currentLabel: string | null;
    currentTier: string | null;
    estimatedLabel: string | null;
    estimatedTier: string | null;
    estimatedPoints: number | null;
    puuid?: string | null;
  },
): Promise<void> {
  const sql = await getSql();
  await sql`
    UPDATE recent_searches
    SET current_label = ${r.currentLabel}, current_tier = ${r.currentTier},
        estimated_label = ${r.estimatedLabel}, estimated_tier = ${r.estimatedTier},
        estimated_points = ${r.estimatedPoints},
        puuid = COALESCE(${r.puuid ?? null}, puuid)
    WHERE platform = ${platform}
      AND game_name_lower = ${canon(gameName)} AND tag_line_lower = ${canon(tagLine)}`;
}

export interface RecentSearchRow {
  platform: PlatformRegion;
  game_name: string;
  tag_line: string;
  current_label: string | null;
  current_tier: string | null;
  estimated_label: string | null;
  estimated_tier: string | null;
  estimated_points: number | null;
  searched_at: string;
}

export async function listRecentSearches(
  limit: number,
): Promise<RecentSearchRow[]> {
  const sql = await getSql();
  // Infinity면 전량 — 크론 전체 갱신은 상한이 있으면 그 뒤 소환사가
  // 자동 갱신에서 영영 빠지므로 제한 없이 순회해야 한다
  // 정렬은 반드시 결정적이어야 한다 — 전체 갱신이 "몇 번째"(커서)로 이어서 훑는데,
  // 시드는 searched_at이 전부 같아(2000-01-01) 동률 순서가 라운드마다 바뀌면
  // 같은 사람을 여러 번 보고 어떤 사람은 영영 못 본다(실제로 6,418명 누락됐던 사고).
  const rows = Number.isFinite(limit)
    ? await sql`
        SELECT platform, game_name, tag_line, current_label, current_tier,
               estimated_label, estimated_tier, estimated_points, searched_at
        FROM recent_searches
        ORDER BY searched_at DESC, platform, game_name_lower, tag_line_lower
        LIMIT ${limit}`
    : await sql`
        SELECT platform, game_name, tag_line, current_label, current_tier,
               estimated_label, estimated_tier, estimated_points, searched_at
        FROM recent_searches
        ORDER BY searched_at DESC, platform, game_name_lower, tag_line_lower`;
  return rows as unknown as RecentSearchRow[];
}

export interface SummonerSuggestion {
  game_name: string;
  tag_line: string;
  current_label: string | null;
  current_tier: string | null;
}

/** 소환사 자동완성 — 기록된 검색에서 부분 일치, 최근 검색 순 */
export async function searchRecentSummoners(
  platform: PlatformRegion,
  query: string,
  limit = 8,
): Promise<SummonerSuggestion[]> {
  const sql = await getSql();
  const q = `%${canon(query)}%`;
  const rows = await sql`
    SELECT game_name, tag_line, current_label, current_tier
    FROM recent_searches
    WHERE platform = ${platform}
      AND (game_name_lower LIKE ${q}
           OR game_name_lower || '#' || tag_line_lower LIKE ${q})
    ORDER BY searched_at DESC LIMIT ${limit}`;
  return rows as unknown as SummonerSuggestion[];
}

/** 최근 30일 내 검색된 소환사인지 — 디스코드 알림 대상 필터 */
export async function isRecentlySearched(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    SELECT 1 FROM recent_searches
    WHERE platform = ${platform}
      AND game_name_lower = ${canon(gameName)}
      AND tag_line_lower = ${canon(tagLine)}
      AND searched_at > now() - interval '30 days'`;
  return rows.length > 0;
}

/** 특정 소환사가 참가한 저장된 매치들 (결산·궁합용, API 호출 없음) */
export async function listMatchesForPuuid(
  fp: string,
  puuid: string,
  limit = 500,
): Promise<MatchInfo[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT match_id, game_creation, game_duration, queue_id, participants
    FROM matches
    WHERE fp = ${fp} AND participants @> ${sql.json([{ puuid }] as never)}
    ORDER BY game_creation DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    matchId: r.match_id as string,
    gameCreation: Number(r.game_creation),
    gameDuration: r.game_duration as number,
    queueId: r.queue_id as number,
    participants: r.participants as MatchInfo["participants"],
  }));
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const sql = await getSql();
  const rows = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  return (rows[0]?.value as T | undefined) ?? null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${key}, ${sql.json(value as never)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** 백그라운드 작업 라운드 점유를 원자적으로 시도한다.
 *  running이고 (라운드가 안 돌고 있거나 하트비트가 staleMs 넘게 죽어 있을 때)만
 *  roundActive=true로 바꾸고 바뀐 상태를 돌려준다 — 동시 호출은 하나만 성공한다.
 *  (체인·관리자 탭 폴링·부팅 훅이 같은 순간 들어와 라운드가 겹치던 문제 방지.)
 *  patch는 점유와 함께 덮어쓸 필드(예: 라운드 진행 카운터 초기화). */
export async function claimRound<T>(
  key: string,
  staleMs: number,
  patch: Record<string, unknown> = {},
): Promise<T | null> {
  const sql = await getSql();
  const now = Date.now();
  const rows = await sql`
    UPDATE app_settings
    SET value = value || ${sql.json({ ...patch, roundActive: true, updatedAt: now } as never)},
        updated_at = now()
    WHERE key = ${key}
      AND coalesce((value->>'running')::boolean, false)
      AND (NOT coalesce((value->>'roundActive')::boolean, false)
           OR coalesce((value->>'updatedAt')::bigint, 0) < ${now - staleMs})
    RETURNING value`;
  return (rows[0]?.value as T | undefined) ?? null;
}

// ── 어드민 ──────────────────────────────────────────────

export async function adminFindUser(
  username: string,
): Promise<{ salt: string; hash: string } | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT salt, hash FROM admin_users WHERE username = ${username}`;
  return (rows[0] as { salt: string; hash: string } | undefined) ?? null;
}

export async function adminInsertSession(
  token: string,
  ttlSeconds: number,
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO admin_sessions (token, expires_at)
    VALUES (${token}, now() + ${`${ttlSeconds} seconds`}::interval)`;
}

export async function adminSessionValid(token: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    SELECT 1 FROM admin_sessions WHERE token = ${token} AND expires_at > now()`;
  return rows.length > 0;
}

export async function adminExpireSession(token: string): Promise<void> {
  const sql = await getSql();
  await sql`UPDATE admin_sessions SET expires_at = now() WHERE token = ${token}`;
}

// ── API 키 교체 데이터 이관 ─────────────────────────────
// PUUID는 키 단위 암호화라 키를 바꾸면 옛 지문(fp) 데이터가 조회 불가능해진다.
// 이름(game_name#tag_line)은 키와 무관하므로, 옛 행의 이름으로 새 키에서 puuid를
// 다시 받아오면 랭크 스냅샷(LP 히스토리)을 새 키 기준으로 되살릴 수 있다.
// 매치 상세는 participants 안에 옛 puuid가 박혀 있어 재키잉이 불가능 → 정리 대상.

export interface LegacyStats {
  summoners: number;
  snapshots: number;
  matches: number;
  identities: number; // 이관 대상 소환사 수(이름 기준 중복 제거)
}

export async function legacyStats(curFp: string): Promise<LegacyStats> {
  const sql = await getSql();
  const [s, sn, m, id] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM summoners WHERE fp <> ${curFp}`,
    sql`SELECT count(*)::int AS n FROM league_snapshots WHERE fp <> ${curFp}`,
    sql`SELECT count(*)::int AS n FROM matches WHERE fp <> ${curFp}`,
    sql`SELECT count(*)::int AS n FROM (
          SELECT DISTINCT platform,
                 lower(normalize(game_name, NFKC)) AS g,
                 lower(normalize(tag_line, NFKC)) AS t
          FROM summoners WHERE fp <> ${curFp}
        ) x`,
  ]);
  return {
    summoners: s[0].n,
    snapshots: sn[0].n,
    matches: m[0].n,
    identities: id[0].n,
  };
}

export interface LegacyIdentity {
  platform: PlatformRegion;
  game_name: string;
  tag_line: string;
  old_fp: string;
  old_puuid: string;
}

/** 아직 새 키로 이관되지 않은 옛 소환사 식별자 (스냅샷 많은 순) */
export async function listLegacyIdentities(
  curFp: string,
  limit: number,
): Promise<LegacyIdentity[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT s.platform, s.game_name, s.tag_line, s.fp AS old_fp, s.puuid AS old_puuid,
           (SELECT count(*) FROM league_snapshots ls
             WHERE ls.fp = s.fp AND ls.puuid = s.puuid) AS snaps
    FROM summoners s
    WHERE s.fp <> ${curFp}
    ORDER BY snaps DESC
    LIMIT ${limit}`;
  return rows as unknown as LegacyIdentity[];
}

/**
 * 옛 스냅샷을 새 키 기준으로 이관하고 옛 소환사 행을 제거한다.
 * 같은 (fp, platform, puuid, created_at) 충돌은 이미 이관된 것이므로 버린다.
 */
export async function migrateLegacyIdentity(
  id: LegacyIdentity,
  newFp: string,
  newPuuid: string,
): Promise<number> {
  const sql = await getSql();
  const moved = await sql`
    UPDATE league_snapshots
    SET fp = ${newFp}, puuid = ${newPuuid}
    WHERE fp = ${id.old_fp} AND puuid = ${id.old_puuid}
      AND NOT EXISTS (
        SELECT 1 FROM league_snapshots x
        WHERE x.fp = ${newFp} AND x.puuid = ${newPuuid}
          AND x.created_at = league_snapshots.created_at)
    RETURNING 1`;
  await sql`
    DELETE FROM league_snapshots
    WHERE fp = ${id.old_fp} AND puuid = ${id.old_puuid}`;
  await sql`
    DELETE FROM summoners
    WHERE fp = ${id.old_fp} AND puuid = ${id.old_puuid}`;
  return moved.length;
}

/** 이관 불가능한 옛 매치 상세를 배치로 정리 */
export async function purgeLegacyMatches(
  curFp: string,
  limit: number,
): Promise<number> {
  const sql = await getSql();
  const rows = await sql`
    DELETE FROM matches
    WHERE ctid IN (
      SELECT ctid FROM matches WHERE fp <> ${curFp} LIMIT ${limit}
    )
    RETURNING 1`;
  return rows.length;
}

/** 이관 대상이 사라진(소환사 행이 없는) 고아 스냅샷 정리 */
export async function purgeOrphanSnapshots(
  curFp: string,
  limit: number,
): Promise<number> {
  const sql = await getSql();
  const rows = await sql`
    DELETE FROM league_snapshots
    WHERE ctid IN (
      SELECT ctid FROM league_snapshots WHERE fp <> ${curFp} LIMIT ${limit}
    )
    RETURNING 1`;
  return rows.length;
}

/**
 * 이관·정리 후 디스크 공간 회수. DELETE만으로는 파일 크기가 줄지 않는다.
 * 짧은 배타 락이 걸리지만 대상 테이블이 작아 수백 ms 수준이다.
 */
export async function vacuumMigratedTables(): Promise<void> {
  const sql = await getSql();
  for (const t of ["league_snapshots", "matches"]) {
    await sql.unsafe(`VACUUM FULL ${t}`).catch(() => {});
  }
}

/** 만료된 캐시 행 정리 — 새벽 크론에서 호출한다(방치하면 계속 누적됨) */
export async function purgeExpiredCache(limit = 5000): Promise<number> {
  const sql = await getSql();
  const rows = await sql`
    DELETE FROM cache_entries
    WHERE ctid IN (
      SELECT ctid FROM cache_entries WHERE expires_at <= now() LIMIT ${limit}
    )
    RETURNING 1`;
  return rows.length;
}

/**
 * puuid 목록의 "현재 알려진 이름"을 한 번에 조회한다.
 * 매치에는 경기 시점 이름이 박제돼 있어, 그 뒤 닉변한 참가자는 옛 이름으로
 * 표시되고 링크도 엉뚱한 곳으로 간다. 우리가 이미 아는 계정은 이 조회로
 * 현재 이름으로 바로잡는다 (API 호출 없음).
 */
export async function currentNamesByPuuid(
  fp: string,
  puuids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (puuids.length === 0) return out;
  const sql = await getSql();
  const rows = await sql`
    SELECT puuid, game_name, tag_line FROM summoners
    WHERE fp = ${fp} AND puuid = ANY(${puuids})`;
  for (const r of rows) {
    out.set(r.puuid as string, `${r.game_name}#${r.tag_line}`);
  }
  return out;
}

// ── 방문 로그·통계 (관리자 대시보드) ─────────────────────

/** 소환사 페이지 방문 기록 — 실패해도 페이지 표시에 영향을 주지 않는다 */
export async function logVisit(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  source: "user" | "tool",
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO visit_log (platform, game_name, tag_line, source)
    VALUES (${platform}, ${gameName}, ${tagLine}, ${source})`;
}

export interface HourlyVisit {
  hour: number; // KST 0~23
  visits: number;
  summoners: number;
}

/** 최근 N일간 방문을 KST 시간대별로 집계 (유저 방문만) */
export async function hourlyVisitStats(days: number): Promise<HourlyVisit[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT EXTRACT(hour FROM at AT TIME ZONE 'Asia/Seoul')::int AS hour,
           count(*)::int AS visits,
           count(DISTINCT (platform, game_name, tag_line))::int AS summoners
    FROM visit_log
    WHERE source = 'user' AND at > now() - ${`${days} days`}::interval
    GROUP BY 1 ORDER BY 1`;
  const map = new Map(rows.map((r) => [r.hour as number, r]));
  return Array.from({ length: 24 }, (_, h) => {
    const r = map.get(h) as HourlyVisit | undefined;
    return { hour: h, visits: r?.visits ?? 0, summoners: r?.summoners ?? 0 };
  });
}

export interface TierCount {
  tier: string | null;
  n: number;
}

/** 기록된 소환사의 현재 티어 분포 */
export async function tierDistribution(): Promise<TierCount[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT current_tier AS tier, count(*)::int AS n
    FROM recent_searches GROUP BY 1 ORDER BY n DESC`;
  return rows as unknown as TierCount[];
}


// ── 관리자 소환사 목록 (SQL 집계) ────────────────────────
// 전체 행을 앱으로 끌어와 JS에서 계산하면 목록이 커질수록 어드민이 느려진다.
// 상태 판정·검색·필터·페이징을 모두 SQL에서 끝내고 필요한 만큼만 가져온다.

export type AdminAnalysisState =
  | "deep"
  | "deep-stale"
  | "quick"
  | "quick-stale"
  | "none";

export interface AdminSummonerRow {
  region: string;
  name: string;
  currentLabel: string | null;
  estimatedLabel: string | null;
  searchedAt: number;
  analysis: AdminAnalysisState;
}

const STATE_SQL = `
  CASE
    WHEN a.deep_at IS NOT NULL THEN
      CASE WHEN a.deep_ver = $1 AND a.deep_at > now() - interval '72 hours'
                AND NOT (a.quick_at IS NOT NULL AND a.quick_at > a.deep_at
                         AND a.quick_mid IS DISTINCT FROM a.deep_mid)
           THEN 'deep' ELSE 'deep-stale' END
    WHEN a.quick_at IS NOT NULL THEN
      CASE WHEN a.quick_ver = $1 AND a.quick_at > now() - interval '72 hours'
           THEN 'quick' ELSE 'quick-stale' END
    ELSE 'none'
  END`;

const AGG_SQL = `
  LEFT JOIN (
    SELECT platform, game_name_lower, tag_line_lower,
      max(CASE WHEN kind='deep'  THEN algo_version END)     AS deep_ver,
      max(CASE WHEN kind='deep'  THEN analyzed_at END)      AS deep_at,
      max(CASE WHEN kind='deep'  THEN latest_match_id END)  AS deep_mid,
      max(CASE WHEN kind='quick' THEN algo_version END)     AS quick_ver,
      max(CASE WHEN kind='quick' THEN analyzed_at END)      AS quick_at,
      max(CASE WHEN kind='quick' THEN latest_match_id END)  AS quick_mid
    FROM analyses GROUP BY 1,2,3
  ) a ON a.platform = r.platform
     AND a.game_name_lower = r.game_name_lower
     AND a.tag_line_lower = r.tag_line_lower`;

// 티어 필터 조건 — 'all' 전체, 'none' 티어 없음(언랭·미수집), 그 외 current_tier 일치
const TIER_WHERE = (param: string) =>
  `(${param} = 'all' OR (${param} = 'none' AND r.current_tier IS NULL) OR r.current_tier = ${param})`;

/** 티어별 개수 (검색어만 반영) — 관리자 티어 필터 드롭다운용 */
export async function adminTierCounts(q: string): Promise<Record<string, number>> {
  const sql = await getSql();
  const like = `%${q.toLowerCase()}%`;
  const rows = await sql.unsafe(
    `SELECT coalesce(r.current_tier, 'none') AS tier, count(*)::int AS n
     FROM recent_searches r
     WHERE ($1 = '%%' OR lower(r.game_name || '#' || r.tag_line) LIKE $1)
     GROUP BY 1`,
    [like],
  );
  const out: Record<string, number> = {};
  for (const r of rows as unknown as { tier: string; n: number }[]) out[r.tier] = r.n;
  return out;
}

/** 상태별 개수 (검색어·티어 반영) */
export async function adminSummonerCounts(
  algoVersion: number,
  q: string,
  tier = "all",
): Promise<Record<string, number>> {
  const sql = await getSql();
  const like = `%${q.toLowerCase()}%`;
  const rows = await sql.unsafe(
    `SELECT ${STATE_SQL} AS state, count(*)::int AS n
     FROM recent_searches r ${AGG_SQL}
     WHERE ($2 = '%%' OR lower(r.game_name || '#' || r.tag_line) LIKE $2)
       AND ${TIER_WHERE("$3")}
     GROUP BY 1`,
    [algoVersion, like, tier],
  );
  const out: Record<string, number> = {};
  for (const r of rows as unknown as { state: string; n: number }[]) {
    out[r.state] = r.n;
  }
  return out;
}

/** 검색·필터·페이징을 SQL에서 처리한 소환사 목록 */
export async function adminSummonerPage(
  algoVersion: number,
  q: string,
  filter: string,
  tier: string,
  limit: number,
  offset: number,
): Promise<{ rows: AdminSummonerRow[]; total: number }> {
  const sql = await getSql();
  const like = `%${q.toLowerCase()}%`;
  const where = `WHERE ($2 = '%%' OR lower(r.game_name || '#' || r.tag_line) LIKE $2)
      AND ($3 = 'all' OR ${STATE_SQL} = $3)
      AND ${TIER_WHERE("$4")}`;

  const [rows, totalRows] = await Promise.all([
    sql.unsafe(
      `SELECT r.platform, r.game_name, r.tag_line, r.current_label,
              r.estimated_label, r.searched_at, ${STATE_SQL} AS state
       FROM recent_searches r ${AGG_SQL} ${where}
       ORDER BY r.searched_at DESC, r.platform, r.game_name_lower, r.tag_line_lower
       LIMIT $5 OFFSET $6`,
      [algoVersion, like, filter, tier, limit, offset],
    ),
    sql.unsafe(
      `SELECT count(*)::int AS n FROM recent_searches r ${AGG_SQL} ${where}`,
      [algoVersion, like, filter, tier],
    ),
  ]);

  return {
    rows: (rows as unknown as Record<string, unknown>[]).map((r) => ({
      region: r.platform as string,
      name: `${r.game_name}#${r.tag_line}`,
      currentLabel: (r.current_label as string) ?? null,
      estimatedLabel: (r.estimated_label as string) ?? null,
      searchedAt: new Date(r.searched_at as string).getTime(),
      analysis: r.state as AdminAnalysisState,
    })),
    total: (totalRows as unknown as { n: number }[])[0]?.n ?? 0,
  };
}
