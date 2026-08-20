// 개발용 API 키 제한(20req/1s, 100req/120s)에 맞춘 토큰 버킷 레이트리미터.
// 우선순위 2단계: 페이지 로딩 등 전경 호출(high)이 백그라운드 정밀 분석(low)보다
// 항상 먼저 슬롯을 받는다 — 정밀 분석이 한도를 점유해도 페이지가 굶지 않는다.
// 서버 인스턴스당 하나만 존재하면 되므로 모듈 스코프 싱글턴으로 둔다.

import { AsyncLocalStorage } from "async_hooks";

interface Bucket {
  capacity: number;
  windowMs: number;
  timestamps: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Priority = "high" | "low";

// 호출 경로 전체에 priority 인자를 뚫는 대신 ALS 컨텍스트로 전달한다
const priorityContext = new AsyncLocalStorage<Priority>();

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
}

class RateLimiter {
  private buckets: Bucket[];
  private high: Array<() => void> = [];
  private low: Array<() => void> = [];
  private pumping = false;

  constructor(limits: Array<{ capacity: number; windowMs: number }>) {
    this.buckets = limits.map((l) => ({ ...l, timestamps: [] }));
  }

  /** 현재 한도 사용량·대기 큐 상태 (관측용 — 내부 상태를 변형하지 않는다) */
  snapshot(): LimiterSnapshot {
    const now = Date.now();
    const buckets = this.buckets.map((b): BucketState => {
      const live = b.timestamps.filter((t) => now - t < b.windowMs);
      const full = live.length >= b.capacity;
      return {
        capacity: b.capacity,
        windowMs: b.windowMs,
        used: live.length,
        nextSlotInMs: full ? Math.max(0, live[0] + b.windowMs - now) : 0,
      };
    });
    return {
      buckets,
      waitingHigh: this.high.length,
      waitingLow: this.low.length,
      nextSlotInMs: Math.max(0, ...buckets.map((b) => b.nextSlotInMs)),
      saturated: buckets.some((b) => b.used >= b.capacity),
    };
  }

  /** 슬롯이 날 때까지 대기 후 반환. high 큐가 항상 low 큐보다 먼저 소진된다 */
  acquire(priority: Priority = "high"): Promise<void> {
    return new Promise<void>((resolve) => {
      (priority === "high" ? this.high : this.low).push(resolve);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.high.length > 0 || this.low.length > 0) {
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

export const riotLimiter = new RateLimiter(
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
);
