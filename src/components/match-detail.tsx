"use client";

import { TIER_COLORS } from "@/lib/mmr/rank";

// 펼친 경기의 상세 — 종합 스코어보드 / 팀 분석 / 빌드 세 탭.
// 종합·팀 분석은 이미 받은 전적 데이터로 그리고, 빌드(아이템 타임라인·
// 스킬 순서)만 탭을 열 때 타임라인 API를 한 번 호출한다(서버 30일 캐시).

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  championIconUrl,
  championNameKo,
  itemIconUrl,
  spellIconUrl,
} from "@/lib/ddragon-assets";
import type { RuneInfo } from "@/lib/ddragon";

export interface DetailPlayer {
  name: string;
  champ: string;
  position: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  damage: number | null;
  gold: number | null;
  vision: number | null;
  level: number | null;
  spells: number[];
  items: number[];
  self?: boolean;
  /** 팀 내 최고 기여 — 승팀 MVP / 패팀 ACE */
  badge?: "MVP" | "ACE";
  /** 경기 시점의 솔로랭크 (우리 스냅샷 기준, 가장 가까운 것). 없으면 미확인 */
  rank?: { tier: string; label: string; short: string; ageDays: number } | null;
}

export function RankAtGame({ rank, short = false }: { rank?: DetailPlayer["rank"]; short?: boolean }) {
  if (!rank) return null;
  return (
    <span
      className="shrink-0 text-[10px] leading-none tabular-nums"
      style={{ color: TIER_COLORS[rank.tier] }}
      title={`경기 시점 기준 솔로랭크${rank.ageDays > 3 ? ` (경기와 ${rank.ageDays}일 차이 나는 기록)` : ""}`}
    >
      {short ? rank.short : rank.label}
      {rank.ageDays > 3 && <span className="ml-0.5 opacity-60">±{rank.ageDays}d</span>}
    </span>
  );
}

