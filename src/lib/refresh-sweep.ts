// 갱신 스윕 — 기록된 소환사를 최근 검색 순으로 순회하며 스테일한 결과를
// 실제 검색 흐름과 동일하게(빠른 추정 → 이어서 정밀) 갱신한다.
// 새벽 크론과 관리자 '전체 갱신'이 공유한다. 관리자 쪽이 HTTP로 크론을
// 호출하면 함수가 자기 자신을 부르는 사슬이 생겨 Vercel 루프 감지(508)에
// 걸리므로, 반드시 이 함수를 직접 호출한다.

import "server-only";
import {
  ensureQueuedAndSchedule,
  getFreshDeepResult,
  getFreshQuickResult,
  getLatestMatchId,
  runDeepAnalysis,
  runQuickAnalysis,
} from "@/lib/mmr/deep-jobs";
import { getRecentSearches } from "@/lib/recent";
import { recomputeRankPtsBatch } from "@/lib/rank-pts";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { canon } from "@/lib/identity";
import { RiotApiError } from "@/lib/riot/types";

// 계정이 사라진(404) 소환사는 7일간 건너뛴다 — 매 라운드 같은 계정을
// 재시도하며 실패 수만 불리던 문제 방지. 닉변이면 puuid 폴백이 먼저 잡는다.
const GONE_TTL_SEC = 7 * 24 * 60 * 60;
const goneKey = (region: string, g: string, t: string) =>
  `sweep:gone:${region}:${canon(g)}#${canon(t)}`;

