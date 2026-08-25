import { Swords } from "lucide-react";
import { OtherTools, ToolHero } from "@/components/tool-kit";
import { TeamClient } from "./team-client";

export const metadata = {
  title: "내전 팀 밸런서",
  description:
    "참가자들의 매칭 구간으로 가장 공평한 5:5 팀을 자동으로 나눠주는 내전 도우미",
};

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ToolHero
        tone="sky"
        icon={Swords}
        title="내전 팀 밸런서"
        description="참가자들의 매칭 구간(로비 평균 랭크)으로 전력 차가 가장 적은 팀 구성을 찾아드려요"
        steps={[
          "참가자 닉네임 입력 (짝수 인원)",
          "팀 나누기",
          "마음에 안 들면 다른 조합",
        ]}
      />
      <TeamClient />
      <OtherTools current="/team" />
    </div>
  );
}
