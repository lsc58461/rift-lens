"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useEffect, useState } from "react";
import { pointsToRank, pointsToShortLabel } from "@/lib/mmr/rank";

export interface MmrChartPoint {
  game: string; // "8경기 전" ... "최근"
  lobby: number | null;
  est: number | null; // 그 경기까지 반영한 추정 레이팅
  win: boolean;
}

const chartConfig = {
  lobby: { label: "로비 평균 랭크", color: "var(--chart-1)" },
  est: { label: "매칭 실력대", color: "var(--chart-2)" },
} satisfies ChartConfig;

// 색은 전역 토큰으로 직접 참조한다. ChartContainer가 만드는 --color-lobby /
// --color-est는 컨테이너 안에서만 정의되는 스코프 변수라, 밖에 있는 범례에서
// 쓰면 값이 비어 스와치가 통째로 안 보인다.
const LOBBY_COLOR = "var(--chart-1)";
const EST_COLOR = "var(--chart-2)";

// 점 색은 계열 색 하나로 고정한다.
// 예전엔 로비 점의 색으로 승패를 표현했는데, 패배 점(붉은 계열)이 매칭 실력대
// 선(주황)과 섞여 "파란 선에 주황 점이 찍혀 있다"로 읽혔다. 점 색에 계열과 승패
// 두 가지 의미를 겹쳐 실은 게 원인이라, 승패는 채움/비움으로 분리한다.

export function MmrChart({
  data,
  currentPoints,
}: {
  data: MmrChartPoint[];
  currentPoints: number | null;
}) {
  // 좁은 화면에서는 Y축 라벨을 "플3" 축약형으로 줄여 차트 영역을 넓힌다
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const values = data
    .flatMap((d) => [d.lobby, d.est])
    .filter((v): v is number => v !== null)
    .concat(currentPoints !== null ? [currentPoints] : []);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(50, (max - min) * 0.2);

  return (
    <div className="space-y-3">
    <ChartContainer config={chartConfig} className="h-64 w-full">
      {/* right 여백: 마지막 점(r=4)이 잘리지 않도록 */}
      <ComposedChart data={data} margin={{ left: 8, right: 14, top: 8 }}>
        <defs>
          <linearGradient id="fillLobby" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-lobby)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-lobby)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="game"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          // 20경기까지 늘어나면 라벨이 서로 겹친다 — 양 끝은 유지하고 사이는 솎아낸다
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
          // 마스터 이상은 라벨이 "마스터 65LP"(구분자 없음)라 split만으로는
          // LP가 남아 축에서 줄바꿈된다 — 뒤의 LP 표기를 함께 떼어낸다
          tickFormatter={(v: number) =>
            compact
              ? pointsToShortLabel(v)
              : pointsToRank(v)
                  .label.split(" · ")[0]
                  .replace(/\s\d+LP$/, "")
          }
          tickLine={false}
          axisLine={false}
          // "그랜드마스터"(7자·약 80px)까지 한 줄에 들어가야 한다 — 좁으면
          // Recharts가 라벨을 두 줄로 꺾는다
          width={compact ? 34 : 96}
          fontSize={11}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span>
                  {chartConfig[name as keyof typeof chartConfig]?.label}:{" "}
                  {pointsToRank(Number(value)).label} (
                  {Math.round(Number(value))}pt)
                </span>
              )}
            />
          }
        />
        {currentPoints !== null && (
          <ReferenceLine
            y={currentPoints}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{
              value: "현재 랭크",
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
        )}
        <Area
          dataKey="lobby"
          type="monotone"
          stroke="var(--color-lobby)"
          strokeWidth={2}
          fill="url(#fillLobby)"
          connectNulls
          // 승 = 채운 점, 패 = 속 빈 점 (색은 계열 색으로 통일)
          dot={({ cx, cy, payload, index }) => (
            <circle
              key={index}
              cx={cx}
              cy={cy}
              r={4}
              fill={payload.win ? LOBBY_COLOR : "var(--background)"}
              stroke={payload.win ? "var(--background)" : LOBBY_COLOR}
              strokeWidth={payload.win ? 1.5 : 2}
            />
          )}
        />
        <Line
          dataKey="est"
          type="monotone"
          stroke="var(--color-est)"
          strokeWidth={2}
          strokeDasharray="6 4"
          connectNulls
          // 점선에도 점을 찍어 이 계열이 자기 마커를 갖게 한다 —
          // 점이 없으면 로비 선의 패배 점이 이 계열 것으로 오인된다.
          // 테두리는 로비 점과 동일하게 배경색으로 둘러 겹칠 때 구분되게 한다
          // 로비 점과 동일 규격 (r=4, 배경색 테두리 1.5)
          dot={{
            r: 4,
            fill: EST_COLOR,
            stroke: "var(--background)",
            strokeWidth: 1.5,
            // Line의 strokeDasharray가 점의 원 테두리까지 상속돼 테두리가
            // 잘려 찌그러져 보인다 — 점에서는 실선으로 되돌린다
            strokeDasharray: "0",
          }}
        />
      </ComposedChart>
    </ChartContainer>

      {/* 커스텀 범례 — 선 종류와 점 의미를 같이 설명한다 */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={LOBBY_COLOR}
              strokeWidth="2"
            />
          </svg>
          로비 평균 랭크
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={EST_COLOR}
              strokeWidth="2"
              strokeDasharray="5 3"
            />
          </svg>
          매칭 실력대
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/70">로비 점</span>
          <span className="flex items-center gap-1">
            <span
              className="size-2.5 rounded-full"
              style={{ background: LOBBY_COLOR }}
            />
            승
          </span>
          <span className="flex items-center gap-1">
            <span
              className="size-2.5 rounded-full border-2"
              style={{ borderColor: LOBBY_COLOR }}
            />
            패
          </span>
        </span>
      </div>
    </div>
  );
}
