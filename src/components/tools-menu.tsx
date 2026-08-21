// GNB 도구 메뉴 — 클릭해야 열리는 드롭다운 대신, 사이트 내비게이션 관례대로
// 호버(모바일은 탭)에 바로 열리는 플라이아웃. JS 상태 없이 CSS만으로 동작해
// 서버 컴포넌트로 렌더된다.

import Link from "next/link";
import { ChevronDown, Heart, Sparkles, Swords, Wrench } from "lucide-react";

const TOOLS = [
  {
    icon: Swords,
    label: "내전 팀 밸런서",
    desc: "10명을 실력대 기준으로 균형 있게 나눠요",
    href: "/team",
    tile: "bg-sky-500/15 text-sky-500 dark:text-sky-400",
  },
  {
    icon: Heart,
    label: "듀오 궁합 분석",
    desc: "함께한 경기의 승률과 시너지를 봐요",
    href: "/duo",
    tile: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
  },
  {
    icon: Sparkles,
    label: "시즌 결산",
    desc: "이번 시즌 여정을 한 장으로 정리해요",
    href: "/recap",
    tile: "bg-amber-500/15 text-amber-500 dark:text-amber-400",
  },
] as const;

export function ToolsMenu() {
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground group-focus-within:bg-accent group-focus-within:text-accent-foreground"
      >
        <Wrench className="size-4" />
        <span className="hidden sm:inline">도구</span>
        <ChevronDown className="size-3.5 transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" />
      </button>
      {/* pt-2가 트리거와 패널 사이 호버 브리지 역할을 한다 */}
      <div className="invisible absolute top-full right-0 z-50 translate-y-1 pt-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <div className="w-max max-w-[calc(100vw-1.5rem)] rounded-xl border bg-popover p-2 shadow-lg">
          {TOOLS.map(({ icon: Icon, label, desc, href, tile }) => (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-md ${tile}`}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm leading-none font-medium">
                  {label}
                </span>
                <span className="truncate text-xs leading-snug text-muted-foreground">
                  {desc}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
