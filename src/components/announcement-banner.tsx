"use client";

// GNB 위 공지 배너 — 관리자가 설정하면 사이트 전역 상단에 얇은 스트립으로
// 나타난다. X로 닫으면 그 공지(updatedAt 기준)는 그 브라우저에서 다시 뜨지
// 않고, 내용이 바뀌면 새 공지로 취급해 다시 보인다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Megaphone, X } from "lucide-react";

interface Announcement {
  enabled: boolean;
  text?: string;
  href?: string | null;
  tone?: "info" | "event" | "warn";
  updatedAt?: number;
}

const DISMISS_KEY = "announce-dismissed";

const TONE_STYLES: Record<string, string> = {
  info: "from-primary/15 via-chart-2/10 to-primary/15 text-foreground [&_.announce-icon]:text-primary",
  event:
    "from-violet-500/15 via-fuchsia-500/10 to-violet-500/15 text-foreground [&_.announce-icon]:text-violet-500 dark:[&_.announce-icon]:text-violet-400",
  warn: "from-amber-500/20 via-amber-400/10 to-amber-500/20 text-foreground [&_.announce-icon]:text-amber-600 dark:[&_.announce-icon]:text-amber-400",
};

export function AnnouncementBanner() {
  const [a, setA] = useState<Announcement | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch("/api/announcement")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Announcement | null) => {
        if (stop || !d?.enabled || !d.text) return;
        try {
          if (localStorage.getItem(DISMISS_KEY) === String(d.updatedAt)) return;
        } catch {
          // localStorage 접근 불가 환경이면 그냥 보여준다
        }
        setA(d);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  if (!a || closed) return null;

  const dismiss = () => {
    setClosed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(a.updatedAt));
    } catch {
      // 저장 실패해도 이번 세션에선 닫힘
    }
  };

  const inner = (
    <span className="flex min-w-0 items-center gap-2">
      <Megaphone className="announce-icon size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-normal break-keep leading-snug">{a.text}</span>
      {a.href && (
        <ArrowRight className="size-3 shrink-0 opacity-60 transition-transform group-hover/announce:translate-x-0.5" />
      )}
    </span>
  );

  return (
    <div
      className={`relative border-b border-border/60 bg-linear-to-r text-[13px] animate-in fade-in slide-in-from-top-2 duration-300 ${
        TONE_STYLES[a.tone ?? "info"]
      }`}
    >
      <div className="mx-auto flex h-9 w-full max-w-7xl items-center justify-center px-10">
        {a.href ? (
          <Link
            href={a.href}
            className="group/announce flex min-w-0 items-center font-medium underline-offset-4 hover:underline"
          >
            {inner}
          </Link>
        ) : (
          <span className="flex min-w-0 items-center font-medium">{inner}</span>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="공지 닫기"
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
