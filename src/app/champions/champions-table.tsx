"use client";

// 챔피언 통계 — 목록은 간단하게(승률·판수·주 포지션), 챔피언을 누르면
// 모달에서 평균 지표·포지션별 성적·추천 스펠/아이템/룬을 자세히 보여준다.

import { useEffect, useMemo, useState } from "react";
import { AssetTip } from "@/components/asset-tip";
import { matchesKo } from "@/lib/hangul";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Flame, Search, X } from "lucide-react";
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
import type { RuneInfo, RuneTree } from "@/lib/ddragon";
import { RuneTreeView } from "@/components/rune-page";

const POSITION_LABEL: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};
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

function wr(wins: number, games: number): number {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
}

/** 표본 보정 승률(윌슨 하한) — 판수가 적은 항목이 높은 승률만으로
 * 추천되는 것을 막는다. 130판 52%보다 1368판 47%가 위에 올 수 있다. */
function adjustedRate(wins: number, games: number): number {
  if (games === 0) return 0;
  const z = 1.96;
  const p = wins / games;
  return (
    (p + (z * z) / (2 * games) -
      z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)) /
    (1 + (z * z) / games)
  );
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

function WinrateText({ wins, games }: { wins: number; games: number }) {
  const v = wr(wins, games);
  return (
    <span
      className={`tabular-nums ${
        v >= 55 ? "text-emerald-500" : v < 45 ? "text-red-500" : ""
      }`}
    >
      {v}%
    </span>
  );
}

