// 소환사 시드 크롤 — 이미 저장된 매치의 참가자 중 아직 기록되지 않은 소환사를
// 찾아 빠른 분석을 돌리고 사이트에 등록한다. 외부 도구로 페이지를 순회하던
// 작업을 관리자 버튼으로 옮긴 것.
//
// 정밀 분석은 돌리지 않는다 — 새벽 크론이 스테일 판정으로 알아서 채운다.
// 라이엇 호출은 저우선순위라 유저 검색이 들어오면 자동으로 뒤로 밀린다.

import "server-only";
import {
  ensureQueuedAndSchedule,
  runDeepAnalysis,
  runQuickAnalysis,
} from "@/lib/mmr/deep-jobs";
import { recordSearch } from "@/lib/recent";
import { riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { getSql } from "@/lib/db";
import { chainNextRound } from "@/lib/round-chain";
import { getSetting, setSetting } from "@/lib/store";
import { canon } from "@/lib/identity";

const STATE_KEY = "crawl:state";
const PER_ROUND = 3; // 라운드당 분석할 후보 수
// 라운드 상한은 목표를 채우는 데 필요한 만큼 + 여유 — 폭주 방지용일 뿐
// 목표 상한(1000명) 기준으로 넉넉히 잡는다
const MAX_ROUNDS = 400;
const ROUND_STALE_MS = 300_000;
const SKIP_TTL = "7 days"; // 실패한 후보를 다시 시도하기까지의 유예

export type CrawlMode = "balanced" | "recent";

export interface CrawlState {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  target: number; // 이번 실행에서 수집할 소환사 수
  mode: CrawlMode; // balanced = 표본이 부족한 티어 우선
  withDeep: boolean; // 수집 직후 정밀 분석까지 실행할지
  deepDone: number; // 정밀까지 끝낸 수
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
    ...empty(Math.min(1000, Math.max(5, Math.floor(target))), mode, withDeep),
    running: true,
  };
  await save(next);
  return next;
}

export async function stopCrawl(): Promise<void> {
  const s = await getCrawlState();
  if (s) await save({ ...s, running: false, roundActive: false });
}

interface Candidate {
  name: string;
  tag: string;
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
  IRON: 1,
  BRONZE: 1,
  SILVER: 1,
  GOLD: 1,
  PLATINUM: 1,
  EMERALD: 1,
  DIAMOND: 1,
  MASTER: 0.4,
  GRANDMASTER: 0.1,
  CHALLENGER: 0.1,
};

/** 표본이 가장 부족한 티어를 고른다 — 후보 풀(스냅샷)에 미수집 인원이
 * 있는 티어 중에서 수집된 소환사 수가 가장 적은 티어. */
async function pickTargetTier(): Promise<string | null> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const [collected, available] = await Promise.all([
    sql`SELECT current_tier AS tier, count(*)::int AS n
        FROM recent_searches WHERE current_tier IS NOT NULL GROUP BY 1`,
    sql`SELECT ls.solo_tier AS tier, count(DISTINCT ls.puuid)::int AS n
        FROM league_snapshots ls
        WHERE ls.fp = ${fp} AND ls.solo_tier IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM recent_searches r WHERE r.puuid = ls.puuid)
        GROUP BY 1`,
  ]);
  const have = new Map(
    (collected as unknown as { tier: string; n: number }[]).map((r) => [r.tier, r.n]),
  );
  const pool = new Map(
    (available as unknown as { tier: string; n: number }[]).map((r) => [r.tier, r.n]),
  );
  let best: string | null = null;
  let bestScore = Infinity;
  for (const tier of TIER_LADDER) {
    if ((pool.get(tier) ?? 0) < 1) continue; // 후보가 없는 티어는 건너뜀
    // 가중치 보정 점수 — 상위 티어는 낮은 목표로 수렴
    const score = (have.get(tier) ?? 0) / (TIER_WEIGHT[tier] ?? 1);
    if (score < bestScore) {
      best = tier;
      bestScore = score;
    }
  }
  return best;
}

/** 특정 티어(스냅샷 기준)의 미수집 소환사를 매치 묶음 순서로 뽑는다 */
async function findTierCandidates(
  tier: string,
  limit: number,
): Promise<Candidate[]> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const rows = await sql`
    SELECT name, tag FROM (
      SELECT DISTINCT ON (lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')))
             p->>'riotIdGameName' AS name, p->>'riotIdTagline' AS tag,
             m.match_id AS mid, m.game_creation AS gc
      FROM matches m
      CROSS JOIN LATERAL jsonb_array_elements(m.participants) p
      WHERE m.fp = ${fp}
        AND coalesce(p->>'riotIdGameName', '') <> ''
        AND coalesce(p->>'riotIdTagline', '') <> ''
        AND EXISTS (
          SELECT 1 FROM league_snapshots ls
          WHERE ls.fp = m.fp AND ls.puuid = p->>'puuid'
            AND ls.solo_tier = ${tier})
        AND NOT EXISTS (
          SELECT 1 FROM recent_searches r
          WHERE r.platform = m.platform
            AND r.game_name_lower = lower(trim(p->>'riotIdGameName'))
            AND r.tag_line_lower = lower(trim(p->>'riotIdTagline')))
        AND NOT EXISTS (
          SELECT 1 FROM cache_entries c
          WHERE c.key = 'crawl-skip:' || lower(trim(p->>'riotIdGameName'))
                        || '#' || lower(trim(p->>'riotIdTagline'))
            AND c.expires_at > now())
      ORDER BY lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')),
               m.game_creation DESC
    ) s
    ORDER BY gc DESC, mid
    LIMIT ${limit}`;
  return rows as unknown as Candidate[];
}

