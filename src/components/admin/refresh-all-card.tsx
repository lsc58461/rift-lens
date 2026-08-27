"use client";

// 전체 유저 데이터 갱신 — 새벽 크론과 같은 작업을 수동으로 돌린다.
// 한 번에 다 돌리면 함수 시간제한에 걸리므로, 폴링하며 라운드를 이어 요청한다.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { estimateEtaMs, formatEta } from "@/lib/eta";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface State {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  rounds: number;
  refreshed: number;
  deepCompleted: number;
  failed: number;
  updatedAt: number;
  lastError: string | null;
  scanned?: number;
  target?: number;
  cursor?: number;
  passes?: number;
  passStartedAt?: number;
  startedAt?: number;
}

const STALE_MS = 300_000; // 크론 한 라운드(최대 240초)보다 넉넉하게

export function RefreshAllCard() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/refresh-all");
      if (res.ok) {
        const d: { state: State | null } = await res.json();
        setState(d.state);
        return d.state;
      }
    } catch {
      // 다음 폴링에서 재시도
    }
    return null;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 진행 중이면 상태를 갱신하고, 라운드가 끝나 있으면 다음 라운드를 이어 요청
  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(async () => {
      const s = await load();
      // 라운드가 끝났거나(roundActive=false) 죽은 것 같으면 다음 라운드를 잇는다
      const idle = s?.running && !s.roundActive;
      const stuck = s?.running && Date.now() - s.updatedAt > STALE_MS;
      if (idle || stuck) {
        await fetch("/api/admin/refresh-all?action=continue", {
          method: "POST",
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state?.running, load]);

  async function act(action: "start" | "stop" | "resume") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/refresh-all?action=${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "요청에 실패했어요");
      }
      toast.success(
        action === "start"
          ? "전체 갱신을 처음부터 시작했어요"
          : action === "resume"
            ? "멈춘 자리에서 이어서 시작했어요"
            : "갱신을 중지했어요",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "요청에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="size-4 text-primary" />
          전체 유저 데이터 갱신
          {state?.running && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="size-3 animate-spin" />
              진행 중
              {state.target ? (
                <span className="tabular-nums">
                  · {(state.passes ?? 0) + 1}바퀴 {state.rounds + 1}라운드 · {state.scanned ?? 0}/
                  {state.target}
                  {state.passStartedAt ?? state.startedAt ? (
                    <>
                      {" · 남은 시간 "}
                      {formatEta(
                        estimateEtaMs({
                          startedAt: state.passStartedAt ?? state.startedAt!,
                          done: state.scanned ?? 0,
                          total: state.target,
                        }),
                      )}
                    </>
                  ) : null}
                </span>
              ) : null}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          새벽 자동 갱신과 같은 작업을 지금 실행합니다 — 최근 검색된 소환사를
          순회하며 새 경기가 있으면 다시 분석해요. 라이엇 호출은 저우선순위라
          유저 검색이 들어오면 자동으로 뒤로 밀립니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">갱신한 소환사</div>
              <div className="text-lg font-semibold tabular-nums">
                {state.refreshed}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">정밀 분석 완료</div>
              <div className="text-lg font-semibold tabular-nums">
                {state.deepCompleted}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">라운드</div>
              <div className="text-lg font-semibold tabular-nums">
                {state.rounds}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">실패</div>
              <div className="text-lg font-semibold tabular-nums">
                {state.failed}
              </div>
            </div>
          </div>
        )}

        {state?.lastError && (
          <p className="truncate text-xs text-muted-foreground">
            마지막 오류: {state.lastError}
          </p>
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
            <>
              {(state?.cursor ?? 0) > 0 && (
                <Button
                  size="sm"
                  onClick={() => act("resume")}
                  disabled={busy}
                  className="gap-1.5"
                  title={`위치 ${state?.cursor}/${state?.target}부터 이어서`}
                >
                  <Play className="size-3.5" />
                  이어서 시작 ({state?.cursor?.toLocaleString()}부터)
                </Button>
              )}
              <Button
                size="sm"
                variant={(state?.cursor ?? 0) > 0 ? "outline" : "default"}
                onClick={() => act("start")}
                disabled={busy}
                className="gap-1.5"
              >
                <Play className="size-3.5" />
                {(state?.cursor ?? 0) > 0 ? "처음부터" : "전체 갱신 시작"}
              </Button>
            </>
          )}
          {state?.done && !state.running && (state?.cursor ?? 0) === 0 && (
            <span className="text-sm text-muted-foreground">
              갱신할 대상이 남지 않았어요 ✅
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
