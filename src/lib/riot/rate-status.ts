// 레이트리밋 관측 — 어드민이 "지금 한도에 걸려 대기 중인지, 언제 재개되는지"를
// 볼 수 있게 한다.
//
// 리미터(limiter.ts)는 인스턴스별 메모리 싱글턴이라, 어드민 요청이 뜬 인스턴스의
// 상태만 읽으면 실제로 분석을 돌리는 인스턴스와 무관한 값이 나온다. 그래서 각
// 인스턴스가 자기 상태를 공유 캐시에 발행하고, 어드민은 그걸 모아서 본다.
//
// 발행 비용은 억제한다: 한가할 땐 아예 쓰지 않고, 바쁠 때만 3초 간격으로 갱신한다.

import "server-only";
import { randomUUID } from "crypto";
import { riotLimiter, type LimiterSnapshot } from "./limiter";
import { cache } from "@/lib/cache";

const NODE_PREFIX = "ratelimit:node:";
const COOLDOWN_KEY = "ratelimit:cooldown";
const PUBLISH_INTERVAL_MS = 3_000;
const NODE_TTL_SEC = 15; // 죽은 인스턴스는 알아서 사라진다
const IDLE_TICKS_BEFORE_STOP = 3;

const nodeId = randomUUID().slice(0, 8);
const nodeKey = `${NODE_PREFIX}${nodeId}`;

interface NodeEntry extends LimiterSnapshot {
  node: string;
  at: number;
}

interface Cooldown {
  until: number;
  retryAfterSec: number;
  endpoint: string;
  at: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let idleTicks = 0;

async function publish(snap: LimiterSnapshot): Promise<void> {
  const entry: NodeEntry = { ...snap, node: nodeId, at: Date.now() };
  await cache.set(nodeKey, entry, NODE_TTL_SEC).catch(() => {});
}

/**
 * 라이엇 호출이 일어날 때마다 호출한다. 바쁜 동안에만 주기 발행 타이머를 돌리고,
 * 한가해지면 스스로 멈춘다 (유휴 시 DB 쓰기 0).
 */
export function trackRateLimiter(): void {
  idleTicks = 0;
  if (timer) return;
  timer = setInterval(() => {
    const snap = riotLimiter.snapshot();
    // "바쁨" = 이 인스턴스에 실제 대기 요청이 있을 때만. 한도 포화(saturated)는
    // Redis 공유 값이라 일을 안 하는 인스턴스도 참이 돼서 기준에서 뺐다 —
    // 어드민의 '보고 인스턴스'가 실제 호출을 내는 인스턴스 수를 뜻하게.
    const busy = snap.waitingHigh + snap.waitingLow > 0;
    if (busy) {
      idleTicks = 0;
      void publish(snap);
      return;
    }
    if (++idleTicks === 1) void publish(snap); // 마지막 1회 — "이제 여유" 반영
    if (idleTicks > IDLE_TICKS_BEFORE_STOP && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, PUBLISH_INTERVAL_MS);
  // 서버리스 인스턴스가 이 타이머 때문에 살아 있지 않도록
  timer.unref?.();
}

/** 429를 맞았을 때 — 재개 시각을 공유 캐시에 남긴다 */
export async function recordRateLimitHit(
  retryAfterSec: number,
  url: string,
): Promise<void> {
  const now = Date.now();
  const endpoint =
    url.match(/riotgames\.com(\/[^?]*)/)?.[1]?.split("/").slice(0, 4).join("/") ??
    "unknown";
  const entry: Cooldown = {
    until: now + retryAfterSec * 1000,
    retryAfterSec,
    endpoint,
    at: now,
  };
  await cache
    .set(COOLDOWN_KEY, entry, Math.ceil(retryAfterSec) + 120)
    .catch(() => {});
}

export interface RateLimitStatus {
  /** 상태 요약 — 어드민 배지에 그대로 쓴다 */
  state: "idle" | "busy" | "throttled" | "cooldown";
  /** 재개까지 남은 ms (0이면 지금 여유) */
  resumeInMs: number;
  waitingHigh: number;
  waitingLow: number;
  buckets: LimiterSnapshot["buckets"];
  /** 상태를 보고한 인스턴스 수 */
  nodes: number;
  cooldown: { until: number; retryAfterSec: number; endpoint: string } | null;
}

const IDLE: RateLimitStatus = {
  state: "idle",
  resumeInMs: 0,
  waitingHigh: 0,
  waitingLow: 0,
  buckets: [],
  nodes: 0,
  cooldown: null,
};

/** 어드민 표시용 집계 — 여러 인스턴스 중 가장 압박이 큰 쪽을 대표로 삼는다 */
export async function getRateLimitStatus(): Promise<RateLimitStatus> {
  const now = Date.now();
  const [entries, cd] = await Promise.all([
    cache.entries<NodeEntry>(NODE_PREFIX).catch(() => []),
    cache.get<Cooldown>(COOLDOWN_KEY).catch(() => null),
  ]);
  const live = entries
    .map((e) => e.value)
    .filter((v) => v && now - v.at < NODE_TTL_SEC * 1000 && v.node !== nodeId);
  // 이 인스턴스의 상태는 발행 주기(3초)를 기다리지 않고 라이브 스냅샷을 쓴다.
  // 단일 서버에선 이게 곧 전체 진실이라 어드민 표시가 실시간이 된다.
  live.push({ ...riotLimiter.snapshot(), node: nodeId, at: now });

  const cooldown = cd && cd.until > now ? cd : null;
  if (live.length === 0 && !cooldown) return IDLE;

  // 대기는 전체 합, 재개 시점·사용량은 가장 압박이 큰 인스턴스 기준
  const waitingHigh = live.reduce((s, v) => s + v.waitingHigh, 0);
  const waitingLow = live.reduce((s, v) => s + v.waitingLow, 0);
  const worst = live.reduce<NodeEntry | null>(
    (a, v) => (!a || v.nextSlotInMs > a.nextSlotInMs ? v : a),
    null,
  );

  const limiterResumeInMs = worst?.nextSlotInMs ?? 0;
  const cooldownResumeInMs = cooldown ? cooldown.until - now : 0;
  const resumeInMs = Math.max(limiterResumeInMs, cooldownResumeInMs);

  const state: RateLimitStatus["state"] = cooldown
    ? "cooldown"
    : worst?.saturated
      ? "throttled"
      : waitingHigh + waitingLow > 0
        ? "busy"
        : "idle";

  return {
    state,
    resumeInMs,
    waitingHigh,
    waitingLow,
    buckets: worst?.buckets ?? [],
    nodes: live.length,
    cooldown: cooldown
      ? {
          until: cooldown.until,
          retryAfterSec: cooldown.retryAfterSec,
          endpoint: cooldown.endpoint,
        }
      : null,
  };
}
