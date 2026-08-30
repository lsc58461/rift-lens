// 챔피언 통계 — 수집된 매치의 참가자 레코드를 챔피언 단위로 집계한다.
// 집계는 무겁기 때문에(참가자 수만 행 × 4개 쿼리) 결과를 KV에 6시간 캐시.

import "server-only";
import { cache, cached } from "@/lib/cache";
import {
  getChampionKeyToId,
  getCompletedItemIds,
  getDDragonVersion,
} from "@/lib/ddragon";
import { getSql } from "@/lib/db";
import { bracketOf, RANK_BRACKETS, type RankBracketKey } from "@/lib/rank-pts";
import { riotKeyFp } from "@/lib/riot/client";

const MIN_CHAMP_GAMES = 10; // 이보다 표본이 적은 챔피언은 목록에서 제외
const TTL_SECONDS = 24 * 60 * 60; // 캐시 보존(만료) — 실제 갱신 주기는 REFRESH_AFTER_MS

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

// 캐시 전략: stale-while-revalidate. 캐시가 있으면 나이와 무관하게 즉시 돌려주고,
// REFRESH_AFTER보다 오래됐으면 뒤에서 다시 집계해 갈아 끼운다. 유저가 재집계를
// 기다리는 건 캐시가 아예 없을 때뿐인데, 그건 부팅 워밍(warmChampionStats)이 막는다.
// TTL은 길게(하루) — 갱신 실패나 장시간 무방문에도 낡은 결과나마 즉시 나가게.
const REFRESH_AFTER_MS = 60 * 60_000;
const statsKey = (patch: string | null, bracket: RankBracketKey) =>
  `champstats:v8:${patch ?? "recent2"}:${bracket}`;
const refreshing = new Map<string, Promise<void>>();

function refreshInBackground(
  key: string,
  patch: string | null,
  bracket: RankBracketKey,
): void {
  if (refreshing.has(key)) return;
  const job = (async () => {
    // 인스턴스 2개가 같은 키를 동시에 재집계하지 않게 짧은 공유 마커
    const lockKey = `${key}:refreshing`;
    if (await cache.get<number>(lockKey).catch(() => null)) return;
    await cache.set(lockKey, Date.now(), 180).catch(() => {});
    try {
      const fresh = await buildStats(patch, bracket);
      await cache.set(key, fresh, TTL_SECONDS);
    } catch (e) {
      console.error(`[champstats] 백그라운드 재집계 실패 ${key}:`, (e as Error)?.message);
    } finally {
      await cache.delete(lockKey).catch(() => {});
    }
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, job);
}

export async function getChampionStats(
  patch: string | null = null,
  bracket: RankBracketKey = "all",
): Promise<ChampionStatsPayload> {
  const key = statsKey(patch, bracket);
  const hit = await cache.get<ChampionStatsPayload>(key).catch(() => null);
  if (hit) {
    if (!hit.computedAt || Date.now() - hit.computedAt > REFRESH_AFTER_MS) {
      refreshInBackground(key, patch, bracket);
    }
    return hit;
  }
  const fresh = await buildStats(patch, bracket);
  await cache.set(key, fresh, TTL_SECONDS).catch(() => {});
  return fresh;
}

/** 자주 보는 조합을 미리 집계해 둔다 — 부팅 직후·캐시 비움 직후 호출.
 *  최신 패치 × 모든 랭크 구간 + 직전 패치 × 기본 구간(에메랄드). */
export async function warmChampionStats(): Promise<void> {
  const patches = (await listPatches().catch(() => [])).slice(0, 2);
  const latest = patches[0]?.patch ?? null;
  const targets: [string | null, RankBracketKey][] = [
    ...RANK_BRACKETS.map((b): [string | null, RankBracketKey] => [latest, b.key]),
  ];
  if (patches[1]) targets.push([patches[1].patch, "emerald"]);
  for (const [patch, bracket] of targets) {
    await getChampionStats(patch, bracket).catch(() => {});
  }
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

  // 공통 서브쿼리 — 참가자 정규화 테이블(1행 = 1참가자). JSON 펼치기 없이
  // (fp, patch, champion_name)·(fp, patch, rank_pts) 인덱스를 탄다.
  // patchFilter의 m.patch / m.rank_pts 는 이 테이블에 같은 이름으로 복제돼 있다.
  const P = `
    SELECT champion_name AS champ, win,
           spell1 AS s1, spell2 AS s2,
           keystone, sub_style AS substyle,
           perks, sub_perks AS subperks, stat_perks AS statperks,
           team_position AS pos,
           kills::int, deaths::int, assists::int, cs, damage,
           items
    FROM match_participants m
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
      SELECT champ, it.id,
             count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
      FROM (${P}) p
      CROSS JOIN LATERAL unnest(p.items[1:6]) AS it(id)
      WHERE it.id > 0
      GROUP BY champ, it.id`),
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
    // int[]::text 는 "{1,2,3}" 형태 — JSON 배열("[1,2,3]")도 함께 허용
    const parse = (t: string | null): number[] => {
      if (!t) return [];
      try {
        const v = JSON.parse(t.replace(/^\{/, "[").replace(/\}$/, "]"));
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

  // ── 밴 집계 — match_bans(경기당 밴 행)를 매치(패치·구간 필터)와 조인해 챔피언별 밴 매치 수.
  // 밴 캡처 도입 후 매치만 대상이라, 분모(밴이 있는 매치 수)도 따로 구해 밴률을 낸다.
  const [banRows, banTotalRows] = await Promise.all([
    runQuery(sql, `
      SELECT b.champion_id AS champ_id, count(DISTINCT b.match_id)::int AS n
      FROM matches m
      JOIN match_bans b ON b.fp = m.fp AND b.match_id = m.match_id
      WHERE m.fp = $1 ${patchFilter}
      GROUP BY b.champion_id`,
      [fp],
    ),
    runQuery(sql, `SELECT count(*)::int AS n FROM matches m
       WHERE m.fp = $1 ${patchFilter}
         AND EXISTS (SELECT 1 FROM match_bans b WHERE b.fp = m.fp AND b.match_id = m.match_id)`,
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
