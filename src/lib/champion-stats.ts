// 챔피언 통계 — 수집된 매치의 참가자 레코드를 챔피언 단위로 집계한다.
// 집계는 무겁기 때문에(참가자 수만 행 × 4개 쿼리) 결과를 KV에 6시간 캐시.

import "server-only";
import { cached } from "@/lib/cache";
import {
  getChampionKeyToId,
  getCompletedItemIds,
  getDDragonVersion,
} from "@/lib/ddragon";
import { getSql } from "@/lib/db";
import { bracketOf, type RankBracketKey } from "@/lib/rank-pts";
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
  tier?: number; // 이 라인 기준 1(최상)~5 티어 (opgg식 상대 순위)
  score?: number; // 자체 점수(승률+픽·밴 프레즌스) — 정렬·표시용
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
  bans?: number; // 이 챔피언이 밴된 매치 수 (밴 캡처 도입 후 매치 기준)
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
  computedAt?: number; // 집계 시각(ms) — 캐시된 결과가 언제 것인지 표시용
  totalParticipants: number;
  bansMatchTotal?: number; // 밴이 캡처된 매치 수 (밴률 분모)
  patch: string | null; // null = 전체 패치
  champions: ChampionStat[];
  builtAt: number;
}

export function getChampionStats(
  patch: string | null = null,
  bracket: RankBracketKey = "all",
): Promise<ChampionStatsPayload> {
  return cached(
    `champstats:v8:${patch ?? "recent2"}:${bracket}`,
    TTL_SECONDS,
    () => buildStats(patch, bracket),
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

/** 유실·지연된 쿼리가 페이지를 영원히 잡지 않도록 타임아웃 + 1회 재시도 */
// postgres.js는 풀 초과분을 내부 대기열에 쌓는데, 드물게 대기열의 쿼리가
// 영영 디스패치되지 않는 문제가 있다(재시도하면 즉시 성공 — 실측 확인).
// 그래서 ① 동시 실행을 풀 크기 밑으로 우리가 직접 제한하고 ② 만일을 위한
// 타임아웃+1회 재시도를 남긴다.
const MAX_CONCURRENT = 3;
let running = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

async function runQuery(
  sql: Awaited<ReturnType<typeof getSql>>,
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> {
  const attempt = () =>
    withSlot(() =>
      Promise.race([
        sql.unsafe(text, params as never[]) as unknown as Promise<unknown[]>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("query timeout")), 30_000),
        ),
      ]),
    );
  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

async function buildStats(
  patch: string | null,
  bracket: RankBracketKey = "all",
): Promise<ChampionStatsPayload> {
  // 재집계 소요 시간 기록 — 패치당 매치가 늘면 느려진다. 10초를 넘기 시작하면
  // 참가자 정규화 테이블(match_participants)로 옮길 시점이다.
  const startedAt = Date.now();
  const sql = await getSql();
  const fp = riotKeyFp();
  // 기본 보기(patch=null)는 '최근 2개 패치 합산' — 옛 패치 매치는 집계에서만
  // 제외되고 데이터는 계속 보존된다. 특정 패치를 고르면 그 패치만.
  let patchFilter = "";
  if (patch) {
    patchFilter = `AND m.patch = '${patch.replace(/[^0-9.]/g, "")}'`;
  } else {
    const recent = await sql`
      SELECT patch FROM matches WHERE fp = ${fp} AND patch IS NOT NULL
      GROUP BY patch
      ORDER BY string_to_array(patch, '.')::int[] DESC LIMIT 2`;
    const list = (recent as unknown as { patch: string }[])
      .map((r) => `'${r.patch.replace(/[^0-9.]/g, "")}'`)
      .join(",");
    if (list) patchFilter = `AND m.patch IN (${list})`;
  }
  // 랭크 브라켓 필터 — rank_pts(참가자 평균 랭크점수) 범위. -1(계산불가)·NULL은
  // 브라켓 선택 시 자동 제외(>= min이 걸러줌). '전체'면 필터 없음.
  const b = bracketOf(bracket);
  let rankFilter = "";
  if (b.min !== null) rankFilter += ` AND m.rank_pts >= ${b.min}`;
  if (b.max !== null) rankFilter += ` AND m.rank_pts < ${b.max}`;
  // patchFilter에 합쳐 모든 쿼리에 함께 적용
  patchFilter += rankFilter;
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
    runQuery(sql, `SELECT count(*)::int AS games FROM matches m
       WHERE m.fp = $1 ${patchFilter}`,
      [fp],
    ),
    runQuery(sql, `
      SELECT champ, count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins,
             coalesce(avg(kills), 0)::float AS ak,
             coalesce(avg(deaths), 0)::float AS ad,
             coalesce(avg(assists), 0)::float AS aa,
             coalesce(avg(cs), 0)::float AS acs,
             coalesce(avg(damage), 0)::float AS admg
      FROM (${P}) p GROUP BY champ`),
    runQuery(sql, `
      SELECT champ, pos, count(*)::int AS n, count(*) FILTER (WHERE win)::int AS w
      FROM (${P}) p WHERE coalesce(pos, '') <> '' GROUP BY champ, pos`),
    runQuery(sql, `
      SELECT champ, least(s1, s2) AS s1, greatest(s1, s2) AS s2,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p WHERE s1 IS NOT NULL AND s2 IS NOT NULL
      GROUP BY champ, least(s1, s2), greatest(s1, s2)`),
    runQuery(sql, `
      SELECT champ, (it.val #>> '{}')::int AS id,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p
      CROSS JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS it(val, ord)
      WHERE it.ord <= 6 AND (it.val #>> '{}')::int > 0
      GROUP BY champ, (it.val #>> '{}')::int`),
    runQuery(sql, `
      SELECT champ, keystone, substyle,
             perks::text AS perks, subperks::text AS subperks, statperks::text AS statperks,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p
      WHERE keystone IS NOT NULL AND substyle IS NOT NULL AND perks IS NOT NULL
      GROUP BY champ, keystone, substyle, perks::text, subperks::text, statperks::text`),
    runQuery(sql, `SELECT champ, items, games, wins FROM start_items WHERE fp = $1`,
      [fp],
    ),
    runQuery(sql, `SELECT champ, path, games, wins FROM build_paths WHERE fp = $1`,
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

  // ── 밴 집계 — matches.bans(챔피언 id 배열)를 펼쳐 챔피언별 밴 매치 수를 센다.
  // 밴 캡처 도입 후 매치만 대상이라, 분모(밴 캡처된 매치 수)도 따로 구해 밴률을 낸다.
  const [banRows, banTotalRows] = await Promise.all([
    runQuery(sql, `
      SELECT (b.val #>> '{}')::int AS champ_id, count(*)::int AS n
      FROM matches m
      CROSS JOIN LATERAL jsonb_array_elements(m.bans) b(val)
      WHERE m.fp = $1 ${patchFilter}
      GROUP BY (b.val #>> '{}')::int`,
      [fp],
    ),
    runQuery(sql, `SELECT count(*)::int AS n FROM matches m
       WHERE m.fp = $1 AND jsonb_array_length(m.bans) > 0 ${patchFilter}`,
      [fp],
    ),
  ]);
  const keyToId = await getChampionKeyToId(await getDDragonVersion());
  const bansByChamp = new Map<string, number>();
  for (const r of banRows as unknown as { champ_id: number; n: number }[]) {
    const name = keyToId[r.champ_id];
    if (name) bansByChamp.set(name, r.n);
  }
  for (const c of champions) c.bans = bansByChamp.get(c.champ) ?? 0;
  const bansMatchTotal =
    (banTotalRows as unknown as { n: number }[])[0]?.n ?? 0;

  // ── 티어 산정(라인별 상대 순위, opgg식) ──────────────────
  // 점수 = 표본보정 승률(윌슨 하한) + 픽률·밴률 프레즌스 가중.
  // 라인마다 최소 표본 넘는 챔프만 대상으로 점수순 정렬 후 백분위로 1~5티어.
  const totalMatches =
    (meta as unknown as { games: number }[])[0]?.games ?? 0;
  const LANE_MIN = 20; // 이 라인에서 이 판수 미만이면 티어 산정 제외
  const wilson = (wins: number, games: number): number => {
    if (games === 0) return 0;
    const z = 1.96;
    const p = wins / games;
    return (
      (p + (z * z) / (2 * games) -
        z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)) /
      (1 + (z * z) / games)
    );
  };
  const score = (posGames: number, posWins: number, banCount: number): number => {
    const wr = wilson(posWins, posGames); // 0~1
    const pick = totalMatches ? posGames / totalMatches : 0;
    const ban = bansMatchTotal ? banCount / bansMatchTotal : 0;
    // 승률을 주로, 프레즌스(픽+밴)를 보조로 반영 (점수 대역 ~50대 유지)
    return wr * 100 + pick * 100 * 0.3 + ban * 100 * 0.15;
  };
  // 티어 컷 백분위(상위부터 누적): 1티어 8% / 2티어 20% / 3티어 50% / 4티어 78% / 나머지 5
  const tierOf = (rank: number, n: number): number => {
    const pct = n <= 1 ? 0 : rank / (n - 1); // 0=최상
    if (pct <= 0.08) return 1;
    if (pct <= 0.2) return 2;
    if (pct <= 0.5) return 3;
    if (pct <= 0.78) return 4;
    return 5;
  };
  for (const lane of ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]) {
    const pool = champions
      .map((c) => ({ c, p: c.positions[lane] }))
      .filter((x) => x.p && x.p.games >= LANE_MIN)
      .map((x) => ({
        c: x.c,
        p: x.p as PositionStat,
        s: score(x.p!.games, x.p!.wins, x.c.bans ?? 0),
      }))
      .sort((a, b) => b.s - a.s);
    pool.forEach((x, i) => {
      x.p.tier = tierOf(i, pool.length);
      x.p.score = Math.round(x.s * 100) / 100; // 소수 2자리
    });
  }

  const tookMs = Date.now() - startedAt;
  const totalGames = (meta as unknown as { games: number }[])[0]?.games ?? 0;
  (tookMs > 10_000 ? console.warn : console.log)(
    `[champstats] 재집계 patch=${patch ?? "recent2"} bracket=${bracket} games=${totalGames} took=${(tookMs / 1000).toFixed(1)}s${tookMs > 10_000 ? " — 느려짐: 참가자 테이블 전환 검토" : ""}`,
  );
  return {
    totalGames,
    computedAt: Date.now(),
    totalParticipants: champions.reduce((a, c) => a + c.games, 0),
    bansMatchTotal, // 밴이 캡처된 매치 수(밴률 분모)
    patch,
    champions,
    builtAt: Date.now(),
  };
}
