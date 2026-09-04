"use client";

// 챔피언 통계 목록 — 승률·판수·주 포지션. 챔피언을 누르면 상세 페이지(/champions/[champion])로 간다.
// 예전엔 모달이었는데 주소가 없어 검색엔진·AI 가 상세 내용에 닿지 못했다(2026-09-03).

import { useMemo, useState } from "react";
import { matchesKo } from "@/lib/hangul";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Flame, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  championIconUrl,
  championNameKo,
  itemIconUrl,
  spellIconUrl,
  STAT_MODS,
} from "@/lib/ddragon-assets";
import type {
  ChampionStat,
  ChampionStatsPayload,
} from "@/lib/champion-stats";
import { adjustedRate, championHref, POSITION_LABEL, WinrateText } from "./shared";
import { RuneTreeView } from "@/components/rune-page";

const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

type Lane = (typeof LANES)[number] | "all";

// 랭크 브라켓 (서버 RANK_BRACKETS와 라벨 일치)
const RANK_OPTIONS: { key: string; label: string }[] = [
  { key: "all", label: "전체 랭크" },
  { key: "brpl", label: "브·실·골·플" },
  { key: "emerald", label: "에메랄드 이상" },
  { key: "diamond", label: "다이아 이상" },
  { key: "master", label: "마스터 이상" },
];

/** 표시용 패치 라벨 — DB엔 DDragon 번호(16.16)로 저장되지만 유저에겐 라이엇
 * 마케팅 번호(26.16)로 보여준다. 패치노트 페이지와 표기를 맞추기 위함. */
function patchDisplay(p: string): string {
  const [maj, min] = p.split(".").map((n) => parseInt(n, 10));
  return Number.isFinite(maj) ? `${maj + 10}.${min ?? 0}` : p;
}



/** 라인 필터가 걸려 있으면 그 라인 기준 판수·승수를 쓴다 */
function laneStats(c: ChampionStat, lane: Lane): { games: number; wins: number } {
  if (lane === "all") return { games: c.games, wins: c.wins };
  const p = c.positions[lane];
  return { games: p?.games ?? 0, wins: p?.wins ?? 0 };
}

/** 정렬·표시용 자체 점수 — 전체 라인에선 주 포지션 점수, 특정 라인에선 그 라인 점수 */
function scoreOf(c: ChampionStat, lane: Lane): number | undefined {
  if (lane === "all") {
    const main = Object.entries(c.positions).sort(
      (a, b) => b[1].games - a[1].games,
    )[0];
    return main?.[1].score;
  }
  return c.positions[lane]?.score;
}

/** OP 챔피언 판정 — 표본 보정 승률이 높고(≥53%) 표본이 충분한(50판+) 챔피언.
 * 판수 적은 고승률 편향을 윌슨 하한으로 걸러 진짜 강한 챔프만 표시한다. */
function isOp(wins: number, games: number): boolean {
  return games >= 50 && adjustedRate(wins, games) >= 0.53;
}

const TIER_STYLE: Record<number, string> = {
  1: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30",
  2: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  3: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  4: "bg-muted text-muted-foreground border-transparent",
  5: "bg-muted/60 text-muted-foreground/70 border-transparent",
};
function TierBadge({ tier }: { tier?: number }) {
  if (!tier) return <span className="inline-block w-9" />;
  return (
    <span
      className={`inline-flex w-9 shrink-0 items-center justify-center rounded-md border py-0.5 text-[11px] font-bold tabular-nums ${TIER_STYLE[tier] ?? TIER_STYLE[4]}`}
    >
      {tier}티어
    </span>
  );
}


