import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BarChart3, CircleHelp, History, Newspaper, Wrench } from "lucide-react";
import Link from "next/link";
import "./globals.css";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { LogoMark } from "@/components/logo-mark";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "리그 오브 레전드 전적 검색 — 최근 솔로랭크 경기 기록과 함께, 같은 경기에서 만난 플레이어들의 현재 랭크 분포를 라이엇 공식 API의 공개 데이터로 보여드립니다.";

export const metadata: Metadata = {
  metadataBase: new URL("https://rift-lens.xyz"),
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
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Rift Lens",
    title: "Rift Lens — 롤 전적 검색 · 매칭 랭크 분석",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: { index: true, follow: true },
};

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
          <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
            <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4">
              <Link href="/" className="group flex items-center gap-2">
                <LogoMark className="size-7 shadow-sm transition-transform group-hover:scale-110" />
                <span className="font-semibold tracking-tight">
                  Rift <span className="text-primary">Lens</span>
                </span>
              </Link>
              <div className="flex items-center gap-1">
                <Link
                  href="/champions"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <BarChart3 className="size-4" />
                  <span className="hidden sm:inline">챔피언</span>
                </Link>
                <Link
                  href="/recent"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <History className="size-4" />
                  <span className="hidden sm:inline">최근 검색</span>
                </Link>
                <Link
                  href="/patch-notes"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Newspaper className="size-4" />
                  <span className="hidden sm:inline">패치노트</span>
                </Link>
                <Link
                  href="/faq"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <CircleHelp className="size-4" />
                  <span className="hidden sm:inline">FAQ</span>
                </Link>
                <Link
                  href="/tools"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Wrench className="size-4" />
                  <span className="hidden sm:inline">도구</span>
                </Link>
                <ThemeToggle />
              </div>
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
