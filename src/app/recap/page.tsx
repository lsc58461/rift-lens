import { Sparkles } from "lucide-react";
import { pageMeta } from "@/lib/seo";
import { OtherTools, ToolHero } from "@/components/tool-kit";
import { getChampionNamesKo, getDDragonVersion } from "@/lib/ddragon";
import { RecapClient } from "./recap-client";

export const metadata = pageMeta({
  title: "시즌 결산",
  description: "시즌 랭크 판수·승률·최다 챔피언을 한 장의 카드로 — 롤 시즌 결산",
  path: "/recap",
});

export default async function RecapPage() {
  const ddVersion = await getDDragonVersion();
  const champNames = await getChampionNamesKo(ddVersion);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ToolHero
        tone="amber"
        icon={Sparkles}
        title="시즌 결산"
        description="시즌 랭크 판수·승률·KDA·최다 챔피언을 모아 한 장의 카드로 정리해요"
        steps={["소환사 입력", "결산 보기", "카드 이미지로 공유"]}
      />
      <RecapClient version={ddVersion} names={champNames} />
      <OtherTools current="/recap" />
    </div>
  );
}
