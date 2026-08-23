// 분석 결과 저장/재사용 + 정밀 분석 백그라운드 잡 관리.
//
// 저장된 결과(quick/deep)는 TTL이 아니라 "새 경기가 생겼는지"로 무효화한다:
// 검색 시 최신 매치 ID 하나만 비교해서 같으면 이전 분석을 그대로 재사용하고,
// 다르면(새 게임을 돌렸으면) 다시 분석한다. TTL은 안전망(24시간)으로만 둔다.
//
// 잡 상태는 캐시(DATABASE_URL이 있으면 Postgres)에 저장한다 — Vercel처럼
// 인스턴스가 여러 개인 환경에서도 어느 인스턴스든 진행 상황을 볼 수 있다.
// 백그라운드 실행 자체는 라우트 핸들러에서 next/server의 after()로 시작한다.

import "server-only";
import { cache } from "@/lib/cache";
import { canon } from "@/lib/identity";
import { getAnalysis, saveAnalysis } from "@/lib/store";
import { withLowPriority } from "@/lib/riot/limiter";
import {
  getAccountByRiotId,
  getRankedMatchIds,
  harvestMissingBuildData,
} from "@/lib/riot/client";
import type { PlatformRegion } from "@/lib/riot/types";
import {
  ALGO_VERSION,
  DEEP_DEPTH,
  QUICK_DEPTH,
  estimateMmr,
  fetchCountFor,
  type MmrEstimate,
} from "./estimate";

// 결과는 analyses 테이블에 영구 보관(소환사·종류당 1행 upsert) —
// "이전 분석"으로 즉시 표시되고 백그라운드 재분석이 갱신한다.
// 신선도(72h)는 아래 FRESH_MAX_AGE_MS로 판정.
const FRESH_MAX_AGE_MS = 72 * 60 * 60_000;
const JOB_TTL = 60 * 15;
const JOB_STALE_MS = 5 * 60_000; // 이 시간 동안 진행이 없으면 죽은 잡으로 간주

export interface DeepJob {
  state: "running" | "done" | "error";
  progress: number; // 0~1
  updatedAt: number;
}

const globalForJobs = globalThis as unknown as {
  __quickInflight?: Map<string, Promise<MmrEstimate>>;
};
// 같은 소환사를 여러 요청이 동시에 검색해도 분석은 1번만 돌도록 진행 중 Promise를 공유
// (인스턴스 단위 최적화 — 인스턴스가 갈리면 각자 돌 수 있지만 결과는 동일)
const quickInflight =
  globalForJobs.__quickInflight ?? (globalForJobs.__quickInflight = new Map());

function resultKey(
  kind: "quick" | "deep",
  platform: string,
  gameName: string,
  tagLine: string,
): string {
  return `${kind}:${platform}:${canon(gameName)}#${canon(tagLine)}`;
}

function jobKey(platform: string, gameName: string, tagLine: string): string {
  return `deepjob:${platform}:${canon(gameName)}#${canon(tagLine)}`;
}

/** 현재 최신 매치 ID (account/matchids 캐시를 타므로 저렴) */
export async function getLatestMatchId(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  bypassCache = false,
): Promise<string | null> {
  const account = await getAccountByRiotId(platform, gameName, tagLine);
  const ids = await getRankedMatchIds(
    platform,
    account.puuid,
    fetchCountFor(QUICK_DEPTH),
    bypassCache,
  );
  return ids[0] ?? null;
}

/** 저장된 결과가 있고 그 이후 새 경기가 없으면 반환, 아니면 null */
async function getFreshResult(
  kind: "quick" | "deep",
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  latestMatchId: string | null,
): Promise<MmrEstimate | null> {
  const stored = await getAnalysis(kind, platform, gameName, tagLine);
  if (
    !stored ||
    stored.latestMatchId !== latestMatchId ||
    // 구버전 알고리즘으로 계산된 결과는 재분석
    (stored.algoVersion ?? 0) !== ALGO_VERSION ||
    // 72시간 넘은 결과는 참가자 랭크 변동을 반영하기 위해 재분석
    // (analyzedAt이 없는 구버전 결과 포함 — stale 표시로는 계속 쓰인다)
    Date.now() - (stored.analyzedAt ?? 0) > FRESH_MAX_AGE_MS
  ) {
    return null;
  }
  return stored;
}

