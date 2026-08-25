// 소환사 시드 크롤 — 이미 저장된 매치의 참가자 중 아직 기록되지 않은 소환사를
// 찾아 사이트에 "등록만" 한다(라이엇 호출 0). 이름·puuid·티어는 매치 참가자와
// 랭크 스냅샷에 이미 있으므로 DB만으로 충분하다.
//
// 전적(빠른 추정 → 정밀 분석 → 빌드 수확)은 전체 유저 데이터 갱신·새벽 크론이
// 스테일 판정으로 채운다 — 같은 일을 두 곳에서 하지 않는다. 등록 시각은 먼
// 과거로 박아 갱신 순회에서 실제 유저 뒤에 오게 하고 홈 최근 검색에도 안 섞이게 한다.

import "server-only";
import { pointsToRank, rankToPoints } from "@/lib/mmr/rank";
import { riotKeyFp } from "@/lib/riot/client";
import { getSql } from "@/lib/db";
import { chainNextRound } from "@/lib/round-chain";
import { getSetting, setSetting, upsertRecentSearch } from "@/lib/store";

const STATE_KEY = "crawl:state";
const MAX_TARGET = 10_000; // 한 번에 수집할 최대 소환사 수
// 후보 쿼리는 매치 전체(참가자 백만 행+)를 훑어 LIMIT과 무관하게 ~30초가 든다.
// 그래서 라운드마다 한 번만 크게 받아(FETCH_LIMIT) JS에서 티어 균형을 맞춰 고른다.
const PER_ROUND = 2000; // 라운드당 등록 수 (DB 인서트만이라 빠르다)
const FETCH_LIMIT = 10000; // 라운드당 후보 조회 수 (희귀 티어도 섞이도록 넉넉히)
// 라운드 상한은 목표를 채우는 데 필요한 만큼 + 여유 — 폭주 방지용일 뿐
// 목표 상한(10000명 ÷ 라운드당 2000명 = 5라운드) 기준으로 넉넉히 잡는다
const MAX_ROUNDS = 100;
const ROUND_STALE_MS = 300_000;

export type CrawlMode = "balanced" | "recent";

export interface CrawlState {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  target: number; // 이번 실행에서 수집할 소환사 수
  mode: CrawlMode; // balanced = 표본이 부족한 티어 우선
  withDeep: boolean; // (구버전 호환, 미사용 — 등록만 하므로 정밀은 갱신이 담당)
  deepDone: number; // (구버전 호환, 미사용)
  lastTier: string | null; // 직전 라운드가 타깃한 티어 (balanced 전용)
  rounds: number;
  analyzed: number;
  failed: number;
  startedAt: number;
  updatedAt: number;
  lastError: string | null;
}

function empty(
  target: number,
  mode: CrawlMode,
  withDeep: boolean,
): CrawlState {
  return {
    running: false,
    roundActive: false,
    done: false,
    target,
    mode,
    withDeep,
    deepDone: 0,
    lastTier: null,
    rounds: 0,
    analyzed: 0,
    failed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastError: null,
  };
}

export function getCrawlState(): Promise<CrawlState | null> {
  return getSetting<CrawlState>(STATE_KEY);
}

async function save(s: CrawlState): Promise<void> {
  await setSetting(STATE_KEY, { ...s, updatedAt: Date.now() });
}

export async function beginCrawl(
  target: number,
  mode: CrawlMode = "balanced",
  withDeep = false,
): Promise<CrawlState> {
  const next = {
    ...empty(Math.min(MAX_TARGET, Math.max(5, Math.floor(target))), mode, withDeep),
    running: true,
  };
  await save(next);
  return next;
}

export async function stopCrawl(): Promise<void> {
  const s = await getCrawlState();
  if (s) await save({ ...s, running: false, roundActive: false });
}

/** 종료 직전 라운드 놓기 — 새 인스턴스가 즉시 이어받도록 (refresh-all과 동일) */
export async function releaseCrawlRound(): Promise<boolean> {
  const s = await getCrawlState();
  if (!s?.running || !s.roundActive) return false;
  await save({ ...s, roundActive: false });
  return true;
}

interface Candidate {
  name: string;
  tag: string;
  puuid: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
}

