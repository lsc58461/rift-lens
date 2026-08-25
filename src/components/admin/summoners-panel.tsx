"use client";

// 기록된 소환사 목록. 목록이 커져도 화면이 무거워지지 않도록 검색·필터·페이징을
// 모두 서버에서 처리하고, 브라우저로는 한 페이지 분량만 받는다.

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ANALYSIS_BADGES,
  fetchSummonerPage,
  timeAgo,
  type AnalysisState,
  type SummonerPage,
} from "./types";
import { EmptyState, PageHeader } from "./ui";

const FILTERS: { key: "all" | AnalysisState; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "deep", label: "정밀 · 최신" },
  { key: "deep-stale", label: "정밀 · 스테일" },
  { key: "quick", label: "빠른 분석" },
  { key: "quick-stale", label: "빠른 · 스테일" },
  { key: "none", label: "캐시 만료" },
];

const PAGE_SIZE = 50;

export function SummonersPanel() {
  const [data, setData] = useState<SummonerPage | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filter, setFilter] = useState<"all" | AnalysisState>("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);

  // 검색은 타이핑이 멈춘 뒤에 보낸다
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  // 검색어·필터가 바뀌면 첫 페이지로
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filter]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await fetchSummonerPage({
        page,
        size: PAGE_SIZE,
        q: debouncedQ,
        filter,
      });
      if (d) setData(d);
    } catch {
      // 무시 — 새로고침 버튼으로 재시도
    } finally {
      setBusy(false);
    }
  }, [page, debouncedQ, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-5">
      <PageHeader
        title="기록된 소환사"
        description="스테일 = 매치 기준 불일치, 구버전 알고리즘 또는 분석 후 72시간 경과 · '최신'이어도 분석 이후 새 경기가 있으면 전체 갱신이 다시 분석해요 (새 경기 여부는 라이엇 조회가 필요해 이 목록에선 판정하지 않음)"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={busy}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="소환사 검색"
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {total}명 중 {from}–{to} · 전체 {data?.totalAll ?? 0}명
        </span>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => {
          const n =
            f.key === "all"
              ? Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)
              : (data?.counts?.[f.key] ?? 0);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {f.label}
              <span className="tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          <div className="hidden items-center gap-3 border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
            <span className="flex-1">소환사</span>
            <span className="w-24 shrink-0">상태</span>
            <span className="w-40 shrink-0 text-right">현재 → 매칭 구간</span>
            <span className="w-16 shrink-0 text-right">검색</span>
          </div>
          <div className="divide-y divide-border/60">
            {items.map((r) => (
              <div
                key={`${r.region}:${r.name}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:flex-nowrap"
              >
                <a
                  href={`/summoner/${r.region}/${encodeURIComponent(r.name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-1.5 font-medium"
                >
                  <span className="truncate underline-offset-4 group-hover:underline">
                    {r.name}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
                <span className="sm:w-24 sm:shrink-0">
                  <Badge
                    variant={ANALYSIS_BADGES[r.analysis].variant}
                    className="text-[10px]"
                  >
                    {ANALYSIS_BADGES[r.analysis].label}
                  </Badge>
                </span>
                <span className="truncate text-xs text-muted-foreground sm:w-40 sm:shrink-0 sm:text-right">
                  {r.currentLabel ?? "언랭"} → {r.estimatedLabel ?? "?"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground sm:w-16 sm:text-right">
                  {timeAgo(r.searchedAt)}
                </span>
              </div>
            ))}
            {items.length === 0 && (
              <EmptyState icon={Users}>
                {busy ? "불러오는 중…" : "조건에 맞는 소환사가 없어요"}
              </EmptyState>
            )}
          </div>
        </CardContent>
      </Card>

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || busy}
            className="gap-1"
          >
            <ChevronLeft className="size-3.5" />
            이전
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {page} / {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage || busy}
            className="gap-1"
          >
            다음
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
