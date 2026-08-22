import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { getChampionStats } from "@/lib/champion-stats";
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

export default async function ChampionsPage() {
  const [stats, version] = await Promise.all([
    getChampionStats(),
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
        description={`수집된 솔로랭크 ${stats.totalGames.toLocaleString()}경기 표본 기준 · 챔피언을 누르면 스펠·아이템·룬 승률이 열려요`}
      />
      <ChampionsTable
        stats={stats}
        version={version}
        names={names}
        runeMap={runes}
      />
    </div>
  );
}
