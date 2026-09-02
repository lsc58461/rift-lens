import { NAVER_SITE_VERIFICATION, SITE_URL } from "@/lib/site";
import { OG_BASE } from "@/lib/seo";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BarChart3, CircleHelp, History, Newspaper, Wrench,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import "./globals.css";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { LogoMark } from "@/components/logo-mark";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/sonner";
import { CrawlerProbe } from "@/components/crawler-probe";
import { PumpPing } from "@/components/pump-ping";

// 폰트는 첫 페인트 전 대역폭 경쟁자다(느린 4G 실측: 두 파일 51KB 가 High 우선순위로 CSS 와 나눠 받음, 2026-09-03).
// · Geist Sans 는 라틴 글자·숫자만 담당(한글은 시스템 폰트) → optional: 제때 오면 쓰고 늦으면 이번 방문은
//   시스템 폰트, 다음 방문부터 캐시로 적용. 교체(swap)로 인한 재렌더도 없다.
// · Geist Mono 는 어드민 표·차트 툴팁 두 곳뿐 → preload 끔(쓰이는 화면에서만 받음).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

const DESCRIPTION =
  "롤 전적 검색 — 최근 솔로랭크 경기 기록과 같은 경기에서 만난 플레이어들의 현재 랭크 분포를 보여드려요."; // 네이버 서치어드바이저 권장 80자 이내

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Rift Lens — 롤 전적 검색 · 매칭 랭크 분석",
    template: "%s | Rift Lens",
  },
  description: DESCRIPTION,
  keywords: [
    "롤 전적 검색",
    "롤 매칭 구간",
    "롤 티어 분석",
    "롤 랭크 조회",
    "롤 로비 평균 티어",
    "리그오브레전드 전적",
  ],
  // title/description/url 은 여기 적지 않는다 — 적으면 하위 페이지가 통째로 물려받아
  // 모든 페이지의 og:title/og:url 이 메인 값이 된다. 각 페이지가 pageMeta()로 낸다.
  openGraph: OG_BASE,
  twitter: {
    card: "summary_large_image",
  },
  robots: { index: true, follow: true },
  // 네이버 서치어드바이저 사이트 소유확인 (메타 태그 방식)
  verification: { other: { "naver-site-verification": NAVER_SITE_VERIFICATION } },
};

const NAV_LINKS = [
  { href: "/champions", label: "챔피언", icon: BarChart3 },
  { href: "/ranking", label: "랭킹", icon: Trophy },
  { href: "/recent", label: "최근 검색", icon: History },
  { href: "/patch-notes", label: "패치노트", icon: Newspaper },
  { href: "/faq", label: "FAQ", icon: CircleHelp },
  { href: "/tools", label: "도구", icon: Wrench },
] as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* 배경 장식: 상단 블루 글로우 */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-105 overflow-hidden"
          >
            <div className="absolute left-1/2 -top-56 size-144 -translate-x-1/2 rounded-full bg-primary/12 blur-3xl dark:bg-primary/10" />
          </div>

          <AnnouncementBanner />
          <CrawlerProbe />
          <PumpPing />
          <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
            <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4">
              <Link href="/" className="group flex shrink-0 items-center gap-2">
                <LogoMark className="size-7 shadow-sm transition-transform group-hover:scale-110" />
                <span className="font-semibold tracking-tight whitespace-nowrap">
                  Rift <span className="text-primary">Lens</span>
                </span>
              </Link>
              {/* 좁은 화면에선 아이콘만 남으므로 aria-label 로 링크 이름을 보장한다
                  (접근성 트리에 이름 없는 링크가 남으면 스크린리더·AI 에이전트가 못 읽음) */}
              <nav aria-label="주 메뉴" className="flex items-center gap-1">
                {NAV_LINKS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    aria-label={label}
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="hidden md:inline">{label}</span>
                  </Link>
                ))}
                <ThemeToggle />
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
            {children}
          </main>
          <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
            {/* 링크는 글자 단위로 꺾이지 않게 항목 단위로 줄바꿈 — 좁은 화면에선 두 줄로 */}
            <nav className="mx-auto mb-2 flex max-w-lg flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              <Link href="/updates" className="whitespace-nowrap hover:text-foreground hover:underline">
                업데이트 내역
              </Link>
              <Link href="/faq" className="whitespace-nowrap hover:text-foreground hover:underline">
                자주 묻는 질문
              </Link>
              <Link href="/discord" className="whitespace-nowrap hover:text-foreground hover:underline">
                디스코드 봇
              </Link>
              <Link href="/feedback" className="whitespace-nowrap hover:text-foreground hover:underline">
                문의·버그 신고
              </Link>
              <Link href="/terms" className="whitespace-nowrap hover:text-foreground hover:underline">
                이용약관
              </Link>
              <Link href="/privacy" className="whitespace-nowrap hover:text-foreground hover:underline">
                개인정보처리방침
              </Link>
            </nav>
            <p className="mx-auto max-w-md leading-relaxed [text-wrap:balance]">
              Rift Lens는 Riot Games의 공식 서비스가 아니며, 집계 수치는 참고용입니다.
            </p>
          </footer>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
