"use client";

// 소환사 시드 크롤 — 저장된 매치의 참가자 중 미기록 소환사를 찾아 빠른 분석으로
// 등록한다. 전체 갱신 카드와 같은 폴링·라운드 이어달리기 방식.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Radar, Square } from "lucide-react";
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

interface State {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  target: number;
  rounds: number;
  analyzed: number;
  failed: number;
  updatedAt: number;
  lastError: string | null;
}

const STALE_MS = 300_000;
const TARGETS = [10, 30, 50] as const;

export function CrawlCard() {
  const [state, setState] = useState<State | null>(null);
  const [target, setTarget] = useState<number>(30);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/crawl");
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

  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(async () => {
      const s = await load();
      const idle = s?.running && !s.roundActive;
      const stuck = s?.running && Date.now() - s.updatedAt > STALE_MS;
      if (idle || stuck) {
        await fetch("/api/admin/crawl?action=continue", { method: "POST" });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state?.running, load]);

  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      const qs =
        action === "start" ? `action=start&target=${target}` : "action=stop";
      const res = await fetch(`/api/admin/crawl?${qs}`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "요청에 실패했어요");
      }
      toast.success(
        action === "start"
          ? `소환사 ${target}명 수집을 시작했어요`
          : "수집을 중지했어요",
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
          <Radar className="size-4 text-chart-2" />
          소환사 시드 수집
          {state?.running && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="size-3 animate-spin" />
              진행 중
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          저장된 경기의 참가자 중 아직 기록되지 않은 소환사를 찾아 빠른 분석으로
          등록합니다. 라이엇 호출은 저우선순위라 유저 검색이 먼저 처리돼요.
          정밀 분석은 새벽 자동 갱신이 이어받습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">등록한 소환사</div>
              <div className="text-lg font-semibold tabular-nums">
                {state.analyzed}
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}
                  / {state.target}
                </span>
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

        {state?.done && !state.running && (
          <p className="text-sm text-muted-foreground">
            수집이 끝났어요 — 등록 {state.analyzed}명
            {state.analyzed < state.target && " (더 찾을 후보가 없었어요)"}
          </p>
        )}
        {state?.lastError && (
          <p className="text-sm text-destructive">{state.lastError}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!state?.running && (
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    target === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t}명
                </button>
              ))}
            </div>
          )}
          {state?.running ? (
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
          ) : (
            <Button
              size="sm"
              onClick={() => act("start")}
              disabled={busy}
              className="gap-1.5"
            >
              <Play className="size-3.5" />
              수집 시작
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
