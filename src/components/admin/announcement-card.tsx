"use client";

// 공지 배너 설정 — GNB 위 스트립에 표시될 문구·링크·색조를 관리한다.

import { useEffect, useState } from "react";
import { ArrowRight, Megaphone, X } from "lucide-react";
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

interface Announcement {
  enabled: boolean;
  text: string;
  href: string | null;
  tone: "info" | "event" | "warn";
  updatedAt: number;
}

const TONES = [
  { key: "info", label: "기본", chip: "bg-primary/15 text-primary" },
  {
    key: "event",
    label: "이벤트",
    chip: "bg-violet-500/15 text-violet-500 dark:text-violet-400",
  },
  {
    key: "warn",
    label: "주의",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
] as const;

const PREVIEW_STYLES: Record<string, string> = {
  info: "from-primary/15 via-chart-2/10 to-primary/15 [&_svg.tone]:text-primary",
  event:
    "from-violet-500/15 via-fuchsia-500/10 to-violet-500/15 [&_svg.tone]:text-violet-500",
  warn: "from-amber-500/20 via-amber-400/10 to-amber-500/20 [&_svg.tone]:text-amber-600 dark:[&_svg.tone]:text-amber-400",
};

export function AnnouncementCard() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const [tone, setTone] = useState<"info" | "event" | "warn">("info");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false); // 현재 배포된 공지가 켜져 있는지

  useEffect(() => {
    fetch("/api/admin/announcement")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { announcement: Announcement | null } | null) => {
        const a = d?.announcement;
        if (!a) return;
        setEnabled(a.enabled);
        setLive(a.enabled && Boolean(a.text.trim()));
        setText(a.text);
        setHref(a.href ?? "");
        setTone(a.tone);
      })
      .catch(() => {});
  }, []);

  async function save(nextEnabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextEnabled,
          text,
          href: href.trim() || null,
          tone,
        }),
      });
      if (!res.ok) throw new Error();
      setEnabled(nextEnabled);
      setLive(nextEnabled && Boolean(text.trim()));
      toast.success(
        nextEnabled ? "공지를 게시했어요" : "공지를 내렸어요",
      );
    } catch {
      toast.error("저장에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" />
          공지 배너
          {live && (
            <Badge variant="secondary" className="font-normal">
              게시 중
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          사이트 상단(GNB 위)에 얇은 배너로 표시됩니다. 방문자가 닫으면 같은
          공지는 다시 뜨지 않고, 내용을 바꿔 저장하면 새 공지로 다시 보여요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="공지 문구 — 예: 새 기능 '챔피언 통계'가 열렸어요!"
          />
          <Input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="링크 (선택) — 예: /champions 또는 /updates"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {TONES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTone(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${t.chip} ${
                tone === t.key
                  ? "ring-2 ring-current"
                  : "opacity-50 hover:opacity-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 미리보기 */}
        {text.trim() && (
          <div
            className={`relative rounded-lg border bg-linear-to-r text-[13px] ${PREVIEW_STYLES[tone]}`}
          >
            <div className="flex h-9 items-center justify-center gap-2 px-10 font-medium">
              <Megaphone className="tone size-3.5 shrink-0" />
              <span className="truncate">{text}</span>
              {href.trim() && <ArrowRight className="size-3 opacity-60" />}
            </div>
            <X className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 opacity-60" />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => save(true)}
            disabled={busy || !text.trim()}
          >
            {enabled ? "수정 사항 게시" : "게시하기"}
          </Button>
          {live && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(false)}
              disabled={busy}
            >
              공지 내리기
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
