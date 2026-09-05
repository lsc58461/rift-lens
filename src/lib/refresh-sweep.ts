// 갱신 스윕 — 기록된 소환사를 최근 검색 순으로 순회하며 스테일한 결과를
// 실제 검색 흐름과 동일하게(빠른 추정 → 이어서 정밀) 갱신한다.
// 새벽 크론과 관리자 '전체 갱신'이 공유한다. 관리자 쪽이 HTTP로 크론을
// 호출하면 함수가 자기 자신을 부르는 사슬이 생겨 Vercel 루프 감지(508)에
// 걸리므로, 반드시 이 함수를 직접 호출한다.

import "server-only";
import { getAccountByRiotId } from "@/lib/riot/client";
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
import { markAccountGone, updateRecentSearchRank } from "@/lib/store";
import { getSql } from "@/lib/db";
import { canon } from "@/lib/identity";
import { type PlatformRegion, RiotApiError } from "@/lib/riot/types";

// 계정이 사라진(404) 소환사는 7일간 건너뛴다 — 매 라운드 같은 계정을
// 재시도하며 실패 수만 불리던 문제 방지. 닉변이면 puuid 폴백이 먼저 잡는다.
const GONE_TTL_SEC = 7 * 24 * 60 * 60;
const goneKey = (region: string, g: string, t: string) =>
  `sweep:gone:${region}:${canon(g)}#${canon(t)}`;

// 최근 이 시간 안에 정밀분석이 끝난 소환사는 DB만 보고 건너뛴다(라이엇 콜 0).
// 라운드마다 목록 처음부터 재스캔하는 구조라, 이게 없으면 10분 캐시가 만료될
// 때마다 ~수백 명의 최신 매치ID 조회가 반복돼 쿼터를 낭비했다.
// 백그라운드 갱신은 하루 1회(새벽 크론 주기)면 충분하다 — 그 사이 새 경기는
// 유저가 직접 검색할 때 즉시 반영된다. 6h였을 땐 한 바퀴가 하루를 넘기면
// 앞부분 정밀 스킵이 풀려 다음 바퀴가 다시 느려졌다.
const RECENT_DEEP_MS = 36 * 60 * 60_000; // 한 바퀴가 하루를 넘겨도 앞부분 스킵이 유지되도록 여유
// (옛 RECENT_QUICK_MS 제거, 2026-09-05) "빠른 추정이 하루 안이면 통과"는 라이엇 콜을 아꼈지만,
// 그 사람은 정밀이 없는 채로 커서를 넘어가 '빠른'으로 남았다. 지금은 건너뛰지 않는다 —
// 최신 매치 확인 콜 1개가 더 들지만, 어차피 정밀을 돌려야 할 사람들이라 낭비가 아니다.

