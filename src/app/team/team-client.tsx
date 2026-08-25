"use client";

import { useMemo, useState } from "react";
import { Copy, Loader2, Plus, Shuffle, Swords, Users, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyHint } from "@/components/page-kit";
import { SummonerAutocomplete } from "@/components/summoner-autocomplete";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TIER_COLORS, pointsToRank } from "@/lib/mmr/rank";

interface Player {
  input: string;
  name: string;
  points: number;
  label: string;
  tier: string;
  source: "analysis" | "rank" | "unranked";
  error?: string;
}

const SOURCE_LABELS = {
  analysis: "매칭 구간",
  rank: "현재 랭크",
  unranked: "기본값",
} as const;

/** n명의 인덱스를 절반으로 나누는 모든 조합을 팀 점수차 오름차순으로 반환 */
function partitions(players: Player[]): { a: number[]; b: number[]; diff: number }[] {
  const n = players.length;
  const half = Math.floor(n / 2);
  const result: { a: number[]; b: number[]; diff: number }[] = [];
  const seen = new Set<string>();

  const combo = (start: number, picked: number[]) => {
    if (picked.length === half) {
      // 첫 플레이어 고정으로 대칭 중복 제거
      if (n % 2 === 0 && !picked.includes(0)) return;
      const a = picked;
      const b = [...Array(n).keys()].filter((i) => !picked.includes(i));
      const key = a.join(",");
      if (seen.has(key)) return;
      seen.add(key);
      const sumA = a.reduce((s, i) => s + players[i].points, 0);
      const sumB = b.reduce((s, i) => s + players[i].points, 0);
      result.push({ a, b, diff: Math.abs(sumA - sumB) });
      return;
    }
    for (let i = start; i < n; i++) combo(i + 1, [...picked, i]);
  };
  combo(0, []);
  return result.sort((x, y) => x.diff - y.diff);
}

