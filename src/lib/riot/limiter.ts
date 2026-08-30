// 라이엇 API 레이트리미터.
//
// 우선순위 2단계: 페이지 로딩 등 전경 호출(high)이 백그라운드 정밀 분석(low)보다
// 항상 먼저 슬롯을 받는다 — 정밀 분석이 한도를 점유해도 페이지가 굶지 않는다.
//
// 한도 계정(버킷)은 REDIS_URL이 있으면 **Redis 공유 슬라이딩 윈도**로 센다.
// 앱 인스턴스가 2개(app-a/app-b) 이상이면 프로세스별 카운터로는 합산이 한도를
// 넘겨 429가 났다(전체 갱신이 한쪽에서 돌고 유저 요청이 다른 쪽에 떨어질 때).
// Lua 스크립트 한 번으로 "만료 정리 → 용량 확인 → 예약"을 원자적으로 처리해
// 인스턴스 수와 무관하게 정확히 한도를 지킨다. Redis가 없거나 죽으면 프로세스
// 로컬 버킷으로 폴백한다(안전 쪽으로 — 이때는 예전처럼 초과가 날 수 있다).
//
// 대기 큐(우선순위)는 프로세스 로컬이다: 인스턴스 간 우선순위 공유까지는 하지
// 않는다 — 한 프로세스 안에서 high가 low보다 먼저 슬롯을 요청하는 것으로 충분하다.

import { AsyncLocalStorage } from "async_hooks";
import { getRedisClient } from "@/lib/cache";

