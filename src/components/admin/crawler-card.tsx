"use client";

import { Bug } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "./ui";

export interface CrawlerStat {
  bot: string;
  hits24h: number;
  hits7d: number;
  lastAt: number;
  lastPath: string | null;
}

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 어떤 크롤러(봇)가 얼마나 들어오는지 — 봇별 24시간/7일 방문 수와 마지막 경로 */
export function CrawlerCard({ crawlers }: { crawlers: CrawlerStat[] }) {
  const total24 = crawlers.reduce((a, c) => a + c.hits24h, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bug className="size-4 text-chart-4" />
          크롤러 방문
        </CardTitle>
        <CardDescription>
          최근 7일 · 봇 UA로 들어온 페이지 요청 (크롤러엔 라이엇 호출을 하지 않아요
          {total24 > 0 && ` · 24시간 ${total24.toLocaleString()}회`})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {crawlers.length === 0 ? (
          <EmptyState icon={Bug}>아직 봇 방문 기록이 없어요 — 지금부터 쌓입니다</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-1.5 pr-3 text-left font-medium">봇</th>
                  <th className="py-1.5 px-2 text-right font-medium whitespace-nowrap">24시간</th>
                  <th className="py-1.5 px-2 text-right font-medium whitespace-nowrap">7일</th>
                  <th className="py-1.5 px-2 text-right font-medium whitespace-nowrap">마지막</th>
                  <th className="py-1.5 pl-3 text-left font-medium whitespace-nowrap">마지막 경로</th>
                </tr>
              </thead>
              <tbody>
                {crawlers.map((c) => (
                  <tr key={c.bot} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.bot}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.hits24h.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                      {c.hits7d.toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap text-muted-foreground">
                      {ago(c.lastAt)}
                    </td>
                    <td className="py-1.5 pl-3 max-w-64 truncate font-mono text-xs text-muted-foreground">
                      {c.lastPath ? decodeURIComponent(c.lastPath) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
