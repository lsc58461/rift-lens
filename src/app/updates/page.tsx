import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "업데이트 내역",
  description: "Rift Lens의 기능 추가와 개선 사항 기록",
};

type Tag = "신규" | "개선" | "수정";

const TAG_VARIANT: Record<Tag, "default" | "secondary" | "outline"> = {
  신규: "default",
  개선: "secondary",
  수정: "outline",
};

const CHANGELOG: {
  date: string;
  title: string;
  items: { tag: Tag; text: string }[];
}[] = [
  {
    date: "2026-08-19",
    title: "분석 속도와 화면 정리",
    items: [
      {
        tag: "개선",
        text: "정밀 분석이 더 빨라졌어요 — 표본 구성을 조정하고 참가자 랭크 재사용 기간을 늘렸습니다",
      },
      {
        tag: "개선",
        text: "실력대 추이 그래프 — 승/패를 점 채움으로 구분하고, 매칭 실력대 선에도 점과 범례를 추가했어요",
      },
      {
        tag: "개선",
        text: "소환사 페이지 — 최근 전적과 분석에 사용된 경기를 탭으로 묶어 스크롤을 줄였어요",
      },
      {
        tag: "개선",
        text: "내전 밸런서·듀오 궁합·시즌 결산·인증 페이지 디자인 정리 (팀 전력차 막대, 듀오 승률 게이지, 챔피언 막대 등)",
      },
      {
        tag: "수정",
        text: "그래프 세로축에서 마스터 이상 티어 표기가 줄바꿈되던 문제",
      },
      {
        tag: "수정",
        text: "전각 태그(ＫR1 등) 계정이 두 번 분석돼 정밀 분석이 매번 처음부터 다시 돌던 문제",
      },
    ],
  },
  {
    date: "2026-08-19",
    title: "닉네임 재사용 대응",
    items: [
      {
        tag: "수정",
        text: "누군가 남이 버린 옛 닉네임을 새로 쓰기 시작하면, 그 이름은 더 이상 이전 주인에게 연결되지 않아요",
      },
      {
        tag: "개선",
        text: "닉네임을 바꾸면 옛 이름으로 남아 있던 분석·검색 기록을 정리해요",
      },
    ],
  },
  {
    date: "2026-08-02",
    title: "닉네임 변경 대응",
    items: [
      {
        tag: "신규",
        text: "닉네임을 바꿔도 기존 분석·인증 기록이 그대로 이어져요",
      },
      {
        tag: "신규",
        text: "옛 닉네임으로 검색하면 새 이름 페이지로 자동 이동 — 예전에 공유한 링크도 안 깨져요",
      },
    ],
  },
  {
    date: "2026-07-31",
    title: "분석 속도 개선",
    items: [
      {
        tag: "개선",
        text: "참가자 랭크 재사용을 늘려 정밀 분석 대기 시간 단축",
      },
    ],
  },
  {
    date: "2026-07-26",
    title: "전적검색과 도메인 이전",
    items: [
      {
        tag: "신규",
        text: "최근 전적 — 챔피언·KDA·CS·딜량·아이템·스펠과 팀 구성까지 한눈에",
      },
      {
        tag: "개선",
        text: "사이트 이름이 Rift Lens로, 주소가 rift-lens.xyz로 바뀌었어요",
      },
    ],
  },
  {
    date: "2026-07-24",
    title: "디스코드 봇",
    items: [
      {
        tag: "신규",
        text: "디스코드 봇 — /mmr 로 서버에서 바로 조회, /mmr-team·/mmr-duo·/mmr-recent 지원",
      },
      {
        tag: "신규",
        text: "/mmr-verify 로 계정 인증 — 디스코드에서 명령어 한 줄이면 알림 대상 등록",
      },
      {
        tag: "개선",
        text: "알림 발송이 Rift Lens 봇으로 통일됐어요",
      },
    ],
  },
  {
    date: "2026-07-22",
    title: "새 도구 3종과 디스코드 알림",
    items: [
      {
        tag: "신규",
        text: "내전 팀 밸런서 — 매칭 실력대로 가장 공평한 팀 자동 구성",
      },
      { tag: "신규", text: "듀오 궁합 분석 — 함께한 경기 승률·맞대결 기록" },
      { tag: "신규", text: "시즌 결산 — 판수·승률·최다 챔피언 카드" },
      {
        tag: "신규",
        text: "소환사 인증 — 인증하면 승급/강등, 5·10연승, 시즌 최고 티어 달성 시 디스코드 알림을 받아요",
      },
      { tag: "신규", text: "소환사 입력 자동완성 (기록 기반)" },
    ],
  },
  {
    date: "2026-07-22",
    title: "LP 흐름 추적과 내부 구조 개선",
    items: [
      {
        tag: "신규",
        text: "LP 흐름 카드 — 승리당/패배당 평균 LP로 내부 실력 지표를 교차 확인 (데이터가 쌓이면 표시)",
      },
      { tag: "신규", text: "업데이트 내역·점검 안내 페이지" },
      {
        tag: "개선",
        text: "데이터 구조 전면 개편 — 분석 기록 영구 보관, 랭크 히스토리 축적 시작",
      },
      {
        tag: "수정",
        text: "전각 문자 태그(ＫR1 등)가 다른 소환사로 취급되던 문제",
      },
    ],
  },
  {
    date: "2026-07-21",
    title: "편의 기능과 안정성 업데이트",
    items: [
      { tag: "신규", text: "자주 묻는 질문(FAQ) 페이지" },
      { tag: "신규", text: "업데이트 내역 페이지" },
      { tag: "신규", text: "재분석 버튼 — 방금 끝난 게임을 즉시 반영" },
      { tag: "신규", text: "정밀 분석 대기열 — 순번과 남은 분석 수 표시" },
      {
        tag: "신규",
        text: "새벽 자동 갱신(3~7시) — 아침에는 항상 최신 결과로 시작",
      },
      {
        tag: "개선",
        text: "이전 분석 즉시 표시 — 재분석을 기다리는 동안에도 결과를 바로 확인",
      },
      {
        tag: "개선",
        text: "결과 보관 기간 30일로 연장 — 오래 안 봐도 기록이 사라지지 않음",
      },
      {
        tag: "수정",
        text: "한국 서버 마스터 이상 구간의 듀오 오탐 수정 (듀오 금지 구간 감지 제외)",
      },
      {
        tag: "수정",
        text: "카카오톡 인앱 브라우저에서 이미지 공유가 안 되던 문제",
      },
    ],
  },
  {
    date: "2026-07-20",
    title: "정확도 개선과 새 기능",
    items: [
      { tag: "신규", text: "듀오 추정 경기 자동 감지·분석 제외 (부족분은 과거 경기로 보충)" },
      { tag: "신규", text: "결과 이미지 공유 — 카톡·디스코드 링크 미리보기 지원" },
      { tag: "신규", text: "최근 검색 페이지" },
      { tag: "신규", text: "챔피언 아이콘·티어 엠블럼·한글 챔피언명" },
      {
        tag: "개선",
        text: "추정 알고리즘 고도화 — 리메이크 제외, 이상치 완화, 승패 반영(Elo), 오차범위 표시",
      },
      { tag: "개선", text: "전체 디자인 개편 (블루·골드 테마, 다크모드)" },
    ],
  },
  {
    date: "2026-07-19",
    title: "Rift Lens 오픈",
    items: [
      {
        tag: "신규",
        text: "숨은 실력대 추정 — 최근 경기 로비의 랭크를 역추적해 계산",
      },
      { tag: "신규", text: "정밀 분석 — 20경기 × 전원 표본, 완료 시 자동 갱신" },
      { tag: "신규", text: "경기별 실력대 추이 그래프" },
    ],
  },
];

export default function UpdatesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Megaphone className="size-4.5" />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            업데이트 내역
          </h1>
          <p className="text-sm text-muted-foreground">
            Rift Lens가 이렇게 좋아지고 있어요
          </p>
        </div>
      </div>

      <div className="relative space-y-8 border-l pl-6">
        {CHANGELOG.map((entry) => (
          // 같은 날짜에 항목이 둘 이상일 수 있어 날짜만으로는 키가 겹친다
          <section key={`${entry.date}-${entry.title}`} className="relative">
            <span className="absolute left-[-1.85rem] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" />
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-semibold">{entry.title}</h2>
              <time className="text-xs text-muted-foreground">
                {entry.date}
              </time>
            </div>
            <ul className="space-y-1.5">
              {entry.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge
                    variant={TAG_VARIANT[item.tag]}
                    className="mt-px shrink-0 text-[10px]"
                  >
                    {item.tag}
                  </Badge>
                  <span className="text-muted-foreground">{item.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