export function ChampionsTable({
  stats,
  version,
  names,
  patches,
  currentPatch,
  currentBracket,
}: {
  stats: ChampionStatsPayload;
  version: string;
  names: Record<string, string>;
  patches: { patch: string; games: number }[];
  currentPatch: string | null;
  currentBracket: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<Lane>("all");

  // 패치·랭크 선택을 URL로 이동 (서로 유지). rank 기본값(emerald)은 URL에서 생략.
  const go = (patch: string | null, rank: string) => {
    const p = new URLSearchParams();
    if (patch) p.set("patch", patch);
    if (rank && rank !== "emerald") p.set("rank", rank);
    const qs = p.toString();
    router.push(`/champions${qs ? `?${qs}` : ""}`);
  };

  // 상세 링크에 붙일 패치 — 최신 패치를 보고 있으면 생략(색인이 한 주소로 모이게)
  const patch = currentPatch && currentPatch !== patches[0]?.patch ? currentPatch : null;

  const rows = useMemo(() => {
    const query = q.trim();
    let list = stats.champions;
    if (query) {
      // 영문 키·한글 이름 모두 — 띄어쓰기 무시("리신") + 초성("ㄹㅅ") 검색
      list = list.filter(
        (c) => matchesKo(c.champ, query) || matchesKo(championNameKo(names, c.champ), query),
      );
    }
    if (lane !== "all") {
      // 그 라인이 실제 포지션인 챔피언만 — 절대 판수(5+)에 더해 점유율(15%+)을
      // 요구한다. 900판 챔피언이 미드 6판 갔다고 미드 필터에 뜨면 안 된다.
      list = list.filter((c) => {
        const g = c.positions[lane]?.games ?? 0;
        return g >= 5 && g / c.games >= 0.15;
      });
    }
    return [...list].sort((a, b) => {
      // 자체 점수 내림차순 — 점수 없으면(표본 부족) 맨 뒤, 동점은 판수순
      const sca = scoreOf(a, lane) ?? -1;
      const scb = scoreOf(b, lane) ?? -1;
      if (scb !== sca) return scb - sca;
      return laneStats(b, lane).games - laneStats(a, lane).games;
    });
  }, [stats.champions, q, lane, names]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="챔피언 검색"
            className="pl-9"
          />
        </div>
        {patches.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 self-end rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent data-popup-open:bg-accent sm:self-auto">
              {currentPatch ? `패치 ${patchDisplay(currentPatch)}` : "패치 선택"}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {patches.map((p) => (
                <DropdownMenuItem
                  key={p.patch}
                  onClick={() => go(p.patch, currentBracket)}
                  className="justify-between text-xs"
                >
                  <span>
                    패치 {patchDisplay(p.patch)}
                    <span className="ml-1.5 text-muted-foreground">
                      {p.games.toLocaleString()}경기
                    </span>
                  </span>
                  {currentPatch === p.patch && (
                    <Check className="size-3.5 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 self-end rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent data-popup-open:bg-accent sm:self-auto">
            {RANK_OPTIONS.find((r) => r.key === currentBracket)?.label ??
              "에메랄드 이상"}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {RANK_OPTIONS.map((r) => (
              <DropdownMenuItem
                key={r.key}
                onClick={() => go(currentPatch, r.key)}
                className="justify-between text-xs"
              >
                {r.label}
                {currentBracket === r.key && (
                  <Check className="size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="self-end text-[11px] text-muted-foreground sm:self-auto">
          자체 점수순
        </span>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(["all", ...LANES] as Lane[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLane(l)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              lane === l
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {l === "all" ? "전체 라인" : POSITION_LABEL[l]}
          </button>
        ))}
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          {/* 헤더는 데스크톱에서만 — 모바일은 2줄 카드형이라 컬럼 헤더가 불필요 */}
          <div className="hidden items-center gap-3 border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
            <span className="w-9 shrink-0 text-center">티어</span>
            <span className="flex-1">챔피언</span>
            <span className="flex items-center justify-end gap-3">
              <span className="text-right whitespace-nowrap normal-case">
                {lane === "all" ? "표본·주포지션" : "표본·점유"}
              </span>
              <span className="w-14 text-right">점수</span>
              <span className="w-12 text-right">승률</span>
              {(stats.bansMatchTotal ?? 0) > 0 && (
                <span className="w-12 text-right">밴률</span>
              )}
              <span className="w-4 shrink-0" />
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((c) => {
              const s = laneStats(c, lane);
              const mainPos = Object.entries(c.positions).sort(
                (a, b) => b[1].games - a[1].games,
              )[0];
              const tier =
                lane === "all"
                  ? (mainPos ? c.positions[mainPos[0]]?.tier : undefined)
                  : c.positions[lane]?.tier;
              return (
                <Link
                  key={c.champ}
                  href={championHref(c.champ, patch, currentBracket)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 sm:flex-nowrap"
                >
                  {/* 1줄차: 티어 + 챔피언 (모바일에선 지표가 2줄차로 내려감) */}
                  <TierBadge tier={tier} />
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 font-medium">
                    <Image
                      src={championIconUrl(version, c.champ)}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="size-8 shrink-0 rounded-lg object-cover"
                    />
                    <span className="truncate">
                      {championNameKo(names, c.champ)}
                    </span>
                    {isOp(s.wins, s.games) && (
                      <span
                        title="OP — 표본 충분 + 보정 승률 상위"
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400"
                      >
                        <Flame className="size-2.5" />
                        OP
                      </span>
                    )}
                  </span>
                  {/* 지표: 모바일에선 w-full로 2줄차, sm+에선 인라인. 컬럼 구성 동일 */}
                  <span className="flex w-full items-center justify-end gap-3 pl-11 text-xs text-muted-foreground sm:w-auto sm:pl-0">
                    <span className="tabular-nums">
                      {s.games}판
                      {lane === "all"
                        ? mainPos
                          ? ` · ${POSITION_LABEL[mainPos[0]] ?? mainPos[0]}`
                          : ""
                        : ` · ${Math.round((s.games / c.games) * 100)}%`}
                    </span>
                    <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-foreground">
                      {(() => {
                        const sc = scoreOf(c, lane);
                        return sc !== undefined ? sc.toFixed(2) : "—";
                      })()}
                    </span>
                    <span className="w-12 shrink-0 text-right font-medium">
                      <WinrateText wins={s.wins} games={s.games} />
                    </span>
                    {(stats.bansMatchTotal ?? 0) > 0 && (
                      <span className="w-12 shrink-0 text-right tabular-nums">
                        밴{" "}
                        {c.bans && stats.bansMatchTotal
                          ? `${Math.round((c.bans / stats.bansMatchTotal) * 100)}%`
                          : "—"}
                      </span>
                    )}
                    <ChevronRight className="size-4 shrink-0" />
                  </span>
                </Link>
              );
            })}
            {rows.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                조건에 맞는 챔피언이 없어요
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        이 사이트에서 분석된 소환사들의 경기에서 집계한 표본이라 전체 서버
        통계와 다를 수 있어요. 표본 10판 미만 챔피언은 표시하지 않습니다.
      </p>

    </div>
  );
}

