// 참가자 정규화 테이블(match_participants) — matches.participants(jsonb)에서 파생한
// "1행 = 1참가자" 테이블. 챔피언 통계·후보 검색·puuid 기준 조회처럼 참가자 단위
// 집계를 JSON 펼치기 없이 인덱스로 처리하기 위한 것.
//
// 원본은 여전히 matches.participants다. 이 테이블은 ① 매치 저장 시 함께 upsert(이중 기록)
// ② rank_pts 계산 시 함께 갱신 ③ 기존 매치는 백그라운드 적재로 채운다. 틀어지면
// 원본에서 언제든 다시 만들 수 있다(resyncMatch).
import "server-only";
import type { Sql } from "postgres";
import { getSql } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/store";
import type { MatchInfo, MatchParticipant, PlatformRegion } from "@/lib/riot/types";

const STATE_KEY = "participants:backfill";
const BACKFILL_BATCH = 2_000; // 틱당 매치 수 (DB만 사용)

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

/** 1분마다 호출 — 미적재 매치를 한 묶음 적재. DB만 쓰므로 라이엇 한도와 무관.
 *  두 인스턴스가 겹쳐도 upsert라 안전하다(같은 일을 두 번 할 뿐). */
export async function runParticipantsBackfillTick(fp: string): Promise<void> {
  const state = await getParticipantsBackfillState();
  if (state?.finished) return;
  const sql = await getSql();
  try {
    const ids = (await sql`
      SELECT m.match_id FROM matches m
      WHERE m.fp = ${fp} AND NOT EXISTS (
        SELECT 1 FROM match_participants p WHERE p.fp = m.fp AND p.match_id = m.match_id)
      ORDER BY m.game_creation DESC
      LIMIT ${BACKFILL_BATCH}`) as unknown as { match_id: string }[];
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
    if (ids.length === 0) {
      const cur = (await getParticipantsBackfillState())!;
      await setSetting(STATE_KEY, { ...cur, finished: true, updatedAt: Date.now() });
      console.log("[participants] 적재 완료");
      return;
    }
    const n = await resyncMatches(fp, ids.map((r) => r.match_id));
    const cur = (await getParticipantsBackfillState())!;
    await setSetting(STATE_KEY, { ...cur, done: cur.done + n, updatedAt: Date.now(), lastError: null });
  } catch (e) {
    const cur = await getParticipantsBackfillState();
    if (cur) {
      await setSetting(STATE_KEY, { ...cur, updatedAt: Date.now(), lastError: (e as Error)?.message ?? String(e) });
    }
    console.error("[participants] 적재 실패:", (e as Error)?.message);
  }
}
