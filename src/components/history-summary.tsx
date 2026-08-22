"use client";

// 최근 경기 요약을 전적 탭이 아닌 왼쪽 컬럼 카드로 보여주기 위한 배선.
// 데이터는 전적 목록(MatchHistory)의 /api/history 응답에 함께 실려 오므로,
// 컨텍스트로 끌어올려 두 위치에서 공유한다 — 같은 데이터를 두 번 불러오지 않는다.

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MatchSummary, type Summary } from "@/components/match-summary";

interface Ctx {
  summary: Summary | null;
  setSummary: (s: Summary | null) => void;
}

const HistorySummaryContext = createContext<Ctx | null>(null);

export function HistorySummaryProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  return (
    <HistorySummaryContext.Provider value={{ summary, setSummary }}>
      {children}
    </HistorySummaryContext.Provider>
  );
}

/** MatchHistory가 fetch 후 요약을 올려보낼 때 사용 (프로바이더 밖이면 no-op) */
export function useHistorySummary(): Ctx | null {
  return useContext(HistorySummaryContext);
}

/** 왼쪽 컬럼용 요약 카드 — 전적 응답이 도착하면 나타난다 */
export function MatchSummaryCard({
  version,
  names,
  region,
}: {
  version: string;
  names: Record<string, string>;
  region: string;
}) {
  const ctx = useHistorySummary();
  const summary = ctx?.summary ?? null;
  if (!summary || summary.games === 0) return null;

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <CardHeader>
        <CardTitle className="text-base">최근 경기 요약</CardTitle>
        <CardDescription>최근 {summary.games}경기 기준</CardDescription>
      </CardHeader>
      <CardContent>
        <MatchSummary
          summary={summary}
          version={version}
          names={names}
          region={region}
          bare
        />
      </CardContent>
    </Card>
  );
}
