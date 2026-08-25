"use client";

// 문의함 — 접수된 문의·버그 신고를 상태별로 보고, 메모를 남기고, mailto로 답장한다.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Inbox, Mail, RefreshCw, Save, Trash2 } from "lucide-react";
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

type Kind = "inquiry" | "bug" | "data";
type Status = "new" | "in_progress" | "done";
interface Entry {
  id: number;
  kind: Kind;
  email: string;
  message: string;
  summoner: string | null;
  page: string | null;
  userAgent: string | null;
  status: Status;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const KIND_LABEL: Record<Kind, string> = {
  inquiry: "문의",
  bug: "버그",
  data: "데이터 요청",
};
const KIND_VARIANT: Record<Kind, "default" | "secondary" | "destructive" | "outline"> = {
  inquiry: "secondary",
  bug: "destructive",
  data: "default",
};
const STATUS_LABEL: Record<Status, string> = {
  new: "신규",
  in_progress: "처리 중",
  done: "완료",
};
const FILTERS: { value: Status | "all"; label: string }[] = [
  { value: "new", label: "신규" },
  { value: "in_progress", label: "처리 중" },
  { value: "done", label: "완료" },
  { value: "all", label: "전체" },
];

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function mailto(e: Entry): string {
  const subject = `[Rift Lens] ${KIND_LABEL[e.kind]} 답변 (#${e.id})`;
  const quoted = e.message
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const body = `안녕하세요, Rift Lens입니다.\n\n\n\n---- 보내주신 내용 ----\n${quoted}`;
  return `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function FeedbackInbox() {
  const [filter, setFilter] = useState<Status | "all">("new");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/admin/feedback${qs}`);
      if (res.ok) {
        const d = (await res.json()) as { entries: Entry[] };
        setEntries(d.entries);
        setNotes(Object.fromEntries(d.entries.map((e) => [e.id, e.note ?? ""])));
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: number, body: { status?: Status; note?: string | null }) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "실패");
      const { entry } = (await res.json()) as { entry: Entry };
      setEntries((list) =>
        filter !== "all" && entry.status !== filter
          ? list.filter((e) => e.id !== id)
          : list.map((e) => (e.id === id ? entry : e)),
      );
      toast.success(body.status ? `${STATUS_LABEL[body.status]}로 바꿨어요` : "메모를 저장했어요");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "실패했어요");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm(`#${id} 항목을 삭제할까요? 되돌릴 수 없어요.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/feedback?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
      setEntries((list) => list.filter((e) => e.id !== id));
      toast.success("삭제했어요");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "실패했어요");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="size-4 text-primary" />
          문의함
          {filter === "new" && entries.length > 0 && (
            <Badge variant="destructive" className="font-normal">
              {entries.length}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => void load()}
            disabled={loading}
            title="새로고침"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
        <CardDescription>
          /feedback 으로 접수된 문의·버그 신고·데이터 요청. 답장은 &quot;메일로 답장&quot;을 눌러
          지메일에서 직접 보내고, 끝나면 상태를 완료로 바꿔 두세요. 새 접수는 디스코드 알림 채널로도
          와요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {!loading && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filter === "new" ? "새 접수가 없어요" : "항목이 없어요"}
          </p>
        )}

        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={KIND_VARIANT[e.kind]} className="font-normal">
                  {KIND_LABEL[e.kind]}
                </Badge>
                <Badge variant="outline" className="font-normal">
                  {STATUS_LABEL[e.status]}
                </Badge>
                <span className="tabular-nums">#{e.id}</span>
                <span>·</span>
                <span>{fmt(e.createdAt)}</span>
                <a
                  href={`mailto:${e.email}`}
                  className="ml-auto inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  <Mail className="size-3.5" />
                  {e.email}
                </a>
              </div>

              {(e.summoner || e.page) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {e.summoner && (
                    <span>
                      소환사: <b className="text-foreground">{e.summoner}</b>
                    </span>
                  )}
                  {e.page && (
                    <a
                      href={e.page}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      {e.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                    </a>
                  )}
                </div>
              )}

              <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.message}</p>

              {e.userAgent && (
                <p className="truncate text-[11px] text-muted-foreground" title={e.userAgent}>
                  {e.userAgent}
                </p>
              )}

              <div className="space-y-2">
                <textarea
                  value={notes[e.id] ?? ""}
                  onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                  rows={2}
                  placeholder="처리 메모 (나만 보여요)"
                  className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={mailto(e)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
                  >
                    <Mail className="size-4" />
                    메일로 답장
                  </a>
                  {(["new", "in_progress", "done"] as Status[])
                    .filter((s) => s !== e.status)
                    .map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        disabled={busy === e.id}
                        onClick={() => void patch(e.id, { status: s })}
                      >
                        {STATUS_LABEL[s]}로
                      </Button>
                    ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === e.id || (notes[e.id] ?? "") === (e.note ?? "")}
                    onClick={() => void patch(e.id, { note: notes[e.id] ?? "" })}
                  >
                    <Save className="size-4" />
                    메모 저장
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    disabled={busy === e.id}
                    onClick={() => void remove(e.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
