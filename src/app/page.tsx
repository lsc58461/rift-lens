import {
  Bot,
  Activity,
  ArrowRight,
  BarChart3,
  Gauge,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { getHomeStats } from "@/lib/home-stats";
import { getRecentSearches } from "@/lib/recent";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { TOOLS } from "@/lib/tools";

// 라이브 지표·최근 검색을 보여주므로 요청 시 렌더 (지표는 10분 캐시)
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Gauge,
    title: "전적 · 매치 히스토리",
    description:
      "최근 솔로랭크 경기의 KDA·딜량·CS·아이템·팀 구성을 한 화면에서 확인하고, 참가자 이름을 눌러 바로 이동할 수 있어요.",
    tile: "bg-primary/12 text-primary",
    hover: "hover:border-primary/40",
  },
  {
    icon: Users,
    title: "매칭 랭크 분석",
    description:
      "최근 경기에서 만난 플레이어들의 현재 랭크 분포를 모아, 요즘 어떤 랭크 구간에서 게임이 잡히는지 보여줘요.",
    tile: "bg-sky-500/12 text-sky-500 dark:text-sky-400",
    hover: "hover:border-sky-500/40",
  },
  {
    icon: Activity,
    title: "랭크 추이 그래프",
    description:
      "경기별 로비 평균 랭크와 LP 흐름을 그래프로 담아 상승세인지 하락세인지 한눈에 확인할 수 있어요.",
    tile: "bg-violet-500/12 text-violet-500 dark:text-violet-400",
    hover: "hover:border-violet-500/40",
  },
] as const;

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Rift Lens",
  url: "https://rift-lens.xyz",
  description:
    "리그 오브 레전드 전적 검색 — 최근 솔로랭크 경기와 함께 매칭된 플레이어들의 랭크 분포를 보여주는 사이트",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://rift-lens.xyz/summoner/kr/{search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
        {label}
      </div>
    </div>
  );
}

export default async function Home() {
  // 지표·최근 검색은 장식 — 실패해도 홈은 떠야 한다
  const [stats, recent] = await Promise.all([
    getHomeStats().catch(() => null),
    getRecentSearches(10).catch(() => []),
  ]);

  return (
    <div className="relative flex flex-col items-center gap-12 py-10 sm:gap-14 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {/* 배경 글로우 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden"
      >
        <div className="mx-auto h-72 max-w-3xl bg-primary/12 blur-[110px] sm:h-96" />
      </div>

      {/* 히어로 */}
      <div className="max-w-2xl space-y-5 text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
        <Badge
          variant="outline"
          className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-primary"
        >
          <Sparkles className="size-3.5" />
          한국 서버 전용 · 라이엇 공식 API
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl sm:whitespace-nowrap lg:text-5xl">
          내 경기, 어느{" "}
          <span className="bg-linear-to-r from-primary via-primary to-chart-2 bg-clip-text text-transparent">
            랭크
          </span>
          에서 잡힐까?
        </h1>
        <p className="text-muted-foreground text-pretty sm:text-lg">
          최근 솔로랭크 전적과 함께, 같은 경기에 잡힌 플레이어들의 현재 랭크
          분포까지 — 전적을 한층 깊게 보여드립니다.
        </p>
      </div>

      {/* 검색 */}
      <div className="w-full max-w-xl space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-150 fill-mode-backwards">
        <div className="rounded-2xl border bg-card/80 p-5 shadow-lg shadow-primary/5 ring-1 ring-primary/10 backdrop-blur-sm sm:p-6">
          <SearchForm />
        </div>

        {/* 최근 검색 티저 — 지금 막 조회된 소환사 */}
        {recent.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">최근 검색</span>
            {recent.slice(0, 6).map((r) => (
              <Link
                key={`${r.gameName}#${r.tagLine}`}
                href={`/summoner/kr/${encodeURIComponent(`${r.gameName}#${r.tagLine}`)}`}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-primary"
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

      {/* 라이브 지표 */}
      {stats && (
        <div className="grid w-full max-w-xl grid-cols-3 gap-3 rounded-2xl border bg-card/60 px-4 py-4 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-300 fill-mode-backwards">
          <StatBlock
            value={stats.totalMatches.toLocaleString()}
            label="수집된 경기"
          />
          <StatBlock
            value={stats.totalSummoners.toLocaleString()}
            label="기록된 소환사"
          />
          <StatBlock
            value={stats.visits24h.toLocaleString()}
            label="24시간 조회"
          />
        </div>
      )}

      {/* 기능 */}
      <div className="grid w-full gap-4 sm:grid-cols-3 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-300 fill-mode-backwards">
        {FEATURES.map(({ icon: Icon, title, description, tile, hover }) => (
          <div
            key={title}
            className={`group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md ${hover}`}
          >
            <span
              className={`mb-3 flex size-9 items-center justify-center rounded-lg ${tile}`}
            >
              <Icon className="size-4.5" />
            </span>
            <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </div>

      {/* 챔피언 통계 배너 */}
      <Link
        href="/champions"
        className="group flex w-full items-center gap-4 rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-md animate-in fade-in slide-in-from-bottom-3 duration-700 delay-500 fill-mode-backwards"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-500 dark:text-amber-400">
          <BarChart3 className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">챔피언 통계</span>
          <span className="block text-sm text-muted-foreground">
            라인별 1~5티어와 승률·픽률·밴률 — 지금 강한 챔피언을 확인하세요
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* 디스코드 봇 배너 */}
      <Link
        href="/discord"
        className="group flex w-full items-center gap-4 rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-[#5865F2]/40 hover:shadow-md animate-in fade-in slide-in-from-bottom-3 duration-700 delay-500 fill-mode-backwards"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#5865F2]/12 text-[#5865F2]">
          <Bot className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">디스코드 봇 초대하기</span>
          <span className="block text-sm text-muted-foreground">
            새 패치노트와 서비스 상태를 여러분의 서버 채널로 알려드려요
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* 도구 */}
      <div className="w-full space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-500 fill-mode-backwards">
        <h2 className="text-center text-sm font-semibold text-muted-foreground">
          함께 쓰는 도구
        </h2>
        <div className="grid w-full gap-4 sm:grid-cols-3">
          {TOOLS.map(({ icon: Icon, label, desc, href, tile, accent }) => (
            <Link
              key={href}
              href={href}
              className={`group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md ${accent}`}
            >
              <span
                className={`mb-3 flex size-9 items-center justify-center rounded-lg ${tile}`}
              >
                <Icon className="size-4.5" />
              </span>
              <h3 className="mb-1.5 text-sm font-semibold">{label}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {desc}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                사용해 보기
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