export function TeamClient() {
  const [names, setNames] = useState<string[]>(["", ""]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [comboIndex, setComboIndex] = useState(0);

  const valid = players.filter((p) => !p.error);
  const combos = useMemo(() => partitions(valid), [valid]);
  const current = combos[comboIndex % Math.max(combos.length, 1)];

  function setName(i: number, v: string) {
    setNames((arr) => arr.map((n, idx) => (idx === i ? v : n)));
  }
  function addRow() {
    setNames((arr) => (arr.length >= 10 ? arr : [...arr, ""]));
  }
  function removeRow(i: number) {
    setNames((arr) => (arr.length <= 2 ? arr : arr.filter((_, idx) => idx !== i)));
  }

  async function resolve() {
    const list = names.map((s) => s.trim()).filter(Boolean);
    if (list.length < 2) {
      toast.error("2명 이상 입력해 주세요 (게임명#태그)");
      return;
    }
    if (list.length % 2 !== 0) {
      toast.error("짝수 인원만 팀을 나눌 수 있어요");
      return;
    }
    if (new Set(list.map((s) => s.toLowerCase())).size !== list.length) {
      toast.error("중복된 소환사가 있어요");
      return;
    }
    setLoading(true);
    setComboIndex(0);
    try {
      const res = await fetch("/api/team/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: "kr", names: list }),
      });
      if (!res.ok) throw new Error();
      const data: { players: Player[] } = await res.json();
      setPlayers(data.players);
      const failed = data.players.filter((p) => p.error);
      if (failed.length) {
        toast.warning(`${failed.length}명 조회 실패 — 목록에서 확인해 주세요`);
      }
    } catch {
      toast.error("조회에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  function copyTeams() {
    if (!current) return;
    const line = (idx: number[]) =>
      idx.map((i) => `${valid[i].name} (${valid[i].label})`).join("\n");
    const sumA = current.a.reduce((s, i) => s + valid[i].points, 0);
    const sumB = current.b.reduce((s, i) => s + valid[i].points, 0);
    const pctA = sumA + sumB > 0 ? ((sumA / (sumA + sumB)) * 100).toFixed(1) : "50.0";
    navigator.clipboard
      .writeText(
        `[블루팀] ${pctA}%\n${line(current.a)}\n\n[레드팀] ${(100 - Number(pctA)).toFixed(1)}%\n${line(current.b)}\n\n로비 평균 랭크 기준 · Rift Lens 팀 밸런서`,
      )
      .then(() => toast.success("팀 구성을 복사했어요"))
      .catch(() => toast.error("복사에 실패했어요"));
  }

  const teamCard = (title: string, idx: number[], tone: "blue" | "red") => {
    const sum = idx.reduce((s, i) => s + valid[i].points, 0);
    const avg = idx.length ? Math.round(sum / idx.length) : 0;
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <div
          className={`flex items-baseline justify-between px-4 py-2.5 ${
            tone === "blue"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs opacity-80">
            평균 {pointsToRank(avg).label}
          </span>
        </div>
        <div className="divide-y divide-border/60">
          {idx.map((i) => (
            <div
              key={valid[i].name}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: TIER_COLORS[valid[i].tier] }}
                />
                <span className="truncate font-medium">{valid[i].name}</span>
                {valid[i].source !== "analysis" && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {SOURCE_LABELS[valid[i].source]}
                  </span>
                )}
              </span>
              <span
                className="shrink-0 text-xs"
                style={{ color: TIER_COLORS[valid[i].tier] }}
              >
                {valid[i].label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* overflow-visible: 자동완성 드롭다운이 카드 밖으로 나올 수 있게 */}
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" />
            참가자 입력
          </CardTitle>
          <CardDescription>
            게임명#태그로 입력 (2·4·6·8·10명) · 기준값은 저장된 매칭 구간(로비 평균 랭크) →
            현재 랭크 순으로 사용해요
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <SummonerAutocomplete
                  value={n}
                  onChange={(v) => setName(i, v)}
                  placeholder={`참가자 ${i + 1} (게임명#태그)`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(i)}
                  disabled={names.length <= 2}
                  aria-label="참가자 제거"
                  className="shrink-0"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={names.length >= 10}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              인원 추가 ({names.length}/10)
            </Button>
            <Button size="sm" onClick={resolve} disabled={loading} className="gap-1.5">
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Swords className="size-3.5" />
              )}
              팀 나누기
            </Button>
          </div>
        </CardContent>
      </Card>

      {players.some((p) => p.error) && (
        <Card>
          <CardContent className="space-y-1 text-sm text-destructive">
            {players
              .filter((p) => p.error)
              .map((p) => (
                <div key={p.input}>
                  {p.input} — {p.error}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {!current && !loading && (
        <EmptyHint icon={Swords} title="참가자를 입력하면 팀이 여기에 나와요">
          짝수 인원(2·4·6·8·10명)으로 입력하고 팀 나누기를 누르면, 전력차가 가장
          작은 조합부터 순서대로 보여드려요.
        </EmptyHint>
      )}

      {current && valid.length >= 2 && (
        <>
          {/* 전력 밸런스 — 두 팀 합계의 비율을 그대로 폭으로 */}
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">전력 밸런스</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                조합 {(comboIndex % combos.length) + 1} / {combos.length}
              </span>
            </div>
            {(() => {
              const sumA = current.a.reduce((s, i) => s + valid[i].points, 0);
              const sumB = current.b.reduce((s, i) => s + valid[i].points, 0);
              const pct = sumA + sumB > 0 ? (sumA / (sumA + sumB)) * 100 : 50;
              return (
                <div className="mt-2.5">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-blue-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="flex-1 bg-red-500 transition-all duration-300" />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] tabular-nums">
                    <span className="text-blue-600 dark:text-blue-400">
                      블루 {pct.toFixed(1)}%
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      {(100 - pct).toFixed(1)}% 레드
                    </span>
                  </div>
                </div>
              );
            })()}
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComboIndex((i) => i + 1)}
                disabled={combos.length <= 1}
                className="gap-1.5"
              >
                <Shuffle className="size-3.5" />
                다른 조합
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyTeams}
                className="gap-1.5"
              >
                <Copy className="size-3.5" />
                복사
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {teamCard("블루팀", current.a, "blue")}
            {teamCard("레드팀", current.b, "red")}
          </div>

          <p className="text-xs text-muted-foreground">
            표시 없는 참가자는 저장된 매칭 구간(로비 평균 랭크) 기준이고, &quot;현재 랭크&quot;
            ·&quot;기본값&quot;은 분석 기록이 없어 대체한 값이에요.
          </p>
        </>
      )}
    </div>
  );
}