interface Bucket {
  capacity: number;
  windowMs: number;
  timestamps: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Priority = "high" | "low";

// 호출 경로 전체에 priority 인자를 뚫는 대신 ALS 컨텍스트로 전달한다.
// ※ Turbopack 이 이 모듈을 서버 청크마다 복제해서, 모듈 변수로 두면 withLowPriority 를
//   부른 청크와 client.ts 가 읽는 청크의 ALS 가 달라 "high" 로 새어 나갔다(2026-08-30) —
//   프로세스 전역(globalThis)에 하나만 둔다. 리미터 인스턴스도 같은 이유로 전역.
const g = globalThis as unknown as {
  __riftPriorityCtx?: AsyncLocalStorage<Priority>;
  __riftLimiter?: RateLimiter;
};
const priorityContext = (g.__riftPriorityCtx ??= new AsyncLocalStorage<Priority>());

/** 이 콜백 안에서 발생하는 라이엇 API 호출을 저우선순위로 처리 */
export function withLowPriority<T>(fn: () => Promise<T>): Promise<T> {
  return priorityContext.run("low", fn);
}

export function currentPriority(): Priority {
  return priorityContext.getStore() ?? "high";
}

export interface BucketState {
  capacity: number;
  windowMs: number;
  used: number;
  /** 이 버킷이 꽉 찼을 때 다음 슬롯이 열리기까지 남은 ms (여유 있으면 0) */
  nextSlotInMs: number;
}

export interface LimiterSnapshot {
  buckets: BucketState[];
  waitingHigh: number;
  waitingLow: number;
  /** 지금 요청하면 슬롯을 받기까지 최소 대기 ms (0이면 즉시) */
  nextSlotInMs: number;
  saturated: boolean;
  /** 공유(Redis) 카운팅 중인지 — 어드민 표시용 */
  shared: boolean;
}

// 인스턴스 간 우선순위: 대기 큐는 프로세스 로컬이라 다른 인스턴스의 유저 요청이
// 이쪽 백그라운드 작업에 밀릴 수 있다. 그래서 high 예약은 "최근 유저 트래픽 있음"
// 마커(hot)를 남기고, 마커가 살아 있는 동안 low 예약은 용량의 일부(RESERVE)를
// 유저 몫으로 비워 둔다. 유저가 없으면 마커가 사라져 백그라운드가 전량을 쓴다.
const HOT_KEY = "riot:rl:hot";
const HOT_TTL_MS = 30_000;
const LOW_RESERVE_RATIO = 0.4; // hot일 때 low가 못 쓰는 비율

// KEYS = [hot, 버킷 키들...], ARGV = [now, member, isHigh(0/1), reserveRatio, hotTtl, cap1, win1, cap2, win2, ...]
// 반환 = [waitMs, used1, used2, ...] (waitMs가 0이면 예약 완료)
const ACQUIRE_LUA = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local isHigh = ARGV[3] == '1'
local reserve = tonumber(ARGV[4])
local hotTtl = tonumber(ARGV[5])
local hotKey = KEYS[1]
if isHigh then
  redis.call('SET', hotKey, '1', 'PX', hotTtl)
end
local hot = (not isHigh) and (redis.call('EXISTS', hotKey) == 1)
local wait = 0
local used = {}
for i = 2, #KEYS do
  local key = KEYS[i]
  local cap = tonumber(ARGV[2*i+2])
  local win = tonumber(ARGV[2*i+3])
  if hot then cap = math.floor(cap * (1 - reserve)) end
  redis.call('ZREMRANGEBYSCORE', key, 0, now - win)
  local n = redis.call('ZCARD', key)
  used[i-1] = n
  if n >= cap then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local w = tonumber(oldest[2]) + win - now + 20
    if w > wait then wait = w end
  end
end
if wait > 0 then
  local out = {wait}
  for i = 1, #KEYS - 1 do out[#out+1] = used[i] end
  return out
end
local out = {0}
for i = 2, #KEYS do
  local key = KEYS[i]
  local win = tonumber(ARGV[2*i+3])
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, win + 1000)
  out[#out+1] = used[i-1] + 1
end
return out
`;

// 버킷 키는 용량:윈도로 이름 붙여, 한도 설정이 바뀌면 자동으로 새 키를 쓴다
const bucketKey = (b: { capacity: number; windowMs: number }) =>
  `riot:rl:${b.capacity}:${b.windowMs}`;

class RateLimiter {
  private buckets: Bucket[];
  private high: Array<() => void> = [];
  private low: Array<() => void> = [];
  private pumping = false;
  private seq = 0;
  /** 마지막 Redis 응답 — 스냅샷(어드민 표시)에 쓴다 */
  private shared: { at: number; used: number[]; wait: number } | null = null;
  private sharedBroken = 0; // Redis 실패 시각 — 잠시 로컬 폴백 후 재시도

  constructor(limits: Array<{ capacity: number; windowMs: number }>) {
    this.buckets = limits.map((l) => ({ ...l, timestamps: [] }));
  }

  /** 현재 한도 사용량·대기 큐 상태 (관측용 — 내부 상태를 변형하지 않는다) */
  snapshot(): LimiterSnapshot {
    const now = Date.now();
    const sharedFresh = this.shared && now - this.shared.at < 5_000 ? this.shared : null;
    const buckets = this.buckets.map((b, i): BucketState => {
      const live = b.timestamps.filter((t) => now - t < b.windowMs);
      const used = sharedFresh ? (sharedFresh.used[i] ?? live.length) : live.length;
      const full = used >= b.capacity;
      const localNext = live.length >= b.capacity ? Math.max(0, live[0] + b.windowMs - now) : 0;
      return {
        capacity: b.capacity,
        windowMs: b.windowMs,
        used,
        nextSlotInMs: sharedFresh ? (full ? Math.max(0, sharedFresh.wait) : 0) : localNext,
      };
    });
    return {
      buckets,
      waitingHigh: this.high.length,
      waitingLow: this.low.length,
      nextSlotInMs: Math.max(0, ...buckets.map((b) => b.nextSlotInMs)),
      saturated: buckets.some((b) => b.used >= b.capacity),
      shared: sharedFresh !== null,
    };
  }

  /** 슬롯이 날 때까지 대기 후 반환. high 큐가 항상 low 큐보다 먼저 소진된다 */
  acquire(priority: Priority = "high"): Promise<void> {
    return new Promise<void>((resolve) => {
      (priority === "high" ? this.high : this.low).push(resolve);
      void this.pump();
    });
  }

  /** Redis 공유 버킷에서 슬롯 예약 시도. 반환: 대기 ms(0이면 예약됨), Redis 불가면 null */
  private async acquireShared(priority: Priority): Promise<number | null> {
    if (Date.now() - this.sharedBroken < 10_000) return null; // 최근 실패 → 잠시 로컬
    const client = getRedisClient();
    if (!client) return null;
    try {
      const c = await client;
      const now = Date.now();
      const member = `${now}-${process.pid}-${this.seq++}`;
      const args = [
        String(now),
        member,
        priority === "high" ? "1" : "0",
        String(LOW_RESERVE_RATIO),
        String(HOT_TTL_MS),
      ];
      for (const b of this.buckets) args.push(String(b.capacity), String(b.windowMs));
      const res = (await c.eval(ACQUIRE_LUA, {
        keys: [HOT_KEY, ...this.buckets.map(bucketKey)],
        arguments: args,
      })) as number[];
      const wait = Number(res[0] ?? 0);
      this.shared = { at: now, used: res.slice(1).map(Number), wait };
      return wait;
    } catch (e) {
      this.sharedBroken = Date.now();
      console.error("[limiter] redis 공유 버킷 실패, 로컬 폴백:", (e as Error)?.message);
      return null;
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.high.length > 0 || this.low.length > 0) {
        // 다음에 슬롯을 받을 대기자의 우선순위로 예약한다 (high가 항상 먼저)
        const nextPriority: Priority = this.high.length > 0 ? "high" : "low";
        const shared = await this.acquireShared(nextPriority);
        if (shared !== null) {
          if (shared > 0) {
            // low가 유저 예약분에 막힌 경우는 짧게 재시도 (유저 트래픽이 끊기면 바로 풀린다)
            await sleep(Math.min(shared, nextPriority === "low" ? 500 : 2_000));
            continue;
          }
          // 예약 완료 — 로컬 버킷에도 기록해 폴백 시 연속성을 유지한다
          const ts = Date.now();
          for (const b of this.buckets) {
            b.timestamps = b.timestamps.filter((t) => ts - t < b.windowMs);
            b.timestamps.push(ts);
          }
          const next = this.high.shift() ?? this.low.shift();
          if (!next) break;
          next();
          continue;
        }

        // 로컬 폴백
        const now = Date.now();
        let waitMs = 0;
        for (const b of this.buckets) {
          b.timestamps = b.timestamps.filter((t) => now - t < b.windowMs);
          if (b.timestamps.length >= b.capacity) {
            waitMs = Math.max(waitMs, b.timestamps[0] + b.windowMs - now + 20);
          }
        }
        if (waitMs > 0) {
          await sleep(waitMs);
          continue;
        }
        const next = this.high.shift() ?? this.low.shift();
        if (!next) break;
        const ts = Date.now();
        for (const b of this.buckets) b.timestamps.push(ts);
        next();
      }
    } finally {
      this.pumping = false;
    }
  }
}

// 실제 한도보다 약간 보수적으로 잡아 429를 예방한다.
// 우선순위: RIOT_RATE_LIMITS(커스텀) > RIOT_KEY_TYPE=prod(표준 프로덕션) > 개발/퍼스널 키.
// RIOT_RATE_LIMITS 형식: "용량:윈도초" 콤마 구분 (예: "45:10" = 10초당 45건, "45:10,2500:600")
function limitsFromEnv(): Array<{ capacity: number; windowMs: number }> | null {
  const raw = process.env.RIOT_RATE_LIMITS;
  if (!raw) return null;
  const limits = raw
    .split(",")
    .map((part) => {
      const [cap, winSec] = part.split(":").map((n) => Number(n.trim()));
      return { capacity: cap, windowMs: winSec * 1000 };
    })
    .filter((l) => Number.isFinite(l.capacity) && l.capacity > 0 && l.windowMs > 0);
  return limits.length > 0 ? limits : null;
}

export const riotLimiter: RateLimiter = (g.__riftLimiter ??= new RateLimiter(
  limitsFromEnv() ??
    (process.env.RIOT_KEY_TYPE === "prod"
      ? [
          { capacity: 450, windowMs: 10_000 },
          { capacity: 27_000, windowMs: 600_000 },
        ]
      : [
          { capacity: 18, windowMs: 1_000 },
          { capacity: 95, windowMs: 120_000 },
        ]),
));
