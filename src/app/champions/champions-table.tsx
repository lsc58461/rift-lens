"use client";

// 챔피언 통계 테이블 — 행을 누르면 스펠 조합·아이템·룬 승률이 펼쳐진다.

import { useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  championIconUrl,
  championNameKo,
  itemIconUrl,
  spellIconUrl,
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

type SortKey = "games" | "winrate";

function wr(wins: number, games: number): number {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
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
  const [open, setOpen] = useState<string | null>(null);

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
    return [...list].sort((a, b) =>
      sort === "games"
        ? b.games - a.games
        : wr(b.wins, b.games) - wr(a.wins, a.games) || b.games - a.games,
    );
  }, [stats.champions, q, sort, names]);

  const maxGames = Math.max(1, ...stats.champions.map((c) => c.games));

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

      <Card className="py-0">
        <CardContent className="px-0">
          <div className="hidden items-center gap-3 border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
            <span className="flex-1">챔피언</span>
            <span className="w-24 shrink-0 text-right">판수</span>
            <span className="w-16 shrink-0 text-right">승률</span>
            <span className="w-20 shrink-0 text-right">주 포지션</span>
            <span className="w-6 shrink-0" />
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((c) => (
              <ChampionRow
                key={c.champ}
                c={c}
                version={version}
                names={names}
                runeMap={runeMap}
                maxGames={maxGames}
                open={open === c.champ}
                onToggle={() => setOpen(open === c.champ ? null : c.champ)}
              />
            ))}
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

function ChampionRow({
  c,
  version,
  names,
  runeMap,
  maxGames,
  open,
  onToggle,
}: {
  c: ChampionStat;
  version: string;
  names: Record<string, string>;
  runeMap: Record<number, RuneInfo>;
  maxGames: number;
  open: boolean;
  onToggle: () => void;
}) {
  const mainPos = Object.entries(c.positions).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 sm:flex-nowrap"
        aria-expanded={open}
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
          <span className="truncate">{championNameKo(names, c.champ)}</span>
        </span>
        <span className="flex w-24 shrink-0 items-center justify-end gap-2">
          <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-foreground/10 sm:block">
            <span
              className="block h-full rounded-full bg-primary/70"
              style={{ width: `${(c.games / maxGames) * 100}%` }}
            />
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {c.games}판
          </span>
        </span>
        <span className="w-16 shrink-0 text-right text-xs font-medium">
          <WinrateText wins={c.wins} games={c.games} />
        </span>
        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
          {mainPos ? (POSITION_LABEL[mainPos[0]] ?? mainPos[0]) : "—"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="grid gap-4 border-t bg-muted/20 px-4 py-4 sm:grid-cols-3">
          <StatBlock title="스펠 조합">
            {c.spells.length === 0 && <Empty />}
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
                        width={22}
                        height={22}
                        unoptimized
                        className="size-[22px] rounded"
                      />
                    ) : (
                      <span
                        key={i}
                        className="size-[22px] rounded bg-foreground/8"
                      />
                    );
                  })}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {s.games}판
                </span>
                <span className="ml-auto font-medium">
                  <WinrateText wins={s.wins} games={s.games} />
                </span>
              </div>
            ))}
          </StatBlock>

          <StatBlock title="자주 나온 아이템">
            {c.items.length === 0 && <Empty />}
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
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
                        width={28}
                        height={28}
                        unoptimized
                        className="size-7 rounded"
                      />
                    ) : (
                      <span className="size-7 rounded bg-foreground/8" />
                    )}
                    <span className="text-[10px]">
                      <WinrateText wins={it.wins} games={it.games} />
                    </span>
                  </div>
                );
              })}
            </div>
          </StatBlock>

          <StatBlock title="룬">
            {c.runes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                룬 데이터는 수집 중이에요 — 새 경기가 쌓이면 표시됩니다
              </p>
            )}
            {c.runes.map((r) => {
              const key = runeMap[r.keystone];
              const sub = runeMap[r.subStyle];
              return (
                <div
                  key={`${r.keystone}-${r.subStyle}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="flex items-center gap-1">
                    {key && (
                      <Image
                        src={`https://ddragon.leagueoflegends.com/cdn/img/${key.icon}`}
                        alt={key.name}
                        width={24}
                        height={24}
                        unoptimized
                        className="size-6"
                      />
                    )}
                    {sub && (
                      <Image
                        src={`https://ddragon.leagueoflegends.com/cdn/img/${sub.icon}`}
                        alt={sub.name}
                        width={16}
                        height={16}
                        unoptimized
                        className="size-4 opacity-80"
                      />
                    )}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {key?.name ?? r.keystone}
                  </span>
                  <span className="ml-auto shrink-0 font-medium">
                    <WinrateText wins={r.wins} games={r.games} />
                  </span>
                </div>
              );
            })}
          </StatBlock>
        </div>
      )}
    </div>
  );
}

function StatBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">표본이 부족해요</p>;
}
