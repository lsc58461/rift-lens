// 도메인 테이블 저장 계층. 신선도(TTL) 판단은 타임스탬프 컬럼 + 호출부 비교로 한다.
// puuid가 들어가는 테이블(summoners/matches/league_snapshots)은 API 키 지문(fp)으로 스코프.

import "server-only";
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
  await sql`
    INSERT INTO matches (fp, match_id, platform, game_creation, game_duration, queue_id, participants)
    VALUES (${fp}, ${match.matchId}, ${platform}, ${match.gameCreation},
            ${match.gameDuration}, ${match.queueId}, ${sql.json(match.participants as never)})
    ON CONFLICT (fp, match_id) DO UPDATE SET participants = EXCLUDED.participants`;
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

export async function insertLeagueSnapshot(
  fp: string,
  platform: PlatformRegion,
  puuid: string,
  entries: LeagueEntry[],
): Promise<void> {
  const sql = await getSql();
  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  await sql`
    INSERT INTO league_snapshots
      (fp, platform, puuid, solo_tier, solo_rank, solo_lp, solo_wins, solo_losses, entries)
    VALUES (${fp}, ${platform}, ${puuid}, ${solo?.tier ?? null}, ${solo?.rank ?? null},
            ${solo?.leaguePoints ?? null}, ${solo?.wins ?? null}, ${solo?.losses ?? null},
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

export async function listQuickAnalysisPages(): Promise<QuickAnalysisPage[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT platform, game_name, tag_line, analyzed_at
    FROM analyses WHERE kind = 'quick'`;
  return rows as unknown as QuickAnalysisPage[];
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
            ${r.puuid ?? null}, now())
    ON CONFLICT (platform, game_name_lower, tag_line_lower) DO UPDATE
    SET game_name = EXCLUDED.game_name, tag_line = EXCLUDED.tag_line,
        current_label = EXCLUDED.current_label, current_tier = EXCLUDED.current_tier,
        estimated_label = EXCLUDED.estimated_label, estimated_tier = EXCLUDED.estimated_tier,
        estimated_points = EXCLUDED.estimated_points,
        puuid = COALESCE(EXCLUDED.puuid, recent_searches.puuid), searched_at = now()`;
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
  const rows = await sql`
    SELECT platform, game_name, tag_line, current_label, current_tier,
           estimated_label, estimated_tier, estimated_points, searched_at
    FROM recent_searches ORDER BY searched_at DESC LIMIT ${limit}`;
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
