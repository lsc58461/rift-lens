import {
  ArrowRight,
  BarChart3,
  Crown,
  Gauge,
  Radar,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { summonerPath } from "@/lib/summoner-url";
import type { Metadata } from "next";
import { OG_BASE } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import { InteractiveBackground } from "@/components/home/interactive-bg";
import { SpotlightCard } from "@/components/home/spotlight-card";
import { SearchForm } from "@/components/search-form";
import { getApexCutoffs, getApexLadder } from "@/lib/apex-ladder";
import { getHomeStats } from "@/lib/home-stats";
import { getRecentSearches } from "@/lib/recent";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { TOOLS } from "@/lib/tools";

// 라이브 지표·최근 검색·랭킹을 보여주므로 요청 시 렌더 (지표는 10분 캐시, 랭킹은 30분 갱신)
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Radar,
    title: "매칭 구간",
    description:
      "최근 솔로랭크 경기에서 실제로 만난 플레이어들의 랭크를 모아, 요즘 어느 구간의 로비에서 게임이 잡히는지 보여줘요.",
    spot: "var(--color-primary)",
    tile: "bg-primary/15 text-primary",
  },
  {
    icon: Gauge,
    title: "전적 · 스코어보드",
    description:
      "KDA·딜량·CS·아이템·룬은 물론 경기 당시 참가자 랭크, MVP·ACE, 멀티킬까지 한 화면에서. 참가자 이름을 누르면 바로 이동해요.",
    spot: "oklch(0.72 0.17 200)",
    tile: "bg-sky-500/15 text-sky-500 dark:text-sky-400",
  },
  {
    icon: TrendingUp,
    title: "랭크 추이 · LP 흐름",
    description:
      "경기별 로비 평균 랭크와 LP 득실을 그래프로 담아 상승세인지 하락세인지, 시즌 최고 티어는 어디였는지 한눈에.",
    spot: "oklch(0.7 0.2 300)",
    tile: "bg-violet-500/15 text-violet-500 dark:text-violet-400",
  },
] as const;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...OG_BASE, url: "/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Rift Lens",
  url: SITE_URL,
  description:
    "리그 오브 레전드 전적 검색 — 최근 솔로랭크 경기와 함께 매칭된 플레이어들의 랭크 분포를 보여주는 사이트",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/summoner/kr/{search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-full border border-white/10 bg-card/50 px-3.5 py-1.5 backdrop-blur-sm dark:border-white/8">
      <span className="text-sm font-bold tabular-nums tracking-tight">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default async function Home() {
  // 전부 장식 데이터 — 실패해도 홈은 떠야 한다
  const [stats, recent, ladder, cutoffs] = await Promise.all([
    getHomeStats().catch(() => null),
    getRecentSearches(8).catch(() => []),
    getApexLadder("CHALLENGER").catch(() => ({ rows: [], fetchedAt: null })),
    getApexCutoffs().catch(() => null),
  ]);
  const top = ladder.rows.filter((r) => r.name).slice(0, 3);

  return (
    <div className="relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      {/* 히어로 텍스트엔 opacity 페이드를 쓰지 않는다 — LCP 후보에서 빠져 700ms 늦어짐(2026-09-03 실측) */}
      <InteractiveBackground />

      {/* ── 히어로 ─────────────────────────────────────────── */}
      <section className="mx-auto flex min-h-[calc(100dvh-9.5rem)] max-w-3xl flex-col items-center justify-center gap-7 py-14 text-center sm:gap-8 sm:py-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-3.5 py-1 text-xs font-medium text-primary backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
          한국 서버 · 솔로랭크 · 광고 X
        </span>

        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl animate-in slide-in-from-bottom-3 duration-700">
          내 게임은 지금
          <br />
          <span className="bg-linear-to-r from-primary via-sky-400 to-amber-400 bg-clip-text text-transparent">
            어느 랭크
          </span>
          에서 잡힐까
        </h1>

        <p className="max-w-xl text-pretty text-muted-foreground sm:text-lg animate-in slide-in-from-bottom-3 duration-700">
          최근 솔로랭크 전적에 같은 경기를 뛴 플레이어들의 랭크까지 얹어 보여드려요.
          닉네임#태그만 넣으면 끝.
        </p>

        <div className="w-full max-w-xl animate-in slide-in-from-bottom-3 duration-700">
          <SpotlightCard className="z-20 p-4 shadow-2xl shadow-primary/10 sm:p-5">
            <SearchForm />
          </SpotlightCard>
          {recent.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">방금 조회</span>
              {recent.slice(0, 6).map((r) => (
                <Link
                  key={`${r.gameName}#${r.tagLine}`}
                  href={summonerPath("kr", `${r.gameName}#${r.tagLine}`)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-card/50 px-2.5 py-1 text-xs backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-white/8"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{
                      background: r.estimatedTier
                        ? TIER_COLORS[r.estimatedTier]
                        : "var(--color-muted-foreground)",
                    }}
                  />
                  <span className="max-w-28 truncate">{r.gameName}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {(stats || cutoffs) && (
          <div className="flex flex-wrap items-center justify-center gap-2 animate-in fade-in duration-700 delay-300 fill-mode-backwards">
            {stats && (
              <>
                <Stat value={stats.totalMatches.toLocaleString()} label="수집 경기" />
                <Stat value={stats.totalSummoners.toLocaleString()} label="소환사" />
                <Stat value={stats.visits24h.toLocaleString()} label="24시간 조회" />
              </>
            )}
            {cutoffs && (
              <Stat value={`${cutoffs.challenger.toLocaleString()} LP`} label="챌린저 컷" />
            )}
          </div>
        )}
      </section>

      {/* ── 기능 ───────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, description, spot, tile }) => (
          <SpotlightCard key={title} spot={spot} className="p-6">
            <span className={`mb-4 flex size-10 items-center justify-center rounded-xl ${tile}`}>
              <Icon className="size-5" />
            </span>
            <h2 className="mb-1.5 text-base font-semibold">{title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </SpotlightCard>
        ))}
      </section>

      {/* ── 랭킹 · 챔피언 통계 ─────────────────────────────── */}
      <section className="mx-auto mt-4 grid max-w-6xl gap-4 lg:grid-cols-2">
        <SpotlightCard href="/ranking" spot="oklch(0.8 0.16 85)" className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2 text-base font-semibold">
              <Trophy className="size-4.5 text-amber-400" />
              챌린저 TOP 3
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover/spot:text-foreground">
              전체 랭킹
              <ArrowRight className="size-3.5 transition-transform group-hover/spot:translate-x-0.5" />
            </span>
          </div>
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">래더를 불러오는 중이에요.</p>
          ) : (
            <ol className="space-y-2">
              {top.map((r) => (
                <li key={r.puuid} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-right font-bold tabular-nums text-amber-400">{r.rankNo}</span>
                  <Crown className={`size-3.5 ${r.rankNo === 1 ? "text-amber-400" : "text-muted-foreground/50"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.name!.split("#")[0]}
                    <span className="font-normal text-muted-foreground">#{r.name!.split("#")[1]}</span>
                  </span>
                  <span className="font-semibold tabular-nums" style={{ color: TIER_COLORS.CHALLENGER }}>
                    {r.lp.toLocaleString()} LP
                  </span>
                </li>
              ))}
            </ol>
          )}
          {cutoffs && (
            <p className="mt-4 text-xs text-muted-foreground">
              챌린저 컷 {cutoffs.challenger.toLocaleString()}LP · 그랜드마스터 컷{" "}
              {cutoffs.grandmaster.toLocaleString()}LP · 30분마다 갱신
            </p>
          )}
        </SpotlightCard>

        <SpotlightCard href="/champions" spot="oklch(0.8 0.16 85)" className="flex flex-col justify-between p-6">
          <div>
            <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 dark:text-amber-400">
              <BarChart3 className="size-5" />
            </span>
            <h2 className="mb-1.5 text-base font-semibold">챔피언 통계</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              라인별 1~5티어와 승률·픽률·밴률, 스펠·아이템·룬 조합까지. 랭크 구간별로 걸러서 지금 강한
              챔피언을 확인하세요.
            </p>
          </div>
          <span className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-amber-500 dark:text-amber-400">
            통계 보기
            <ArrowRight className="size-3.5 transition-transform group-hover/spot:translate-x-0.5" />
          </span>
        </SpotlightCard>
      </section>

      {/* ── 도구 ───────────────────────────────────────────── */}
      <section className="mx-auto mt-14 mb-10 max-w-6xl space-y-4">
        <div className="flex items-end justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4 text-primary" />
            함께 쓰는 도구
          </h2>
          <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            모두 보기
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map(({ icon: Icon, label, desc, href, tile }) => (
            <SpotlightCard key={href} href={href} className="p-6">
              <span className={`mb-4 flex size-10 items-center justify-center rounded-xl ${tile}`}>
                <Icon className="size-5" />
              </span>
              <h3 className="mb-1.5 text-base font-semibold">{label}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                사용해 보기
                <ArrowRight className="size-3.5 transition-transform group-hover/spot:translate-x-0.5" />
              </span>
            </SpotlightCard>
          ))}
        </div>
      </section>

    </div>
  );
}
