"use client";

// 대시보드 통계 — 기록된 소환사의 티어 분포와, 유저가 실제로 사이트에 들어와
// 갱신하는 시간대 분포. 둘 다 순수 CSS 막대라 차트 라이브러리가 필요 없다.

import { Clock, PieChart } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TIER_COLORS, TIER_LABELS } from "@/lib/mmr/rank";
import { EmptyState } from "./ui";

const TIER_ORDER = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
];

export function TierDistributionCard({
  tiers,
}: {
  tiers: { tier: string | null; n: number }[];
}) {
  const rows = [...tiers].sort((a, b) => {
    const ia = a.tier ? TIER_ORDER.indexOf(a.tier) : 99;
    const ib = b.tier ? TIER_ORDER.indexOf(b.tier) : 99;
    return (ia < 0 ? 98 : ia) - (ib < 0 ? 98 : ib);
  });
  const total = rows.reduce((a, r) => a + r.n, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="size-4 text-primary" />
          티어 분포
        </CardTitle>
        <CardDescription>
          기록된 소환사 {total}명의 현재 티어
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={PieChart}>아직 데이터가 없어요</EmptyState>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div
                key={r.tier ?? "unranked"}
                className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-sm"
              >
                <span
                  className="truncate text-right text-xs font-medium"
                  style={
                    r.tier ? { color: TIER_COLORS[r.tier] } : undefined
                  }
                >
                  {r.tier ? (TIER_LABELS[r.tier] ?? r.tier) : "언랭크"}
                </span>
                <div className="h-3.5 overflow-hidden rounded-full bg-foreground/8">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(r.n / max) * 100}%`,
                      backgroundColor: r.tier
                        ? TIER_COLORS[r.tier]
                        : "var(--muted-foreground)",
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {r.n}명 ·{" "}
                  {total > 0 ? Math.round((r.n / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function HourlyVisitsCard({
  hourly,
}: {
  hourly: { hour: number; visits: number; summoners: number }[];
}) {
  const total = hourly.reduce((a, h) => a + h.visits, 0);
  const max = Math.max(1, ...hourly.map((h) => h.visits));
  const peak = hourly.reduce(
    (best, h) => (h.visits > best.visits ? h : best),
    { hour: 0, visits: 0, summoners: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-chart-2" />
          시간대별 방문
        </CardTitle>
        <CardDescription>
          최근 30일 · 유저가 직접 소환사 페이지를 연 횟수 (KST 기준
          {total > 0 && ` · 총 ${total}회, 피크 ${peak.hour}시`})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState icon={Clock}>
            아직 방문 기록이 없어요 — 이 통계는 지금부터 쌓입니다
          </EmptyState>
        ) : (
          <>
            <div className="flex h-32 items-end gap-[3px]">
              {hourly.map((h) => (
                <div
                  key={h.hour}
                  className="group relative flex-1"
                  title={`${h.hour}시 · ${h.visits}회 (소환사 ${h.summoners}명)`}
                >
                  <div
                    className={`w-full rounded-t transition-colors ${
                      h.hour === peak.hour
                        ? "bg-chart-2"
                        : "bg-primary/70 group-hover:bg-primary"
                    }`}
                    style={{
                      height: `${Math.max(2, (h.visits / max) * 128)}px`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              {[0, 6, 12, 18, 23].map((h) => (
                <span key={h}>{h}시</span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
