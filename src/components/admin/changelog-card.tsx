"use client";

// 업데이트 내역 관리 — DB 기반이라 재배포 없이 추가·수정·삭제한다.
// 항목은 "태그: 내용" 한 줄씩 입력 (태그: 신규 | 개선 | 수정, 생략 시 개선).

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus, Save, Trash2, X } from "lucide-react";
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

type Tag = "신규" | "개선" | "수정";
interface Item {
  tag: Tag;
  text: string;
}
interface Entry {
  id: number;
  date: string;
  title: string;
  items: Item[];
  published: boolean;
}

const TAG_VARIANT: Record<Tag, "default" | "secondary" | "outline"> = {
  신규: "default",
  개선: "secondary",
  수정: "outline",
};

function itemsToText(items: Item[]): string {
  return items.map((i) => `${i.tag}: ${i.text}`).join("\n");
}
function textToItems(text: string): Item[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(신규|개선|수정)\s*[:：]\s*(.+)$/);
      if (m) return { tag: m[1] as Tag, text: m[2].trim() };
      return { tag: "개선" as Tag, text: l };
    });
}

interface Draft {
  id?: number;
  date: string;
  title: string;
  itemsText: string;
  published: boolean;
}

function todayKst(): string {
  // 표시용 날짜 기본값 (KST) — en-CA 로케일이 YYYY-MM-DD 형식
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ChangelogCard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/changelog");
      if (res.ok) {
        const d = await res.json();
        setEntries(d.entries ?? []);
      }
    } catch {
      // 무시
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setDraft({
      date: todayKst(),
      title: "",
      itemsText: "신규: ",
      published: true,
    });
  }
  function startEdit(e: Entry) {
    setDraft({
      id: e.id,
      date: e.date,
      title: e.title,
      itemsText: itemsToText(e.items),
      published: e.published,
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          date: draft.date,
          title: draft.title,
          items: textToItems(draft.itemsText),
          published: draft.published,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "저장 실패");
      }
      toast.success(draft.id ? "수정했어요" : "추가했어요");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("이 항목을 삭제할까요?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/changelog?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("삭제 실패");
      toast.success("삭제했어요");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" />
          업데이트 내역
        </CardTitle>
        <CardDescription>
          /updates 페이지에 표시돼요. 재배포 없이 여기서 바로 추가·수정·삭제할 수
          있어요. 항목은 &quot;태그: 내용&quot; 한 줄씩 (태그: 신규·개선·수정).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                placeholder="2026-08-24"
                className="sm:w-40"
              />
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="제목 (예: 챔피언 통계 개편)"
              />
            </div>
            <textarea
              value={draft.itemsText}
              onChange={(e) => setDraft({ ...draft, itemsText: e.target.value })}
              rows={5}
              placeholder={"신규: 새 기능 설명\n개선: 개선한 내용\n수정: 고친 버그"}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) =>
                    setDraft({ ...draft, published: e.target.checked })
                  }
                />
                공개
              </label>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft(null)}
                  disabled={busy}
                  className="gap-1.5"
                >
                  <X className="size-3.5" />
                  취소
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={busy || !draft.title.trim() || !draft.date.trim()}
                  className="gap-1.5"
                >
                  <Save className="size-3.5" />
                  저장
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={startNew} className="gap-1.5">
            <Plus className="size-3.5" />
            새 항목 추가
          </Button>
        )}

        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground">{e.date}</span>
                  {!e.published && (
                    <Badge variant="outline" className="text-[10px]">
                      비공개
                    </Badge>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {e.items.map((it, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-muted-foreground"
                    >
                      <Badge
                        variant={TAG_VARIANT[it.tag]}
                        className="shrink-0 text-[9px]"
                      >
                        {it.tag}
                      </Badge>
                      <span className="line-clamp-2">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startEdit(e)}
                  disabled={busy}
                >
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(e.id)}
                  disabled={busy}
                  className="text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
