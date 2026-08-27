"use client";

// 경기 목록 한 개 — 최근 전적에 "매칭 구간 집계에 쓰인 경기"를 로비 랭크 칩으로 표시한다.
// 예전엔 최근 전적 / 집계에 사용된 경기 두 탭이었는데, 두 번째 탭의 고유 정보는
// 경기별 로비 평균 랭크뿐이라 전적 행에 칩으로 붙이고 탭을 없앴다.

import { Swords } from "lucide-react";
import { MatchHistory, type LobbyInfo } from "@/components/match-history";
import type { RuneInfo } from "@/lib/ddragon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type LobbyInfoMap = Record<string, LobbyInfo>;

export function MatchSection({
  region,
  riotId,
  ddVersion,
  champNames,
  runeMap,
  lobbyByMatch,
  analyzedCount,
}: {
  region: string;
  riotId: string;
  ddVersion: string;
  champNames: Record<string, string>;
  runeMap?: Record<number, RuneInfo>;
  lobbyByMatch: Record<string, LobbyInfo>;
  analyzedCount: number;
}) {
  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-[400ms] fill-mode-backwards">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Swords className="size-4 text-primary" />
          최근 전적
        </CardTitle>
        <CardDescription>
          최근 솔로랭크 경기 기록
          {analyzedCount > 0 && (
            <>
              {" · "}
              <span className="text-foreground/80">로비 랭크</span> 칩이 붙은 경기가 매칭 구간
              집계에 쓰인 최근 {analyzedCount}경기예요
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MatchHistory
          runeMap={runeMap}
          region={region}
          riotId={riotId}
          ddVersion={ddVersion}
          champNames={champNames}
          lobbyByMatch={lobbyByMatch}
          bare
        />
      </CardContent>
    </Card>
  );
}