/** 저장된 매치의 참가자 중 미기록·미실패 소환사를 뽑는다.
 * 같은 경기 참가자를 연달아 처리하면 서로의 로비·최근 경기가 겹쳐 랭크 캐시
 * 적중이 올라간다(=라이엇 호출 절약) — 그래서 무작위 대신 최신 매치 순으로 묶는다. */
async function findCandidates(limit: number): Promise<Candidate[]> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const rows = await sql`
    SELECT name, tag FROM (
      SELECT DISTINCT ON (lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')))
             p->>'riotIdGameName' AS name, p->>'riotIdTagline' AS tag,
             m.match_id AS mid, m.game_creation AS gc
      FROM matches m
      CROSS JOIN LATERAL jsonb_array_elements(m.participants) p
      WHERE m.fp = ${fp}
        AND coalesce(p->>'riotIdGameName', '') <> ''
        AND coalesce(p->>'riotIdTagline', '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM recent_searches r
          WHERE r.platform = m.platform
            AND r.game_name_lower = lower(trim(p->>'riotIdGameName'))
            AND r.tag_line_lower = lower(trim(p->>'riotIdTagline')))
        AND NOT EXISTS (
          SELECT 1 FROM cache_entries c
          WHERE c.key = 'crawl-skip:' || lower(trim(p->>'riotIdGameName'))
                        || '#' || lower(trim(p->>'riotIdTagline'))
            AND c.expires_at > now())
      ORDER BY lower(trim(p->>'riotIdGameName')), lower(trim(p->>'riotIdTagline')),
               m.game_creation DESC
    ) s
    ORDER BY gc DESC, mid
    LIMIT ${limit}`;
  return rows as unknown as Candidate[];
}

/** 실패한 후보는 한동안 다시 뽑지 않는다 (닉변·삭제 계정이 무한 재시도되는 것 방지) */
async function markSkip(c: Candidate): Promise<void> {
  const sql = await getSql();
  const key = `crawl-skip:${canon(c.name)}#${canon(c.tag)}`;
  await sql`
    INSERT INTO cache_entries (key, value, expires_at)
    VALUES (${key}, ${sql.json({ at: Date.now() })}, now() + ${SKIP_TTL}::interval)
    ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at`;
}

/** 한 라운드: 후보 몇 명을 빠른 분석하고 최근 검색에 등록한다.
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
    let candidates: Candidate[] = [];
    let pickedTier: string | null = null;
    if (state.mode === "balanced") {
      pickedTier = await pickTargetTier();
      if (pickedTier) {
        candidates = await findTierCandidates(pickedTier, want);
      }
    }
    if (candidates.length === 0) {
      pickedTier = null;
      candidates = await findCandidates(want);
    }
    if (candidates.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }

    let analyzed = 0;
    let failed = 0;
    let deepDone = 0;
    const roundStart = Date.now();
    for (const c of candidates) {
      // 정밀까지 돌리면 명당 시간이 길다 — 함수 제한 안에서 안전하게 중단
      if (Date.now() - roundStart > 200_000) break;
      // 후보 하나(~30초)마다 취소 확인
      const live = await getCrawlState();
      if (!live?.running) break;
      try {
        const result = await withLowPriority(() =>
          runQuickAnalysis("kr", c.name, c.tag),
        );
        await recordSearch({
          region: "kr",
          gameName: result.account.gameName,
          tagLine: result.account.tagLine,
          currentLabel: result.currentRank?.label ?? null,
          currentTier: result.currentRank?.tier ?? null,
          estimatedLabel: result.estimatedRank?.label ?? null,
          estimatedTier: result.estimatedRank?.tier ?? null,
          estimatedPoints: result.estimatedPoints,
        });
        analyzed++;
        // 옵션: 정밀 분석까지 — 러너 락이 비어 있을 때만 즉시 실행하고,
        // 막혀 있으면 건너뛴다(새벽 갱신이 이어받음)
        if (state.withDeep) {
          let deepRun: Promise<void> | null = null;
          await ensureQueuedAndSchedule("kr", c.name, c.tag, (p, g, t) => {
            deepRun = runDeepAnalysis(p, g, t);
          }).catch(() => {});
          if (deepRun) {
            await withLowPriority(() => deepRun as Promise<void>);
            deepDone++;
          }
        }
      } catch {
        failed++;
        await markSkip(c).catch(() => {});
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
      deepDone: (state.deepDone ?? 0) + deepDone,
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
