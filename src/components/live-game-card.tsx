"use client";

// 소환사 페이지 상단 "지금 게임 중" 카드 — 페이지 로드 뒤 /api/live-game 을 따로 불러
// 페이지 렌더를 늦추지 않는다. 게임 중이 아니면 아무것도 그리지 않는다.
import { useCallback, useEffect, useState } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TIER_COLORS } from "@/lib/mmr/rank";

interface LivePlayer {
  puuid: string;
  riotId: string | null;
  champion: { id: number; key: string | null; name: string; icon: string | null };
  rank: { tier: string; label: string } | null;
  estimated: { tier: string; label: string } | null;
  self: boolean;
}
interface LiveGame {
  inGame: boolean;
  queue?: string;
  startedAt?: number;
  lengthSec?: number;
  fetchedAt?: number;
  teams?: { teamId: number; players: LivePlayer[] }[];
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveGameCard({
  region,
  gameName,
  tagLine,
}: {
  region: string;
  gameName: string;
  tagLine: string;
}) {
  const [game, setGame] = useState<LiveGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ region, gameName, tagLine });
      const res = await fetch(`/api/live-game?${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      setGame((await res.json()) as LiveGame);
    } catch {
      // 조회 실패는 카드 생략
    } finally {
      setBusy(false);
    }
  }, [region, gameName, tagLine]);

  useEffect(() => {
    void load();
  }, [load]);

  // 경과 시간 틱 (게임 중일 때만)
  useEffect(() => {
    if (!game?.inGame) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [game?.inGame]);

  if (!game?.inGame || !game.teams) return null;

  const elapsedSec =
    game.startedAt && game.startedAt > 0
      ? Math.max(0, Math.floor((now - game.startedAt) / 1000))
      : Math.max(0, (game.lengthSec ?? 0) + Math.floor((now - (game.fetchedAt ?? now)) / 1000));
  const loading = !game.startedAt;

  return (
    <Card className="border-red-500/30 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            지금 게임 중
            <Badge variant="secondary" className="font-normal">
              {game.queue}
            </Badge>
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {loading ? "로딩 중" : `${fmtElapsed(elapsedSec)} 경과`}
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy} className="h-7 gap-1 px-2 text-xs">
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
        <CardDescription className="flex items-center gap-1.5">
          <Radio className="size-3.5" />
          같은 게임의 소환사 — 랭크는 최근 관측값, 매칭 구간은 Rift Lens에 등록된 소환사만 표시돼요
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {game.teams.map((team, i) => (
            <div key={team.teamId} className="space-y-1.5">
              <div className={`text-xs font-medium ${i === 0 ? "text-blue-400" : "text-red-400"}`}>
                {i === 0 ? "블루팀" : "레드팀"}
              </div>
              {team.players.map((p) => {
                const href = p.riotId
                  ? `/summoner/${region}/${encodeURIComponent(p.riotId)}`
                  : null;
                const name = p.riotId ?? "알 수 없음";
                return (
                  <div
                    key={p.puuid}
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                      p.self ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/40"
                    }`}
                  >
                    {p.champion.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.champion.icon}
                        alt={p.champion.name}
                        width={32}
                        height={32}
                        className="size-8 shrink-0 rounded-md"
                        loading="lazy"
                      />
                    ) : (
                      <div className="size-8 shrink-0 rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      {href ? (
                        <a href={href} className="block truncate text-sm font-medium hover:underline">
                          {name}
                        </a>
                      ) : (
                        <div className="truncate text-sm font-medium">{name}</div>
                      )}
                      <div className="truncate text-xs text-muted-foreground">{p.champion.name}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className="text-xs font-medium"
                        style={p.rank ? { color: TIER_COLORS[p.rank.tier] } : undefined}
                      >
                        {p.rank?.label ?? "—"}
                      </div>
                      {p.estimated && (
                        <div
                          className="text-[11px] text-muted-foreground"
                          title="Rift Lens 매칭 구간"
                          style={{ color: TIER_COLORS[p.estimated.tier] }}
                        >
                          구간 {p.estimated.label}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
