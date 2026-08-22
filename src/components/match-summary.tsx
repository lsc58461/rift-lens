"use client";

// 최근 경기 요약 — 전적검색 사이트의 상단 통계 패널에 해당한다.
// 승패 도넛, 평균 KDA, 킬관여·분당 CS, 선호 포지션, 자주 쓴 챔피언,
// 함께 플레이한 소환사를 한 카드에 모은다. 모두 저장된 매치에서 계산된 값.

import Image from "next/image";
import Link from "next/link";
import { championIconUrl, championNameKo } from "@/lib/ddragon-assets";

export interface Summary {
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  kp: number | null;
  csPerMin: number | null;
  positions: Record<string, number>;
  champions: { champ: string; games: number; wins: number; kda: number | null }[];
  mates: { name: string; games: number; wins: number }[];
}

const POSITION_LABEL: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};
const POSITION_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/** 승률 도넛 — conic-gradient 한 겹으로 그린다(차트 라이브러리 불필요) */
function WinRateDonut({
  wins,
  losses,
}: {
  wins: number;
  losses: number;
}) {
  const total = wins + losses;
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div
        className="relative size-16 rounded-full"
        style={{
          background: `conic-gradient(var(--chart-1) 0% ${pct}%, var(--destructive) ${pct}% 100%)`,
        }}
      >
        <div className="absolute inset-[6px] flex flex-col items-center justify-center rounded-full bg-card">
          <span className="text-sm leading-none font-bold tabular-nums">
            {pct}%
          </span>
        </div>
      </div>
      <div className="text-sm">
        <div className="font-semibold tabular-nums">
          <span className="text-chart-1">{wins}승</span>{" "}
          <span className="text-destructive">{losses}패</span>
        </div>
        <div className="text-xs text-muted-foreground">최근 {total}경기</div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}

function kdaTone(ratio: number | null): string {
  if (ratio === null || ratio >= 5) return "text-chart-2";
  if (ratio >= 3) return "text-primary";
  return "";
}

export function MatchSummary({
  summary,
  version,
  names,
  region,
  bare = false,
}: {
  summary: Summary;
  version: string;
  names: Record<string, string>;
  region: string;
  /** 바깥에서 Card로 감쌀 때 자체 테두리 상자를 생략한다 */
  bare?: boolean;
}) {
  const posEntries = POSITION_ORDER.filter((p) => summary.positions[p]).map(
    (p) => ({ pos: p, n: summary.positions[p] }),
  );
  const posTotal = posEntries.reduce((a, p) => a + p.n, 0);

  return (
    <div className={bare ? "" : "mb-3 rounded-xl border bg-card/60 p-3 sm:p-4"}>
      {/* 승률 + 핵심 지표 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <WinRateDonut wins={summary.wins} losses={summary.losses} />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Stat
            label="평균 KDA"
            value={summary.kda === null ? "Perfect" : summary.kda.toFixed(2)}
            sub={`${summary.kills.toFixed(1)} / ${summary.deaths.toFixed(1)} / ${summary.assists.toFixed(1)}`}
            tone={kdaTone(summary.kda)}
          />
          {summary.kp !== null && (
            <Stat
              label="킬관여"
              value={`${Math.round(summary.kp * 100)}%`}
              sub="팀 킬 대비"
            />
          )}
          {summary.csPerMin !== null && (
            <Stat
              label="분당 CS"
              value={summary.csPerMin.toFixed(1)}
              sub="미니언 처치"
            />
          )}
        </div>
      </div>

      {/* 선호 포지션 */}
      {posTotal > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            선호 포지션
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
            {posEntries.map((p, i) => (
              <div
                key={p.pos}
                className="h-full"
                style={{
                  width: `${(p.n / posTotal) * 100}%`,
                  backgroundColor: `var(--chart-${(i % 5) + 1})`,
                }}
                title={`${POSITION_LABEL[p.pos]} ${p.n}경기`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {posEntries.map((p, i) => (
              <span key={p.pos} className="flex items-center gap-1">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `var(--chart-${(i % 5) + 1})` }}
                />
                {POSITION_LABEL[p.pos]} {Math.round((p.n / posTotal) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 자주 쓴 챔피언 / 함께 플레이한 소환사 */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            자주 쓴 챔피언
          </div>
          <div className="space-y-1.5">
            {summary.champions.map((c) => {
              const rate = Math.round((c.wins / c.games) * 100);
              return (
                <div key={c.champ} className="flex items-center gap-2">
                  <Image
                    src={championIconUrl(version, c.champ)}
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    className="size-7 shrink-0 rounded-md"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {championNameKo(names, c.champ)}
                  </span>
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      rate >= 60
                        ? "text-chart-1"
                        : rate < 40
                          ? "text-destructive"
                          : ""
                    }`}
                  >
                    {rate}%
                  </span>
                  <span className="w-20 text-right text-[11px] tabular-nums text-muted-foreground">
                    {c.games}경기 · {c.kda === null ? "Perfect" : c.kda.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            함께 플레이한 소환사
          </div>
          {summary.mates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              최근 경기에서 두 번 이상 만난 팀원이 없어요
            </p>
          ) : (
            <div className="space-y-1.5">
              {summary.mates.map((m) => {
                const rate = Math.round((m.wins / m.games) * 100);
                return (
                  <div key={m.name} className="flex items-center gap-2">
                    <Link
                      href={`/summoner/${region}/${encodeURIComponent(m.name)}`}
                      className="min-w-0 flex-1 truncate text-xs underline-offset-2 hover:underline"
                    >
                      {m.name.split("#")[0]}
                    </Link>
                    <span
                      className={`text-xs font-semibold tabular-nums ${
                        rate >= 60
                          ? "text-chart-1"
                          : rate < 40
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      {rate}%
                    </span>
                    <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
                      {m.wins}승 {m.games - m.wins}패
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
