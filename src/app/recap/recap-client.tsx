"use client";

import Image from "next/image";
import { championIconUrl, championNameKo } from "@/lib/ddragon-assets";

import { useState } from "react";
import { ImageDown, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EmptyHint, Stat } from "@/components/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SummonerAutocomplete } from "@/components/summoner-autocomplete";
import { TIER_COLORS } from "@/lib/mmr/rank";

interface Recap {
  name: string;
  totalRanked: number;
  totalCapped: boolean;
  analyzed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  topChamps: { championName: string; games: number; wins: number }[];
  peakRank: { tier: string; label: string } | null;
  currentRank: { tier: string; label: string } | null;
}

export function RecapClient({
  version,
  names,
}: {
  version: string;
  names: Record<string, string>;
}) {
  const [riotId, setRiotId] = useState("");
  const [loading, setLoading] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setRecap(null);
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: "kr", riotId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "조회에 실패했어요");
        return;
      }
      setRecap(data);
    } catch {
      toast.error("조회에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  const winrate =
    recap && recap.analyzed > 0
      ? Math.round((recap.wins / recap.analyzed) * 100)
      : null;
  const kda =
    recap && recap.deaths > 0
      ? ((recap.kills + recap.assists) / recap.deaths).toFixed(2)
      : recap && recap.analyzed > 0
        ? "∞"
        : null;
  const imageUrl = recap
    ? `/api/recap-image?region=kr&riotId=${encodeURIComponent(recap.name)}`
    : "";

  return (
    <div className="space-y-5">
      {/* overflow-visible: 자동완성 드롭다운이 카드 밖으로 나올 수 있게 */}
      <Card className="overflow-visible">
        <CardContent>
          <form onSubmit={load} className="flex gap-2">
            <SummonerAutocomplete
              value={riotId}
              onChange={setRiotId}
              placeholder="게임명#태그 (예: Hide on bush#KR1)"
            />
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              결산 보기
            </Button>
          </form>
        </CardContent>
      </Card>

      {!recap && !loading && (
        <EmptyHint icon={Sparkles} title="소환사를 입력하면 결산이 나와요">
          시즌 랭크 판수·승률·KDA·최다 챔피언을 모아 보여주고, 공유용 카드
          이미지로도 저장할 수 있어요.
        </EmptyHint>
      )}

      {recap && (
        <>
          {/* 히어로 — 이름과 관측 최고 랭크 */}
          <div className="rounded-xl border bg-card p-5 text-center">
            <div className="text-xs text-muted-foreground">
              시즌 랭크 {recap.totalRanked}
              {recap.totalCapped ? "+" : ""}판
            </div>
            <div className="mt-1 truncate text-2xl font-bold tracking-tight">
              {recap.name.split("#")[0]}
              <span className="font-normal text-muted-foreground">
                #{recap.name.split("#")[1]}
              </span>
            </div>
            {recap.peakRank && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  관측 최고
                </span>
                <span
                  className="font-semibold"
                  style={{ color: TIER_COLORS[recap.peakRank.tier] }}
                >
                  {recap.peakRank.label}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="시즌 랭크"
              value={`${recap.totalRanked}${recap.totalCapped ? "+" : ""}판`}
            />
            <Stat
              label="분석 승률"
              value={winrate !== null ? `${winrate}%` : "—"}
              tone={
                winrate === null
                  ? "default"
                  : winrate >= 50
                    ? "positive"
                    : "negative"
              }
              sub={`${recap.wins}승 ${recap.losses}패`}
            />
            <Stat label="KDA" value={kda ?? "—"} sub={`분석 ${recap.analyzed}경기`} />
            <Stat
              label="관측 최고 랭크"
              value={recap.peakRank?.label ?? "수집 중"}
              color={
                recap.peakRank ? TIER_COLORS[recap.peakRank.tier] : undefined
              }
            />
          </div>

          {recap.topChamps.length > 0 && (
            <Card>
              <CardContent className="space-y-2.5">
                <div className="text-xs text-muted-foreground">
                  최다 플레이 챔피언
                </div>
                {recap.topChamps.map((c) => {
                  const max = recap.topChamps[0].games || 1;
                  const wr = Math.round((c.wins / c.games) * 100);
                  return (
                    <div key={c.championName}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-1.5 font-medium">
                          <Image
                            src={championIconUrl(version, c.championName)}
                            alt=""
                            width={20}
                            height={20}
                            unoptimized
                            className="size-5 rounded"
                          />
                          <span className="truncate">
                            {championNameKo(names, c.championName)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {c.games}판 ·{" "}
                          <span
                            className={
                              wr >= 50 ? "text-emerald-500" : "text-red-500"
                            }
                          >
                            {wr}%
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(c.games / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ImageDown className="size-4" />
              결산 카드 이미지로 보기
            </a>
            <p className="text-xs text-muted-foreground">
              상세 통계는 저장된 분석 경기 기준 — 검색이 쌓일수록 정확해져요
            </p>
          </div>
        </>
      )}
    </div>
  );
}
