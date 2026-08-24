import { Heart } from "lucide-react";
import { OtherTools, ToolHero } from "@/components/tool-kit";
import { DuoClient } from "./duo-client";

export const metadata = {
  title: "듀오 궁합 분석",
  description:
    "두 소환사가 함께한 경기를 모아 같은 팀 승률과 맞대결 전적으로 궁합을 분석해요",
};

export default function DuoPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ToolHero
        tone="rose"
        icon={Heart}
        title="듀오 궁합 분석"
        description="두 소환사가 함께 잡힌 경기를 찾아 같은 팀 승률과 맞대결 전적을 계산해요"
        steps={["두 소환사 입력", "궁합 분석", "결과 공유"]}
      />
      <DuoClient />
      <OtherTools current="/duo" />
    </div>
  );
}