// 최근 이 시간 안에 정밀분석이 끝난 소환사는 DB만 보고 건너뛴다(라이엇 콜 0).
// 라운드마다 목록 처음부터 재스캔하는 구조라, 이게 없으면 10분 캐시가 만료될
// 때마다 ~수백 명의 최신 매치ID 조회가 반복돼 쿼터를 낭비했다.
const RECENT_DEEP_MS = 6 * 60 * 60_000;
async function deepAnalyzedWithin(
  platform: string,
  gameName: string,
  tagLine: string,
  ms: number,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    SELECT updated_at FROM analyses
    WHERE platform = ${platform} AND kind = 'deep'
      AND game_name_lower = ${canon(gameName)} AND tag_line_lower = ${canon(tagLine)}
    LIMIT 1`;
  const at = rows[0]?.updated_at as string | undefined;
  return !!at && Date.now() - new Date(at).getTime() < ms;
}

export interface SweepResult {
  quickRefreshed: string[];
  deepCompleted: number;
  deepBlocked: boolean;
  deepPending: boolean;
  brokeEarly: boolean;
  skipped: number;
  failed: number;
  /** 실패한 소환사와 사유 (진단용 — 상위 몇 건만) */
  failures: { who: string; error: string }[];
  /** brokeEarly 또는 deepPending — 다음 스윕이 이어받을 작업이 남음 */
  remaining: boolean;
}

export async function runRefreshSweep(opts: {
  /** 이번 스윕에서 빠른 추정을 새로 돌릴 최대 소환사 수 */
  limit: number;
  /** 스윕 전체 시간 예산 (ms) */
  budgetMs: number;
  /** 이 시점(ms) 이후엔 정밀 분석을 새로 시작하지 않음 — 시간 초과 방지 */
  deepDeadlineMs: number;
  /** false를 돌려주면 다음 소환사로 넘어가지 않고 즉시 중단 (취소 반영) */
  shouldContinue?: () => Promise<boolean>;
  /** 소환사 하나를 처리할 때마다 호출 — 라운드 중 실시간 진행 표시용 */
  onProgress?: (p: {
    scanned: number;
    total: number;
    refreshed: number;
    deepCompleted: number;
  }) => void | Promise<void>;
}): Promise<SweepResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  // 상한을 두면 그 뒤 소환사는 자동 갱신에서 영영 빠진다 — 전량 순회한다
  const recent = await getRecentSearches(Infinity); // 최근 검색 순
  let scanned = 0;
  const reportProgress = async () => {
    scanned++;
    await opts.onProgress?.({
      scanned,
      total: recent.length,
      refreshed: quickRefreshed.length,
      deepCompleted,
    });
  };

  const quickRefreshed: string[] = [];
  let deepCompleted = 0;
  let deepBlocked = false; // 러너 락이 다른 분석에 잡혀 있으면 이번 스윕에선 정밀 생략
  let deepPending = false; // 시간 게이트에 걸려 정밀을 못 돌린 스테일 소환사가 남음
  let brokeEarly = false; // 예산/상한으로 순회를 중단함 — 다음 스윕에서 이어서
  let skipped = 0;
  let failed = 0;
  const failures: { who: string; error: string }[] = [];

  for (const r of recent) {
    if (elapsed() > opts.budgetMs || quickRefreshed.length >= opts.limit) {
      brokeEarly = true;
      break;
    }
    // 취소 확인 — 진행 중이던 소환사만 마무리하고 멈춘다
    if (opts.shouldContinue && !(await opts.shouldContinue())) {
      brokeEarly = true;
      break;
    }
    // ① 사라진 계정(최근 404) — 쿨다운 동안 라이엇 콜 없이 건너뜀
    if (await cache.get(goneKey(r.region, r.gameName, r.tagLine)).catch(() => null)) {
      skipped++;
      await reportProgress().catch(() => {});
      continue;
    }
    // ② 최근 정밀분석 완료 — DB만 보고 건너뜀(재스캔 쿼터 낭비 방지)
    if (await deepAnalyzedWithin(r.region, r.gameName, r.tagLine, RECENT_DEEP_MS).catch(() => false)) {
      skipped++;
      await reportProgress().catch(() => {});
      continue;
    }
    try {
      const latest = await getLatestMatchId(r.region, r.gameName, r.tagLine);
      if (await getFreshDeepResult(r.region, r.gameName, r.tagLine, latest)) {
        skipped++;
        await reportProgress().catch(() => {});
        continue;
      }

      // 1) 실제 흐름처럼 빠른 추정 먼저
      const quickFresh = await getFreshQuickResult(
        r.region,
        r.gameName,
        r.tagLine,
        latest,
      );
      if (!quickFresh) {
        await runQuickAnalysis(r.region, r.gameName, r.tagLine);
        quickRefreshed.push(`${r.gameName}#${r.tagLine}`);
      }

      // 2) 이어서 정밀 분석 — 완료까지 기다린 뒤 다음 소환사로 (러너 락 존중)
      if (!deepBlocked && elapsed() < opts.deepDeadlineMs) {
        let deepRun: Promise<void> | null = null;
        await ensureQueuedAndSchedule(r.region, r.gameName, r.tagLine, (p, g, t) => {
          // 크론 갱신에서도 마일스톤 변화가 있으면 알림 발송
          // 전체 갱신은 분석에 쓰인 매치(DEEP_DEPTH=30) 빌드를 한 번에 다
          // 수확해 백필거리를 남기지 않는다 (인터랙티브 검색은 기본 10 유지).
          deepRun = runDeepAnalysis(p, g, t, 30);
        });
        if (deepRun) {
          await deepRun;
          deepCompleted++;
        } else {
          deepBlocked = true;
          deepPending = true;
        }
      } else {
        deepPending = true; // 이 소환사의 정밀은 다음 스윕이 처리
      }
    } catch (e) {
      failed++;
      const who = `${r.gameName}#${r.tagLine}`;
      const error = e instanceof Error ? e.message : String(e);
      if (failures.length < 10) failures.push({ who, error });
      // 서버 로그에도 남겨 사후 추적 가능하게 (스택 포함)
      console.error(`[sweep] 실패 ${who} (${r.region}):`, e);
      // 계정 자체가 없으면(404, puuid 폴백도 실패) 7일간 재시도하지 않는다
      if (e instanceof RiotApiError && e.status === 404) {
        await cache
          .set(goneKey(r.region, r.gameName, r.tagLine), Date.now(), GONE_TTL_SEC)
          .catch(() => {});
      }
    }
    await reportProgress().catch(() => {});
  }

  // 이번 라운드에서 새 매치·스냅샷이 생겼으니, 미계산 매치의 랭크점수를 조금 채운다
  // (챔피언 통계 랭크 필터용 — 점진적으로 커버리지가 올라간다).
  await recomputeRankPtsBatch(300).catch(() => {});

  return {
    quickRefreshed,
    deepCompleted,
    deepBlocked,
    deepPending,
    brokeEarly,
    skipped,
    failed,
    failures,
    remaining: brokeEarly || deepPending,
  };
}
