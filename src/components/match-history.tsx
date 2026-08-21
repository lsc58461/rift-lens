"use client";

// 최근 전적 목록. 전적검색 사이트 관례를 따라 한 줄에
// [결과·시간] [챔피언·스펠] [KDA] [지표] [딜량] [아이템] [양 팀] 순으로 배치하고,
// 펼치면 10인 스코어보드를 보여준다.

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Swords } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  championIconUrl,
  championNameKo,
  itemIconUrl,
  spellIconUrl,
} from "@/lib/ddragon-assets";

interface Player {
  name: string;
  champ: string;
  position: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  damage: number | null;
  items: number[];
  self?: boolean;
}

interface Game {
  matchId: string;
  gameCreation: number;
  gameDuration: number;
  win: boolean;
  championName: string;
  champLevel: number | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  damage: number | null;
  gold: number | null;
  vision: number | null;
  position: string;
  spells: number[];
  items: number[];
  teamKills: number;
  maxDamage: number;
  team: Player[];
  enemy: Player[];
}

const POSITION_LABEL: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};

const POSITION_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function byPosition(a: Player, b: Player): number {
  const ia = POSITION_ORDER.indexOf(a.position);
  const ib = POSITION_ORDER.indexOf(b.position);
  return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 60) return `${Math.max(1, m)}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}일 전` : `${Math.floor(d / 30)}개월 전`;
}

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** KDA 평점은 구간별로 색을 달리해 한눈에 읽히게 한다 */
function kdaTone(ratio: number | null): string {
  if (ratio === null) return "text-chart-2"; // Perfect
  if (ratio >= 5) return "text-chart-2";
  if (ratio >= 3) return "text-primary";
  if (ratio >= 1.5) return "text-foreground";
  return "text-muted-foreground";
}

function ItemGrid({
  version,
  items,
  size = 24,
}: {
  version: string;
  items: number[];
  size?: number;
}) {
  // 앞 6칸은 아이템, 마지막 칸은 장신구
  return (
    <div className="grid grid-cols-4 gap-0.5">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const url = itemIconUrl(version, items[i] ?? 0);
        return url ? (
          <Image
            key={i}
            src={url}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="rounded"
            style={{ width: size, height: size }}
          />
        ) : (
          <div
            key={i}
            className="rounded bg-foreground/6"
            style={{ width: size, height: size }}
          />
        );
      })}
    </div>
  );
}

