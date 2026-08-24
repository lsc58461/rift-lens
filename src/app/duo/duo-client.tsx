"use client";

import { useState } from "react";
import { Heart, Loader2, Search, Swords } from "lucide-react";
import { toast } from "sonner";
import { EmptyHint, Stat } from "@/components/page-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SummonerAutocomplete } from "@/components/summoner-autocomplete";

interface DuoResult {
  a: { name: string };
  b: { name: string };
  totalCommon: number;
  together: { games: number; wins: number };
  versus: { games: number; aWins: number };
  games: {
    matchId: string;
    gameCreation: number;
    sameTeam: boolean;
    win: boolean;
    champA: string;
    champB: string;
  }[];
}

function timeAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return "오늘";
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

function verdict(games: number, wins: number): {
  text: string;
  cls: string;
} {
  const rate = (wins / games) * 100;
  if (rate >= 60)
    return {
      text: "환상의 듀오예요! 같이 하면 이깁니다 💙",
      cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    };
  if (rate >= 50)
    return {
      text: "안정적인 조합이에요 — 같이 해도 좋아요",
      cls: "border-primary/30 bg-primary/10 text-primary",
    };
  if (rate >= 40)
    return {
      text: "미묘한 궁합… 컨디션 좋은 날만 같이 하세요",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    };
  return {
    text: "이 조합은 위험해요. 각자 솔로큐가 나을지도…",
    cls: "border-destructive/30 bg-destructive/10 text-destructive",
  };
}

export function DuoClient() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DuoResult | null>(null);

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/duo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: "kr", a, b }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "조회에 실패했어요");
        return;
      }
      setResult(data);
      if (data.totalCommon === 0) {
        toast.info("최근 100경기 안에서 함께한 기록이 없어요");
      }
    } catch {
      toast.error("조회에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  const t = result?.together;
  const winrate = t && t.games > 0 ? Math.round((t.wins / t.games) * 100) : null;

  return (
    <div className="space-y-5">
      {/* overflow-visible: 자동완성 드롭다운이 카드 밖으로 나올 수 있게 */}
      <Card className="overflow-visible">
        <CardContent>
          <form onSubmit={analyze} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SummonerAutocomplete
                value={a}
                onChange={setA}
                placeholder="첫 번째 소환사 (게임명#태그)"
              />
              <SummonerAutocomplete
                value={b}
                onChange={setB}
                placeholder="두 번째 소환사 (게임명#태그)"
              />
            </div>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              궁합 분석
            </Button>
          </form>
        </CardContent>
      </Card>

      {!result && !loading && (
        <EmptyHint icon={Heart} title="두 소환사를 입력하면 궁합이 나와요">
          최근 100경기 안에서 함께 잡힌 판을 찾아 같은 팀 승률과 맞대결 전적을
          계산합니다.
        </EmptyHint>
      )}

      {result && (
        <>
          {/* 두 사람 — VS 카드: 이름을 크게, 가운데 하트 타일 */}
          <div className="relative overflow-hidden rounded-2xl border bg-card p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-rose-500/10 to-transparent"
            />
            <div className="relative flex items-center justify-center gap-4">
              <span className="min-w-0 flex-1 truncate text-right text-base font-bold tracking-tight sm:text-lg">
                {result.a.name.split("#")[0]}
              </span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/25">
                <Heart className="size-5 text-rose-500 dark:text-rose-400" />
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-bold tracking-tight sm:text-lg">
                {result.b.name.split("#")[0]}
              </span>
            </div>
            {winrate !== null && t ? (
              <>
                <div className="mt-4 text-center">
                  <div
                    className={`text-4xl font-bold tabular-nums ${
                      winrate >= 50 ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {winrate}%
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    함께 {t.games}판 · {t.wins}승 {t.games - t.wins}패
                  </div>
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${winrate}%` }}
                  />
                  <div className="flex-1 bg-red-500/70" />
                </div>
              </>
            ) : (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                최근 100경기 안에서 같은 팀으로 만난 기록이 없어요
              </p>
            )}
          </div>

          {t && t.games > 0 && (
            <div
              className={`rounded-xl border px-4 py-3 text-center text-sm font-medium ${verdict(t.games, t.wins).cls}`}
            >
              {verdict(t.games, t.wins).text}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              icon={Heart}
              label="함께 플레이"
              value={`${t?.games ?? 0}판`}
              sub={t && t.games > 0 ? `${t.wins}승 ${t.games - t.wins}패` : undefined}
            />
            <Stat
              icon={Swords}
              label="맞대결"
              value={`${result.versus.games}판`}
              sub={
                result.versus.games > 0
                  ? `${result.a.name.split("#")[0]} ${result.versus.aWins}승`
                  : undefined
              }
            />
            <Stat
              label="교집합 경기"
              value={`${result.totalCommon}건`}
              sub="최근 100경기 기준"
            />
          </div>

          {result.games.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">함께 잡힌 경기</CardTitle>
                <CardDescription>
                  최근 100경기 교집합 {result.totalCommon}건 중{" "}
                  {result.games.length}건 표시
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                {result.games.map((g) => (
                  <div
                    key={g.matchId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Badge
                        variant={g.sameTeam ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {g.sameTeam ? "같은 팀" : "맞대결"}
                      </Badge>
                      <span
                        className={`text-xs font-semibold ${
                          g.win ? "text-chart-1" : "text-destructive"
                        }`}
                      >
                        {g.sameTeam
                          ? g.win
                            ? "승리"
                            : "패배"
                          : g.win
                            ? `${result.a.name.split("#")[0]} 승`
                            : `${result.b.name.split("#")[0]} 승`}
                      </span>
                      <span className="text-muted-foreground">
                        {g.champA} · {g.champB}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(g.gameCreation)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
