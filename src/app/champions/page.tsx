import { BarChart3 } from "lucide-react";
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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata = {
  title: "챔피언 통계",
  description:
    "수집된 솔로랭크 경기 기준 챔피언별 승률과 스펠·아이템·룬 통계",
};

export default async function ChampionsPage({
  searchParams,
}: {
  searchParams: Promise<{ patch?: string; rank?: string }>;
}) {
  const { patch: rawPatch, rank: rawRank } = await searchParams;
  // 랭크 브라켓 — 기본은 에메랄드 이상
  const bracket = RANK_BRACKETS.some((b) => b.key === rawRank)
    ? (rawRank as (typeof RANK_BRACKETS)[number]["key"])
    : "emerald";
  // 최근 패치 몇 개를 선택지로 제공하고, 기본은 최신 패치.
  // 옛 패치 데이터는 삭제하지 않고 선택하면 볼 수 있다.
  const patches = (await listPatches()).slice(0, 6);
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
      <PageHeader
        icon={BarChart3}
        title="챔피언 통계"
        description={`${patch ? `패치 ${patchLabel(patch)}` : "전체"} · 수집된 솔로랭크 ${stats.totalGames.toLocaleString()}경기 표본 기준 · 챔피언을 누르면 상세 통계가 열려요`}
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
