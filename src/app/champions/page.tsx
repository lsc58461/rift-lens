import { BarChart3 } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, pageMeta } from "@/lib/seo";
import { PageHeader } from "@/components/page-kit";
import { getChampionStats, listPatches } from "@/lib/champion-stats";
import { RANK_BRACKETS } from "@/lib/rank-pts";
import { patchLabel } from "@/lib/patch-notes";
import {
  getChampionNamesKo,
  getDDragonVersion,
  getRuneMapKo,
} from "@/lib/ddragon";
import { ChampionsTable } from "./champions-table";

/** 집계 시각 표시 — "방금", "N분 전", "N시간 전" */
function computedAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ChampionsParams = Promise<{ patch?: string; rank?: string }>;

// canonical 은 패치를 뺀다 — 옛 패치 보기는 같은 표의 과거 스냅샷이라 별 페이지로 색인할 가치가 없다
export async function generateMetadata({ searchParams }: { searchParams: ChampionsParams }) {
  const { rank } = await searchParams;
  const bracket = RANK_BRACKETS.find((b) => b.key === rank && b.key !== "emerald");
  return pageMeta({
    title: bracket ? `챔피언 통계 (${bracket.label})` : "챔피언 통계",
    description: `수집된 솔로랭크 경기 기준 ${bracket ? bracket.label : "에메랄드 이상"} 챔피언별 승률과 스펠·아이템·룬 통계`,
    path: bracket ? `/champions?rank=${bracket.key}` : "/champions",
  });
}

export default async function ChampionsPage({
  searchParams,
}: {
  searchParams: ChampionsParams;
}) {
  const { patch: rawPatch, rank: rawRank } = await searchParams;
  // 랭크 브라켓 — 기본은 에메랄드 이상
  const bracket = RANK_BRACKETS.some((b) => b.key === rawRank)
    ? (rawRank as (typeof RANK_BRACKETS)[number]["key"])
    : "emerald";
  // 최근 패치 몇 개를 선택지로 제공하고, 기본은 최신 패치.
  // 옛 패치 데이터는 삭제하지 않고 선택하면 볼 수 있다.
  // 패치 선택은 현재 패치 포함 최근 2개만 노출 (UI 필터만 — 집계 데이터는 그대로)
  const patches = (await listPatches()).slice(0, 2);
  // 목록에 있는 패치만 허용(캐시 키 오염 방지) — 없으면 최신 패치 기본 선택
  const patch =
    rawPatch && patches.some((p) => p.patch === rawPatch)
      ? rawPatch
      : (patches[0]?.patch ?? null);
  const [stats, version] = await Promise.all([
    getChampionStats(patch, bracket),
    getDDragonVersion(),
  ]);
  const [names, runes] = await Promise.all([
    getChampionNamesKo(version),
    getRuneMapKo(version),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <JsonLd data={breadcrumbLd([{ name: "홈", path: "/" }, { name: "챔피언 통계", path: "/champions" }])} />
      <PageHeader
        icon={BarChart3}
        title="챔피언 통계"
        description={`${patch ? `패치 ${patchLabel(patch)}` : "전체"} · 수집된 솔로랭크 ${stats.totalGames.toLocaleString()}경기 표본 기준${stats.computedAt ? ` · ${computedAgo(stats.computedAt)} 집계` : ""} · 챔피언을 누르면 상세 통계가 열려요`}
      />
      <ChampionsTable
        stats={stats}
        version={version}
        names={names}
        runeMap={runes}
        patches={patches}
        currentPatch={patch}
        currentBracket={bracket}
      />
    </div>
  );
}
