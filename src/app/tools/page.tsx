import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { TOOLS } from "@/lib/tools";

export const metadata = {
  title: "도구",
  description:
    "내전 팀 밸런서, 듀오 궁합 분석, 시즌 결산 — Rift Lens의 소환사 도구 모음",
};

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Wrench}
        title="도구"
        description="전적 검색 말고도 쓸 수 있는 것들을 모아뒀어요"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map(({ icon: Icon, label, detail, href, tile, accent }) => (
          <Link
            key={href}
            href={href}
            className={`group flex flex-col gap-3 rounded-2xl border p-5 transition-colors hover:bg-accent/40 ${accent}`}
          >
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tile}`}
            >
              <Icon className="size-5.5" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-1.5 font-semibold">
                {label}
                <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                {detail}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
