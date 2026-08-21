import {
  Activity,
  ArrowRight,
  Gauge,
  Heart,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import Link from "next/link";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    icon: Gauge,
    title: "전적 · 매치 히스토리",
    description:
      "최근 솔로랭크 경기의 KDA·딜량·CS·아이템·팀 구성을 한 화면에서 확인하고, 참가자 이름을 눌러 바로 이동할 수 있습니다.",
  },
  {
    icon: Users,
    title: "매칭 로비 분석",
    description:
      "최근 경기에서 만난 플레이어들의 현재 랭크 분포를 모아, 요즘 어떤 구간의 로비에서 게임이 잡히는지 보여줍니다.",
  },
  {
    icon: Activity,
    title: "랭크 추이 그래프",
    description:
      "경기별 로비 평균 랭크와 LP 흐름을 그래프로 담아 상승세인지 하락세인지 한눈에 확인할 수 있습니다.",
  },
] as const;

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Rift Lens",
  url: "https://rift-lens.xyz",
  description:
    "리그 오브 레전드 전적 검색 — 최근 솔로랭크 경기와 매칭 로비의 랭크 분포를 보여주는 사이트",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate:
        "https://rift-lens.xyz/summoner/kr/{search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

const TOOLS = [
  {
    icon: Swords,
    title: "내전 팀 밸런서",
    description: "최근 랭크 데이터로 가장 공평한 5:5 팀을 자동으로 나눠드려요.",
    href: "/team",
  },
  {
    icon: Heart,
    title: "듀오 궁합 분석",
    description: "둘이 같이 하면 이기는 조합인지 최근 경기로 확인해요.",
    href: "/duo",
  },
  {
    icon: Sparkles,
    title: "시즌 결산",
    description: "시즌 판수·승률·최다 챔피언을 카드 한 장으로.",
    href: "/recap",
  },
] as const;

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-14 py-10 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <div className="max-w-2xl space-y-5 text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
        <Badge
          variant="outline"
          className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-primary"
        >
          <Sparkles className="size-3.5" />
          라이엇 공식 API 데이터 기반
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          요즘 나는 어떤{" "}
          <span className="bg-linear-to-r from-primary via-primary to-chart-2 bg-clip-text text-transparent">
            로비
          </span>
          에서
          <br className="sm:hidden" /> 싸우고 있을까?
        </h1>
        <p className="text-muted-foreground text-pretty sm:text-lg">
          최근 솔로랭크 전적과 함께, 같은 경기에 잡힌 플레이어들의 현재 랭크
          분포까지 — 전적을 한층 깊게 보여드립니다.
        </p>
      </div>

      <div className="w-full max-w-xl rounded-2xl border bg-card/80 p-5 shadow-lg shadow-primary/5 ring-1 ring-primary/10 backdrop-blur-sm sm:p-6 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-150 fill-mode-backwards">
        <SearchForm />
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-3 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-300 fill-mode-backwards">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5"
          >
            <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="size-4.5" />
            </span>
            <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </div>

      {/* 도구 */}
      <div className="w-full space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-500 fill-mode-backwards">
        <h2 className="text-center text-sm font-semibold text-muted-foreground">
          함께 쓰는 도구
        </h2>
        <div className="grid w-full gap-4 sm:grid-cols-3">
          {TOOLS.map(({ icon: Icon, title, description, href }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-chart-2/50 hover:shadow-md hover:shadow-chart-2/5"
            >
              <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-chart-2 group-hover:text-white">
                <Icon className="size-4.5" />
              </span>
              <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
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
