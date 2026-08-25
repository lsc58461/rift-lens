// 도구 목록 — /tools 허브와 GNB가 같은 정의를 공유한다.
import { Heart, Sparkles, Swords, type LucideIcon } from "lucide-react";

export interface ToolDef {
  icon: LucideIcon;
  label: string;
  desc: string;
  detail: string; // 허브 카드에서 보여줄 조금 더 자세한 설명
  href: string;
  tile: string; // 아이콘 타일 색
  accent: string; // 카드 호버 강조 색
}

export const TOOLS: ToolDef[] = [
  {
    icon: Swords,
    label: "내전 팀 밸런서",
    desc: "10명을 매칭 구간 기준으로 균형 있게 나눠요",
    detail:
      "참가자 닉네임만 넣으면 각자의 매칭 구간(로비 평균 랭크)으로 전력 차가 가장 적은 5:5를 찾아드려요.",
    href: "/team",
    tile: "bg-sky-500/15 text-sky-500 dark:text-sky-400",
    accent: "hover:border-sky-500/40",
  },
  {
    icon: Heart,
    label: "듀오 궁합 분석",
    desc: "함께한 경기의 승률과 시너지를 봐요",
    detail:
      "두 소환사가 같이 한 경기를 모아 승률·KDA·라인 조합까지 궁합을 분석해요.",
    href: "/duo",
    tile: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
    accent: "hover:border-rose-500/40",
  },
  {
    icon: Sparkles,
    label: "시즌 결산",
    desc: "이번 시즌 여정을 한 장으로 정리해요",
    detail:
      "시즌 전적·주 챔피언·최고의 순간을 카드 한 장으로 정리해 공유할 수 있어요.",
    href: "/recap",
    tile: "bg-amber-500/15 text-amber-500 dark:text-amber-400",
    accent: "hover:border-amber-500/40",
  },
];
