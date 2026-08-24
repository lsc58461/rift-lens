"use client";

// 룬 백필 — 룬 저장 도입 전 매치를 다시 받아 룬을 채운다.
// 다른 대량 작업 카드와 같은 폴링·라운드 이어달리기 방식.

import { useCallback, useEffect, useState } from "react";
import { Eraser, Loader2, Play, Sparkle, Square, Zap } from "lucide-react";
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
  total: number;
  filled: number;
  failed: number;
  rounds: number;
  turbo?: boolean;
  startedAt?: number;
  updatedAt: number;
  lastError: string | null;
}

const STALE_MS = 300_000;

export function RuneBackfillCard() {
  const [state, setState] = useState<State | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/rune-backfill");
      if (res.ok) {
        const d: { state: State | null; missing: number | null } =
          await res.json();
        setState(d.state);
        setMissing(d.missing);
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

  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(async () => {
      const s = await load();
      const idle = s?.running && !s.roundActive;
      const stuck = s?.running && Date.now() - s.updatedAt > STALE_MS;
      if (idle || stuck) {
        await fetch("/api/admin/rune-backfill?action=continue", {
          method: "POST",
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state?.running, load]);

  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/rune-backfill?action=${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "요청에 실패했어요");
      }
      toast.success(
        action === "start" ? "백필을 시작했어요" : "백필을 중지했어요",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "요청에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  const progress =
    state && state.total > 0
      ? Math.min(100, Math.round(((state.filled + state.failed) / state.total) * 100))
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkle className="size-4 text-chart-2" />
          매치 데이터 백필
          {state?.running && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="size-3 animate-spin" />
              진행 중
              {state.startedAt && state.total > 0 ? (
                <span className="tabular-nums">
                  {" · 남은 시간 "}
                  {formatEta(
                    estimateEtaMs({
                      startedAt: state.startedAt,
                      done: state.filled + state.failed,
                      total: state.total,
                    }),
                  )}
                </span>
              ) : null}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          룬·패치·시작 아이템·코어 빌드 순서가 비어 있는 지난 매치를 다시
          받아 채웁니다 (새 매치는 정밀 분석이 자동으로 채워요). 전부
          저우선순위라 유저 검색이 먼저 처리되고, 시작해두면 탭을 닫아도
          서버가 알아서 완주합니다.
          {missing !== null && (
            <>
              {" "}
              현재 채울 매치 <b>{missing.toLocaleString()}</b>개.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state && state.total > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                채움 {state.filled.toLocaleString()} · 실패 {state.failed}
                {" · 라운드 "}
                {state.rounds}
              </span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-chart-2 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        {state?.done && !state.running && (
          <p className="text-sm text-muted-foreground">
            백필이 끝났어요 — 채움 {state.filled.toLocaleString()}개
          </p>
        )}
        {state?.lastError && (
          <p className="text-sm text-destructive">{state.lastError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={async () => {
              const res = await fetch("/api/admin/clear-stats-cache", {
                method: "POST",
              });
              if (res.ok) {
                const d = await res.json();
                toast.success(
                  `통계를 다시 집계했어요 (${Math.round(d.tookMs / 1000)}초) — 바로 최신 데이터가 보입니다`,
                );
              } else toast.error("요청에 실패했어요");
            }}
          >
            <Eraser className="size-3.5" />
            통계 재집계
          </Button>
          {state?.running ? (
            <>
              <Button
                size="sm"
                variant={state.turbo ? "default" : "outline"}
                disabled={busy}
                className="gap-1.5"
                onClick={async () => {
                  const on = !state.turbo;
                  const res = await fetch(
                    `/api/admin/rune-backfill?action=turbo&turbo=${on ? "on" : "off"}`,
                    { method: "POST" },
                  );
                  if (res.ok) {
                    const d = await res.json();
                    setState(d.state);
                    toast.success(
                      on
                        ? "최고속 모드 켜짐 — 유저 검색과 한도를 나눠 씁니다"
                        : "최고속 모드 꺼짐 — 저우선순위로 돌아갑니다",
                    );
                  } else toast.error("요청에 실패했어요");
                }}
              >
                <Zap className="size-3.5" />
                {state.turbo ? "최고속 켜짐" : "최고속 꺼짐"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act("stop")}
                disabled={busy}
                className="gap-1.5"
              >
                <Square className="size-3.5" />
                중지
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => act("start")}
              disabled={busy || missing === 0}
              className="gap-1.5"
            >
              <Play className="size-3.5" />
              백필 시작
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
