"use client";

// 참가자 정규화 테이블(match_participants) 적재 진행률 — DB만 쓰는 백그라운드 작업.
import { useCallback, useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Info {
  state: {
    total: number;
    done: number;
    startedAt: number;
    updatedAt: number;
    finished: boolean;
    lastError: string | null;
  } | null;
  pending: number;
  matches: number;
  participants: number;
}

export function ParticipantsCard() {
  const [info, setInfo] = useState<Info | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/participants");
    if (res.ok) setInfo((await res.json()) as Info);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!info || info.pending === 0) return;
    const id = setInterval(() => void load(), 5_000);
    return () => clearInterval(id);
  }, [info, load]);

  const running = !!info && info.pending > 0;
  const pct =
    info && info.matches > 0 ? Math.round(((info.matches - info.pending) / info.matches) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4 text-primary" />
          참가자 테이블 적재
          {info && (
            <Badge variant={running ? "secondary" : "outline"} className="gap-1 font-normal">
              {running && <Loader2 className="size-3 animate-spin" />}
              {running ? `적재 중 · 남은 매치 ${info.pending.toLocaleString()}` : "동기화됨"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          매치의 참가자 JSON을 1행=1참가자 테이블(match_participants)로 풀어 둡니다. 새 매치는
          저장 시 함께 기록되고, 기존 매치는 1분마다 2,000건씩 백그라운드로 적재돼요(DB만 사용).
          적재가 끝나면 챔피언 통계·후보 검색 등이 이 테이블을 읽도록 전환합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {info && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
              <span>매치 {info.matches.toLocaleString()}</span>
              <span>참가자 행 {info.participants.toLocaleString()}</span>
              <span>미적재 {info.pending.toLocaleString()}</span>
              {info.state?.startedAt && (
                <span>
                  시작{" "}
                  {new Intl.DateTimeFormat("ko-KR", {
                    timeZone: "Asia/Seoul",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(info.state.startedAt))}
                </span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            {info.state?.lastError && <p className="text-xs text-destructive">{info.state.lastError}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
