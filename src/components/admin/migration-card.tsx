"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Status {
  fp: string;
  stats: {
    summoners: number;
    snapshots: number;
    matches: number;
    identities: number;
  };
  state: {
    running: boolean;
    migrated: number;
    snapshotsMoved: number;
    matchesPurged: number;
    failed: number;
    done: boolean;
    lastError: string | null;
    updatedAt: number;
  } | null;
}

export function MigrationCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/migrate");
      if (res.ok) setSt(await res.json());
    } catch {
      // 다음 폴링에서 재시도
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 진행 중이면 주기적으로 갱신하고, 배치가 끝나 있으면 다음 배치를 이어서 요청
  useEffect(() => {
    if (!st?.state?.running) return;
    const id = setInterval(async () => {
      await load();
      const stale = Date.now() - (st.state?.updatedAt ?? 0) > 20_000;
      if (stale) await fetch("/api/admin/migrate", { method: "POST" });
    }, 5000);
    return () => clearInterval(id);
  }, [st?.state?.running, st?.state?.updatedAt, load]);

  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/migrate?action=${action}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast.success(
        action === "start" ? "이관을 시작했어요" : "이관을 중지했어요",
      );
      await load();
    } catch {
      toast.error("요청에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  const stats = st?.stats;
  const state = st?.state;
  const remaining = stats
    ? stats.identities + stats.matches + stats.snapshots
    : 0;
  const clean = remaining === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4 text-primary" />
          옛 API 키 데이터 이관
          {state?.running && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="size-3 animate-spin" />
              진행 중
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          PUUID는 API 키 단위로 암호화돼서, 키를 바꾸면 옛 데이터가 조회
          불가능해져요. 이름으로 새 키의 PUUID를 다시 받아 <b>랭크 히스토리를
          되살리고</b>, 되살릴 수 없는 매치 상세는 정리합니다. 라이엇 호출은
          저우선순위라 유저 검색이 들어오면 자동으로 뒤로 밀려요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">이관 대기 소환사</div>
            <div className="text-lg font-semibold tabular-nums">
              {stats?.identities ?? "—"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">옛 스냅샷</div>
            <div className="text-lg font-semibold tabular-nums">
              {stats?.snapshots?.toLocaleString() ?? "—"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">옛 매치</div>
            <div className="text-lg font-semibold tabular-nums">
              {stats?.matches?.toLocaleString() ?? "—"}
            </div>
          </div>
        </div>

        {state && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                이관 완료{" "}
                <b className="text-foreground tabular-nums">{state.migrated}</b>명
              </span>
              <span>
                복원한 스냅샷{" "}
                <b className="text-foreground tabular-nums">
                  {state.snapshotsMoved.toLocaleString()}
                </b>
                행
              </span>
              <span>
                정리한 매치{" "}
                <b className="text-foreground tabular-nums">
                  {state.matchesPurged.toLocaleString()}
                </b>
                행
              </span>
              {state.failed > 0 && (
                <span>
                  조회 실패{" "}
                  <b className="text-foreground tabular-nums">{state.failed}</b>명
                </span>
              )}
            </div>
            {state.lastError && (
              <div className="mt-1.5 truncate text-xs text-muted-foreground">
                마지막 오류: {state.lastError}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {state?.running ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => act("stop")}
              disabled={busy}
              className="gap-1.5"
            >
              <Square className="size-3.5" />
              중지
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => act("start")}
              disabled={busy || clean}
              className="gap-1.5"
            >
              <Play className="size-3.5" />
              {clean ? "이관할 데이터 없음" : "이관 시작"}
            </Button>
          )}
          {clean && !state?.running && (
            <span className="text-sm text-muted-foreground">
              현재 키 데이터만 남아 있어요 ✅
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
