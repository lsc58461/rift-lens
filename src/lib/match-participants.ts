// 참가자 테이블(match_participants) — "1행 = 1참가자". 참가자 데이터의 유일한 원본이다
// (2026-08-30 JSON 컬럼 제거). matches 는 경기 메타(시각·큐·패치·밴·팀요약·플래그)만 갖는다.
//
// 쓰기: saveMatchRow → syncParticipantsFromMatch (참가자 먼저, 실패 시 메타도 안 씀)
// 읽기: loadMatchInfo(1경기) / loadMatchesByPuuid(소환사별) 가 행 10개를 MatchInfo로 조립
import "server-only";
import type { Sql } from "postgres";
import { getSql } from "@/lib/db";
import type { MatchInfo, MatchParticipant, PlatformRegion } from "@/lib/riot/types";

type ParticipantRow = Record<string, unknown>;

// 옵셔널 필드: 컬럼 ↔ MatchParticipant 필드 (기본 필드는 toRows/rowToParticipant가 직접 다룬다)
const COL_TO_FIELD: [string, keyof MatchParticipant][] = [
  ["champion_id", "championId"], ["champ_level", "champLevel"], ["cs", "cs"], ["gold", "goldEarned"],
  ["damage", "damage"], ["damage_taken", "damageTaken"], ["vision", "visionScore"],
  ["spell1", "spell1Id"], ["spell2", "spell2Id"], ["keystone", "keystone"], ["sub_style", "subStyle"],
  ["perks", "perks"], ["sub_perks", "subPerks"], ["stat_perks", "statPerks"],
  ["double_kills", "doubleKills"], ["triple_kills", "tripleKills"], ["quadra_kills", "quadraKills"],
  ["penta_kills", "pentaKills"], ["kill_participation", "killParticipation"],
  ["individual_position", "individualPosition"], ["cs_total", "csTotal"], ["cs_jungle", "csJungle"],
  ["gold_spent", "goldSpent"], ["damage_mitigated", "damageMitigated"],
  ["damage_to_objectives", "damageToObjectives"], ["damage_to_turrets", "damageToTurrets"],
  ["total_heal", "totalHeal"], ["heal_on_teammates", "healOnTeammates"],
  ["shield_on_teammates", "shieldOnTeammates"], ["cc_score", "ccScore"], ["turret_kills", "turretKills"],
  ["inhibitor_kills", "inhibitorKills"], ["dragon_kills", "dragonKills"], ["baron_kills", "baronKills"],
  ["objectives_stolen", "objectivesStolen"], ["wards_placed", "wardsPlaced"], ["wards_killed", "wardsKilled"],
  ["control_wards_bought", "controlWardsBought"], ["largest_killing_spree", "largestKillingSpree"],
  ["largest_multi_kill", "largestMultiKill"], ["solo_kills", "soloKills"],
  ["first_blood_kill", "firstBloodKill"], ["first_tower_kill", "firstTowerKill"],
  ["game_ended_in_surrender", "gameEndedInSurrender"],
  ["game_ended_in_early_surrender", "gameEndedInEarlySurrender"],
];
const MULTIKILL_COLS = ["double_kills", "triple_kills", "quadra_kills", "penta_kills"];

const BASE_COLS = [
  "fp", "match_id", "platform", "puuid", "idx", "team_id", "win", "champion_name", "team_position",
  "riot_game_name", "riot_tag_line", "kills", "deaths", "assists", "items", "ext_synced",
  "game_creation", "game_duration", "queue_id", "patch", "rank_pts",
];
const COLS = [...BASE_COLS, ...COL_TO_FIELD.map(([c]) => c)];

function toRows(fp: string, platform: string, m: MatchInfo): ParticipantRow[] {
  return m.participants
    .filter((p) => p && p.puuid)
    .map((p, idx) => {
      const row: ParticipantRow = {
        fp,
        match_id: m.matchId,
        platform,
        puuid: p.puuid,
        idx,
        team_id: p.teamId,
        win: p.win,
        champion_name: p.championName,
        team_position: p.teamPosition ?? "",
        riot_game_name: p.riotIdGameName ?? "",
        riot_tag_line: p.riotIdTagline ?? "",
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        items: (p.items ?? []).map((n) => Number(n) || 0),
        ext_synced: true,
        game_creation: m.gameCreation,
        game_duration: m.gameDuration,
        queue_id: m.queueId,
        patch: m.patch ?? null,
        rank_pts: null,
      };
      for (const [col, field] of COL_TO_FIELD) {
        const v = p[field];
        row[col] = v === undefined ? null : Array.isArray(v) ? v.map(Number) : v;
      }
      for (const col of MULTIKILL_COLS) if (row[col] === null) row[col] = 0; // NOT NULL 컬럼
      return row;
    });
}

// 재저장(백필) 때 새 값이 있으면 덮고, 없으면(NULL) 기존 값을 보존한다.
// rank_pts 는 계산 결과라 저장 시 절대 덮지 않는다.
const OVERWRITE_COLS = [
  "idx", "team_id", "win", "champion_name", "team_position", "riot_game_name", "riot_tag_line",
  "kills", "deaths", "assists", "items", ...MULTIKILL_COLS, "game_creation", "game_duration", "queue_id",
];
const UPSERT_SET = [
  ...OVERWRITE_COLS.map((c) => `${c} = EXCLUDED.${c}`),
  ...COL_TO_FIELD.map(([c]) => c)
    .filter((c) => !MULTIKILL_COLS.includes(c))
    .map((c) => `${c} = coalesce(EXCLUDED.${c}, match_participants.${c})`),
  "patch = coalesce(EXCLUDED.patch, match_participants.patch)",
  "ext_synced = true",
].join(", ");