async function analyzedWithin(
  platform: string,
  gameName: string,
  tagLine: string,
  kind: "deep" | "quick",
  ms: number,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    SELECT updated_at FROM analyses
    WHERE platform = ${platform} AND kind = ${kind}
      AND game_name_lower = ${canon(gameName)} AND tag_line_lower = ${canon(tagLine)}
    LIMIT 1`;
  const at = rows[0]?.updated_at as string | undefined;
  return !!at && Date.now() - new Date(at).getTime() < ms;
}
const deepAnalyzedWithin = (p: string, g: string, t: string, ms: number) =>
  analyzedWithin(p, g, t, "deep", ms);

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
  /** 다음 스윕이 이어서 볼 목록 위치 (끝까지 돌았으면 목록 길이) */
  nextIndex: number;
  /** 목록 끝까지 훑었는지 — false면 예산/취소로 중간에 멈춘 것 */
  reachedEnd: boolean;
  /** 목록 전체 길이 */
  total: number;
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
  /** 목록에서 이어서 볼 시작 위치 — 라운드마다 처음부터 재스캔하면 앞쪽
   *  소환사들의 최신 매치 확인(라이엇 콜)에 예산을 다 써서 뒤로 못 간다 */
  startIndex?: number;
  /** 순회할 목록을 바깥에서 주면(전체 갱신 큐) 최근 검색 목록 대신 이걸 쓴다 */
  list?: { region: PlatformRegion; gameName: string; tagLine: string }[];
  /** 소환사 하나를 처리할 때마다 호출 — 라운드 중 실시간 진행 표시용.
   *  scanned는 목록 전체 기준 절대 위치 */
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
  const all = opts.list ?? (await getRecentSearches(Infinity)); // 큐 또는 최근 검색 순
  const startIndex = Math.min(Math.max(0, opts.startIndex ?? 0), all.length);
  const recent = all.slice(startIndex);
  let scanned = 0; // 이번 스윕에서 처리(또는 건너뜀)한 수
  const reportProgress = async () => {
    scanned++;
    await opts.onProgress?.({
      scanned: startIndex + scanned,
      total: all.length,
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

  for (const queued of recent) {
    let r = queued; // 닉변이면 아래에서 새 이름으로 바뀐다
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
    // ③ 예전엔 "빠른 추정이 24시간 이내면 건너뜀(정밀은 다음 바퀴에)" 이었는데 그게 누수의 주범이었다:
    //    여기까지 온 사람은 ②를 통과했으니 신선한 정밀이 없다. 건너뛰면 정밀이 영영 안 생겨
    //    '빠른'·'정밀 스테일'로 남는다(pass3에서 134명 실측, 2026-09-05). 그래서 건너뛰지 않는다.
    //    빠른 분석 자체는 아래에서 getFreshQuickResult 로 재사용하므로 중복 비용은 거의 없다.
    // 정밀을 시작하기엔 늦은 시점이면 "빠른만 하고 넘기지" 않는다 — 그러면 그 사람은 정밀 없는
    // '빠른' 상태로 남아 다음 바퀴에 빠른부터 다시 해야 한다(지난 바퀴에서 4,200명이 그렇게 샜다).
    // 라운드를 여기서 끝내고, 다음 라운드가 이 사람부터 빠른+정밀을 온전히 이어간다.
    if (!deepBlocked && elapsed() >= opts.deepDeadlineMs) {
      brokeEarly = true;
      break;
    }
    try {
      // 닉변 승계 — 옛 이름이면 getAccountByRiotId 가 새 이름으로 옮겨 준다(recent_searches·analyses 행 rename).
      // 이후 단계는 새 이름으로 진행해야 분석이 새 이름에 저장되고 옛 이름 404 로 실패하지 않는다.
      const acct = await getAccountByRiotId(r.region, r.gameName, r.tagLine);
      if (canon(acct.gameName) !== canon(r.gameName) || canon(acct.tagLine) !== canon(r.tagLine)) {
        console.log(`[sweep] 닉변 승계 ${r.gameName}#${r.tagLine} → ${acct.gameName}#${acct.tagLine}`);
        r = { ...r, gameName: acct.gameName, tagLine: acct.tagLine };
      }
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
      const quick =
        quickFresh ?? (await runQuickAnalysis(r.region, r.gameName, r.tagLine));
      if (!quickFresh) quickRefreshed.push(`${r.gameName}#${r.tagLine}`);
      // 최근 검색 행의 티어·추정치를 최신으로 — 등록 당시 값이 굳어 있으면
      // (챌린저 300명 상한인데 742명처럼) 통계·시드 균형이 왜곡된다
      await updateRecentSearchRank(r.region, r.gameName, r.tagLine, {
        currentLabel: quick.currentRank?.label ?? null,
        currentTier: quick.currentRank?.tier ?? null,
        estimatedLabel: quick.estimatedRank?.label ?? null,
        estimatedTier: quick.estimatedRank?.tier ?? null,
        estimatedPoints: quick.estimatedPoints,
      }).catch(() => {});

      // 2) 이어서 정밀 분석 — 완료까지 기다린 뒤 다음 소환사로 (러너 락 존중)
      if (!deepBlocked && elapsed() < opts.deepDeadlineMs) {
        let deepRun: Promise<void> | null = null;
        await ensureQueuedAndSchedule(
          r.region,
          r.gameName,
          r.tagLine,
          (p, g, t) => {
            // 크론 갱신에서도 마일스톤 변화가 있으면 알림 발송
            // 전체 갱신은 분석에 쓰인 매치(DEEP_DEPTH=30) 빌드를 한 번에 다
            // 수확해 백필거리를 남기지 않는다 (인터랙티브 검색은 기본 10 유지).
            deepRun = runDeepAnalysis(p, g, t, 30);
          },
          { background: true }, // 사용자 검색이 항상 먼저
        );
        if (deepRun) {
          await deepRun;
          deepCompleted++;
        } else {
          // 러너 락을 사용자 검색이 잡고 있다 — 여기서 라운드를 끝낸다. 계속 돌면 남은 사람들을
          // '빠른만' 하고 커서를 넘겨 정밀 없는 상태로 남는다. 커서를 올리지 않으므로
          // 다음 라운드가 이 사람부터 이어서 정밀까지 한다.
          deepBlocked = true;
          deepPending = true;
          brokeEarly = true;
          break;
        }
      } else {
        // 정밀 마감이 지났다 — 마찬가지로 커서를 넘기지 않고 라운드를 끝낸다
        deepPending = true;
        brokeEarly = true;
        break;
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
        // DB 에도 남긴다 — 어드민 '없어진 계정' 카드가 여기서 후보를 읽는다
        // (레디스 마커는 7일 TTL 이라 목록 관리용으로는 못 쓴다)
        await markAccountGone(r.region, r.gameName, r.tagLine).catch(() => {});
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
    nextIndex: startIndex + scanned,
    reachedEnd: !brokeEarly,
    total: all.length,
  };
}
