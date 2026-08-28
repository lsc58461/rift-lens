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
  if (await getRunesFillDone()) return;
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
