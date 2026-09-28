"use client";

import { useMemo, useState } from "react";
import { Copy, Crown, Loader2, Plus, Shuffle, Swords, Users, X } from "lucide-react";
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
import { defaultTeamCount, splitTeams, teamCountOptions } from "@/lib/team-split";

interface Player {
  input: string;
  name: string;
  points: number;
  label: string;
  tier: string;
  source: "analysis" | "rank" | "unranked";
  error?: string;
  /** 입력할 때 팀장으로 찍었는지 — 서로 다른 팀에 한 명씩 배치된다 */
  captain?: boolean;
}

const SOURCE_LABELS = {
  analysis: "매칭 구간",
  rank: "현재 랭크",
  unranked: "기본값",
} as const;

const MAX_PLAYERS = 20;
const MAX_COMBOS = 200;

const TEAM_STYLES = [
  { name: "블루팀", bar: "bg-blue-500", head: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  { name: "레드팀", bar: "bg-red-500", head: "bg-red-500/10 text-red-600 dark:text-red-400" },
  { name: "그린팀", bar: "bg-emerald-500", head: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { name: "퍼플팀", bar: "bg-violet-500", head: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
] as const;

// Tailwind 는 클래스명을 문자열로 조합하면 못 알아채므로 미리 적어 둔다
const TEAM_GRID: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

/** 순서를 한 번 섞은 새 배열 (Fisher-Yates) */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function TeamClient() {
  const [names, setNames] = useState<string[]>(["", ""]);
  const [captains, setCaptains] = useState<Set<number>>(new Set());
  const [pickedCount, setPickedCount] = useState<number | null>(null); // null = 자동
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [comboIndex, setComboIndex] = useState(0);

  const filled = names.filter((s) => s.trim()).length;
  const countOptions = teamCountOptions(filled);
  const teamCount =
    pickedCount && countOptions.includes(pickedCount) ? pickedCount : defaultTeamCount(filled);

  // players 로 메모해야 한다 — 파생 배열을 의존성에 두면 매 렌더 새 참조라 메모가 무효화된다
  const valid = useMemo(() => players.filter((p) => !p.error), [players]);
  const { k, result } = useMemo(() => {
    const n = valid.length;
    const opts = teamCountOptions(n);
    // 조회 실패로 인원이 바뀌면 고른 팀 수가 안 맞을 수 있다 — 그땐 기본값으로 되돌린다
    const use = pickedCount && opts.includes(pickedCount) ? pickedCount : defaultTeamCount(n);
    const caps = valid.map((p, i) => (p.captain ? i : -1)).filter((i) => i >= 0);
    return {
      k: use,
      result: splitTeams(valid.map((p) => p.points), use, caps, MAX_COMBOS),
    };
  }, [valid, pickedCount]);

  const combos = result.list;
  const current = combos[comboIndex % Math.max(combos.length, 1)];
  const sumOf = (idx: number[]) => idx.reduce((s, i) => s + valid[i].points, 0);

  function setName(i: number, v: string) {
    setNames((arr) => arr.map((n, idx) => (idx === i ? v : n)));
  }
  function addRow() {
    setNames((arr) => (arr.length >= MAX_PLAYERS ? arr : [...arr, ""]));
  }
  function removeRow(i: number) {
    setNames((arr) => (arr.length <= 2 ? arr : arr.filter((_, idx) => idx !== i)));
    // 뒤쪽 행이 한 칸씩 당겨지므로 팀장 표시도 같이 옮긴다
    setCaptains((set) => {
      const next = new Set<number>();
      for (const c of set) {
        if (c === i) continue;
        next.add(c > i ? c - 1 : c);
      }
      return next;
    });
  }
  function toggleCaptain(i: number) {
    setCaptains((set) => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function resolve() {
    const entries = names
      .map((s, i) => ({ name: s.trim(), captain: captains.has(i) }))
      .filter((e) => e.name);
    const list = entries.map((e) => e.name);
    if (list.length < 2) {
      toast.error("2명 이상 입력해 주세요 (게임명#태그)");
      return;
    }
    const opts = teamCountOptions(list.length);
    if (opts.length === 0) {
      toast.error(`${list.length}명은 팀이 딱 나뉘지 않아요 — 인원을 조정해 주세요`);
      return;
    }
    const useK = pickedCount && opts.includes(pickedCount) ? pickedCount : defaultTeamCount(list.length);
    const capCount = entries.filter((e) => e.captain).length;
    if (capCount > useK) {
      toast.error(`팀장은 ${useK}명까지예요 (${useK}팀이라 한 팀에 한 명씩)`);
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
      // 팀장 표시를 결과에 붙인 뒤 한 번 섞는다 — 안 섞으면 맨 위에 적은 사람이 늘 첫 팀에 뜬다
      // (팀장이 있으면 팀 순서는 팀장 입력 순을 따르므로 섞여도 그대로다)
      setPlayers(
        shuffled(data.players.map((p, i) => ({ ...p, captain: entries[i]?.captain ?? false }))),
      );
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
    const all = current.teams.reduce((s, t) => s + sumOf(t), 0);
    const text = current.teams
      .map((idx, t) => {
        const pct = all > 0 ? ((sumOf(idx) / all) * 100).toFixed(1) : "0.0";
        const body = idx
          .map((i) => `${valid[i].captain ? "👑 " : ""}${valid[i].name} (${valid[i].label})`)
          .join("\n");
        return `[${TEAM_STYLES[t].name}] ${pct}%\n${body}`;
      })
      .join("\n\n");
    navigator.clipboard
      .writeText(`${text}\n\n로비 평균 랭크 기준 · Rift Lens 팀 밸런서`)
      .then(() => toast.success("팀 구성을 복사했어요"))
      .catch(() => toast.error("복사에 실패했어요"));
  }

  const teamCard = (idx: number[], t: number) => {
    const sum = sumOf(idx);
    const avg = idx.length ? Math.round(sum / idx.length) : 0;
    const style = TEAM_STYLES[t];
    return (
      <div key={t} className="overflow-hidden rounded-xl border bg-card">
        <div className={`flex items-baseline justify-between px-4 py-2.5 ${style.head}`}>
          <span className="text-sm font-semibold">{style.name}</span>
          <span className="text-xs opacity-80">평균 {pointsToRank(avg).label}</span>
        </div>
        <div className="divide-y divide-border/60">
          {idx.map((i) => (
            <div
              key={valid[i].name}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {valid[i].captain ? (
                  <Crown className="size-3.5 shrink-0 text-amber-500" aria-label="팀장" />
                ) : (
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: TIER_COLORS[valid[i].tier] }}
                  />
                )}
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
            게임명#태그로 입력 (최대 {MAX_PLAYERS}명) · 왕관을 누르면 팀장이 되고, 팀장끼리는 서로
            다른 팀에 배치돼요 · 기준값은 저장된 매칭 구간(로비 평균 랭크) → 현재 랭크 순
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
                  onClick={() => toggleCaptain(i)}
                  aria-label={captains.has(i) ? "팀장 해제" : "팀장으로 지정"}
                  aria-pressed={captains.has(i)}
                  title="팀장으로 지정 (선택)"
                  className={`shrink-0 ${captains.has(i) ? "text-amber-500" : "text-muted-foreground/50"}`}
                >
                  <Crown className="size-4" />
                </Button>
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

          {countOptions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">팀 수</span>
              {countOptions.map((opt) => (
                <Button
                  key={opt}
                  variant={teamCount === opt ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPickedCount(opt)}
                >
                  {opt}팀 ({filled / opt}명씩)
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={names.length >= MAX_PLAYERS}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              인원 추가 ({names.length}/{MAX_PLAYERS})
            </Button>
            <Button size="sm" onClick={resolve} disabled={loading} className="gap-1.5">
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Swords className="size-3.5" />
              )}
              팀 나누기
            </Button>
            {filled >= 2 && countOptions.length === 0 && (
              <span className="self-center text-xs text-destructive">
                {filled}명은 팀이 딱 나뉘지 않아요
              </span>
            )}
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
          인원이 딱 나뉘게 입력하고 팀 나누기를 누르면, 전력차가 가장 작은 조합부터 순서대로
          보여드려요. 15명이면 3팀, 20명이면 2팀·4팀 중에 고를 수 있어요.
        </EmptyHint>
      )}

      {current && valid.length >= 2 && (
        <>
          {/* 전력 밸런스 — 팀 합계 비율을 그대로 폭으로 */}
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                전력 밸런스 <span className="text-xs font-normal text-muted-foreground">{k}팀</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                조합 {(comboIndex % combos.length) + 1} / {combos.length.toLocaleString()}
                <span className="ml-1 opacity-70">
                  {result.exact
                    ? result.total && result.total > combos.length
                      ? `(전력차 작은 순 · 전체 ${result.total.toLocaleString()}가지)`
                      : ""
                    : "(전력차 작은 순 · 근사 탐색)"}
                </span>
              </span>
            </div>
            {(() => {
              const sums = current.teams.map(sumOf);
              const all = sums.reduce((s, v) => s + v, 0);
              return (
                <div className="mt-2.5">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    {sums.map((s, t) => (
                      <div
                        key={t}
                        className={`${TEAM_STYLES[t].bar} transition-all duration-300`}
                        style={{ width: `${all > 0 ? (s / all) * 100 : 100 / sums.length}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] tabular-nums">
                    {sums.map((s, t) => (
                      <span key={t} className={TEAM_STYLES[t].head.split(" ").slice(1).join(" ")}>
                        {TEAM_STYLES[t].name} {all > 0 ? ((s / all) * 100).toFixed(1) : "0.0"}%
                      </span>
                    ))}
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
              <Button variant="outline" size="sm" onClick={copyTeams} className="gap-1.5">
                <Copy className="size-3.5" />
                복사
              </Button>
            </div>
          </div>

          <div className={`grid gap-4 ${TEAM_GRID[k] ?? "sm:grid-cols-2"}`}>
            {current.teams.map((idx, t) => teamCard(idx, t))}
          </div>

          <p className="text-xs text-muted-foreground">
            표시 없는 참가자는 저장된 매칭 구간(로비 평균 랭크) 기준이고, &quot;현재 랭크&quot;
            ·&quot;기본값&quot;은 분석 기록이 없어 대체한 값이에요.
            {!result.exact &&
              " 3팀 이상은 경우의 수가 너무 많아(20명 4팀 기준 4.9억 가지) 가장 균형 잡힌 조합을 근사로 찾아요."}
          </p>
        </>
      )}
    </div>
  );
}
