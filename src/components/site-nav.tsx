"use client";

// GNB 메뉴 — 넓은 화면(sm 이상)에선 링크를 그대로 늘어놓고, 좁은 화면에선 하나의 '메뉴' 버튼에 접는다.
// 왜 접나: 검색 버튼이 들어오면서 아이콘이 8개가 되어 360~390px 폰에서 헤더가 가로로 넘쳤다
// (문서 폭 404px, 2026-09-10 실측). 접은 항목이 사라지면 모바일에서 그 페이지를 찾을 길이 없으므로
// 감추는 대신 메뉴 안에 전부 넣는다(푸터에도 링크가 있다).
import Link from "next/link";
import {
  BarChart3,
  CircleHelp,
  History,
  Menu,
  Newspaper,
  Trophy,
  Wrench,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_LINKS = [
  { href: "/champions", label: "챔피언", icon: BarChart3 },
  { href: "/ranking", label: "랭킹", icon: Trophy },
  { href: "/recent", label: "최근 검색", icon: History },
  { href: "/patch-notes", label: "패치노트", icon: Newspaper },
  { href: "/faq", label: "FAQ", icon: CircleHelp },
  { href: "/tools", label: "도구", icon: Wrench },
] as const;

export function SiteNav() {
  return (
    <>
      {/* 좁은 화면: 메뉴 버튼 하나로 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="메뉴"
          className="flex shrink-0 items-center rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden"
        >
          <Menu className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <DropdownMenuItem key={href} render={<Link href={href} />}>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 넓은 화면: 링크를 그대로 (md 이상에서만 글자 라벨) */}
      {NAV_LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-label={label}
          className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex md:py-1.5"
        >
          <Icon className="size-4" aria-hidden />
          <span className="hidden md:inline">{label}</span>
        </Link>
      ))}
    </>
  );
}