/** 등록 시각 — 갱신 순회(최근 검색순)에서 실제 유저 뒤로, 홈 최근 검색 밖으로 */
const SEED_SEARCHED_AT = new Date("2000-01-01T00:00:00Z");

/** 스냅샷 랭크로 표시용 라벨을 만든다 (정밀 갱신 전까지의 임시 값) */
function snapshotLabel(c: Candidate): string | null {
  if (!c.tier) return null;
  try {
    return pointsToRank(rankToPoints(c.tier, c.rank ?? "IV", c.lp ?? 0)).label;
  } catch {
    return null;
  }
}

const TIER_LADDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

// 티어별 수집 가중치 — 균등하게 맞추면 래더에서 극소수인 상위 티어가
// 일반 티어와 같은 인원까지 수집돼 표본이 왜곡된다(챌린저 폭증 문제).
// 수집량은 (수집 수 / 가중치)가 가장 작은 티어부터 채워지므로,
// 가중치 0.1이면 일반 티어의 10% 수준에서 수렴한다.
const TIER_WEIGHT: Record<string, number> = {
  // OP.GG KR 솔랭 티어 분포(2026-08-25 기준)를 골드(23.6%)=1로 정규화한 값.
  // 아이언 3.2 · 브론즈 15.3 · 실버 21.3 · 골드 23.6 · 플래 18.6 · 에메 13.9 · 다이아 3.5
  IRON: 0.14,
  BRONZE: 0.65,
  SILVER: 0.9,
  GOLD: 1,
  PLATINUM: 0.79,
  EMERALD: 0.59,
  DIAMOND: 0.15,
  // 마스터 이상은 실제 비율(0.97/0.02/0.01%)대로면 표본이 수십 명뿐이라
  // "마스터+" 통계 구간이 비어 버린다 — 바닥값을 둬 최소 표본을 확보한다.
  MASTER: 0.12,
  GRANDMASTER: 0.03,
  CHALLENGER: 0.03,
};

/** 이미 등록된 소환사의 티어별 인원 */
async function collectedByTier(): Promise<Map<string, number>> {
  const sql = await getSql();
  const rows = await sql`
    SELECT current_tier AS tier, count(*)::int AS n
    FROM recent_searches WHERE current_tier IS NOT NULL GROUP BY 1`;
  return new Map(
    (rows as unknown as { tier: string; n: number }[]).map((r) => [r.tier, r.n]),
  );
}

/** 후보 풀에서 티어 균형을 맞춰 want명을 고른다 — 매번 (등록 수 ÷ 가중치)가
 * 가장 작은 티어에서 한 명씩. 풀에 그 티어가 없으면 다음으로 부족한 티어.
 * 스냅샷이 없어 티어를 모르는 후보는 맨 마지막에 채운다. */
function pickBalanced(
  pool: Candidate[],
  want: number,
  have: Map<string, number>,
): { picked: Candidate[]; topTier: string | null } {
  const byTier = new Map<string, Candidate[]>();
  const unknown: Candidate[] = [];
  for (const c of pool) {
    if (!c.tier) unknown.push(c);
    else {
      const arr = byTier.get(c.tier) ?? [];
      arr.push(c);
      byTier.set(c.tier, arr);
    }
  }
  const counts = new Map(have);
  const pickedPerTier = new Map<string, number>();
  const picked: Candidate[] = [];
  while (picked.length < want) {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const tier of TIER_LADDER) {
      if (!byTier.get(tier)?.length) continue;
      const score = (counts.get(tier) ?? 0) / (TIER_WEIGHT[tier] ?? 1);
      if (score < bestScore) {
        best = tier;
        bestScore = score;
      }
    }
    if (!best) break;
    picked.push(byTier.get(best)!.shift()!);
    counts.set(best, (counts.get(best) ?? 0) + 1);
    pickedPerTier.set(best, (pickedPerTier.get(best) ?? 0) + 1);
  }
  while (picked.length < want && unknown.length) picked.push(unknown.shift()!);
  const topTier =
    [...pickedPerTier.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { picked, topTier };
}

/** 저장된 매치의 참가자 중 미등록 소환사를 최신 매치 순으로 뽑는다
 * (같은 경기 참가자가 묶여 나오면 나중에 갱신할 때 로비·경기가 겹쳐 캐시 적중이 오른다) */
