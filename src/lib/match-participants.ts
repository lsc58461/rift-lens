// 참가자 정규화 테이블(match_participants) — matches.participants(jsonb)에서 파생한
// "1행 = 1참가자" 테이블. 챔피언 통계·후보 검색·puuid 기준 조회처럼 참가자 단위
// 집계를 JSON 펼치기 없이 인덱스로 처리하기 위한 것.
//
// 원본은 여전히 matches.participants다. 이 테이블은 ① 매치 저장 시 함께 upsert(이중 기록)
// ② rank_pts 계산 시 함께 갱신 ③ 기존 매치는 백그라운드 적재로 채운다. 틀어지면
// 원본에서 언제든 다시 만들 수 있다(resyncMatch).
import "server-only";
import type { Sql } from "postgres";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/store";
import type { MatchInfo, MatchParticipant, PlatformRegion } from "@/lib/riot/types";

const STATE_KEY = "participants:backfill";
const LOCK_KEY = "participants:backfill:lock";
const BACKFILL_BATCH = 5_000; // 묶음당 매치 수 — DB 안에서 한 문장으로 처리
const TICK_BUDGET_MS = 50_000; // 1분 틱 안에서 연속 처리

export interface ParticipantsBackfillState {
  total: number; // 시작 시점 미적재 매치 수
  done: number;
  startedAt: number;
  updatedAt: number;
  finished: boolean;
  lastError: string | null;
}

interface ParticipantRow {
  fp: string;
  match_id: string;
  platform: string;
  puuid: string;
  idx: number;
  team_id: number;
  win: boolean;
  champion_name: string;
  champion_id: number | null;
  team_position: string;
  riot_game_name: string;
  riot_tag_line: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  gold: number | null;
  damage: number | null;
  damage_taken: number | null;
  vision: number | null;
  champ_level: number | null;
  spell1: number | null;
  spell2: number | null;
  keystone: number | null;
  sub_style: number | null;
  items: number[];
  double_kills: number;
  triple_kills: number;
  quadra_kills: number;
  penta_kills: number;
  kill_participation: number | null;
  perks: number[] | null;
  sub_perks: number[] | null;
  stat_perks: number[] | null;
  individual_position: string | null;
  cs_total: number | null;
  cs_jungle: number | null;
  gold_spent: number | null;
  damage_mitigated: number | null;
  damage_to_objectives: number | null;
  damage_to_turrets: number | null;
  total_heal: number | null;
  heal_on_teammates: number | null;
  shield_on_teammates: number | null;
  cc_score: number | null;
  turret_kills: number | null;
  inhibitor_kills: number | null;
  dragon_kills: number | null;
  baron_kills: number | null;
  objectives_stolen: number | null;
  wards_placed: number | null;
  wards_killed: number | null;
  control_wards_bought: number | null;
  largest_killing_spree: number | null;
  largest_multi_kill: number | null;
  solo_kills: number | null;
  first_blood_kill: boolean | null;
  first_tower_kill: boolean | null;
  game_ended_in_surrender: boolean | null;
  game_ended_in_early_surrender: boolean | null;
  ext_synced: boolean;
  game_creation: number;
  game_duration: number;
  queue_id: number;
  patch: string | null;
  rank_pts: number | null;
}

