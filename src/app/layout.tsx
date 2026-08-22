import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BarChart3, CircleHelp, History } from "lucide-react";
import Link from "next/link";
import "./globals.css";
import { LogoMark } from "@/components/logo-mark";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToolsMenu } from "@/components/tools-menu";
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
    "롤 매칭 실력대",
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
                  href="/faq"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <CircleHelp className="size-4" />
                  <span className="hidden sm:inline">FAQ</span>
                </Link>
                <ToolsMenu />
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
            {children}
          </main>
          <footer className="border-t py-4 text-center text-xs text-muted-foreground">
            <div className="mb-1.5 flex items-center justify-center gap-3">
              <Link href="/updates" className="hover:text-foreground hover:underline">
                업데이트 내역
              </Link>
              <span aria-hidden>·</span>
              <Link href="/faq" className="hover:text-foreground hover:underline">
                자주 묻는 질문
              </Link>
            </div>
            Rift Lens는 Riot Games의 공식 서비스가 아니며, 추정치는 참고용입니다.
          </footer>
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