function TeamColumn({
  version,
  names,
  players,
}: {
  version: string;
  names: Record<string, string>;
  players: Player[];
}) {
  return (
    <div className="space-y-[3px]">
      {[...players].sort(byPosition).map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          <Image
            src={championIconUrl(version, p.champ)}
            alt={championNameKo(names, p.champ)}
            width={16}
            height={16}
            unoptimized
            className="size-4 shrink-0 rounded-sm"
          />
          <span
            className={`truncate text-[11px] leading-tight ${
              p.self ? "font-semibold text-foreground" : "text-muted-foreground"
            }`}
          >
            {p.name.split("#")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreboardSide({
  version,
  names,
  players,
  win,
  label,
}: {
  version: string;
  names: Record<string, string>;
  players: Player[];
  win: boolean;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`mb-1.5 text-[11px] font-semibold ${
          win ? "text-chart-1" : "text-destructive"
        }`}
      >
        {label} · {win ? "승리" : "패배"}
      </div>
      <div className="space-y-1">
        {[...players].sort(byPosition).map((p, i) => (
          <div
            key={i}
            className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded px-1.5 py-1 text-[11px] ${
              p.self ? "bg-foreground/8 font-medium" : ""
            }`}
          >
            <Image
              src={championIconUrl(version, p.champ)}
              alt={championNameKo(names, p.champ)}
              width={20}
              height={20}
              unoptimized
              className="size-5 rounded"
            />
            <span
              className={`truncate ${p.self ? "" : "text-muted-foreground"}`}
            >
              {p.name.split("#")[0]}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {p.kills}/{p.deaths}/{p.assists}
            </span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">
              {p.cs !== null ? `${p.cs} CS` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MatchHistory({
  region,
  riotId,
  ddVersion,
  champNames = {},
  bare = false,
}: {
  region: string;
  riotId: string;
  ddVersion: string;
  champNames?: Record<string, string>;
  /** 탭 안에 넣을 때처럼 바깥에서 Card를 감쌀 경우 자체 Card·헤더를 생략한다 */
  bare?: boolean;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region, riotId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { games: Game[] }) => !stop && setGames(d.games))
      .catch(() => !stop && setError(true));
    return () => {
      stop = true;
    };
  }, [region, riotId]);

  const body = (
    <>
      {games === null && !error && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-xl bg-foreground/5"
            />
          ))}
          <div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            전적을 불러오는 중…
          </div>
        </div>
      )}
      {error && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          전적을 불러오지 못했어요
        </p>
      )}
      {games?.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          최근 솔로랭크 기록이 없어요
        </p>
      )}

      <div className="space-y-2">
        {games?.map((g) => {
          const ratio = g.deaths > 0 ? (g.kills + g.assists) / g.deaths : null;
          const csPerMin =
            g.cs !== null ? (g.cs / (g.gameDuration / 60)).toFixed(1) : null;
          const kp =
            g.teamKills > 0
              ? Math.round(((g.kills + g.assists) / g.teamKills) * 100)
              : null;
          const dmgShare =
            g.damage !== null && g.maxDamage > 0
              ? Math.round((g.damage / g.maxDamage) * 100)
              : null;
          const open = expanded === g.matchId;

          return (
            <div
              key={g.matchId}
              className={`overflow-hidden rounded-xl border-l-4 transition-colors ${
                g.win
                  ? "border-l-chart-1 bg-chart-1/8 hover:bg-chart-1/12"
                  : "border-l-destructive bg-destructive/8 hover:bg-destructive/12"
              }`}
            >
              <div className="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">
                {/* 결과 · 시간 */}
                <div className="hidden w-16 shrink-0 sm:block">
                  <div
                    className={`text-sm font-bold ${
                      g.win ? "text-chart-1" : "text-destructive"
                    }`}
                  >
                    {g.win ? "승리" : "패배"}
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {mmss(g.gameDuration)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {timeAgo(g.gameCreation)}
                  </div>
                </div>

                <div className="hidden h-11 w-px shrink-0 bg-foreground/10 sm:block" />

                {/* 챔피언 + 스펠 */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="relative">
                    <Image
                      src={championIconUrl(ddVersion, g.championName)}
                      alt={championNameKo(champNames, g.championName)}
                      width={48}
                      height={48}
                      unoptimized
                      className="size-11 rounded-lg sm:size-12"
                    />
                    {g.champLevel !== null && (
                      <span className="absolute -bottom-1 -left-1 rounded bg-background px-1 text-[9px] font-bold tabular-nums shadow-sm ring-1 ring-foreground/10">
                        {g.champLevel}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {g.spells.map((s, i) => {
                      const url = spellIconUrl(ddVersion, s);
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
                        <div
                          key={i}
                          className="size-[22px] rounded bg-foreground/6"
                        />
                      );
                    })}
                  </div>
                </div>

                {/* KDA */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1 font-semibold tabular-nums">
                    <span className="text-base sm:text-lg">{g.kills}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-base text-destructive sm:text-lg">
                      {g.deaths}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-base sm:text-lg">{g.assists}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className={`font-semibold ${kdaTone(ratio)}`}>
                      {ratio === null ? "Perfect" : `${ratio.toFixed(2)} 평점`}
                    </span>
                    {kp !== null && <span>킬관여 {kp}%</span>}
                    <span className="sm:hidden">{timeAgo(g.gameCreation)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                    {POSITION_LABEL[g.position] && (
                      <span className="mr-1.5">
                        {POSITION_LABEL[g.position]}
                      </span>
                    )}
                    {csPerMin && `CS ${g.cs} (${csPerMin})`}
                    {g.vision !== null && ` · 시야 ${g.vision}`}
                  </div>
                </div>

                {/* 딜량 */}
                <div className="hidden w-24 shrink-0 lg:block">
                  <div className="text-[11px] tabular-nums">
                    딜 {g.damage !== null ? g.damage.toLocaleString() : "—"}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className={`h-full rounded-full ${
                        g.win ? "bg-chart-1" : "bg-destructive"
                      }`}
                      style={{ width: `${dmgShare ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    경기 최고 대비 {dmgShare ?? 0}%
                  </div>
                </div>

                {/* 아이템 */}
                <div className="hidden shrink-0 sm:block">
                  <ItemGrid version={ddVersion} items={g.items} />
                </div>

                {/* 양 팀 */}
                <div className="hidden w-52 shrink-0 grid-cols-2 gap-x-2 xl:grid">
                  <TeamColumn
                    version={ddVersion}
                    names={champNames}
                    players={g.team}
                  />
                  <TeamColumn
                    version={ddVersion}
                    names={champNames}
                    players={g.enemy}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : g.matchId)}
                  className="shrink-0 self-stretch rounded px-1 text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
                  aria-label={open ? "상세 접기" : "상세 보기"}
                  aria-expanded={open}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
              </div>

              {open && (
                <div className="grid gap-4 border-t bg-background/50 px-3 py-3 sm:grid-cols-2">
                  <ScoreboardSide
                    version={ddVersion}
                    names={champNames}
                    players={g.team}
                    win={g.win}
                    label="우리 팀"
                  />
                  <ScoreboardSide
                    version={ddVersion}
                    names={champNames}
                    players={g.enemy}
                    win={!g.win}
                    label="상대 팀"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  if (bare) return body;

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-500 fill-mode-backwards">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="size-4 text-primary" />
          최근 전적
        </CardTitle>
        <CardDescription>최근 솔로랭크 경기 기록</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