function toRows(
  fp: string,
  platform: string,
  m: {
    matchId: string;
    gameCreation: number;
    gameDuration: number;
    queueId: number;
    patch?: string | null;
    rankPts?: number | null;
    participants: MatchParticipant[];
  },
): ParticipantRow[] {
  return m.participants
    .filter((p) => p && p.puuid)
    .map((p, idx) => ({
      fp,
      match_id: m.matchId,
      platform,
      puuid: p.puuid,
      idx,
      team_id: p.teamId,
      win: p.win,
      champion_name: p.championName,
      champion_id: p.championId ?? null,
      team_position: p.teamPosition ?? "",
      riot_game_name: p.riotIdGameName ?? "",
      riot_tag_line: p.riotIdTagline ?? "",
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.cs ?? null,
      gold: p.goldEarned ?? null,
      damage: p.damage ?? null,
      damage_taken: p.damageTaken ?? null,
      vision: p.visionScore ?? null,
      champ_level: p.champLevel ?? null,
      spell1: p.spell1Id ?? null,
      spell2: p.spell2Id ?? null,
      keystone: p.keystone ?? null,
      sub_style: p.subStyle ?? null,
      items: (p.items ?? []).map((n) => Number(n) || 0),
      double_kills: p.doubleKills ?? 0,
      triple_kills: p.tripleKills ?? 0,
      quadra_kills: p.quadraKills ?? 0,
      penta_kills: p.pentaKills ?? 0,
      kill_participation: p.killParticipation ?? null,
      perks: p.perks ? p.perks.map(Number) : null,
      sub_perks: p.subPerks ? p.subPerks.map(Number) : null,
      stat_perks: p.statPerks ? p.statPerks.map(Number) : null,
      individual_position: p.individualPosition ?? null,
      cs_total: p.csTotal ?? null,
      cs_jungle: p.csJungle ?? null,
      gold_spent: p.goldSpent ?? null,
      damage_mitigated: p.damageMitigated ?? null,
      damage_to_objectives: p.damageToObjectives ?? null,
      damage_to_turrets: p.damageToTurrets ?? null,
      total_heal: p.totalHeal ?? null,
      heal_on_teammates: p.healOnTeammates ?? null,
      shield_on_teammates: p.shieldOnTeammates ?? null,
      cc_score: p.ccScore ?? null,
      turret_kills: p.turretKills ?? null,
      inhibitor_kills: p.inhibitorKills ?? null,
      dragon_kills: p.dragonKills ?? null,
      baron_kills: p.baronKills ?? null,
      objectives_stolen: p.objectivesStolen ?? null,
      wards_placed: p.wardsPlaced ?? null,
      wards_killed: p.wardsKilled ?? null,
      control_wards_bought: p.controlWardsBought ?? null,
      largest_killing_spree: p.largestKillingSpree ?? null,
      largest_multi_kill: p.largestMultiKill ?? null,
      solo_kills: p.soloKills ?? null,
      first_blood_kill: p.firstBloodKill ?? null,
      first_tower_kill: p.firstTowerKill ?? null,
      game_ended_in_surrender: p.gameEndedInSurrender ?? null,
      game_ended_in_early_surrender: p.gameEndedInEarlySurrender ?? null,
      ext_synced: true,
      game_creation: m.gameCreation,
      game_duration: m.gameDuration,
      queue_id: m.queueId,
      patch: m.patch ?? null,
      rank_pts: m.rankPts ?? null,
    }));
}

const COLS = [
  "fp", "match_id", "platform", "puuid", "idx", "team_id", "win", "champion_name", "champion_id",
  "team_position", "riot_game_name", "riot_tag_line", "kills", "deaths", "assists", "cs", "gold",
  "damage", "damage_taken", "vision", "champ_level", "spell1", "spell2", "keystone", "sub_style",
  "items", "double_kills", "triple_kills", "quadra_kills", "penta_kills", "kill_participation",
  "perks", "sub_perks", "stat_perks",
  "individual_position", "cs_total", "cs_jungle", "gold_spent", "damage_mitigated", "damage_to_objectives", "damage_to_turrets", "total_heal", "heal_on_teammates", "shield_on_teammates", "cc_score", "turret_kills", "inhibitor_kills", "dragon_kills", "baron_kills", "objectives_stolen", "wards_placed", "wards_killed", "control_wards_bought", "largest_killing_spree", "largest_multi_kill", "solo_kills", "first_blood_kill", "first_tower_kill", "game_ended_in_surrender", "game_ended_in_early_surrender", "ext_synced",
  "game_creation", "game_duration", "queue_id", "patch", "rank_pts",
] as const;

