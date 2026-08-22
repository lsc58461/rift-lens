// 챔피언 통계 — 수집된 매치의 참가자 레코드를 챔피언 단위로 집계한다.
// 집계는 무겁기 때문에(참가자 수만 행 × 4개 쿼리) 결과를 KV에 6시간 캐시.

import "server-only";
import { cached } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { riotKeyFp } from "@/lib/riot/client";

const MIN_CHAMP_GAMES = 10; // 이보다 표본이 적은 챔피언은 목록에서 제외
const TTL_SECONDS = 6 * 60 * 60;

// 슬롯 0~5에 등장하지만 빌드가 아닌 소모품·와드류
const NON_BUILD_ITEMS = new Set([
  2003, 2031, 2033, 2055, 2138, 2139, 2140, 3340, 3363, 3364,
]);

export interface SpellCombo {
  s1: number;
  s2: number;
  games: number;
  wins: number;
}

export interface ItemStat {
  id: number;
  games: number;
  wins: number;
}

export interface RuneStat {
  keystone: number;
  subStyle: number;
  games: number;
  wins: number;
}

export interface ChampionStat {
  champ: string;
  games: number;
  wins: number;
  positions: Record<string, number>;
  spells: SpellCombo[];
  items: ItemStat[];
  runes: RuneStat[];
}

export interface ChampionStatsPayload {
  totalGames: number; // 집계에 쓰인 매치 수
  totalParticipants: number;
  champions: ChampionStat[];
  builtAt: number;
}

export function getChampionStats(): Promise<ChampionStatsPayload> {
  return cached("champstats:v1", TTL_SECONDS, buildStats);
}

async function buildStats(): Promise<ChampionStatsPayload> {
  const sql = await getSql();
  const fp = riotKeyFp();

  // 공통 서브쿼리 — 참가자 한 명이 한 행
  const P = `
    SELECT pp->>'championName' AS champ,
           (pp->>'win')::boolean AS win,
           (pp->>'spell1Id')::int AS s1,
           (pp->>'spell2Id')::int AS s2,
           (pp->>'keystone')::int AS keystone,
           (pp->>'subStyle')::int AS substyle,
           pp->>'teamPosition' AS pos,
           pp->'items' AS items
    FROM matches m
    CROSS JOIN LATERAL jsonb_array_elements(m.participants) pp
    WHERE m.fp = '${fp.replace(/'/g, "")}'`;

  const [meta, base, positions, spells, items, runes] = await Promise.all([
    sql.unsafe(`SELECT count(*)::int AS games FROM matches WHERE fp = $1`, [fp]),
    sql.unsafe(`
      SELECT champ, count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p GROUP BY champ`),
    sql.unsafe(`
      SELECT champ, pos, count(*)::int AS n
      FROM (${P}) p WHERE coalesce(pos, '') <> '' GROUP BY champ, pos`),
    sql.unsafe(`
      SELECT champ, least(s1, s2) AS s1, greatest(s1, s2) AS s2,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p WHERE s1 IS NOT NULL AND s2 IS NOT NULL
      GROUP BY champ, least(s1, s2), greatest(s1, s2)`),
    sql.unsafe(`
      SELECT champ, (it.val #>> '{}')::int AS id,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p
      CROSS JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS it(val, ord)
      WHERE it.ord <= 6 AND (it.val #>> '{}')::int > 0
      GROUP BY champ, (it.val #>> '{}')::int`),
    sql.unsafe(`
      SELECT champ, keystone, substyle,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p WHERE keystone IS NOT NULL AND substyle IS NOT NULL
      GROUP BY champ, keystone, substyle`),
  ]);

  const map = new Map<string, ChampionStat>();
  for (const r of base as unknown as { champ: string; games: number; wins: number }[]) {
    if (!r.champ || r.games < MIN_CHAMP_GAMES) continue;
    map.set(r.champ, {
      champ: r.champ,
      games: r.games,
      wins: r.wins,
      positions: {},
      spells: [],
      items: [],
      runes: [],
    });
  }
  for (const r of positions as unknown as { champ: string; pos: string; n: number }[]) {
    map.get(r.champ)?.positions &&
      (map.get(r.champ)!.positions[r.pos] = r.n);
  }
  for (const r of spells as unknown as { champ: string; s1: number; s2: number; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 3) c.spells.push({ s1: r.s1, s2: r.s2, games: r.games, wins: r.wins });
  }
  for (const r of items as unknown as { champ: string; id: number; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 5 && !NON_BUILD_ITEMS.has(r.id))
      c.items.push({ id: r.id, games: r.games, wins: r.wins });
  }
  for (const r of runes as unknown as { champ: string; keystone: number; substyle: number; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 3)
      c.runes.push({ keystone: r.keystone, subStyle: r.substyle, games: r.games, wins: r.wins });
  }

  const champions = [...map.values()]
    .map((c) => ({
      ...c,
      spells: c.spells.sort((a, b) => b.games - a.games).slice(0, 3),
      items: c.items.sort((a, b) => b.games - a.games).slice(0, 8),
      runes: c.runes.sort((a, b) => b.games - a.games).slice(0, 3),
    }))
    .sort((a, b) => b.games - a.games);

  return {
    totalGames: (meta as unknown as { games: number }[])[0]?.games ?? 0,
    totalParticipants: champions.reduce((a, c) => a + c.games, 0),
    champions,
    builtAt: Date.now(),
  };
}
