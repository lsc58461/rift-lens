"use client";

// 경기 목록 두 개(최근 전적 / 실력대 분석에 사용된 경기)를 탭으로 묶는다.
// 세로로 나란히 쌓으면 페이지 하단이 지나치게 길어지는데, 두 목록을 동시에
// 보는 경우는 드물어서 탭이 맞다.

import { ListChecks, Swords } from "lucide-react";
import { MatchHistory } from "@/components/match-history";
import type { RuneInfo } from "@/lib/ddragon";
import { MatchList, type MatchRow } from "@/components/match-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MatchTabs({
  region,
  riotId,
  ddVersion,
  champNames,
  runeMap,
  rows,
}: {
  region: string;
  riotId: string;
  ddVersion: string;
  champNames: Record<string, string>;
  runeMap?: Record<number, RuneInfo>;
  rows: MatchRow[];
}) {
  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-[400ms] fill-mode-backwards">
      <Tabs defaultValue="history">
        <CardHeader>
          <TabsList>
            <TabsTrigger value="history" className="gap-1.5 px-3">
              <Swords className="size-3.5" />
              최근 전적
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-1.5 px-3">
              <ListChecks className="size-3.5" />
              분석에 사용된 경기
            </TabsTrigger>
          </TabsList>
          <TabsContent value="history">
            <CardTitle className="sr-only">최근 전적</CardTitle>
            <CardDescription>최근 솔로랭크 경기 기록</CardDescription>
          </TabsContent>
          <TabsContent value="analysis">
            <CardTitle className="sr-only">실력대 분석에 사용된 경기</CardTitle>
            <CardDescription>
              로비 평균 랭크 기준 · 최근 {rows.length}경기
            </CardDescription>
          </TabsContent>
        </CardHeader>
        <CardContent>
          <TabsContent value="history">
            <MatchHistory
              runeMap={runeMap}
              region={region}
              riotId={riotId}
              ddVersion={ddVersion}
              champNames={champNames}
              bare
            />
          </TabsContent>
          <TabsContent value="analysis">
            {rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                최근 솔로랭크 기록이 없어요.
              </p>
            ) : (
              <MatchList rows={rows} />
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