export function PlayerBadge({ badge, small = false }: { badge?: "MVP" | "ACE"; small?: boolean }) {
  if (!badge) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 font-bold leading-4 tracking-wide ${
        small ? "text-[9px]" : "text-[10px]"
      } ${
        badge === "MVP"
          ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
          : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
      }`}
      title={badge === "MVP" ? "승리 팀에서 기여도 1위" : "패배 팀에서 기여도 1위"}
    >
      {badge}
    </span>
  );
}

interface TimelineData {
  items: { minute: number; itemId: number; type: "buy" | "sell" }[];
  skills: number[];
}

const POSITION_ORDER: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  BOTTOM: 3,
  UTILITY: 4,
};

const SKILL_KEYS = ["", "Q", "W", "E", "R"] as const;
const SKILL_COLORS = [
  "",
  "bg-sky-500/15 text-sky-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-500",
  "bg-rose-500/15 text-rose-500",
] as const;

const byPosition = (a: DetailPlayer, b: DetailPlayer) =>
  (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9);

type Tab = "scoreboard" | "teams" | "build";

export function MatchDetail({
  matchId,
  team,
  enemy,
  win,
  region,
  riotId,
  version,
  names,
  keystone,
  subStyle,
  runeMap,
}: {
  matchId: string;
  team: DetailPlayer[];
  enemy: DetailPlayer[];
  win: boolean;
  region: string;
  riotId: string;
  version: string;
  names: Record<string, string>;
  keystone: number | null;
  subStyle: number | null;
  runeMap: Record<number, RuneInfo>;
}) {
  const [tab, setTab] = useState<Tab>("scoreboard");

  return (
    <div className="border-t bg-background/50">
      <div className="flex gap-1 border-b px-3 pt-2">
        {(
          [
            ["scoreboard", "종합"],
            ["teams", "팀 분석"],
            ["build", "빌드"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? "border border-b-0 bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="px-3 py-3">
        {tab === "scoreboard" && (
          <div className="space-y-4">
            <Scoreboard
              players={team}
              win={win}
              label="우리 팀"
              region={region}
              version={version}
              names={names}
            />
            <Scoreboard
              players={enemy}
              win={!win}
              label="상대 팀"
              region={region}
              version={version}
              names={names}
            />
          </div>
        )}
        {tab === "teams" && (
          <TeamAnalysis team={team} enemy={enemy} version={version} />
        )}
        {tab === "build" && (
          <BuildTab
            matchId={matchId}
            region={region}
            riotId={riotId}
            version={version}
            keystone={keystone}
            subStyle={subStyle}
            runeMap={runeMap}
          />
        )}
      </div>
    </div>
  );
}

// ── 종합 스코어보드 ──────────────────────────────────────

function Scoreboard({
  players,
  win,
  label,
  region,
  version,
  names,
}: {
  players: DetailPlayer[];
  win: boolean;
  label: string;
  region: string;
  version: string;
  names: Record<string, string>;
}) {
  const maxDamage = Math.max(1, ...players.map((p) => p.damage ?? 0));

  return (
    <div className="min-w-0">
      <div
        className={`mb-1.5 flex items-center gap-2 text-[11px] font-semibold ${
          win ? "text-chart-1" : "text-destructive"
        }`}
      >
        {label} · {win ? "승리" : "패배"}
      </div>
      <div className="hidden grid-cols-[minmax(8rem,1.4fr)_5rem_minmax(4rem,1fr)_3rem_3rem_2.5rem_auto] items-center gap-2 px-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:grid">
        <span>플레이어</span>
        <span className="text-right">KDA</span>
        <span>딜량</span>
        <span className="text-right">골드</span>
        <span className="text-right">CS</span>
        <span className="text-right">시야</span>
        <span className="text-right">아이템</span>
      </div>
      <div className="space-y-0.5">
        {[...players].sort(byPosition).map((p, i) => {
          const ratio =
            p.deaths > 0 ? (p.kills + p.assists) / p.deaths : null;
          return (
            <div
              key={i}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded px-1.5 py-1 text-[11px] sm:grid-cols-[minmax(8rem,1.4fr)_5rem_minmax(4rem,1fr)_3rem_3rem_2.5rem_auto] ${
                p.self ? "bg-foreground/8" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="relative shrink-0">
                  <Image
                    src={championIconUrl(version, p.champ)}
                    alt={championNameKo(names, p.champ)}
                    width={24}
                    height={24}
                    unoptimized
                    className="size-6 rounded"
                  />
                  {p.level !== null && (
                    <span className="absolute -right-1 -bottom-1 rounded bg-background px-0.5 text-[8px] font-bold tabular-nums ring-1 ring-foreground/10">
                      {p.level}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col gap-px">
                  {p.spells.slice(0, 2).map((s, j) => {
                    const url = spellIconUrl(version, s);
                    return url ? (
                      <Image
                        key={j}
                        src={url}
                        alt=""
                        width={11}
                        height={11}
                        unoptimized
                        className="size-[11px] rounded-[2px]"
                      />
                    ) : (
                      <span
                        key={j}
                        className="size-[11px] rounded-[2px] bg-foreground/8"
                      />
                    );
                  })}
                </span>
                <Link
                  href={`/summoner/${region}/${encodeURIComponent(p.name)}`}
                  className={`truncate underline-offset-2 hover:underline ${
                    p.self ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {p.name.split("#")[0]}
                </Link>
                <PlayerBadge badge={p.badge} small />
                <RankAtGame rank={p.rank} />
              </span>
              <span className="text-right tabular-nums">
                {p.kills}/{p.deaths}/{p.assists}
                <span className="ml-1 text-muted-foreground">
                  {ratio === null ? "Perf" : ratio.toFixed(1)}
                </span>
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {p.damage !== null ? compact(p.damage) : "—"}
                </span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
                  <span
                    className={`block h-full rounded-full ${win ? "bg-chart-1" : "bg-destructive"}`}
                    style={{ width: `${((p.damage ?? 0) / maxDamage) * 100}%` }}
                  />
                </span>
              </span>
              <span className="hidden text-right tabular-nums text-muted-foreground sm:block">
                {p.gold !== null ? compact(p.gold) : "—"}
              </span>
              <span className="hidden text-right tabular-nums text-muted-foreground sm:block">
                {p.cs ?? "—"}
              </span>
              <span className="hidden text-right tabular-nums text-muted-foreground sm:block">
                {p.vision ?? "—"}
              </span>
              <span className="hidden justify-end gap-px sm:flex">
                {(p.items ?? []).slice(0, 6).map((id, j) => {
                  const url = id > 0 ? itemIconUrl(version, id) : null;
                  return url ? (
                    <Image
                      key={j}
                      src={url}
                      alt=""
                      width={16}
                      height={16}
                      unoptimized
                      className="size-4 rounded-[2px]"
                    />
                  ) : (
                    <span
                      key={j}
                      className="size-4 rounded-[2px] bg-foreground/6"
                    />
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 팀 분석 ──────────────────────────────────────────────

function TeamAnalysis({
  team,
  enemy,
  version,
}: {
  team: DetailPlayer[];
  enemy: DetailPlayer[];
  version: string;
}) {
  const metrics: {
    key: string;
    label: string;
    get: (p: DetailPlayer) => number;
  }[] = [
    { key: "kills", label: "챔피언 처치", get: (p) => p.kills },
    { key: "gold", label: "골드 획득량", get: (p) => p.gold ?? 0 },
    { key: "damage", label: "가한 피해량", get: (p) => p.damage ?? 0 },
    { key: "cs", label: "CS", get: (p) => p.cs ?? 0 },
    { key: "vision", label: "시야 점수", get: (p) => p.vision ?? 0 },
  ];

  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      {metrics.map((m) => {
        const mine = [...team].sort(byPosition);
        const theirs = [...enemy].sort(byPosition);
        const totalMine = mine.reduce((a, p) => a + m.get(p), 0);
        const totalTheirs = theirs.reduce((a, p) => a + m.get(p), 0);
        const max = Math.max(
          1,
          ...mine.map(m.get),
          ...theirs.map(m.get),
        );
        const share =
          totalMine + totalTheirs > 0
            ? (totalMine / (totalMine + totalTheirs)) * 100
            : 50;
        return (
          <div key={m.key}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium">{m.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-semibold text-chart-1">
                  {compact(totalMine)}
                </span>
                {" vs "}
                <span className="font-semibold text-destructive">
                  {compact(totalTheirs)}
                </span>
              </span>
            </div>
            <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-foreground/10">
              <span
                className="bg-chart-1"
                style={{ width: `${share}%` }}
              />
              <span
                className="bg-destructive"
                style={{ width: `${100 - share}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              {[mine, theirs].map((side, sideIdx) => (
                <div key={sideIdx} className="space-y-0.5">
                  {side.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Image
                        src={championIconUrl(version, p.champ)}
                        alt=""
                        width={14}
                        height={14}
                        unoptimized
                        className="size-3.5 rounded-[2px]"
                      />
                      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/8">
                        <span
                          className={`block h-full rounded-full ${
                            sideIdx === 0 ? "bg-chart-1/80" : "bg-destructive/80"
                          }`}
                          style={{ width: `${(m.get(p) / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-11 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                        {compact(m.get(p))}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 빌드 (아이템 타임라인 · 스킬 순서 · 룬) ──────────────

function BuildTab({
  matchId,
  region,
  riotId,
  version,
  keystone,
  subStyle,
  runeMap,
}: {
  matchId: string;
  region: string;
  riotId: string;
  version: string;
  keystone: number | null;
  subStyle: number | null;
  runeMap: Record<number, RuneInfo>;
}) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch("/api/match-timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region, matchId, riotId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: TimelineData) => !stop && setData(d))
      .catch(() => !stop && setError(true));
    return () => {
      stop = true;
    };
  }, [region, matchId, riotId]);

  if (error) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        빌드 정보를 불러오지 못했어요
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        빌드를 불러오는 중…
      </div>
    );
  }

  // 아이템: 분 단위로 묶는다 (판 것은 반투명 + 취소선 느낌)
  const groups: { minute: number; items: TimelineData["items"] }[] = [];
  for (const ev of data.items) {
    const last = groups[groups.length - 1];
    if (last && last.minute === ev.minute) last.items.push(ev);
    else groups.push({ minute: ev.minute, items: [ev] });
  }

  // 스킬 선마 순서: 슬롯별 5레벨 도달 순서 (R 제외)
  const priority: number[] = [];
  const counts: Record<number, number> = {};
  for (const s of data.skills) {
    counts[s] = (counts[s] ?? 0) + 1;
    if (s !== 4 && counts[s] === 5 && !priority.includes(s)) priority.push(s);
  }
  for (const s of [1, 2, 3]) {
    if (!priority.includes(s)) priority.push(s);
  }

  const keyRune = keystone !== null ? runeMap[keystone] : null;
  const subRune = subStyle !== null ? runeMap[subStyle] : null;

  return (
    <div className="space-y-4">
      <section>
        <SectionLabel>아이템 빌드</SectionLabel>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            아이템 구매 기록이 없어요
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
            {groups.map((g, gi) => (
              <div key={gi} className="flex items-end gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="flex gap-0.5 rounded-md border bg-card p-1">
                    {g.items.map((ev, i) => {
                      const url = itemIconUrl(version, ev.itemId);
                      return url ? (
                        <Image
                          key={i}
                          src={url}
                          alt=""
                          width={22}
                          height={22}
                          unoptimized
                          className={`size-[22px] rounded ${
                            ev.type === "sell" ? "opacity-35 grayscale" : ""
                          }`}
                          title={ev.type === "sell" ? "판매" : undefined}
                        />
                      ) : null;
                    })}
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {g.minute}분
                  </span>
                </div>
                {gi < groups.length - 1 && (
                  <ArrowRight className="mb-5 size-3 shrink-0 text-muted-foreground/50" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel>스킬 빌드</SectionLabel>
        {data.skills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            스킬 기록이 없어요
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {priority.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className={`flex size-6 items-center justify-center rounded ${SKILL_COLORS[s]}`}
                  >
                    {SKILL_KEYS[s]}
                  </span>
                  {i < priority.length - 1 && (
                    <ArrowRight className="size-3 text-muted-foreground/50" />
                  )}
                </span>
              ))}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                선마 순서
              </span>
            </div>
            <div className="flex flex-wrap gap-0.5">
              {data.skills.map((s, i) => (
                <span
                  key={i}
                  className={`flex size-5 items-center justify-center rounded text-[10px] font-semibold ${SKILL_COLORS[s]}`}
                  title={`${i + 1}레벨`}
                >
                  {SKILL_KEYS[s]}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <SectionLabel>룬</SectionLabel>
        {keyRune ? (
          <div className="flex items-center gap-2 text-xs">
            <Image
              src={`https://ddragon.leagueoflegends.com/cdn/img/${keyRune.icon}`}
              alt={keyRune.name}
              width={28}
              height={28}
              unoptimized
              className="size-7"
            />
            <span className="font-medium">{keyRune.name}</span>
            {subRune && (
              <>
                <span className="text-muted-foreground">+</span>
                <Image
                  src={`https://ddragon.leagueoflegends.com/cdn/img/${subRune.icon}`}
                  alt={subRune.name}
                  width={18}
                  height={18}
                  unoptimized
                  className="size-[18px] opacity-90"
                />
                <span className="text-muted-foreground">{subRune.name}</span>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            이 경기는 룬 저장 도입 전에 기록돼 룬 정보가 없어요 — 새 경기부터
            표시됩니다
          </p>
        )}
      </section>
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

function compact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}