async function findCandidates(limit: number): Promise<Candidate[]> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const rows = await sql`
    SELECT name, tag, puuid, tier, rank, lp FROM (
      SELECT DISTINCT ON (lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')))
             p->>'riotIdGameName' AS name, p->>'riotIdTagline' AS tag,
             p->>'puuid' AS puuid,
             ls.solo_tier AS tier, ls.solo_rank AS rank, ls.solo_lp AS lp,
             m.match_id AS mid, m.game_creation AS gc
      FROM matches m
      CROSS JOIN LATERAL jsonb_array_elements(m.participants) p
      LEFT JOIN LATERAL (
        SELECT solo_tier, solo_rank, solo_lp FROM league_snapshots l
        WHERE l.fp = m.fp AND l.platform = m.platform AND l.puuid = p->>'puuid'
          AND l.solo_tier IS NOT NULL
        ORDER BY l.created_at DESC LIMIT 1) ls ON true
      WHERE m.fp = ${fp}
        AND coalesce(p->>'riotIdGameName', '') <> ''
        AND coalesce(p->>'riotIdTagline', '') <> ''
        AND coalesce(p->>'puuid', '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM recent_searches r
          WHERE r.platform = m.platform
            AND r.game_name_lower = lower(trim(p->>'riotIdGameName'))
            AND r.tag_line_lower = lower(trim(p->>'riotIdTagline')))
        AND NOT EXISTS (
          SELECT 1 FROM recent_searches r WHERE r.puuid = p->>'puuid')
      ORDER BY lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')),
               m.game_creation DESC
    ) s
    ORDER BY gc DESC, mid
    LIMIT ${limit}`;
  return rows as unknown as Candidate[];
}

/** 한 라운드: 후보를 DB 정보만으로 최근 검색에 등록한다 (라이엇 호출 없음).
 * origin이 있으면 라운드 후 서버가 스스로 다음 라운드를 잇는다. */
export async function runCrawlRound(origin?: string): Promise<void> {
  let state = await getCrawlState();
  if (!state?.running) return;
  if (state.roundActive && Date.now() - state.updatedAt < ROUND_STALE_MS) return;
  if (state.rounds >= MAX_ROUNDS || state.analyzed >= state.target) {
    await save({ ...state, running: false, roundActive: false, done: true });
    return;
  }

  await save({ ...state, roundActive: true });

  try {
    const want = Math.min(PER_ROUND, state.target - state.analyzed);
    const pool = await findCandidates(FETCH_LIMIT);
    if (pool.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }
    let candidates: Candidate[];
    let pickedTier: string | null = null;
    if (state.mode === "balanced") {
      const r = pickBalanced(pool, want, await collectedByTier());
      candidates = r.picked;
      pickedTier = r.topTier;
    } else {
      candidates = pool.slice(0, want);
    }

    let analyzed = 0;
    let failed = 0;
    let i = 0;
    for (const c of candidates) {
      // 20명마다 취소 확인
      if (i++ % 20 === 0 && !((await getCrawlState())?.running ?? false)) break;
      try {
        await upsertRecentSearch({
          platform: "kr",
          gameName: c.name.trim(),
          tagLine: c.tag.trim(),
          currentLabel: snapshotLabel(c),
          currentTier: c.tier,
          estimatedLabel: null,
          estimatedTier: null,
          estimatedPoints: null,
          puuid: c.puuid,
          searchedAt: SEED_SEARCHED_AT,
        });
        analyzed++;
      } catch {
        failed++;
      }
    }

    state = await getCrawlState();
    if (!state) return;
    await save({
      ...state,
      roundActive: false,
      rounds: state.rounds + 1,
      analyzed: state.analyzed + analyzed,
      failed: state.failed + failed,
      lastTier: pickedTier,
      lastError: null,
    });
    // 아직 할 일이 남았으면 탭 폴링 없이도 다음 라운드를 잇는다
    const next = await getCrawlState();
    if (origin && next?.running && !next.done) {
      await chainNextRound(origin, "/api/admin/crawl");
    }
  } catch (e) {
    const s = await getCrawlState();
    if (s) {
      await save({
        ...s,
        running: false,
        roundActive: false,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