async function upsertRows(sql: Sql, rows: ParticipantRow[]): Promise<void> {
  if (rows.length === 0) return;
  // 매치 단위로 통째 교체(참가자 구성은 불변이라 upsert로 충분). rank_pts는 이미
  // 계산된 값이 있으면 보존한다(재저장으로 NULL이 덮어쓰지 않게).
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      INSERT INTO match_participants ${sql(chunk as unknown as Record<string, unknown>[], ...COLS)}
      ON CONFLICT (fp, match_id, puuid) DO UPDATE SET
        idx = EXCLUDED.idx, team_id = EXCLUDED.team_id, win = EXCLUDED.win,
        champion_name = EXCLUDED.champion_name, champion_id = EXCLUDED.champion_id,
        team_position = EXCLUDED.team_position,
        riot_game_name = EXCLUDED.riot_game_name, riot_tag_line = EXCLUDED.riot_tag_line,
        kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, assists = EXCLUDED.assists,
        cs = EXCLUDED.cs, gold = EXCLUDED.gold, damage = EXCLUDED.damage,
        damage_taken = EXCLUDED.damage_taken, vision = EXCLUDED.vision,
        champ_level = EXCLUDED.champ_level, spell1 = EXCLUDED.spell1, spell2 = EXCLUDED.spell2,
        keystone = EXCLUDED.keystone, sub_style = EXCLUDED.sub_style, items = EXCLUDED.items,
        double_kills = EXCLUDED.double_kills, triple_kills = EXCLUDED.triple_kills,
        quadra_kills = EXCLUDED.quadra_kills, penta_kills = EXCLUDED.penta_kills,
        kill_participation = EXCLUDED.kill_participation,
        perks = coalesce(EXCLUDED.perks, match_participants.perks),
        sub_perks = coalesce(EXCLUDED.sub_perks, match_participants.sub_perks),
        stat_perks = coalesce(EXCLUDED.stat_perks, match_participants.stat_perks),
        individual_position = coalesce(EXCLUDED.individual_position, match_participants.individual_position),
        cs_total = coalesce(EXCLUDED.cs_total, match_participants.cs_total),
        cs_jungle = coalesce(EXCLUDED.cs_jungle, match_participants.cs_jungle),
        gold_spent = coalesce(EXCLUDED.gold_spent, match_participants.gold_spent),
        damage_mitigated = coalesce(EXCLUDED.damage_mitigated, match_participants.damage_mitigated),
        damage_to_objectives = coalesce(EXCLUDED.damage_to_objectives, match_participants.damage_to_objectives),
        damage_to_turrets = coalesce(EXCLUDED.damage_to_turrets, match_participants.damage_to_turrets),
        total_heal = coalesce(EXCLUDED.total_heal, match_participants.total_heal),
        heal_on_teammates = coalesce(EXCLUDED.heal_on_teammates, match_participants.heal_on_teammates),
        shield_on_teammates = coalesce(EXCLUDED.shield_on_teammates, match_participants.shield_on_teammates),
        cc_score = coalesce(EXCLUDED.cc_score, match_participants.cc_score),
        turret_kills = coalesce(EXCLUDED.turret_kills, match_participants.turret_kills),
        inhibitor_kills = coalesce(EXCLUDED.inhibitor_kills, match_participants.inhibitor_kills),
        dragon_kills = coalesce(EXCLUDED.dragon_kills, match_participants.dragon_kills),
        baron_kills = coalesce(EXCLUDED.baron_kills, match_participants.baron_kills),
        objectives_stolen = coalesce(EXCLUDED.objectives_stolen, match_participants.objectives_stolen),
        wards_placed = coalesce(EXCLUDED.wards_placed, match_participants.wards_placed),
        wards_killed = coalesce(EXCLUDED.wards_killed, match_participants.wards_killed),
        control_wards_bought = coalesce(EXCLUDED.control_wards_bought, match_participants.control_wards_bought),
        largest_killing_spree = coalesce(EXCLUDED.largest_killing_spree, match_participants.largest_killing_spree),
        largest_multi_kill = coalesce(EXCLUDED.largest_multi_kill, match_participants.largest_multi_kill),
        solo_kills = coalesce(EXCLUDED.solo_kills, match_participants.solo_kills),
        first_blood_kill = coalesce(EXCLUDED.first_blood_kill, match_participants.first_blood_kill),
        first_tower_kill = coalesce(EXCLUDED.first_tower_kill, match_participants.first_tower_kill),
        game_ended_in_surrender = coalesce(EXCLUDED.game_ended_in_surrender, match_participants.game_ended_in_surrender),
        game_ended_in_early_surrender = coalesce(EXCLUDED.game_ended_in_early_surrender, match_participants.game_ended_in_early_surrender),
        ext_synced = true,
        game_creation = EXCLUDED.game_creation, game_duration = EXCLUDED.game_duration,
        queue_id = EXCLUDED.queue_id,
        patch = coalesce(EXCLUDED.patch, match_participants.patch),
        rank_pts = coalesce(EXCLUDED.rank_pts, match_participants.rank_pts)`;
  }
}

/** 매치 저장 직후 호출 — 방금 저장한 MatchInfo로 참가자 행 upsert (이중 기록) */
export async function syncParticipantsFromMatch(
  fp: string,
  platform: PlatformRegion,
  match: MatchInfo,
): Promise<void> {
  const sql = await getSql();
  await upsertRows(sql, toRows(fp, platform, match));
}

/** DB에 저장된 matches 행에서 다시 만든다 — 백필·복구용 */
export async function resyncMatches(fp: string, matchIds: string[]): Promise<number> {
  if (matchIds.length === 0) return 0;
  const sql = await getSql();
  const rows = (await sql`
    SELECT match_id, platform, game_creation, game_duration, queue_id, participants, patch, rank_pts
    FROM matches WHERE fp = ${fp} AND match_id = ANY(${matchIds})`) as unknown as {
    match_id: string;
    platform: string;
    game_creation: string | number;
    game_duration: number;
    queue_id: number;
    participants: MatchParticipant[];
    patch: string | null;
    rank_pts: number | null;
  }[];
  const all = rows.flatMap((r) =>
    toRows(fp, r.platform, {
      matchId: r.match_id,
      gameCreation: Number(r.game_creation),
      gameDuration: r.game_duration,
      queueId: r.queue_id,
      patch: r.patch,
      rankPts: r.rank_pts,
      participants: Array.isArray(r.participants) ? r.participants : [],
    }),
  );
  await upsertRows(sql, all);
  return rows.length;
}

/** 미적재 매치 한 묶음을 DB 안에서 바로 풀어 넣는다 — JSON을 노드로 가져오지 않아
 *  노드 왕복 방식보다 몇 배 빠르다. 백필 전용(이미 있는 매치는 건드리지 않음). */
async function backfillBatchSql(sql: Sql, fp: string, limit: number): Promise<number> {
  const rows = await sql.unsafe(
    `
    WITH todo AS (
      SELECT m.match_id, m.platform, m.game_creation, m.game_duration, m.queue_id,
             m.participants, m.patch, m.rank_pts
      FROM matches m
      WHERE m.fp = $1 AND NOT EXISTS (
        SELECT 1 FROM match_participants p WHERE p.fp = m.fp AND p.match_id = m.match_id)
      ORDER BY m.game_creation DESC
      LIMIT $2
    ),
    ins AS (
      INSERT INTO match_participants
        (fp, match_id, platform, puuid, idx, team_id, win, champion_name, champion_id,
         team_position, riot_game_name, riot_tag_line, kills, deaths, assists, cs, gold,
         damage, damage_taken, vision, champ_level, spell1, spell2, keystone, sub_style,
         items, double_kills, triple_kills, quadra_kills, penta_kills, kill_participation,
         perks, sub_perks, stat_perks,
         individual_position, cs_total, cs_jungle, gold_spent, damage_mitigated, damage_to_objectives, damage_to_turrets, total_heal, heal_on_teammates, shield_on_teammates, cc_score, turret_kills, inhibitor_kills, dragon_kills, baron_kills, objectives_stolen, wards_placed, wards_killed, control_wards_bought, largest_killing_spree, largest_multi_kill, solo_kills, first_blood_kill, first_tower_kill, game_ended_in_surrender, game_ended_in_early_surrender, ext_synced,
         game_creation, game_duration, queue_id, patch, rank_pts)
      SELECT $1, t.match_id, t.platform, p->>'puuid', (o.ord - 1)::smallint,
             coalesce((p->>'teamId')::int, 0)::smallint, coalesce((p->>'win')::boolean, false),
             coalesce(p->>'championName', ''), (p->>'championId')::int,
             coalesce(p->>'teamPosition', ''), coalesce(p->>'riotIdGameName', ''), coalesce(p->>'riotIdTagline', ''),
             coalesce((p->>'kills')::int, 0)::smallint, coalesce((p->>'deaths')::int, 0)::smallint,
             coalesce((p->>'assists')::int, 0)::smallint,
             (p->>'cs')::int, (p->>'goldEarned')::int, (p->>'damage')::int, (p->>'damageTaken')::int,
             (p->>'visionScore')::int::smallint, (p->>'champLevel')::int::smallint,
             (p->>'spell1Id')::int, (p->>'spell2Id')::int, (p->>'keystone')::int, (p->>'subStyle')::int,
             coalesce(ARRAY(SELECT coalesce(nullif(x, ''), '0')::int
                            FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p->'items') = 'array' THEN p->'items' ELSE '[]'::jsonb END) x), '{}'),
             coalesce((p->>'doubleKills')::int, 0)::smallint, coalesce((p->>'tripleKills')::int, 0)::smallint,
             coalesce((p->>'quadraKills')::int, 0)::smallint, coalesce((p->>'pentaKills')::int, 0)::smallint,
             (p->>'killParticipation')::real,
             CASE WHEN jsonb_typeof(p->'perks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(p->'perks') x) END,
             CASE WHEN jsonb_typeof(p->'subPerks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(p->'subPerks') x) END,
             CASE WHEN jsonb_typeof(p->'statPerks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(p->'statPerks') x) END,
             p->>'individualPosition',
             (p->>'csTotal')::int,
             (p->>'csJungle')::int,
             (p->>'goldSpent')::int,
             (p->>'damageMitigated')::int,
             (p->>'damageToObjectives')::int,
             (p->>'damageToTurrets')::int,
             (p->>'totalHeal')::int,
             (p->>'healOnTeammates')::int,
             (p->>'shieldOnTeammates')::int,
             (p->>'ccScore')::int,
             (p->>'turretKills')::int::smallint,
             (p->>'inhibitorKills')::int::smallint,
             (p->>'dragonKills')::int::smallint,
             (p->>'baronKills')::int::smallint,
             (p->>'objectivesStolen')::int::smallint,
             (p->>'wardsPlaced')::int::smallint,
             (p->>'wardsKilled')::int::smallint,
             (p->>'controlWardsBought')::int::smallint,
             (p->>'largestKillingSpree')::int::smallint,
             (p->>'largestMultiKill')::int::smallint,
             (p->>'soloKills')::int::smallint,
             (p->>'firstBloodKill')::boolean,
             (p->>'firstTowerKill')::boolean,
             (p->>'gameEndedInSurrender')::boolean,
             (p->>'gameEndedInEarlySurrender')::boolean, true,
             t.game_creation, t.game_duration, t.queue_id, t.patch, t.rank_pts
      FROM todo t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.participants) = 'array' THEN t.participants ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS o(p, ord)
      WHERE coalesce(p->>'puuid', '') <> ''
      ON CONFLICT (fp, match_id, puuid) DO NOTHING
      RETURNING match_id
    )
    SELECT count(DISTINCT match_id)::int AS n, (SELECT count(*)::int FROM todo) AS picked FROM ins`,
    [fp, limit],
  );
  const r = (rows as unknown as { n: number; picked: number }[])[0];
  // 참가자가 비어 있는 매치(picked > n)는 영원히 미적재로 남아 매번 뽑히므로,
  // 그런 매치는 더미 없이 건너뛰도록 호출자가 picked==0일 때만 종료 판단한다
  return r?.picked ?? 0;
}

const RUNES_STATE_KEY = "participants:runes-fill";

/** 룬 컬럼이 나중에 추가돼서, 먼저 적재된 행의 perks/sub_perks/stat_perks를 JSON에서
 *  채운다. 매치 단위 묶음으로 DB 안에서 처리. 반환: 이번에 처리한 매치 수 */
async function fillRuneColumnsBatch(sql: Sql, fp: string, limit: number): Promise<number> {
  const rows = await sql.unsafe(
    `
    WITH todo AS (
      SELECT DISTINCT p.match_id FROM match_participants p
      WHERE p.fp = $1 AND p.perks IS NULL AND p.keystone IS NOT NULL
      LIMIT $2
    ),
    src AS (
      SELECT m.match_id, pp->>'puuid' AS puuid,
             CASE WHEN jsonb_typeof(pp->'perks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(pp->'perks') x) END AS perks,
             CASE WHEN jsonb_typeof(pp->'subPerks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(pp->'subPerks') x) END AS sub_perks,
             CASE WHEN jsonb_typeof(pp->'statPerks') = 'array' THEN ARRAY(SELECT (x)::int FROM jsonb_array_elements_text(pp->'statPerks') x) END AS stat_perks
      FROM todo t JOIN matches m ON m.fp = $1 AND m.match_id = t.match_id
      CROSS JOIN LATERAL jsonb_array_elements(m.participants) pp
    ),
    upd AS (
      UPDATE match_participants p
      SET perks = coalesce(s.perks, '{}'), sub_perks = s.sub_perks, stat_perks = s.stat_perks
      FROM src s
      WHERE p.fp = $1 AND p.match_id = s.match_id AND p.puuid = s.puuid
      RETURNING p.match_id
    )
    SELECT (SELECT count(*)::int FROM todo) AS picked, count(DISTINCT match_id)::int AS n FROM upd`,
    [fp, limit],
  );
  const r = (rows as unknown as { picked: number; n: number }[])[0];
  return r?.picked ?? 0;
}

const EXT_STATE_KEY = "participants:ext-fill";

/** 확장 컬럼이 나중에 추가돼서, 먼저 적재된 행(ext_synced=false)을 JSON에서 채운다 */
async function fillExtColumnsBatch(sql: Sql, fp: string, limit: number): Promise<number> {
  const rows = await sql.unsafe(
    `
    WITH todo AS (
      SELECT DISTINCT p.match_id FROM match_participants p
      WHERE p.fp = $1 AND NOT p.ext_synced
      LIMIT $2
    ),
    src AS (
      SELECT m.match_id, pp->>'puuid' AS puuid,
             pp->>'individualPosition' AS individual_position,
             (pp->>'csTotal')::int AS cs_total,
             (pp->>'csJungle')::int AS cs_jungle,
             (pp->>'goldSpent')::int AS gold_spent,
             (pp->>'damageMitigated')::int AS damage_mitigated,
             (pp->>'damageToObjectives')::int AS damage_to_objectives,
             (pp->>'damageToTurrets')::int AS damage_to_turrets,
             (pp->>'totalHeal')::int AS total_heal,
             (pp->>'healOnTeammates')::int AS heal_on_teammates,
             (pp->>'shieldOnTeammates')::int AS shield_on_teammates,
             (pp->>'ccScore')::int AS cc_score,
             (pp->>'turretKills')::int::smallint AS turret_kills,
             (pp->>'inhibitorKills')::int::smallint AS inhibitor_kills,
             (pp->>'dragonKills')::int::smallint AS dragon_kills,
             (pp->>'baronKills')::int::smallint AS baron_kills,
             (pp->>'objectivesStolen')::int::smallint AS objectives_stolen,
             (pp->>'wardsPlaced')::int::smallint AS wards_placed,
             (pp->>'wardsKilled')::int::smallint AS wards_killed,
             (pp->>'controlWardsBought')::int::smallint AS control_wards_bought,
             (pp->>'largestKillingSpree')::int::smallint AS largest_killing_spree,
             (pp->>'largestMultiKill')::int::smallint AS largest_multi_kill,
             (pp->>'soloKills')::int::smallint AS solo_kills,
             (pp->>'firstBloodKill')::boolean AS first_blood_kill,
             (pp->>'firstTowerKill')::boolean AS first_tower_kill,
             (pp->>'gameEndedInSurrender')::boolean AS game_ended_in_surrender,
             (pp->>'gameEndedInEarlySurrender')::boolean AS game_ended_in_early_surrender
      FROM todo t JOIN matches m ON m.fp = $1 AND m.match_id = t.match_id
      CROSS JOIN LATERAL jsonb_array_elements(m.participants) pp
    ),
    upd AS (
      UPDATE match_participants p
      SET individual_position = s.individual_position, cs_total = s.cs_total, cs_jungle = s.cs_jungle, gold_spent = s.gold_spent, damage_mitigated = s.damage_mitigated, damage_to_objectives = s.damage_to_objectives, damage_to_turrets = s.damage_to_turrets, total_heal = s.total_heal, heal_on_teammates = s.heal_on_teammates, shield_on_teammates = s.shield_on_teammates, cc_score = s.cc_score, turret_kills = s.turret_kills, inhibitor_kills = s.inhibitor_kills, dragon_kills = s.dragon_kills, baron_kills = s.baron_kills, objectives_stolen = s.objectives_stolen, wards_placed = s.wards_placed, wards_killed = s.wards_killed, control_wards_bought = s.control_wards_bought, largest_killing_spree = s.largest_killing_spree, largest_multi_kill = s.largest_multi_kill, solo_kills = s.solo_kills, first_blood_kill = s.first_blood_kill, first_tower_kill = s.first_tower_kill, game_ended_in_surrender = s.game_ended_in_surrender, game_ended_in_early_surrender = s.game_ended_in_early_surrender, ext_synced = true
      FROM src s
      WHERE p.fp = $1 AND p.match_id = s.match_id AND p.puuid = s.puuid
      RETURNING p.match_id
    )
    SELECT (SELECT count(*)::int FROM todo) AS picked FROM upd LIMIT 1`,
    [fp, limit],
  );
  const r = (rows as unknown as { picked: number }[])[0];
  // upd가 0행이면 SELECT도 0행 — todo가 남아 있는데 매칭이 안 되는 경우(참가자 JSON 불일치)를
  // 무한 반복하지 않도록 그런 매치는 ext_synced=true로 마감한다
  if (!r) {
    await sql.unsafe(
      `UPDATE match_participants p SET ext_synced = true
       WHERE p.fp = $1 AND NOT p.ext_synced AND p.match_id IN (
         SELECT DISTINCT match_id FROM match_participants WHERE fp = $1 AND NOT ext_synced LIMIT $2)`,
      [fp, limit],
    );
    return 0;
  }
  return r.picked;
}

export async function getExtFillDone(): Promise<boolean> {
  return (await getSetting<{ finished: boolean }>(EXT_STATE_KEY))?.finished === true;
}

async function runExtFillTick(fp: string): Promise<void> {
  if (await getExtFillDone()) return;
  if (await cache.get<number>(LOCK_KEY).catch(() => null)) return;
  await cache.set(LOCK_KEY, Date.now(), 55).catch(() => {});
  const sql = await getSql();
  try {
    const deadline = Date.now() + TICK_BUDGET_MS;
    let done = 0;
    let picked = -1;
    while (Date.now() < deadline) {
      picked = await fillExtColumnsBatch(sql, fp, 2_000);
      if (picked === 0) {
        const left = await sql`
          SELECT count(*)::int AS n FROM match_participants WHERE fp = ${fp} AND NOT ext_synced`;
        if (((left[0]?.n as number) ?? 0) === 0) break;
        continue; // 마감 처리된 묶음이 있어 다음 묶음으로
      }
      done += picked;
    }
    const left = await sql`
      SELECT count(*)::int AS n FROM match_participants WHERE fp = ${fp} AND NOT ext_synced`;
    if (((left[0]?.n as number) ?? 0) === 0) {
      await setSetting(EXT_STATE_KEY, { finished: true, at: Date.now() });
      console.log("[participants] 확장 컬럼 채우기 완료");
    } else if (done > 0) {
      console.log(`[participants] 확장 컬럼 +${done}`);
    }
  } catch (e) {
    console.error("[participants] 확장 컬럼 채우기 실패:", (e as Error)?.message);
  } finally {
    await cache.delete(LOCK_KEY).catch(() => {});
  }
}

export async function getRunesFillDone(): Promise<boolean> {
  return (await getSetting<{ finished: boolean }>(RUNES_STATE_KEY))?.finished === true;
}

export function getParticipantsBackfillState(): Promise<ParticipantsBackfillState | null> {
  return getSetting<ParticipantsBackfillState>(STATE_KEY);
}

/** 아직 참가자 행이 없는 매치 수 */
export async function countParticipantsPending(fp: string): Promise<number> {
  const sql = await getSql();
  const r = await sql`
    SELECT count(*)::int AS n FROM matches m
    WHERE m.fp = ${fp} AND NOT EXISTS (
      SELECT 1 FROM match_participants p WHERE p.fp = m.fp AND p.match_id = m.match_id)`;
  return (r[0]?.n as number) ?? 0;
}

/** 1분마다 호출 — 잠금을 잡은 인스턴스가 50초 동안 5천 건 묶음으로 연속 적재.
 *  DB만 쓰므로 라이엇 한도와 무관. */
export async function runParticipantsBackfillTick(fp: string): Promise<void> {
  const state = await getParticipantsBackfillState();
  if (state?.finished) {
    await runRunesFillTick(fp);
    return;
  }
  if (await cache.get<number>(LOCK_KEY).catch(() => null)) return;
  await cache.set(LOCK_KEY, Date.now(), 55).catch(() => {});
  const sql = await getSql();
  try {
    if (!state) {
      const total = await countParticipantsPending(fp);
      await setSetting<ParticipantsBackfillState>(STATE_KEY, {
        total,
        done: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        finished: total === 0,
        lastError: null,
      });
      if (total === 0) return;
    }
    const deadline = Date.now() + TICK_BUDGET_MS;
    let done = 0;
    let lastPicked = 0;
    while (Date.now() < deadline) {
      const picked = await backfillBatchSql(sql, fp, BACKFILL_BATCH);
      lastPicked = picked;
      if (picked === 0) break;
      done += picked;
      // 참가자가 비어 있는 매치만 남아 같은 묶음이 반복되면(진전 없음) 중단
      if (picked < BACKFILL_BATCH) break;
    }
    const cur = (await getParticipantsBackfillState())!;
    const finished = lastPicked === 0 || (await countParticipantsPending(fp)) === 0;
    await setSetting(STATE_KEY, {
      ...cur,
      done: cur.done + done,
      finished,
      updatedAt: Date.now(),
      lastError: null,
    });
    if (finished) console.log("[participants] 적재 완료");
    else if (done > 0) console.log(`[participants] 적재 +${done}`);
  } catch (e) {
    const cur = await getParticipantsBackfillState();
    if (cur) {
      await setSetting(STATE_KEY, { ...cur, updatedAt: Date.now(), lastError: (e as Error)?.message ?? String(e) });
    }
    console.error("[participants] 적재 실패:", (e as Error)?.message);
  } finally {
    await cache.delete(LOCK_KEY).catch(() => {});
  }
}

/** 메인 적재가 끝난 뒤, 룬 컬럼이 비어 있는 행을 채운다 (50초 연속, 잠금 공유) */
async function runRunesFillTick(fp: string): Promise<void> {
  if (await getRunesFillDone()) {
    await runExtFillTick(fp);
    return;
  }
  if (await cache.get<number>(LOCK_KEY).catch(() => null)) return;
  await cache.set(LOCK_KEY, Date.now(), 55).catch(() => {});
  const sql = await getSql();
  try {
    const deadline = Date.now() + TICK_BUDGET_MS;
    let done = 0;
    let picked = -1;
    while (Date.now() < deadline) {
      picked = await fillRuneColumnsBatch(sql, fp, 3_000);
      if (picked === 0) break;
      done += picked;
    }
    if (picked === 0) {
      await setSetting(RUNES_STATE_KEY, { finished: true, at: Date.now() });
      console.log("[participants] 룬 컬럼 채우기 완료");
    } else if (done > 0) {
      console.log(`[participants] 룬 컬럼 +${done}`);
    }
  } catch (e) {
    console.error("[participants] 룬 컬럼 채우기 실패:", (e as Error)?.message);
  } finally {
    await cache.delete(LOCK_KEY).catch(() => {});
  }
}

// ── 읽기: 참가자 행 → MatchInfo 조립 (JSON 제거 2단계) ─────────────────────
// 컬럼 → MatchParticipant 필드. null은 키 자체를 빼서 JSON 시절의 "없음(undefined)"과
// 같게 만든다 — getMatch의 "cs가 undefined면 재조회" 같은 판정이 그대로 통한다.
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

type DbRow = Record<string, unknown>;

function rowToParticipant(r: DbRow): MatchParticipant {
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
  // 멀티킬·킬관여는 저장 시 0으로 기본값이 들어가지만, 확장 필드 미수집 매치(ext_synced=false,
  // 옛 매치)에선 "없음"이 맞다 — 그 경우 0 대신 생략해 JSON 시절과 같게 둔다
  const ext = r.ext_synced === true;
  for (const [col, field] of COL_TO_FIELD) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    if (!ext && ["doubleKills", "tripleKills", "quadraKills", "pentaKills"].includes(field) && Number(v) === 0) continue;
    p[field] = Array.isArray(v) ? v.map(Number) : v;
  }
  const items = r.items;
  if (Array.isArray(items) && items.length > 0) p.items = items.map(Number);
  return p as unknown as MatchParticipant;
}

const PARTICIPANT_SELECT = `
  fp, match_id, platform, puuid, idx, team_id, win, champion_name, champion_id, team_position,
  riot_game_name, riot_tag_line, kills, deaths, assists, cs, gold, damage, damage_taken, vision,
  champ_level, spell1, spell2, keystone, sub_style, items, double_kills, triple_kills, quadra_kills,
  penta_kills, kill_participation, perks, sub_perks, stat_perks, individual_position, cs_total,
  cs_jungle, gold_spent, damage_mitigated, damage_to_objectives, damage_to_turrets, total_heal,
  heal_on_teammates, shield_on_teammates, cc_score, turret_kills, inhibitor_kills, dragon_kills,
  baron_kills, objectives_stolen, wards_placed, wards_killed, control_wards_bought,
  largest_killing_spree, largest_multi_kill, solo_kills, first_blood_kill, first_tower_kill,
  game_ended_in_surrender, game_ended_in_early_surrender, ext_synced`;

interface MatchMetaRow {
  match_id: string;
  game_creation: string | number;
  game_duration: number;
  queue_id: number;
  patch: string | null;
  bans: unknown;
  teams: unknown;
}

function assemble(meta: MatchMetaRow, parts: DbRow[]): MatchInfo {
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

/** 매치 1건 — matches(메타) + match_participants(참가자 10행)로 조립 */
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
  const rows = parts as unknown as DbRow[];
  if (rows.length === 0) return null; // 참가자 행이 없으면(적재 전) 없는 매치로 — 호출자가 재조회
  return assemble(meta, rows);
}

/** 특정 소환사가 참가한 저장된 매치들 (최신순) — mp_puuid_time_idx 인덱스 사용 */
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
  const byId = new Map<string, DbRow[]>();
  for (const r of parts as unknown as DbRow[]) {
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
