import Link from "next/link";
import { pageMeta } from "@/lib/seo";
import { ArrowRight, ChevronRight, History } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getRecentSearches } from "@/lib/recent";
import { Pager, parsePage } from "@/components/pager";

const PAGE_SIZE = 50;
const MAX_LIST = 500;
import { TIER_COLORS } from "@/lib/mmr/rank";
import { PLATFORM_LABELS } from "@/lib/riot/types";

// 30초 ISR — 캐시된 페이지를 즉시 서빙하고 백그라운드에서 재생성
export const revalidate = 30;

type RecentParams = Promise<{ page?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: RecentParams }) {
  const { page: rawPage } = await searchParams;
  const page = Math.max(1, parseInt(rawPage ?? "1", 10) || 1);
  return pageMeta({
    title: `최근 검색${page > 1 ? ` ${page}페이지` : ""}`,
    description: "Rift Lens에서 최근 조회된 소환사들의 티어와 매칭 구간 목록",
    path: page > 1 ? `/recent?page=${page}` : "/recent",
  });
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default async function RecentPage({
  searchParams,
}: {
  searchParams: RecentParams;
}) {
  const { page: rawPage } = await searchParams;
  const all = await getRecentSearches(MAX_LIST);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = parsePage(rawPage, totalPages);
  const entries = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={History}
        title="최근 검색"
        description={`최근 조회된 소환사 ${all.length.toLocaleString()}명${totalPages > 1 ? ` · ${page}/${totalPages} 페이지` : ""}`}
      />

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            아직 검색 기록이 없어요. 홈에서 소환사를 검색해 보세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <Link
              key={`${e.region}:${e.gameName}#${e.tagLine}`}
              href={`/summoner/${e.region}/${encodeURIComponent(`${e.gameName}#${e.tagLine}`)}`}
              className="group flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-3 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {e.gameName}
                    <span className="font-normal text-muted-foreground">
                      #{e.tagLine}
                    </span>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {PLATFORM_LABELS[e.region]}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {timeAgo(e.searchedAt)}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="font-medium"
                    style={
                      e.currentTier
                        ? { color: TIER_COLORS[e.currentTier] }
                        : undefined
                    }
                  >
                    {e.currentLabel ?? "언랭크"}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <span
                    className="font-semibold"
                    style={
                      e.estimatedTier
                        ? { color: TIER_COLORS[e.estimatedTier] }
                        : undefined
                    }
                  >
                    {e.estimatedLabel ?? "표본 부족"}
                  </span>
                </div>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:ml-0" />
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/recent" />
    </div>
  );
}
