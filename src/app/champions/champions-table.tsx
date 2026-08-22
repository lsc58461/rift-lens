"use client";

// 챔피언 통계 — 목록은 간단하게(승률·판수·주 포지션), 챔피언을 누르면
// 모달에서 평균 지표·포지션별 성적·추천 스펠/아이템/룬을 자세히 보여준다.

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronRight, Search, X } from "lucide-react";
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
import type { RuneInfo } from "@/lib/ddragon";

const POSITION_LABEL: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};
const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

type SortKey = "games" | "winrate";
type Lane = (typeof LANES)[number] | "all";

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
}: {
  stats: ChampionStatsPayload;
  version: string;
  names: Record<string, string>;
  runeMap: Record<number, RuneInfo>;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("games");
  const [lane, setLane] = useState<Lane>("all");
  const [selected, setSelected] = useState<ChampionStat | null>(null);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = stats.champions;
    if (query) {
      list = list.filter(
        (c) =>
          c.champ.toLowerCase().includes(query) ||
          championNameKo(names, c.champ).toLowerCase().includes(query),
      );
    }
    if (lane !== "all") {
      // 그 라인에서 의미 있는 표본(5판+)이 있는 챔피언만
      list = list.filter((c) => (c.positions[lane]?.games ?? 0) >= 5);
    }
    return [...list].sort((a, b) => {
      const sa = laneStats(a, lane);
      const sb = laneStats(b, lane);
      return sort === "games"
        ? sb.games - sa.games
        : wr(sb.wins, sb.games) - wr(sa.wins, sa.games) ||
            sb.games - sa.games;
    });
  }, [stats.champions, q, sort, lane, names]);

  const maxGames = Math.max(
    1,
    ...rows.map((c) => laneStats(c, lane).games),
  );

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
        <div className="flex items-center gap-1 self-end rounded-md border p-0.5 sm:self-auto">
          {(
            [
              ["games", "판수순"],
              ["winrate", "승률순"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                sort === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
          <div className="hidden items-center gap-3 border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
            <span className="flex-1">챔피언</span>
            <span className="w-24 shrink-0 text-right">
              판수{lane !== "all" && ` (${POSITION_LABEL[lane]})`}
            </span>
            <span className="w-16 shrink-0 text-right">승률</span>
            <span className="w-20 shrink-0 text-right">주 포지션</span>
            <span className="w-6 shrink-0" />
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((c) => {
              const s = laneStats(c, lane);
              const mainPos = Object.entries(c.positions).sort(
                (a, b) => b[1].games - a[1].games,
              )[0];
              return (
                <button
                  key={c.champ}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 sm:flex-nowrap"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 font-medium">
                    <Image
                      src={championIconUrl(version, c.champ)}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="size-8 rounded-lg"
                    />
                    <span className="truncate">
                      {championNameKo(names, c.champ)}
                    </span>
                  </span>
                  <span className="flex w-24 shrink-0 items-center justify-end gap-2">
                    <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-foreground/10 sm:block">
                      <span
                        className="block h-full rounded-full bg-primary/70"
                        style={{ width: `${(s.games / maxGames) * 100}%` }}
                      />
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {s.games}판
                    </span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs font-medium">
                    <WinrateText wins={s.wins} games={s.games} />
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                    {mainPos
                      ? (POSITION_LABEL[mainPos[0]] ?? mainPos[0])
                      : "—"}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
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
  onClose,
}: {
  c: ChampionStat;
  version: string;
  names: Record<string, string>;
  runeMap: Record<number, RuneInfo>;
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl"
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
            className="size-11 rounded-xl"
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
                        <Image
                          key={i}
                          src={url}
                          alt=""
                          width={24}
                          height={24}
                          unoptimized
                          className="size-6 rounded"
                        />
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
                      <Image
                        src={url}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                        className="size-8 rounded"
                      />
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
            <div className="space-y-2">
              {c.runes.map((r, i) => (
                <RunePage key={i} r={r} runeMap={runeMap} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** op.gg식 풀 룬 페이지 — 주 트리 4 · 보조 2 · 능력치 파편 3 */
function RunePage({
  r,
  runeMap,
}: {
  r: ChampionStat["runes"][number];
  runeMap: Record<number, RuneInfo>;
}) {
  const runeImg = (id: number, size: string, dim = false) => {
    const info = runeMap[id];
    return info ? (
      <Image
        src={`https://ddragon.leagueoflegends.com/cdn/img/${info.icon}`}
        alt={info.name}
        title={info.name}
        width={28}
        height={28}
        unoptimized
        className={`${size} ${dim ? "opacity-90" : ""}`}
      />
    ) : (
      <span className={`${size} rounded-full bg-foreground/8`} />
    );
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/50 p-2.5">
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
            <Image
              key={i}
              src={`https://ddragon.leagueoflegends.com/cdn/img/${mod.icon}`}
              alt={mod.name}
              title={mod.name}
              width={16}
              height={16}
              unoptimized
              className="size-4 rounded-full bg-foreground/10 p-0.5"
            />
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
    </div>
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
