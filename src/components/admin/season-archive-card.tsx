"use client";

// 시즌 마감 랭크 확정 — 시즌 이름과 마감 시각(KST)을 예약하면 마감 36시간 전부터
// 등록 소환사 전원의 최종 랭크를 받아 season_ranks에 넣는다.
import { useCallback, useEffect, useState } from "react";
import { Archive, Loader2, Square } from "lucide-react";
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
import { Input } from "@/components/ui/input";

interface Archive {
  season: string;
  closesAt: number;
  status: "scheduled" | "running" | "done" | "cancelled";
  total: number;
  done: number;
  failed: number;
  startedAt: number | null;
  updatedAt: number;
  lastError: string | null;
}

const STATUS_LABEL: Record<Archive["status"], string> = {
  scheduled: "예약됨",
  running: "수집 중",
  done: "완료",
  cancelled: "취소됨",
};

function fmtKst(ts: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** datetime-local(KST 입력)을 절대 시각으로 — 브라우저 로컬이 KST가 아닐 수도 있어 명시 변환 */
function kstLocalToIso(local: string): string {
  return `${local}:00+09:00`;
}

export function SeasonArchiveCard() {
  const [archive, setArchive] = useState<Archive | null>(null);
  const [season, setSeason] = useState("2026 S2");
  const [closesAt, setClosesAt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/season-archive");
    if (res.ok) setArchive(((await res.json()) as { archive: Archive | null }).archive);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (archive?.status !== "running" && archive?.status !== "scheduled") return;
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [archive?.status, load]);

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/season-archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? "요청에 실패했어요");
      setArchive(d.archive);
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "요청에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  const active = archive && (archive.status === "scheduled" || archive.status === "running");
  const pct =
    archive && archive.total > 0
      ? Math.min(100, Math.round(((archive.done + archive.failed) / archive.total) * 100))
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Archive className="size-4 text-primary" />
          <span className="whitespace-nowrap">시즌 마감 랭크 확정</span>
          {archive && (
            <Badge variant={active ? "secondary" : "outline"} className="max-w-full gap-1 whitespace-normal text-left font-normal">
              {archive.status === "running" && <Loader2 className="size-3 animate-spin" />}
              {archive.season} · {STATUS_LABEL[archive.status]}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          라이엇은 지난 시즌 랭크를 주지 않아요. 시즌(스플릿) 마감 시각을 예약하면 마감 36시간
          전부터 등록된 소환사 전원의 최종 솔로랭크를 받아 저장하고, 다음 시즌부터 소환사
          페이지에 &quot;지난 시즌&quot;으로 표시돼요. 마감 시각은 라이엇 공지의 랭크 종료 시각(KST)을
          넣으세요 — 그 이후 값은 리셋된 랭크라 쓰지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {archive && (
          <div className="space-y-1.5 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>마감 {fmtKst(archive.closesAt)} (KST)</span>
              <span>수집 시작 {fmtKst(archive.closesAt - 36 * 3_600_000)}</span>
              {archive.total > 0 && (
                <span className="tabular-nums">
                  {archive.done.toLocaleString()} / {archive.total.toLocaleString()}명
                  {archive.failed > 0 && ` · 실패 ${archive.failed}`}
                </span>
              )}
            </div>
            {archive.total > 0 && (
              <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            {archive.lastError && <p className="text-xs text-destructive">{archive.lastError}</p>}
          </div>
        )}

        {active ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void post({ action: "cancel" }, "예약을 취소했어요")}
            className="gap-1.5"
          >
            <Square className="size-3.5" />
            취소
          </Button>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!closesAt) {
                toast.error("마감 시각을 입력해 주세요");
                return;
              }
              void post(
                { season, closesAt: kstLocalToIso(closesAt) },
                `${season} 마감 확정을 예약했어요`,
              );
            }}
          >
            <label className="flex-1 space-y-1 text-xs text-muted-foreground">
              시즌 이름
              <Input value={season} onChange={(e) => setSeason(e.target.value)} maxLength={30} />
            </label>
            <label className="flex-1 space-y-1 text-xs text-muted-foreground">
              마감 시각 (KST)
              <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </label>
            <Button type="submit" size="sm" disabled={busy}>
              예약
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
