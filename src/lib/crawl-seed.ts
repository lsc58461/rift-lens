// 소환사 시드 크롤 — 이미 저장된 매치의 참가자 중 아직 기록되지 않은 소환사를
// 찾아 빠른 분석을 돌리고 사이트에 등록한다. 외부 도구로 페이지를 순회하던
// 작업을 관리자 버튼으로 옮긴 것.
//
// 정밀 분석은 돌리지 않는다 — 새벽 크론이 스테일 판정으로 알아서 채운다.
// 라이엇 호출은 저우선순위라 유저 검색이 들어오면 자동으로 뒤로 밀린다.

import "server-only";
import { runQuickAnalysis } from "@/lib/mmr/deep-jobs";
import { recordSearch } from "@/lib/recent";
import { riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { getSql } from "@/lib/db";
import { chainNextRound } from "@/lib/round-chain";
import { getSetting, setSetting } from "@/lib/store";
import { canon } from "@/lib/identity";

const STATE_KEY = "crawl:state";
const PER_ROUND = 3; // 라운드당 분석할 후보 수
const MAX_ROUNDS = 100;
const ROUND_STALE_MS = 300_000;
const SKIP_TTL = "7 days"; // 실패한 후보를 다시 시도하기까지의 유예

export interface CrawlState {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  target: number; // 이번 실행에서 수집할 소환사 수
  rounds: number;
  analyzed: number;
  failed: number;
  startedAt: number;
  updatedAt: number;
  lastError: string | null;
}

function empty(target: number): CrawlState {
  return {
    running: false,
    roundActive: false,
    done: false,
    target,
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

export async function beginCrawl(target: number): Promise<CrawlState> {
  const next = { ...empty(Math.min(100, Math.max(5, target))), running: true };
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
    const candidates = await findCandidates(want);
    if (candidates.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }

    let analyzed = 0;
    let failed = 0;
    for (const c of candidates) {
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
