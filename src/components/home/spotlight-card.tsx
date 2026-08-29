"use client";

// 커서 위치를 따라 테두리·배경에 빛이 도는 카드. 유리 느낌(반투명 + 블러).
// 색은 CSS 변수 --spot 로 카드마다 다르게 줄 수 있다.
// overflow-hidden 을 쓰지 않는다 — 빛은 ::before(inset-0, rounded-[inherit]) 안에만 그려지고,
// 카드 안의 드롭다운(검색 추천)이 카드 밖으로 나와야 한다.
import Link from "next/link";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

const BASE =
  "group/spot relative rounded-2xl border border-white/10 bg-card/60 backdrop-blur-md transition-transform duration-300 will-change-transform " +
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:transition-opacity before:duration-300 " +
  "before:bg-[radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,50%),color-mix(in_oklab,var(--spot)_22%,transparent),transparent_60%)] " +
  "hover:-translate-y-0.5 hover:border-white/20 hover:before:opacity-100 dark:border-white/8 dark:hover:border-white/16";

function track(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function SpotlightCard({
  children,
  className = "",
  spot = "var(--color-primary)",
  href,
  style,
}: {
  children: ReactNode;
  className?: string;
  /** 빛 색 — CSS color */
  spot?: string;
  href?: string;
  style?: CSSProperties;
}) {
  const merged = { "--spot": spot, ...style } as CSSProperties;
  if (href) {
    return (
      <Link href={href} className={`${BASE} block ${className}`} style={merged} onMouseMove={track}>
        <div className="relative">{children}</div>
      </Link>
    );
  }
  return (
    <div className={`${BASE} ${className}`} style={merged} onMouseMove={track}>
      <div className="relative">{children}</div>
    </div>
  );
}
