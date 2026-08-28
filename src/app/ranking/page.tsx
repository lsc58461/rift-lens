import Link from "next/link";
import { Crown, Flame, Sparkles, Trophy } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  APEX_LADDER_TIERS,
  getApexCutoffs,
  getApexLadder,
  type ApexLadderTier,
} from "@/lib/apex-ladder";
import { TIER_COLORS, TIER_LABELS } from "@/lib/mmr/rank";
import { Pager, parsePage } from "@/components/pager";

const PAGE_SIZE = 50;

export const revalidate = 120; // 래더는 30분마다 갱신되므로 2분 ISR이면 충분

export const metadata = {
  title: "랭킹",
  description: "한국 서버 챌린저·그랜드마스터 솔로랭크 랭킹과 승급 컷",
};

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; page?: string }>;
}) {
  const { tier: rawTier, page: rawPage } = await searchParams;
  const tier: ApexLadderTier = rawTier === "GRANDMASTER" ? "GRANDMASTER" : "CHALLENGER";
  const [{ rows, fetchedAt }, cutoffs] = await Promise.all([
    getApexLadder(tier).catch(() => ({ rows: [], fetchedAt: null })),
    getApexCutoffs().catch(() => null),
  ]);
  const color = TIER_COLORS[tier];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = parsePage(rawPage, totalPages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagerQuery = { tier: tier === "CHALLENGER" ? undefined : tier };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Trophy}
        title="랭킹"
        description={`한국 서버 솔로랭크 상위 래더${fetchedAt ? ` · ${timeAgo(fetchedAt)} 갱신` : ""}`}
      />

      {/* 컷 */}
      {cutoffs && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["CHALLENGER", cutoffs.challenger, cutoffs.counts.challenger],
              ["GRANDMASTER", cutoffs.grandmaster, cutoffs.counts.grandmaster],
            ] as const
          ).map(([t, cut, n]) => (
            <div key={t} className="flex items-center gap-3 rounded-xl border bg-card p-4">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${TIER_COLORS[t]}22`, color: TIER_COLORS[t] }}
              >
                <Crown className="size-4.5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{TIER_LABELS[t]} 컷</div>
                <div className="text-lg font-bold tabular-nums" style={{ color: TIER_COLORS[t] }}>
                  {cut.toLocaleString()}LP
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {n.toLocaleString()}명
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 티어 탭 */}
      <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
        {APEX_LADDER_TIERS.map((t) => (
          <Link
            key={t}
            href={t === "CHALLENGER" ? "/ranking" : `/ranking?tier=${t}`}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              tier === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {TIER_LABELS[t]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            아직 래더를 받아오지 못했어요. 잠시 후 다시 확인해 주세요.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="hidden items-center gap-3 border-b px-3 py-2.5 sm:px-4 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
              <span className="w-8 shrink-0 text-right">#</span>
              <span className="flex-1">소환사</span>
              <span className="w-20 shrink-0 text-right">LP</span>
              <span className="w-28 shrink-0 text-right">승 / 패</span>
              <span className="w-14 shrink-0 text-right">승률</span>
            </div>
            <div className="divide-y divide-border/60">
              {pageRows.map((r) => {
                const games = r.wins + r.losses;
                const wr = games > 0 ? Math.round((r.wins / games) * 100) : 0;
                const label = r.name ?? null;
                return (
                  <div
                    key={r.puuid}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:px-4 transition-colors hover:bg-muted/40 sm:flex-nowrap"
                  >
                    <span
                      className="w-8 shrink-0 text-right font-semibold tabular-nums"
                      style={r.rankNo <= 3 ? { color } : undefined}
                    >
                      {r.rankNo}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 sm:flex-1">
                      {label ? (
                        <Link
                          href={`/summoner/kr/${encodeURIComponent(label)}`}
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {label.split("#")[0]}
                          <span className="font-normal text-muted-foreground">#{label.split("#")[1]}</span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">이름 확인 중…</span>
                      )}
                      {r.hotStreak && (
                        <Badge variant="secondary" className="gap-0.5 px-1.5 text-[10px] font-normal">
                          <Flame className="size-3 text-orange-500" />
                          연승
                        </Badge>
                      )}
                      {r.freshBlood && (
                        <Badge variant="outline" className="gap-0.5 px-1.5 text-[10px] font-normal">
                          <Sparkles className="size-3" />
                          신규
                        </Badge>
                      )}
                    </span>
                    {/* 모바일: 2줄째를 고정 폭 없이 한 줄로 — LP · 승패, 승률은 오른쪽 끝 */}
                    <span className="flex w-full items-baseline gap-2 pl-11 text-xs sm:hidden">
                      <span className="text-sm font-semibold tabular-nums" style={{ color }}>
                        {r.lp.toLocaleString()}
                        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">LP</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {r.wins}승 {r.losses}패
                      </span>
                      <span className="ml-auto tabular-nums">
                        <span className="text-muted-foreground">승률 </span>
                        {wr}%
                      </span>
                    </span>
                    {/* sm+: 헤더와 같은 고정 폭 컬럼 */}
                    <span className="hidden items-center gap-3 sm:flex">
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums" style={{ color }}>
                        {r.lp.toLocaleString()}
                      </span>
                      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {r.wins}승 {r.losses}패
                      </span>
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums">{wr}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Pager page={page} totalPages={totalPages} basePath="/ranking" query={pagerQuery} />

      <p className="text-xs text-muted-foreground">
        라이엇 공식 리그 목록 기준(30분마다 갱신). 컷은 각 티어 명단의 최소 LP예요. 이름은
        확인되는 대로 채워집니다.
      </p>
    </div>
  );
}
