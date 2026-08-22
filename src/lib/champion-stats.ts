// 챔피언 통계 — 수집된 매치의 참가자 레코드를 챔피언 단위로 집계한다.
// 집계는 무겁기 때문에(참가자 수만 행 × 4개 쿼리) 결과를 KV에 6시간 캐시.

import "server-only";
import { cached } from "@/lib/cache";
import { getCompletedItemIds, getDDragonVersion } from "@/lib/ddragon";
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
  /** 주 트리 4개 · 보조 2개 · 파편 3개 — 풀 페이지가 저장된 경기만 집계 */
  perks: number[];
  subPerks: number[];
  statPerks: number[];
  games: number;
  wins: number;
}

export interface PositionStat {
  games: number;
  wins: number;
}

export interface StartItemStat {
  items: number[];
  games: number;
  wins: number;
}

export interface BuildPathStat {
  items: number[]; // 구매 순서대로
  games: number;
  wins: number;
}

export interface ChampionStat {
  champ: string;
  games: number;
  wins: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCs: number;
  avgDamage: number;
  positions: Record<string, PositionStat>;
  spells: SpellCombo[];
  items: ItemStat[];
  startItems: StartItemStat[];
  buildPaths: BuildPathStat[];
  runes: RuneStat[];
}

export interface ChampionStatsPayload {
  totalGames: number; // 집계에 쓰인 매치 수
  totalParticipants: number;
  patch: string | null; // null = 전체 패치
  champions: ChampionStat[];
  builtAt: number;
}

export function getChampionStats(
  patch: string | null = null,
): Promise<ChampionStatsPayload> {
  return cached(`champstats:v7:${patch ?? "recent2"}`, TTL_SECONDS, () =>
    buildStats(patch),
  );
}

/** 표본이 충분한 패치 목록 (최신순) */
export async function listPatches(): Promise<{ patch: string; games: number }[]> {
  return cached("champstats:patches:v1", 60 * 60, async () => {
    const sql = await getSql();
    const rows = await sql`
      SELECT patch, count(*)::int AS games FROM matches
      WHERE fp = ${riotKeyFp()} AND patch IS NOT NULL
      GROUP BY patch HAVING count(*) >= 50
      ORDER BY string_to_array(patch, '.')::int[] DESC`;
    return rows as unknown as { patch: string; games: number }[];
  });
}

