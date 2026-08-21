"use client";

// 실력대 분석에 사용된 경기 목록. 최근 전적(match-history)과 같은 시각 언어를
// 쓰되, 여기서는 "그 경기의 로비가 어느 실력대였는지"가 주인공이다.

import Image from "next/image";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tierEmblemUrl } from "@/lib/ddragon-assets";
import { TIER_COLORS } from "@/lib/mmr/rank";

export interface MatchRow {
  id: string;
  win: boolean;
  iconUrl: string | null;
  champName: string;
  kda: string;
  when: string;
  lobbyLabel: string | null; // "플래티넘 2 · 40LP"
  lobbyTier: string | null;
  sampleSize: number;
  suspectedDuo: boolean;
}

const COLLAPSED_COUNT = 5;

export function MatchList({ rows }: { rows: MatchRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hidden = rows.length - COLLAPSED_COUNT;

  return (
    <div>
      <div className="space-y-1.5">
        {visible.map((m) => (
          <div
            key={m.id}
            className={`flex items-center gap-3 rounded-xl border-l-4 px-3 py-2 transition-colors ${
              m.suspectedDuo
                ? "border-l-border bg-foreground/4 opacity-70"
                : m.win
                  ? "border-l-chart-1 bg-chart-1/8 hover:bg-chart-1/12"
                  : "border-l-destructive bg-destructive/8 hover:bg-destructive/12"
            }`}
          >
            <div className="relative shrink-0">
              {m.iconUrl ? (
                <Image
                  src={m.iconUrl}
                  alt={m.champName}
                  width={40}
                  height={40}
                  unoptimized
                  className="size-10 rounded-lg"
                />
              ) : (
                <div className="size-10 rounded-lg bg-muted" />
              )}
              <span
                className={`absolute -right-1.5 -bottom-1.5 flex size-4.5 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-card ${
                  m.win ? "bg-chart-1" : "bg-destructive"
                }`}
              >
                {m.win ? "승" : "패"}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {m.champName}
                </span>
                {m.suspectedDuo && (
                  <span className="shrink-0 rounded border px-1 py-px text-[10px] text-muted-foreground">
                    듀오 추정
                  </span>
                )}
              </div>
              <div className="text-xs tabular-nums text-muted-foreground">
                {m.kda} · {m.when}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-right">
              {m.suspectedDuo ? (
                <span className="text-xs text-muted-foreground">분석 제외</span>
              ) : m.lobbyLabel ? (
                <>
                  <div>
                    <div className="text-[10px] text-muted-foreground">
                      로비 평균
                    </div>
                    <div
                      className="text-sm font-semibold"
                      style={
                        m.lobbyTier
                          ? { color: TIER_COLORS[m.lobbyTier] }
                          : undefined
                      }
                    >
                      {m.lobbyLabel}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      표본 {m.sampleSize}명
                    </div>
                  </div>
                  {m.lobbyTier && (
                    <Image
                      src={tierEmblemUrl(m.lobbyTier)}
                      alt=""
                      width={40}
                      height={40}
                      unoptimized
                      className="size-9 shrink-0 object-contain drop-shadow-sm"
                    />
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">표본 없음</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 w-full text-muted-foreground"
        >
          {expanded ? "접기" : `더보기 (${hidden}경기)`}
          <ChevronDown
            className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </Button>
      )}
    </div>
  );
}