export function ChampionsTable({
  stats,
  version,
  names,
  runeMap,
  runeTrees,
  patches,
  currentPatch,
  currentBracket,
}: {
  stats: ChampionStatsPayload;
  version: string;
  names: Record<string, string>;
  runeMap: Record<number, RuneInfo>;
  runeTrees: RuneTree[];
  patches: { patch: string; games: number }[];
  currentPatch: string | null;
  currentBracket: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<Lane>("all");
  const [selected, setSelected] = useState<ChampionStat | null>(null);

  // 패치·랭크 선택을 URL로 이동 (서로 유지). rank 기본값(emerald)은 URL에서 생략.
  const go = (patch: string | null, rank: string) => {
    const p = new URLSearchParams();
    if (patch) p.set("patch", patch);
    if (rank && rank !== "emerald") p.set("rank", rank);
    const qs = p.toString();
    router.push(`/champions${qs ? `?${qs}` : ""}`);
  };

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
                <button
                  key={c.champ}
                  type="button"
                  onClick={() => setSelected(c)}
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
                </button>
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

      {selected && (
        <ChampionModal
          c={selected}
          version={version}
          names={names}
          runeMap={runeMap}
          runeTrees={runeTrees}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── 상세 모달 ────────────────────────────────────────────

function ChampionModal({
  c,
  version,
  names,
  runeMap,
  runeTrees,
  onClose,
}: {
  c: ChampionStat;
  version: string;
  names: Record<string, string>;
  runeMap: Record<number, RuneInfo>;
  runeTrees: RuneTree[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const kda =
    c.avgDeaths > 0
      ? ((c.avgKills + c.avgAssists) / c.avgDeaths).toFixed(2)
      : "Perfect";
  const posEntries = Object.entries(c.positions).sort(
    (a, b) => b[1].games - a[1].games,
  );
  const bestSpell = [...c.spells].sort(
    (a, b) => adjustedRate(b.wins, b.games) - adjustedRate(a.wins, a.games),
  )[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="h-dvh w-full overflow-y-auto bg-card shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-lg sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/95 px-5 py-4 backdrop-blur-sm">
          <Image
            src={championIconUrl(version, c.champ)}
            alt=""
            width={44}
            height={44}
            unoptimized
            className="size-11 shrink-0 rounded-xl object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">
              {championNameKo(names, c.champ)}
            </div>
            <div className="text-xs text-muted-foreground">
              {c.games}판 · 승률 <WinrateText wins={c.wins} games={c.games} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* 평균 지표 */}
          <section className="grid grid-cols-3 gap-2">
            <MetricTile
              label="평균 KDA"
              value={kda}
              sub={`${c.avgKills.toFixed(1)} / ${c.avgDeaths.toFixed(1)} / ${c.avgAssists.toFixed(1)}`}
            />
            <MetricTile
              label="평균 CS"
              value={c.avgCs.toFixed(0)}
              sub="경기당"
            />
            <MetricTile
              label="평균 딜량"
              value={
                c.avgDamage >= 1000
                  ? `${(c.avgDamage / 1000).toFixed(1)}k`
                  : c.avgDamage.toFixed(0)
              }
              sub="챔피언 대상"
            />
          </section>

          {/* 포지션별 성적 */}
          <section>
            <SectionLabel>포지션별 성적</SectionLabel>
            <div className="space-y-1.5">
              {posEntries.map(([pos, p]) => (
                <div
                  key={pos}
                  className="grid grid-cols-[3rem_1fr_5.5rem] items-center gap-2 text-xs"
                >
                  <span className="text-muted-foreground">
                    {POSITION_LABEL[pos] ?? pos}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-foreground/8">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{
                        width: `${(p.games / c.games) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {p.games}판 · <WinrateText wins={p.wins} games={p.games} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 시작 아이템 */}
          <section>
            <SectionLabel>시작 아이템</SectionLabel>
            {c.startItems.length === 0 && (
              <p className="text-xs text-muted-foreground">
                시작 아이템 데이터는 수집 중이에요
              </p>
            )}
            <div className="space-y-1.5">
              {c.startItems.map((si, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="flex gap-1">
                    {Object.entries(
                      si.items.reduce<Record<number, number>>((acc, id) => {
                        acc[id] = (acc[id] ?? 0) + 1;
                        return acc;
                      }, {}),
                    ).map(([id, count]) => {
                      const url = itemIconUrl(version, Number(id));
                      return (
                        <span key={id} className="relative">
                          {url ? (
                            <AssetTip kind="item" id={Number(id)}>
                              <Image
                                src={url}
                                alt=""
                                width={24}
                                height={24}
                                unoptimized
                                className="size-6 rounded"
                              />
                            </AssetTip>
                          ) : (
                            <span className="size-6 rounded bg-foreground/8" />
                          )}
                          {count > 1 && (
                            <span className="absolute -right-1 -bottom-1 rounded bg-background px-0.5 text-[9px] font-bold tabular-nums ring-1 ring-foreground/10">
                              {count}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {si.games}판
                  </span>
                  <span className="ml-auto font-medium">
                    <WinrateText wins={si.wins} games={si.games} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 스펠 조합 */}
          <section>
            <SectionLabel>스펠 조합</SectionLabel>
            {c.spells.length === 0 && <Empty />}
            <div className="space-y-1.5">
              {c.spells.map((s) => (
                <div
                  key={`${s.s1}-${s.s2}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="flex gap-1">
                    {[s.s1, s.s2].map((id, i) => {
                      const url = spellIconUrl(version, id);
                      return url ? (
                        <AssetTip key={i} kind="spell" id={id}>
                          <Image
                            src={url}
                            alt=""
                            width={24}
                            height={24}
                            unoptimized
                            className="size-6 rounded"
                          />
                        </AssetTip>
                      ) : (
                        <span key={i} className="size-6 rounded bg-foreground/8" />
                      );
                    })}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.games}판
                  </span>
                  {bestSpell === s && c.spells.length > 1 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      추천
                    </span>
                  )}
                  <span className="ml-auto font-medium">
                    <WinrateText wins={s.wins} games={s.games} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 코어 빌드 순서 */}
          <section>
            <SectionLabel>코어 아이템 순서</SectionLabel>
            {c.buildPaths.length === 0 && (
              <p className="text-xs text-muted-foreground">
                빌드 순서 데이터는 수집 중이에요
              </p>
            )}
            <div className="space-y-1.5">
              {c.buildPaths.map((bp, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {bp.items.map((id, j) => {
                    const url = itemIconUrl(version, id);
                    return (
                      <span key={j} className="flex items-center gap-1.5">
                        {url ? (
                          <AssetTip kind="item" id={id}>
                            <Image
                              src={url}
                              alt=""
                              width={26}
                              height={26}
                              unoptimized
                              className="size-6.5 rounded"
                            />
                          </AssetTip>
                        ) : (
                          <span className="size-6.5 rounded bg-foreground/8" />
                        )}
                        {j < bp.items.length - 1 && (
                          <span className="text-muted-foreground/50">›</span>
                        )}
                      </span>
                    );
                  })}
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {bp.games}판
                  </span>
                  <span className="ml-auto font-medium">
                    <WinrateText wins={bp.wins} games={bp.games} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 아이템 */}
          <section>
            <SectionLabel>자주 나온 아이템</SectionLabel>
            {c.items.length === 0 && <Empty />}
            <div className="grid grid-cols-6 gap-x-2 gap-y-2.5">
              {c.items.map((it) => {
                const url = itemIconUrl(version, it.id);
                return (
                  <div
                    key={it.id}
                    className="flex flex-col items-center gap-0.5"
                    title={`${it.games}판`}
                  >
                    {url ? (
                      <AssetTip kind="item" id={it.id}>
                        <Image
                          src={url}
                          alt=""
                          width={32}
                          height={32}
                          unoptimized
                          className="size-8 rounded"
                        />
                      </AssetTip>
                    ) : (
                      <span className="size-8 rounded bg-foreground/8" />
                    )}
                    <span className="text-[10px]">
                      <WinrateText wins={it.wins} games={it.games} />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 룬 */}
          <section>
            <SectionLabel>룬</SectionLabel>
            {c.runes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                룬 데이터는 수집 중이에요 — 새 경기가 쌓이면 표시됩니다
              </p>
            )}
            <RunePages runes={c.runes} runeMap={runeMap} runeTrees={runeTrees} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** 룬 페이지 목록 — 요약 행을 누르면 아래 풀 트리(op.gg 룬 탭 배치)에 그 페이지가 펼쳐진다 */
function RunePages({
  runes,
  runeMap,
  runeTrees,
}: {
  runes: ChampionStat["runes"];
  runeMap: Record<number, RuneInfo>;
  runeTrees: RuneTree[];
}) {
  const [idx, setIdx] = useState(0);
  const sel = runes[Math.min(idx, runes.length - 1)];
  return (
    <div className="space-y-2">
      {runes.map((r, i) => (
        <RunePage key={i} r={r} runeMap={runeMap} selected={i === idx} onSelect={() => setIdx(i)} />
      ))}
      {sel && runeTrees.length > 0 && (
        <RuneTreeView
          trees={runeTrees}
          keystone={sel.keystone}
          perks={sel.perks}
          subStyle={sel.subStyle}
          subPerks={sel.subPerks}
          statPerks={sel.statPerks}
        />
      )}
    </div>
  );
}

/** 룬 페이지 요약 행 — 핵심룬 크게 + 나머지 3 · 보조 2 · 파편 3, 판수·승률 */
function RunePage({
  r,
  runeMap,
  selected,
  onSelect,
}: {
  r: ChampionStat["runes"][number];
  runeMap: Record<number, RuneInfo>;
  selected: boolean;
  onSelect: () => void;
}) {
  const runeImg = (id: number, size: string, dim = false) => {
    const info = runeMap[id];
    return info ? (
      <AssetTip kind="rune" id={id}>
        <Image
          src={`https://ddragon.leagueoflegends.com/cdn/img/${info.icon}`}
          alt={info.name}
          width={28}
          height={28}
          unoptimized
          className={`${size} ${dim ? "opacity-90" : ""}`}
        />
      </AssetTip>
    ) : (
      <span className={`${size} rounded-full bg-foreground/8`} />
    );
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
        selected ? "border-primary/50 bg-primary/5" : "bg-background/50 hover:bg-accent/40"
      }`}
    >
      {/* 주 트리: 핵심룬 크게 + 나머지 3개 */}
      <div className="flex items-center gap-1">
        {runeImg(r.keystone, "size-8 shrink-0")}
        {r.perks.slice(1).map((id, i) => (
          <span key={i}>{runeImg(id, "size-5 shrink-0", true)}</span>
        ))}
      </div>
      <span className="h-6 w-px shrink-0 bg-border" />
      {/* 보조 트리 + 2개 */}
      <div className="flex items-center gap-1">
        {runeImg(r.subStyle, "size-4 shrink-0", true)}
        {r.subPerks.map((id, i) => (
          <span key={i}>{runeImg(id, "size-5 shrink-0", true)}</span>
        ))}
      </div>
      <span className="h-6 w-px shrink-0 bg-border" />
      {/* 능력치 파편 */}
      <div className="flex items-center gap-1">
        {r.statPerks.map((id, i) => {
          const mod = STAT_MODS[id];
          return mod ? (
            <AssetTip key={i} kind="static" id={id} tip={{ name: mod.name, blocks: [{ kind: "text", text: mod.desc }] }}>
              <Image
                src={`https://ddragon.leagueoflegends.com/cdn/img/${mod.icon}`}
                alt={mod.name}
                width={16}
                height={16}
                unoptimized
                className="size-4 rounded-full bg-foreground/10 p-0.5"
              />
            </AssetTip>
          ) : (
            <span key={i} className="size-4 rounded-full bg-foreground/8" />
          );
        })}
      </div>
      <span className="ml-auto shrink-0 text-right text-xs">
        <span className="mr-1.5 tabular-nums text-muted-foreground">
          {r.games}판
        </span>
        <span className="font-medium">
          <WinrateText wins={r.wins} games={r.games} />
        </span>
      </span>
    </button>
  );
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] tabular-nums text-muted-foreground">
        {sub}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">표본이 부족해요</p>;
}
