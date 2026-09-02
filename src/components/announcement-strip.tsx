"use client";

// 공지 스트립(표시 부분) — 서버(announcement-banner.tsx)가 내용을 정해서 첫 HTML 에 그린다.
// 여기선 닫기만 처리한다: 쿠키(서버가 다음 요청부터 안 그리게)와 localStorage(예전 호환)에
// updatedAt 을 남기고 즉시 숨긴다. 내용이 바뀌면 updatedAt 이 달라져 다시 보인다.
// 진입 애니메이션은 두지 않는다 — 첫 HTML 에 이미 있는 요소라 움직이면 Speed Index 만 나빠진다.

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Megaphone, X } from "lucide-react";

const DISMISS_KEY = "announce-dismissed";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const TONE_STYLES: Record<string, string> = {
  info: "from-primary/15 via-chart-2/10 to-primary/15 text-foreground [&_.announce-icon]:text-primary",
  event:
    "from-violet-500/15 via-fuchsia-500/10 to-violet-500/15 text-foreground [&_.announce-icon]:text-violet-500 dark:[&_.announce-icon]:text-violet-400",
  warn: "from-amber-500/20 via-amber-400/10 to-amber-500/20 text-foreground [&_.announce-icon]:text-amber-600 dark:[&_.announce-icon]:text-amber-400",
};

export function AnnouncementStrip({
  text,
  href,
  tone,
  updatedAt,
}: {
  text: string;
  href: string | null;
  tone: "info" | "event" | "warn";
  updatedAt: number;
}) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  const dismiss = () => {
    setClosed(true);
    try {
      document.cookie = `${DISMISS_KEY}=${updatedAt}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
      localStorage.setItem(DISMISS_KEY, String(updatedAt));
    } catch {
      // 저장 실패해도 이번 세션에선 닫힘
    }
  };

  const inner = (
    <span className="flex min-w-0 items-center gap-2">
      <Megaphone className="announce-icon size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-normal break-keep leading-snug">{text}</span>
      {href && (
        <ArrowRight className="size-3 shrink-0 opacity-60 transition-transform group-hover/announce:translate-x-0.5" />
      )}
    </span>
  );

  return (
    <div
      className={`relative border-b border-border/60 bg-linear-to-r text-[13px] ${TONE_STYLES[tone] ?? TONE_STYLES.info}`}
    >
      <div className="mx-auto flex min-h-11 w-full max-w-7xl items-center justify-center px-10 py-2.5">
        {href ? (
          <Link
            href={href}
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