async function upsertRows(sql: Sql, rows: ParticipantRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      INSERT INTO match_participants ${sql(chunk, ...COLS)}
      ON CONFLICT (fp, match_id, puuid) DO UPDATE SET ${sql.unsafe(UPSERT_SET)}`;
  }
}

/** 매치 저장 — 참가자 행 upsert. 실패하면 던진다(호출자가 메타 저장을 건너뛰게). */
export async function syncParticipantsFromMatch(
  fp: string,
  platform: PlatformRegion,
  match: MatchInfo,
): Promise<void> {
  const sql = await getSql();
  await upsertRows(sql, toRows(fp, platform, match));
}

// ── 읽기: 참가자 행 → MatchInfo 조립 ───────────────────────────────────────
// null 은 키 자체를 빼서 "없음(undefined)"으로 — getMatch 의 "cs 가 undefined 면 재조회"
// 같은 판정이 그대로 통한다.
function rowToParticipant(r: ParticipantRow): MatchParticipant {
  const p: Record<string, unknown> = {
    puuid: r.puuid,
    riotIdGameName: r.riot_game_name ?? "",
    riotIdTagline: r.riot_tag_line ?? "",
    teamId: Number(r.team_id),
    win: !!r.win,
    championName: r.champion_name,
    kills: Number(r.kills),
    deaths: Number(r.deaths),
    assists: Number(r.assists),
    teamPosition: r.team_position ?? "",
  };
  // 확장 필드 미수집 매치(ext_synced=false, 옛 매치)의 멀티킬 0은 "없음"으로 둔다
  const ext = r.ext_synced === true;
  for (const [col, field] of COL_TO_FIELD) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    if (!ext && MULTIKILL_COLS.includes(col) && Number(v) === 0) continue;
    p[field] = Array.isArray(v) ? v.map(Number) : v;
  }
  const items = r.items;
  if (Array.isArray(items) && items.length > 0) p.items = items.map(Number);
  return p as unknown as MatchParticipant;
}

const PARTICIPANT_SELECT = COLS.join(", ");

interface MatchMetaRow {
  match_id: string;
  game_creation: string | number;
  game_duration: number;
  queue_id: number;
  patch: string | null;
  bans: unknown;
  teams: unknown;
}

function assemble(meta: MatchMetaRow, parts: ParticipantRow[]): MatchInfo {
  const sorted = [...parts].sort((a, b) => Number(a.idx) - Number(b.idx));
  const info: MatchInfo = {
    matchId: meta.match_id,
    gameCreation: Number(meta.game_creation),
    gameDuration: meta.game_duration,
    queueId: meta.queue_id,
    participants: sorted.map(rowToParticipant),
  };
  if (meta.patch) info.patch = meta.patch;
  if (Array.isArray(meta.bans) && meta.bans.length > 0) info.bans = meta.bans as number[];
  if (Array.isArray(meta.teams) && meta.teams.length > 0) info.teams = meta.teams as MatchInfo["teams"];
  return info;
}

/** 매치 1건 — matches(메타) + match_participants(참가자 10행) 조립 */
export async function loadMatchInfo(fp: string, matchId: string): Promise<MatchInfo | null> {
  const sql = await getSql();
  const [metaRows, parts] = await Promise.all([
    sql`SELECT match_id, game_creation, game_duration, queue_id, patch, bans, teams
        FROM matches WHERE fp = ${fp} AND match_id = ${matchId}`,
    sql.unsafe(
      `SELECT ${PARTICIPANT_SELECT} FROM match_participants WHERE fp = $1 AND match_id = $2`,
      [fp, matchId],
    ),
  ]);
  const meta = metaRows[0] as unknown as MatchMetaRow | undefined;
  if (!meta) return null;
  const rows = parts as unknown as ParticipantRow[];
  if (rows.length === 0) return null; // 참가자 행이 없으면 없는 매치로 — 호출자가 재조회
  return assemble(meta, rows);
}

/** 특정 소환사가 참가한 저장된 매치들 (최신순) — (fp, puuid, game_creation) 인덱스 */
export async function loadMatchesByPuuid(fp: string, puuid: string, limit: number): Promise<MatchInfo[]> {
  const sql = await getSql();
  const ids = (await sql`
    SELECT match_id FROM match_participants
    WHERE fp = ${fp} AND puuid = ${puuid}
    ORDER BY game_creation DESC LIMIT ${limit}`) as unknown as { match_id: string }[];
  if (ids.length === 0) return [];
  const matchIds = ids.map((r) => r.match_id);
  const [metaRows, parts] = await Promise.all([
    sql`SELECT match_id, game_creation, game_duration, queue_id, patch, bans, teams
        FROM matches WHERE fp = ${fp} AND match_id = ANY(${matchIds})`,
    sql.unsafe(
      `SELECT ${PARTICIPANT_SELECT} FROM match_participants WHERE fp = $1 AND match_id = ANY($2)`,
      [fp, matchIds],
    ),
  ]);
  const byId = new Map<string, ParticipantRow[]>();
  for (const r of parts as unknown as ParticipantRow[]) {
    const id = String(r.match_id);
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(r);
  }
  const metaById = new Map((metaRows as unknown as MatchMetaRow[]).map((m) => [m.match_id, m]));
  return matchIds
    .map((id) => {
      const meta = metaById.get(id);
      const rows = byId.get(id);
      return meta && rows?.length ? assemble(meta, rows) : null;
    })
    .filter((m): m is MatchInfo => m !== null);
}
