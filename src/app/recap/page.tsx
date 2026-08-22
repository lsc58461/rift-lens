import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { getChampionNamesKo, getDDragonVersion } from "@/lib/ddragon";
import { RecapClient } from "./recap-client";

export const metadata = {
  title: "시즌 결산",
  description:
    "시즌 랭크 판수·승률·최다 챔피언을 한 장의 카드로 — 롤 시즌 결산",
};

export default async function RecapPage() {
  const ddVersion = await getDDragonVersion();
  const champNames = await getChampionNamesKo(ddVersion);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Sparkles}
        title="시즌 결산"
        description="올 시즌 나의 롤 여정을 카드 한 장으로"
      />
      <RecapClient version={ddVersion} names={champNames} />
    </div>
  );
}
