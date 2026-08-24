// 도구 페이지 공용 UI — 툴별 액센트 컬러의 히어로 헤더와,
// 페이지 하단의 "다른 도구" 크로스링크. /tools 허브와 같은 정의(TOOLS)를 쓴다.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TOOLS } from "@/lib/tools";

const HERO_TONES = {
  sky: {
    glow: "from-sky-500/20 via-sky-500/5",
    tile: "bg-sky-500/15 text-sky-500 dark:text-sky-400 ring-sky-500/20",
  },
  rose: {
    glow: "from-rose-500/20 via-rose-500/5",
    tile: "bg-rose-500/15 text-rose-500 dark:text-rose-400 ring-rose-500/20",
  },
  amber: {
    glow: "from-amber-500/20 via-amber-500/5",
    tile: "bg-amber-500/15 text-amber-500 dark:text-amber-400 ring-amber-500/20",
  },
} as const;

export type ToolTone = keyof typeof HERO_TONES;

/** 도구 페이지 상단 히어로 — 액센트 글로우 + 큰 아이콘 타일 + 단계 안내 */
export function ToolHero({
  tone,
  icon: Icon,
  title,
  description,
  steps,
}: {
  tone: ToolTone;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  steps?: string[];
}) {
  const t = HERO_TONES[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card">
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent`}
      />
      <div className="relative flex flex-col gap-4 p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 ${t.tile}`}
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h1>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {steps && steps.length > 0 && (
          <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="flex size-4.5 items-center justify-center rounded-full bg-foreground/8 text-[10px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** 페이지 하단 — 현재 도구를 제외한 나머지 도구로의 크로스링크 */
export function OtherTools({ current }: { current: string }) {
  const others = TOOLS.filter((t) => t.href !== current);
  if (others.length === 0) return null;
  return (
    <div className="border-t pt-5">
      <p className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        다른 도구
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {others.map(({ icon: Icon, label, desc, href, tile }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40"
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tile}`}
            >
              <Icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {desc}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
