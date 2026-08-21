export interface AdminStatus {
  running: {
    region: string;
    name: string;
    progress: number;
    state: string;
    updatedAgoSec: number;
  } | null;
  waiting: {
    position: number;
    region: string;
    name: string;
    lastSeenAgoSec: number;
    /** 폴링이 끊겼지만 상위 순번이라 대기열에 유지 중 */
    detached: boolean;
  }[];
  rate: {
    state: "idle" | "busy" | "throttled" | "cooldown";
    /** 재개까지 남은 ms (응답 시점 기준) */
    resumeInMs: number;
    waitingHigh: number;
    waitingLow: number;
    buckets: {
      capacity: number;
      windowMs: number;
      used: number;
      nextSlotInMs: number;
    }[];
    nodes: number;
    cooldown: {
      until: number;
      retryAfterSec: number;
      endpoint: string;
    } | null;
  };
  summoners: {
    region: string;
    name: string;
    currentLabel: string | null;
    estimatedLabel: string | null;
    searchedAt: number;
    analysis: "deep" | "deep-stale" | "quick" | "quick-stale" | "none";
  }[];
  /** 기록된 소환사 전체 수 (목록 자체는 페이지 API로 받는다) */
  summonerTotal: number;
  summonerCounts: Record<string, number>;
  tiers: { tier: string | null; n: number }[];
  hourly: { hour: number; visits: number; summoners: number }[];
}

export type AnalysisState = AdminStatus["summoners"][number]["analysis"];

export interface SummonerPage {
  items: AdminStatus["summoners"];
  total: number;
  totalAll: number;
  counts: Record<AnalysisState, number>;
  page: number;
  size: number;
}

export async function fetchSummonerPage(params: {
  page: number;
  size: number;
  q: string;
  filter: AnalysisState | "all";
}): Promise<SummonerPage | null> {
  const qs = new URLSearchParams({
    page: String(params.page),
    size: String(params.size),
    q: params.q,
    filter: params.filter,
  });
  const res = await fetch(`/api/admin/summoners?${qs}`);
  return res.ok ? ((await res.json()) as SummonerPage) : null;
}

export const RATE_STATES: Record<
  AdminStatus["rate"]["state"],
  { label: string; note: string; cls: string; dot: string }
> = {
  idle: {
    label: "여유",
    note: "한도에 여유가 있어요",
    cls: "border-border bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  busy: {
    label: "대기 중",
    note: "슬롯 순서를 기다리는 호출이 있어요",
    cls: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  throttled: {
    label: "한도 도달",
    note: "버킷이 가득 차 다음 슬롯을 기다리는 중",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  cooldown: {
    label: "429 쿨다운",
    note: "라이엇이 429를 반환해 재시도를 대기 중",
    cls: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

/** 1000 → "1초", 120000 → "2분" */
export function windowLabel(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  return `${Math.round(ms / 60_000)}분`;
}

/** 남은 시간 표기 — 1분 미만은 소수점 1자리까지 */
export function countdown(ms: number): string {
  if (ms <= 0) return "지금";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}초`;
  const m = Math.floor(ms / 60_000);
  return `${m}분 ${Math.round((ms % 60_000) / 1000)}초`;
}

export const ANALYSIS_BADGES: Record<
  AdminStatus["summoners"][number]["analysis"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  deep: { label: "정밀 · 최신", variant: "default" },
  "deep-stale": { label: "정밀 · 스테일", variant: "destructive" },
  quick: { label: "빠른 분석", variant: "secondary" },
  "quick-stale": { label: "빠른 · 스테일", variant: "destructive" },
  none: { label: "캐시 만료", variant: "outline" },
};

export function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

/** 어드민 상태 폴링 훅에서 공용으로 쓰는 fetch */
export async function fetchAdminStatus(): Promise<AdminStatus | null> {
  const res = await fetch("/api/admin/status");
  if (!res.ok) return null;
  return res.json();
}
