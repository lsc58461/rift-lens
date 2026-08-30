"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Clock, Database, Gauge, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RATE_STATES,
  countdown,
  fetchAdminStatus,
  windowLabel,
  type AdminStatus,
} from "./types";
import { HourlyVisitsCard, TierDistributionCard } from "./stats-cards";
import { CrawlerCard } from "./crawler-card";
import { EmptyState, LiveDot, PageHeader, StatTile } from "./ui";

/**
 * 라이엇 API 한도 카드.
 * resumeInMs는 응답 시점 기준이라, 받은 순간의 로컬 시각을 더해 마감 시각을
 * 만들고 폴링(2초) 사이에는 클라이언트에서 직접 카운트다운한다.
 */
function RateCard({
  rate: rateFromStatus,
  receivedAt: receivedAtFromStatus,
}: {
  rate: AdminStatus["rate"];
  receivedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // 한도 현황만 전용 엔드포인트로 1초 폴링 — 인메모리 스냅샷이라 부담 없음.
  // 실패하면 대시보드 공용 폴링(2초) 값으로 폴백한다.
  const [fast, setFast] = useState<{ rate: AdminStatus["rate"]; at: number } | null>(null);
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await fetch("/api/admin/rate", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { rate: AdminStatus["rate"] };
          if (!stopped) setFast({ rate: data.rate, at: Date.now() });
        }
      } catch {
        // 다음 폴링에서 재시도
      }
      if (!stopped) setTimeout(poll, 1000);
    }
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  const rate = fast?.rate ?? rateFromStatus;
  const receivedAt = fast?.at ?? receivedAtFromStatus;
  const s = RATE_STATES[rate.state];
  const remaining = Math.max(0, receivedAt + rate.resumeInMs - now);
  const waiting = rate.waitingHigh + rate.waitingLow;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Gauge className="size-4 text-primary" />
          라이엇 API 한도
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
          >
            <span className={`size-1.5 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        </CardTitle>
        <CardDescription>{s.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">재개까지</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              {remaining > 0 ? countdown(remaining) : "여유"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">대기 중인 호출</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              {waiting}
            </div>
            {waiting > 0 && (
              <div className="text-xs text-muted-foreground">
                전경 {rate.waitingHigh} · 배경 {rate.waitingLow}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">보고 인스턴스</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              {rate.nodes}
            </div>
          </div>
        </div>

        {rate.buckets.length > 0 && (
          <div className="space-y-2">
            {rate.buckets.map((b) => {
              const pct = Math.min(100, (b.used / b.capacity) * 100);
              const full = b.used >= b.capacity;
              return (
                <div key={b.windowMs}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">
                      {windowLabel(b.windowMs)}당
                    </span>
                    <span className="tabular-nums">
                      {b.used} / {b.capacity}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        full ? "bg-amber-500" : "bg-primary"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rate.cooldown && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <span className="font-medium text-destructive">
              429 · Retry-After {rate.cooldown.retryAfterSec}초
            </span>
            <span className="ml-2 text-muted-foreground">
              {rate.cooldown.endpoint}
            </span>
          </div>
        )}

        {rate.nodes === 0 && !rate.cooldown && (
          <p className="text-xs text-muted-foreground">
            최근 라이엇 호출이 없어 보고된 상태가 없어요 — 호출이 시작되면 자동으로
            표시됩니다
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const data = await fetchAdminStatus();
        if (stopped) return;
        if (data === null) {
          router.refresh(); // 세션 만료
          return;
        }
        setStatus(data);
        setUpdatedAt(Date.now());
      } catch {
        // 다음 폴링에서 재시도
      }
      if (!stopped) setTimeout(poll, 2000);
    }
    poll();
    return () => {
      stopped = true;
    };
  }, [router]);

  // 목록은 최근 10명만 내려오므로 합계는 서버가 계산한 값을 쓴다
  const total = status?.summonerTotal ?? 0;
  const deepFresh = status?.summonerCounts?.deep ?? 0;
  const running = status?.running;
  const waiting = status?.waiting ?? [];
  const rate = status?.rate;
  const rateState = RATE_STATES[rate?.state ?? "idle"];

  return (
    <div className="space-y-5">
      <PageHeader
        title="대시보드"
        description="정밀 분석 러너와 대기열, 기록된 소환사 현황"
        actions={
          <LiveDot
            on={!!updatedAt}
            label={
              updatedAt
                ? new Date(updatedAt).toLocaleTimeString("ko-KR")
                : "연결 중"
            }
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          icon={Activity}
          label="실행 중 분석"
          value={running ? `${Math.round(running.progress * 100)}%` : "유휴"}
          sub={running?.name ?? "러너 대기 중"}
          tone={running ? "primary" : "muted"}
        />
        <StatTile
          icon={Clock}
          label="대기열"
          value={waiting.length}
          sub={waiting.length ? `다음: ${waiting[0].name}` : "대기 없음"}
          tone={waiting.length ? "amber" : "muted"}
        />
        <StatTile
          icon={Gauge}
          label="API 한도"
          value={rateState.label}
          sub={
            rate && rate.resumeInMs > 0
              ? `재개까지 ${countdown(rate.resumeInMs)}`
              : `대기 ${(rate?.waitingHigh ?? 0) + (rate?.waitingLow ?? 0)}건`
          }
          tone={
            rate?.state === "cooldown"
              ? "amber"
              : rate?.state === "throttled"
                ? "amber"
                : rate?.state === "busy"
                  ? "primary"
                  : "muted"
          }
        />
        <StatTile
          icon={Users}
          label="기록 소환사"
          value={total}
          sub="최근 검색 기준"
        />
        <StatTile
          icon={Database}
          label="정밀 · 최신"
          value={`${deepFresh}/${total}`}
          sub={total ? `${Math.round((deepFresh / total) * 100)}% 신선` : "—"}
          tone={total && deepFresh === total ? "emerald" : "muted"}
        />
      </div>

      {rate && updatedAt && <RateCard rate={rate} receivedAt={updatedAt} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              실행 중인 정밀 분석
            </CardTitle>
            <CardDescription>한 번에 1건만 실행돼요 (러너 락)</CardDescription>
          </CardHeader>
          <CardContent>
            {running ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {running.name}
                  </span>
                  <span className="text-2xl font-bold tabular-nums">
                    {Math.round(running.progress * 100)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${running.progress * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">
                    {running.region}
                  </span>
                  <span className="tabular-nums">
                    {running.updatedAgoSec}초 전 갱신
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState icon={Activity}>실행 중인 분석이 없어요</EmptyState>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-amber-500" />
              대기열
              {waiting.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {waiting.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              상위 5명은 화면을 나가도 순번이 유지돼요
            </CardDescription>
          </CardHeader>
          <CardContent>
            {waiting.length ? (
              <div className="space-y-1.5">
                {waiting.map((w) => (
                  <div
                    key={`${w.region}:${w.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums">
                        {w.position}
                      </span>
                      <span className="truncate">{w.name}</span>
                    </span>
                    {w.detached ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 text-[10px] text-muted-foreground"
                      >
                        화면 이탈 · 순번 유지
                      </Badge>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {w.lastSeenAgoSec}초 전
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Clock}>대기 중인 분석이 없어요</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TierDistributionCard tiers={status?.tiers ?? []} />
        <HourlyVisitsCard hourly={status?.hourly ?? []} />
      </div>

      <CrawlerCard crawlers={status?.crawlers ?? []} />

      <p className="text-xs text-muted-foreground">
        실행 중·대기열은 서버 캐시 기준이며 5초 간격으로 갱신됩니다
      </p>
    </div>
  );
}