async function buildStats(patch: string | null): Promise<ChampionStatsPayload> {
  const sql = await getSql();
  const fp = riotKeyFp();
  // 기본 보기(patch=null)는 '최근 2개 패치 합산' — 옛 패치 매치는 집계에서만
  // 제외되고 데이터는 계속 보존된다. 특정 패치를 고르면 그 패치만.
  let patchFilter = "";
  if (patch) {
    patchFilter = `AND m.patch = '${patch.replace(/[^0-9.]/g, "")}'`;
  } else {
    const recent = await sql`
      SELECT DISTINCT patch FROM matches WHERE fp = ${fp} AND patch IS NOT NULL
      ORDER BY string_to_array(patch, '.')::int[] DESC LIMIT 2`;
    const list = (recent as unknown as { patch: string }[])
      .map((r) => `'${r.patch.replace(/[^0-9.]/g, "")}'`)
      .join(",");
    if (list) patchFilter = `AND m.patch IN (${list})`;
  }
  // 아이템 통계는 완성 아이템만 — 컴포넌트·소모품이 섞이면 목록이 지저분하다
  const completed = new Set(
    await getCompletedItemIds(await getDDragonVersion()),
  );

  // 공통 서브쿼리 — 참가자 한 명이 한 행
  const P = `
    SELECT pp->>'championName' AS champ,
           (pp->>'win')::boolean AS win,
           (pp->>'spell1Id')::int AS s1,
           (pp->>'spell2Id')::int AS s2,
           (pp->>'keystone')::int AS keystone,
           (pp->>'subStyle')::int AS substyle,
           pp->'perks' AS perks,
           pp->'subPerks' AS subperks,
           pp->'statPerks' AS statperks,
           pp->>'teamPosition' AS pos,
           (pp->>'kills')::int AS kills,
           (pp->>'deaths')::int AS deaths,
           (pp->>'assists')::int AS assists,
           (pp->>'cs')::int AS cs,
           (pp->>'damage')::int AS damage,
           pp->'items' AS items
    FROM matches m
    CROSS JOIN LATERAL jsonb_array_elements(m.participants) pp
    WHERE m.fp = '${fp.replace(/'/g, "")}' ${patchFilter}`;

  const [meta, base, positions, spells, items, runes, startItems, buildPaths] = await Promise.all([
    sql.unsafe(
      `SELECT count(*)::int AS games FROM matches m
       WHERE m.fp = $1 ${patchFilter}`,
      [fp],
    ),
    sql.unsafe(`
      SELECT champ, count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins,
             coalesce(avg(kills), 0)::float AS ak,
             coalesce(avg(deaths), 0)::float AS ad,
             coalesce(avg(assists), 0)::float AS aa,
             coalesce(avg(cs), 0)::float AS acs,
             coalesce(avg(damage), 0)::float AS admg
      FROM (${P}) p GROUP BY champ`),
    sql.unsafe(`
      SELECT champ, pos, count(*)::int AS n, count(*) FILTER (WHERE win)::int AS w
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
             perks::text AS perks, subperks::text AS subperks, statperks::text AS statperks,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p
      WHERE keystone IS NOT NULL AND substyle IS NOT NULL AND perks IS NOT NULL
      GROUP BY champ, keystone, substyle, perks::text, subperks::text, statperks::text`),
    sql.unsafe(
      `SELECT champ, items, games, wins FROM start_items WHERE fp = $1`,
      [fp],
    ),
    sql.unsafe(
      `SELECT champ, path, games, wins FROM build_paths WHERE fp = $1`,
      [fp],
    ),
  ]);

  const map = new Map<string, ChampionStat>();
  for (const r of base as unknown as { champ: string; games: number; wins: number; ak: number; ad: number; aa: number; acs: number; admg: number }[]) {
    if (!r.champ || r.games < MIN_CHAMP_GAMES) continue;
    map.set(r.champ, {
      champ: r.champ,
      games: r.games,
      wins: r.wins,
      avgKills: r.ak,
      avgDeaths: r.ad,
      avgAssists: r.aa,
      avgCs: r.acs,
      avgDamage: r.admg,
      positions: {},
      spells: [],
      items: [],
      startItems: [],
      buildPaths: [],
      runes: [],
    });
  }
  for (const r of positions as unknown as { champ: string; pos: string; n: number; w: number }[]) {
    const c = map.get(r.champ);
    if (c) c.positions[r.pos] = { games: r.n, wins: r.w };
  }
  for (const r of spells as unknown as { champ: string; s1: number; s2: number; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 3) c.spells.push({ s1: r.s1, s2: r.s2, games: r.games, wins: r.wins });
  }
  for (const r of items as unknown as { champ: string; id: number; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (
      c &&
      r.games >= 5 &&
      !NON_BUILD_ITEMS.has(r.id) &&
      (completed.size === 0 || completed.has(r.id))
    )
      c.items.push({ id: r.id, games: r.games, wins: r.wins });
  }
  for (const r of runes as unknown as { champ: string; keystone: number; substyle: number; perks: string; subperks: string; statperks: string; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (!c || r.games < 2) continue;
    const parse = (t: string | null): number[] => {
      try {
        const v = JSON.parse(t ?? "[]");
        return Array.isArray(v) ? v.map(Number) : [];
      } catch {
        return [];
      }
    };
    c.runes.push({
      keystone: r.keystone,
      subStyle: r.substyle,
      perks: parse(r.perks),
      subPerks: parse(r.subperks),
      statPerks: parse(r.statperks),
      games: r.games,
      wins: r.wins,
    });
  }

  // 코어 빌드 순서 — 시작 아이템과 마찬가지로 패치 구분 없는 누적 집계
  for (const r of buildPaths as unknown as { champ: string; path: string; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 2)
      c.buildPaths.push({
        items: r.path.split(">").map(Number),
        games: r.games,
        wins: r.wins,
      });
  }

  // 시작 아이템은 패치 구분 없이 누적 집계된 값을 쓴다 (표본이 아직 적음)
  for (const r of startItems as unknown as { champ: string; items: string; games: number; wins: number }[]) {
    const c = map.get(r.champ);
    if (c && r.games >= 2)
      c.startItems.push({
        items: r.items.split(",").map(Number),
        games: r.games,
        wins: r.wins,
      });
  }

  const champions = [...map.values()]
    .map((c) => ({
      ...c,
      spells: c.spells.sort((a, b) => b.games - a.games).slice(0, 3),
      startItems: c.startItems.sort((a, b) => b.games - a.games).slice(0, 3),
      buildPaths: c.buildPaths.sort((a, b) => b.games - a.games).slice(0, 3),
      items: c.items.sort((a, b) => b.games - a.games).slice(0, 12),
      runes: c.runes.sort((a, b) => b.games - a.games).slice(0, 3),
    }))
    .sort((a, b) => b.games - a.games);

  return {
    totalGames: (meta as unknown as { games: number }[])[0]?.games ?? 0,
    totalParticipants: champions.reduce((a, c) => a + c.games, 0),
    patch,
    champions,
    builtAt: Date.now(),
  };
}