export function getFreshDeepResult(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  latestMatchId: string | null,
): Promise<MmrEstimate | null> {
  return getFreshResult("deep", platform, gameName, tagLine, latestMatchId);
}

export function getFreshQuickResult(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  latestMatchId: string | null,
): Promise<MmrEstimate | null> {
  return getFreshResult("quick", platform, gameName, tagLine, latestMatchId);
}

/** 신선도·버전과 무관하게 저장된 결과를 반환 (stale-while-revalidate 표시용) */
export function getStoredResult(
  kind: "quick" | "deep",
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<MmrEstimate | null> {
  return getAnalysis(kind, platform, gameName, tagLine);
}

// 빠른 분석 실행 마커 — Vercel처럼 인스턴스가 여러 개일 때 같은 소환사의
// 재분석이 인스턴스마다 중복 실행되는 것을 막는다 (90초 무갱신이면 죽은 것으로 간주)
const QUICK_MARKER_TTL = 60 * 3;
const QUICK_MARKER_STALE_MS = 90_000;

function quickMarkerKey(
  platform: string,
  gameName: string,
  tagLine: string,
): string {
  return `quickjob:${platform}:${canon(gameName)}#${canon(tagLine)}`;
}

/** 다른 인스턴스에서 빠른 분석이 진행 중인지 (트리거 중복 방지용) */
export async function isQuickRunActive(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<boolean> {
  const marker = await cache.get<{ at: number }>(
    quickMarkerKey(platform, gameName, tagLine),
  );
  return marker !== null && Date.now() - marker.at < QUICK_MARKER_STALE_MS;
}

/**
 * 빠른 추정 실행 + 저장. 동일 소환사에 대한 동시 요청은 진행 중인
 * 분석 Promise를 공유해 API 호출이 중복되지 않는다 (thundering herd 방지).
 */
export function runQuickAnalysis(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<MmrEstimate> {
  const key = resultKey("quick", platform, gameName, tagLine);
  const existing = quickInflight.get(key);
  if (existing) return existing;

  const mk = quickMarkerKey(platform, gameName, tagLine);
  const promise = (async () => {
    await cache.set(mk, { at: Date.now() }, QUICK_MARKER_TTL);
    let lastMarker = Date.now();
    try {
      const result = await estimateMmr(
        platform,
        gameName,
        tagLine,
        QUICK_DEPTH,
        () => {
          // 진행 중 생존신호 (레이트리밋 대기로 오래 걸릴 때 마커 만료 방지)
          if (Date.now() - lastMarker > 15_000) {
            lastMarker = Date.now();
            void cache.set(mk, { at: lastMarker }, QUICK_MARKER_TTL);
          }
        },
      );
      const acct = await getAccountByRiotId(platform, gameName, tagLine).catch(
        () => null,
      );
      await saveAnalysis(
        "quick",
        platform,
        gameName,
        tagLine,
        result,
        acct?.puuid,
      );
      return result;
    } finally {
      await cache.set(mk, null, 1).catch(() => {});
    }
  })().finally(() => quickInflight.delete(key));

  quickInflight.set(key, promise);
  return promise;
}

export function getDeepJob(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<DeepJob | null> {
  return cache.get<DeepJob>(jobKey(platform, gameName, tagLine));
}

// 전역 러너 락: 정밀 분석은 한 번에 1건만 실행한다.
// 여러 건이 병렬로 돌면 레이트리밋을 나눠 먹어 전부 느려지고,
// Vercel에서는 maxDuration(300s) 안에 아무것도 못 끝낼 수 있다.
// 대기 건은 클라이언트 폴링이 락이 풀린 뒤 자동으로 시작한다(사실상 선착순).
const RUNNER_LOCK_KEY = "deep-runner-lock";
const QUEUE_KEY = "deep-queue:list";
// 대기 건은 클라이언트 폴링(4초 간격)이 계속 갱신한다 — 1분간 갱신이 없으면
// 브라우저를 닫고 떠난 것으로 보고 소멸시켜 뒷순번이 막히지 않게 한다.
// 단 상위 5명은 곧 차례가 오므로 화면을 나가도 유지한다(절대 상한 30분).
const QUEUE_ENTRY_TTL_MS = 60_000;
const QUEUE_TOP_KEEP = 5;
const QUEUE_ENTRY_MAX_MS = 30 * 60_000;

interface RunnerLock {
  key: string;
  at: number;
}

interface QueueEntry {
  key: string;
  at: number;
}

async function getQueue(): Promise<QueueEntry[]> {
  const q = (await cache.get<QueueEntry[]>(QUEUE_KEY)) ?? [];
  const now = Date.now();
  const kept: QueueEntry[] = [];
  for (const e of q) {
    const age = now - e.at;
    if (
      age < QUEUE_ENTRY_TTL_MS ||
      (kept.length < QUEUE_TOP_KEEP && age < QUEUE_ENTRY_MAX_MS)
    ) {
      kept.push(e);
    }
  }
  return kept;
}

// "deepjob:kr:이름#태그" → 분석 파라미터 (스케줄러가 헤드의 잡을 대신 시작할 때 사용)
function parseJobKey(
  key: string,
): { platform: PlatformRegion; gameName: string; tagLine: string } | null {
  const m = key.match(/^deepjob:([^:]+):(.+)$/);
  if (!m) return null;
  const hash = m[2].lastIndexOf("#");
  if (hash <= 0) return null;
  return {
    platform: m[1] as PlatformRegion,
    gameName: m[2].slice(0, hash),
    tagLine: m[2].slice(hash + 1),
  };
}

/**
 * 대기열 등록/생존신호 갱신 + 스케줄링.
 * 락이 비어 있으면 (요청자가 누구든) 대기열 맨 앞의 잡을 시작한다 —
 * 브라우저가 없는 상위 대기 건도 다른 사람의 폴링으로 진행된다.
 * 반환: 요청자 본인 잡이 시작됐는지와 남은 앞 순번 수.
 */
export async function ensureQueuedAndSchedule(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
  startJob: (p: PlatformRegion, g: string, t: string) => void,
): Promise<{ selfStarted: boolean; ahead: number }> {
  const selfKey = jobKey(platform, gameName, tagLine);
  const now = Date.now();
  let queue = await getQueue();

  let index = queue.findIndex((e) => e.key === selfKey);
  if (index === -1) {
    queue.push({ key: selfKey, at: now });
    index = queue.length - 1;
  } else {
    queue[index].at = now; // 폴링 생존 신호
  }

  const holder = await cache.get<RunnerLock>(RUNNER_LOCK_KEY);
  const busy =
    holder !== null && holder.at !== 0 && now - holder.at < JOB_STALE_MS;
  if (busy) {
    await cache.set(QUEUE_KEY, queue, 60 * 15);
    return { selfStarted: false, ahead: index + 1 };
  }

  // 락이 비었다 — 헤드의 잡을 시작
  const head = queue[0];
  const parsed = parseJobKey(head.key);
  queue = queue.slice(1);
  await cache.set(QUEUE_KEY, queue, 60 * 15);
  if (!parsed) {
    // 파싱 불가한 항목은 버리고 다음 폴링에서 재시도
    return { selfStarted: false, ahead: index };
  }
  await cache.set<RunnerLock>(
    RUNNER_LOCK_KEY,
    { key: head.key, at: now },
    60 * 10,
  );
  await markDeepJobRunning(parsed.platform, parsed.gameName, parsed.tagLine);
  startJob(parsed.platform, parsed.gameName, parsed.tagLine);

  return { selfStarted: head.key === selfKey, ahead: index };
}

export interface QueuedJob {
  position: number;
  region: string;
  name: string;
  lastSeenAgoSec: number;
  /** 폴링 생존신호가 끊겼지만 상위 순번이라 유지 중 (브라우저를 닫고 떠난 경우) */
  detached: boolean;
}

/**
 * 현재 대기열 — 스케줄러가 보는 것과 동일한 보존 규칙(getQueue)을 그대로 쓴다.
 * 어드민 표시용이지만 규칙을 따로 구현하면 실제 대기열과 어긋나므로 여기서 제공한다.
 */
export async function listQueue(): Promise<QueuedJob[]> {
  const now = Date.now();
  const queue = await getQueue();
  return queue.flatMap((e, i) => {
    const p = parseJobKey(e.key);
    if (!p) return [];
    return [
      {
        position: i + 1,
        region: p.platform,
        name: `${p.gameName}#${p.tagLine}`,
        lastSeenAgoSec: Math.round((now - e.at) / 1000),
        detached: now - e.at >= QUEUE_ENTRY_TTL_MS,
      },
    ];
  });
}

export interface RunnerStatus {
  region: string;
  name: string;
  progress: number;
  state: string;
  updatedAgoSec: number;
}

/** 지금 러너 락을 쥐고 돌아가는 정밀 분석 (죽은 잡은 제외) */
export async function getRunnerStatus(): Promise<RunnerStatus | null> {
  const holder = await cache.get<RunnerLock>(RUNNER_LOCK_KEY);
  const now = Date.now();
  if (!holder || holder.at === 0 || now - holder.at >= JOB_STALE_MS)
    return null;
  const parsed = parseJobKey(holder.key);
  const job = await cache.get<DeepJob>(holder.key);
  if (!parsed || !job) return null;
  return {
    region: parsed.platform,
    name: `${parsed.gameName}#${parsed.tagLine}`,
    progress: job.progress,
    state: job.state,
    updatedAgoSec: Math.round((now - job.updatedAt) / 1000),
  };
}

async function releaseDeepRunner(key: string): Promise<void> {
  const holder = await cache.get<RunnerLock>(RUNNER_LOCK_KEY);
  if (holder?.key === key) {
    // 삭제 대신 즉시 만료 처리 (스토어에 delete가 없음)
    await cache.set<RunnerLock>(RUNNER_LOCK_KEY, { key, at: 0 }, 1);
  }
}

export function isJobStale(job: DeepJob): boolean {
  return Date.now() - job.updatedAt > JOB_STALE_MS;
}

/** 잡을 running으로 마킹 — after()로 runDeepAnalysis를 시작하기 직전에 호출 */
export async function markDeepJobRunning(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<void> {
  await cache.set<DeepJob>(
    jobKey(platform, gameName, tagLine),
    { state: "running", progress: 0, updatedAt: Date.now() },
    JOB_TTL,
  );
}

/** 정밀 분석 본체. 진행률을 캐시에 기록하며 완료 시 결과를 저장한다. */
export async function runDeepAnalysis(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<void> {
  const jk = jobKey(platform, gameName, tagLine);
  let lastWritten = 0;
  let harvestAfterDeep: string[] | null = null;
  try {
    // 백그라운드 작업은 저우선순위 — 페이지 로딩(전경) 호출이 항상 먼저 처리된다
    const result = await withLowPriority(() =>
      estimateMmr(platform, gameName, tagLine, DEEP_DEPTH, (done, total) => {
        const p = total ? done / total : 0;
        // 진행률은 5% 단위로만 기록해 DB 쓰기를 아낀다 (러너 락도 함께 갱신)
        if (p - lastWritten >= 0.05) {
          lastWritten = p;
          void cache.set<DeepJob>(
            jk,
            { state: "running", progress: p, updatedAt: Date.now() },
            JOB_TTL,
          );
          void cache.set<RunnerLock>(
            RUNNER_LOCK_KEY,
            { key: jk, at: Date.now() },
            60 * 10,
          );
        }
      }),
    );
    const acct = await getAccountByRiotId(platform, gameName, tagLine).catch(
      () => null,
    );
    await saveAnalysis(
      "deep",
      platform,
      gameName,
      tagLine,
      result,
      acct?.puuid,
    );
    await cache.set<DeepJob>(
      jk,
      { state: "done", progress: 1, updatedAt: Date.now() },
      JOB_TTL,
    );
    // 분석에 쓰인 매치의 빌드 데이터(시작 아이템·코어 순서)를 이어서 수확 —
    // 결과 저장·완료 표시 후라 유저 응답과 무관하고, 실패해도 분석엔 영향 없음
    harvestAfterDeep = result.matches.map((m) => m.matchId);
  } catch {
    await cache
      .set<DeepJob>(
        jk,
        { state: "error", progress: 0, updatedAt: Date.now() },
        JOB_TTL,
      )
      .catch(() => {});
  } finally {
    await releaseDeepRunner(jk).catch(() => {});
  }
  // 러너 락을 놓은 뒤에 수확 — 다음 대기자 분석을 막지 않는다
  if (harvestAfterDeep) {
    await harvestMissingBuildData(platform, harvestAfterDeep).catch(() => {});
  }
}
