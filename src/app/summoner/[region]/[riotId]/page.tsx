import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Minus,
  SearchX,
  TrendingUp,
  Users,
} from "lucide-react";
import { DeepRefine } from "@/components/deep-refine";
import {
  HistorySummaryProvider,
  MatchSummaryCard,
} from "@/components/history-summary";
import { LobbyDistribution } from "@/components/lobby-distribution";
import { type MatchRow } from "@/components/match-list";
import { MatchTabs } from "@/components/match-tabs";
import { MmrChart, type MmrChartPoint } from "@/components/mmr-chart";
import { SearchForm } from "@/components/search-form";
import { ShareButton } from "@/components/share-button";
import { Badge } from "@/components/ui/badge";
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
  getChampionNamesKo,
  getRuneMapKo,
  getDDragonVersion,
  profileIconUrl,
  tierEmblemUrl,
} from "@/lib/ddragon";
import { StaleRefresh } from "@/components/stale-refresh";
import {
  getFreshDeepResult,
  getFreshQuickResult,
  getLatestMatchId,
  getStoredResult,
  runQuickAnalysis,
} from "@/lib/mmr/deep-jobs";
import { pointsToRank, TIER_COLORS } from "@/lib/mmr/rank";
import {
  computeLpInsight,
  hasLpSignal,
  lpVerdict,
  type LpInsight,
} from "@/lib/mmr/lp-insight";
import { recordSearch } from "@/lib/recent";
import { resolveRenameTarget } from "@/lib/rename";
import {
  getAccountByPuuid,
  getAccountByRiotId,
  getLeagueHistory,
  getSummoner,
  riotKeyFp,
} from "@/lib/riot/client";
import {
  findPuuidByOldName,
  findRenamedTo,
  logVisit,
  recordNameChange,
} from "@/lib/store";
import {
  RiotApiError,
  PLATFORM_LABELS,
  type PlatformRegion,
} from "@/lib/riot/types";

export const dynamic = "force-dynamic";
// 콜드 검색 시 빠른 추정이 레이트리밋 대기까지 수십 초 걸릴 수 있다 (Vercel 함수 제한 대비)
export const maxDuration = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ region: string; riotId: string }>;
}) {
  const { region, riotId } = await params;
  const decoded = decodeURIComponent(riotId);
  const title = `${decoded} 숨은 실력대`;
  const description = `${decoded}의 숨은 실력대 — 최근 솔로랭크 경기 로비 랭크 역추적 기반 추정치를 확인해 보세요.`;
  const image = `/api/share-image?region=${region}&riotId=${encodeURIComponent(decoded)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

const CONFIDENCE_LABELS = {
  high: "신뢰도 높음",
  medium: "신뢰도 보통",
  low: "신뢰도 낮음",
} as const;

function gapVerdict(gap: number): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (gap >= 150)
    return {
      text: "티어보다 훨씬 높은 실력대에서 매칭되고 있어요. 곧 티어가 따라 올라갈 거예요.",
      tone: "up",
    };
  if (gap >= 50)
    return {
      text: "티어보다 한 단계 높은 매칭이에요. LP를 잘 받고 있을 거예요.",
      tone: "up",
    };
  if (gap <= -150)
    return {
      text: "현재 티어보다 낮은 실력대에서 매칭되고 있어요. LP 효율이 나쁠 수 있어요.",
      tone: "down",
    };
  if (gap <= -50)
    return { text: "티어보다 약간 낮은 매칭이에요.", tone: "down" };
  return { text: "티어와 실제 실력대가 잘 맞아떨어져요.", tone: "flat" };
}

function timeAgo(ts: number): string {
  const hours = Math.floor((Date.now() - ts) / 3_600_000);
  if (hours < 1) return "방금 전";
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

function WinrateRing({ pct, games }: { pct: number; games: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <div className="relative size-13">
        <svg viewBox="0 0 48 48" className="size-full -rotate-90">
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            strokeWidth="5"
            className="stroke-muted"
          />
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            stroke="var(--chart-1)"
            strokeDasharray={`${c * pct} ${c}`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
          {Math.round(pct * 100)}%
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">최근 {games}판</span>
    </div>
  );
}

function ErrorCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <SearchForm compact />
      <Link
        href="/"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}

export default async function SummonerPage({
  params,
  searchParams,
}: {
  params: Promise<{ region: string; riotId: string }>;
  searchParams: Promise<{ renamed?: string }>;
}) {
  const { region, riotId } = await params;
  const { renamed } = await searchParams;
  if (!(region in PLATFORM_LABELS)) {
    return (
      <ErrorCard
        title="지원하지 않는 지역이에요"
        description="지역을 다시 선택해 주세요."
      />
    );
  }
  // NFKC 정규화 — 전각(ＫR1)/반각(KR1) 등이 다른 소환사로 취급되는 것 방지
  const decoded = decodeURIComponent(riotId).normalize("NFKC");
  const hashIndex = decoded.lastIndexOf("#");
  if (hashIndex <= 0) {
    return (
      <ErrorCard
        title="잘못된 검색 형식이에요"
        description="게임명#태그 형식으로 검색해 주세요. (예: Hide on bush#KR1)"
      />
    );
  }
  const gameName = decoded.slice(0, hashIndex);
  const tagLine = decoded.slice(hashIndex + 1);

  // 크롤러(OG 미리보기 봇·검색엔진)는 분석을 유발하거나 기록을 남기지 않는다.
  // 저장된 결과가 있으면 그대로 보여주고(SEO 유지), 없으면 안내만 반환.
  const ua = (await headers()).get("user-agent") ?? "";
  const isBot =
    /bot|crawl|spider|scrap|facebookexternalhit|kakaotalk|slack|twitter|discord|telegram|whatsapp|preview|embed/i.test(
      ua,
    );

  const platform = region as PlatformRegion;

  // 닉변 이력이 있으면(저장된 분석이 남아 있어도) 새 이름으로 먼저 이동.
  // 옛 이름을 남이 가져갔는지 확인 후에만 이동한다 (resolveRenameTarget)
  const known = await resolveRenameTarget(platform, gameName, tagLine).catch(
    () => null,
  );
  if (known) {
    const knownId = `${known.gameName}#${known.tagLine}`;
    if (knownId !== decoded) {
      redirect(
        `/summoner/${region}/${encodeURIComponent(knownId)}?renamed=${encodeURIComponent(decoded)}`,
      );
    }
  }

  // 최신 매치 ID가 그대로면 저장된 분석(정밀 우선)을 재사용하고,
  // 새 경기가 생겼으면: 이전 분석이 있으면 일단 보여주며 백그라운드 재분석(stale),
  // 아무것도 없으면(첫 검색) 즉시 분석한다.
  let result;
  let mode: "quick" | "deep" | "stale" = "quick";
  // 크롤러인데 저장된 결과가 없는 경우 — JSX는 try 밖에서 만든다
  // (try/catch는 렌더 에러를 잡지 못하므로 안에서 JSX를 구성하지 않는다)
  let botNoData = false;
  try {
    const latestMatchId = await getLatestMatchId(platform, gameName, tagLine);
    const deep = await getFreshDeepResult(
      platform,
      gameName,
      tagLine,
      latestMatchId,
    );
    if (deep) {
      result = deep;
      mode = "deep";
    } else {
      result = await getFreshQuickResult(
        platform,
        gameName,
        tagLine,
        latestMatchId,
      );
      if (!result) {
        const stale =
          (await getStoredResult("deep", platform, gameName, tagLine)) ??
          (await getStoredResult("quick", platform, gameName, tagLine));
        if (stale) {
          result = stale;
          mode = "stale";
        } else if (isBot) {
          botNoData = true;
        } else {
          result = await runQuickAnalysis(platform, gameName, tagLine);
        }
      }
    }
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      // 닉변 가능성 — ① 닉변 이력에서 새 이름을 찾고, ② 없으면 저장된 puuid로 역조회
      const renamedTo = await findRenamedTo(platform, gameName, tagLine).catch(
        () => null,
      );
      let currentId = renamedTo
        ? `${renamedTo.gameName}#${renamedTo.tagLine}`
        : null;
      if (!currentId) {
        const oldPuuid = await findPuuidByOldName(
          platform,
          gameName,
          tagLine,
          riotKeyFp(),
        ).catch(() => null);
        if (oldPuuid) {
          const current = await getAccountByPuuid(platform, oldPuuid);
          if (current) {
            currentId = `${current.gameName}#${current.tagLine}`;
            await recordNameChange(
              platform,
              gameName,
              tagLine,
              current.gameName,
              current.tagLine,
            ).catch(() => {});
          }
        }
      }
      if (currentId && currentId !== decoded) {
        redirect(
          `/summoner/${region}/${encodeURIComponent(currentId)}?renamed=${encodeURIComponent(decoded)}`,
        );
      }
      return (
        <ErrorCard
          title="소환사를 찾을 수 없어요"
          description={`"${decoded}" 계정이 ${PLATFORM_LABELS[region as PlatformRegion]} 서버에 없어요. 철자와 태그를 확인해 주세요.`}
        />
      );
    }
    if (e instanceof RiotApiError && (e.status === 401 || e.status === 403)) {
      return (
        <ErrorCard
          title="API 키가 만료됐어요"
          description="라이엇 개발용 API 키는 24시간마다 만료돼요. developer.riotgames.com에서 재발급 후 .env.local을 갱신해 주세요."
        />
      );
    }
    throw e;
  }

  // 크롤러라 분석을 건너뛴 경우, 그리고 어떤 이유로도 결과가 비었을 때
  if (botNoData || !result) {
    return (
      <ErrorCard
        title="아직 분석된 적 없는 소환사예요"
        description="사이트에서 검색하면 숨은 실력대 분석이 시작됩니다."
      />
    );
  }

  const ddVersion = await getDDragonVersion();
  const champNames = await getChampionNamesKo(ddVersion);
  const runeMap = await getRuneMapKo(ddVersion);

  // 저장된 이전 분석에는 프로필 정보가 없을 수 있어 보충 조회 (둘 다 캐시됨)
  let selfPuuid: string | null = null; // 닉변 승계용 — 아래 조회에서 확보
  let profileIconId = result.profileIconId ?? null;
  let summonerLevel = result.summonerLevel ?? null;
  if (profileIconId === null) {
    try {
      const acct = await getAccountByRiotId(platform, gameName, tagLine);
      selfPuuid = acct.puuid;
      const summoner = await getSummoner(platform, acct.puuid);
      profileIconId = summoner.profileIconId;
      summonerLevel = summoner.summonerLevel;
    } catch {
      // 프로필 조회 실패는 표시 생략으로 처리
    }
  }

  // LP 득실 추적 — 스냅샷 히스토리 기반 (API 호출 없음)
  let lpInsight: LpInsight | null = null;
  try {
    const acct = await getAccountByRiotId(platform, gameName, tagLine);
    selfPuuid = acct.puuid;
    lpInsight = computeLpInsight(await getLeagueHistory(platform, acct.puuid));
  } catch {
    // 히스토리 조회 실패는 카드 생략으로 처리
  }

  // 방문 로그 — 관리자 시간대 통계용. 내부 도구(크롤러)는 따로 표시해
  // 실제 유저 사용 패턴이 왜곡되지 않게 한다.
  if (!isBot) {
    void logVisit(
      platform,
      result.account.gameName,
      result.account.tagLine,
      /rift-lens-seed/i.test(ua) ? "tool" : "user",
    ).catch(() => {});
  }

  // 봇 트래픽은 최근 검색에 기록하지 않는다
  if (!isBot)
    await recordSearch({
      region: platform,
      gameName: result.account.gameName,
      tagLine: result.account.tagLine,
      currentLabel: result.currentRank?.label ?? null,
      currentTier: result.currentRank?.tier ?? null,
      estimatedLabel: result.estimatedRank?.label ?? null,
      estimatedTier: result.estimatedRank?.tier ?? null,
      estimatedPoints: result.estimatedPoints,
      puuid: selfPuuid,
    });

  const {
    account,
    soloEntry,
    currentRank,
    currentPoints,
    estimatedRank,
    estimatedPoints,
    errorMargin,
    gap,
    recentWinrate,
    matches,
    sampledPlayers,
    confidence,
  } = result;
  const duoExcludedCount = result.duoExcludedCount ?? 0; // 구버전 저장 결과 호환
  const analyzedCount = matches.length - duoExcludedCount;

  // 분석에서 제외된 경기(듀오 추정)는 그래프에서도 뺀다
  const chartData: MmrChartPoint[] = [...matches]
    .reverse()
    .filter((m) => !(m.suspectedDuo ?? false))
    .map((m, i, arr) => ({
      game: i === arr.length - 1 ? "최근" : `${arr.length - 1 - i}경기 전`,
      lobby: m.lobbyPoints !== null ? Math.round(m.lobbyPoints) : null,
      est: m.ratingAfter,
      win: m.win,
    }));

  const verdict = gap !== null ? gapVerdict(gap) : null;
  const estColor = estimatedRank ? TIER_COLORS[estimatedRank.tier] : undefined;
  const showLobbyDist = matches.some((m) => m.lobbyPoints !== null);

  return (
    <div className="space-y-5">
      {/* 닉변 리다이렉트 안내 */}
      {renamed && renamed !== decoded && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <b>{renamed}</b> 님은 <b>{decoded}</b> 로 닉네임을 변경했어요 — 새
          이름으로 이동했습니다.
        </div>
      )}

      {/* 헤더 */}
      <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex items-center gap-3">
          {profileIconId !== null && (
            <div className="relative shrink-0">
              <Image
                src={profileIconUrl(ddVersion, profileIconId)}
                alt=""
                width={56}
                height={56}
                unoptimized
                className="rounded-xl ring-2 ring-border"
              />
              {summonerLevel !== null && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border bg-background/95 px-1.5 text-[10px] font-medium tabular-nums">
                  {summonerLevel}
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              {account.gameName}
              <span className="font-normal text-muted-foreground">
                #{account.tagLine}
              </span>
            </h1>
            <Badge variant="secondary">
              {PLATFORM_LABELS[region as PlatformRegion]}
            </Badge>
            {mode === "stale" ? (
              <StaleRefresh
                region={region}
                gameName={gameName}
                tagLine={tagLine}
              />
            ) : (
              <DeepRefine
                region={region}
                gameName={gameName}
                tagLine={tagLine}
                mode={mode}
              />
            )}
            <ShareButton region={region} riotId={decoded} />
          </div>
        </div>
        <div className="w-full sm:w-80">
          <SearchForm compact />
        </div>
      </div>

      {/* 본문 2단 — 좌: 실력대 요약 / 우: 추이·전적.
          넓은 화면에서 스크롤을 줄이려고 정보 카드를 옆으로 세운다. */}
      <HistorySummaryProvider>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* 좌측 컬럼 — xl에선 스크롤을 따라오도록 고정(헤더 높이만큼 내려서) */}
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-backwards xl:sticky xl:top-[4.25rem] xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-1 xl:[scrollbar-width:none] xl:[&::-webkit-scrollbar]:hidden">
          <Card
            className="relative overflow-hidden"
            style={
              estColor
                ? {
                    backgroundImage: `radial-gradient(120% 150% at 0% 0%, color-mix(in oklab, ${estColor} 18%, transparent), transparent 60%)`,
                  }
                : undefined
            }
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    매칭 실력대
                    <Badge
                      variant="outline"
                      className="bg-background/60 font-normal"
                    >
                      {CONFIDENCE_LABELS[confidence]}
                    </Badge>
                  </CardDescription>
                  <CardTitle
                    className="text-2xl sm:text-3xl"
                    style={{ color: estColor }}
                  >
                    {estimatedRank?.label ?? "표본 부족"}
                  </CardTitle>
                  {estimatedPoints !== null && (
                    <p className="text-sm text-muted-foreground">
                      {Math.round(estimatedPoints).toLocaleString()}pt
                      {errorMargin !== null && ` · 오차범위 ±${errorMargin}pt`}
                    </p>
                  )}
                </div>
                {estimatedRank && (
                  <div className="relative size-22 shrink-0 sm:size-30">
                    <Image
                      src={tierEmblemUrl(estimatedRank.tier)}
                      alt=""
                      fill
                      unoptimized
                      className="object-contain drop-shadow-xl"
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            {verdict && (
              <CardContent>
                <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2.5 text-xs backdrop-blur-sm sm:text-sm">
                  {verdict.tone === "up" && (
                    <ArrowUp className="size-4 shrink-0 text-emerald-500" />
                  )}
                  {verdict.tone === "down" && (
                    <ArrowDown className="size-4 shrink-0 text-red-500" />
                  )}
                  {verdict.tone === "flat" && (
                    <Minus className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>{verdict.text}</span>
                  {gap !== null && (
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">
                      {gap > 0 ? "+" : ""}
                      {gap}pt
                    </span>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardDescription>현재 티어</CardDescription>
                  <CardTitle
                    className="text-xl sm:text-2xl"
                    style={
                      currentRank
                        ? { color: TIER_COLORS[currentRank.tier] }
                        : undefined
                    }
                  >
                    {currentRank?.label ?? "언랭크"}
                  </CardTitle>
                </div>
                {recentWinrate !== null && analyzedCount > 0 && (
                  <WinrateRing pct={recentWinrate} games={analyzedCount} />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {soloEntry && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="size-4" />
                  시즌 {soloEntry.wins}승 {soloEntry.losses}패 (
                  {Math.round(
                    (soloEntry.wins / (soloEntry.wins + soloEntry.losses)) *
                      100,
                  )}
                  %)
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="size-4" />
                표본 {sampledPlayers}명의 현재 랭크 분석
              </div>
            </CardContent>
          </Card>

          {/* LP 흐름 — 스냅샷이 쌓여야 표시됨 */}
          {lpInsight && hasLpSignal(lpInsight) && (
            <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-backwards">
              <CardHeader>
                <CardTitle className="text-base">LP 흐름</CardTitle>
                <CardDescription>
                  랭크 스냅샷 관측 {lpInsight.observedWins}승{" "}
                  {lpInsight.observedLosses}패 기준 · LP 득실은 내부 지표를 가장
                  직접 반영하는 신호예요
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border px-4 py-3">
                    <div className="text-xs text-muted-foreground">
                      승리당 평균
                    </div>
                    <div className="mt-1 text-xl font-bold text-emerald-500 tabular-nums">
                      {lpInsight.avgGain !== null
                        ? `+${lpInsight.avgGain.toFixed(1)} LP`
                        : "수집 중"}
                    </div>
                  </div>
                  <div className="rounded-lg border px-4 py-3">
                    <div className="text-xs text-muted-foreground">
                      패배당 평균
                    </div>
                    <div className="mt-1 text-xl font-bold text-red-500 tabular-nums">
                      {lpInsight.avgLoss !== null
                        ? `-${lpInsight.avgLoss.toFixed(1)} LP`
                        : "수집 중"}
                    </div>
                  </div>
                </div>
                {(() => {
                  const v = lpVerdict(lpInsight);
                  if (!v) return null;
                  return (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs sm:text-sm">
                      {v.tone === "up" && (
                        <ArrowUp className="size-4 shrink-0 text-emerald-500" />
                      )}
                      {v.tone === "down" && (
                        <ArrowDown className="size-4 shrink-0 text-red-500" />
                      )}
                      {v.tone === "flat" && (
                        <Minus className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>{v.text}</span>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* 로비 티어 분포 */}
          {showLobbyDist && (
            <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200 fill-mode-backwards">
              <CardHeader>
                <CardTitle className="text-base">로비 티어 분포</CardTitle>
                <CardDescription>
                  최근 경기들의 로비 평균 랭크가 속한 티어
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LobbyDistribution matches={matches} />
              </CardContent>
            </Card>
          )}

        </div>

        {/* 우측 컬럼 — 추이 차트 · 경기 목록 */}
        <div className="space-y-4">
          {/* 추이 차트 */}
          <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300 fill-mode-backwards">
            <CardHeader>
              <CardTitle className="text-base">경기별 실력대 추이</CardTitle>
              <CardDescription>
                분석에 사용된 최근 {analyzedCount}경기 기준
                {duoExcludedCount > 0 &&
                  ` · 듀오 추정 ${duoExcludedCount}경기는 제외됨`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.some((d) => d.lobby !== null) ? (
                <MmrChart data={chartData} currentPoints={currentPoints} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  최근 솔로랭크 경기가 없어 그래프를 그릴 수 없어요.
                </p>
              )}
            </CardContent>
          </Card>

          {/* 최근 경기 요약 — 데이터는 전적 목록의 응답에서 공유받는다 */}
          <MatchSummaryCard
            version={ddVersion}
            names={champNames}
            region={region}
          />

          {/* 경기 목록 — 최근 전적 / 분석 근거를 탭으로 (세로 길이 절감) */}
          <MatchTabs
            runeMap={runeMap}
            region={region}
            riotId={decoded}
            ddVersion={ddVersion}
            champNames={champNames}
            rows={matches.map((m): MatchRow => {
              const lobby =
                m.lobbyPoints !== null
                  ? pointsToRank(Math.round(m.lobbyPoints))
                  : null;
              return {
                id: m.matchId,
                win: m.win,
                iconUrl: m.championName
                  ? championIconUrl(ddVersion, m.championName)
                  : null,
                champName: championNameKo(champNames, m.championName),
                kda: m.kda,
                when: timeAgo(m.gameCreation),
                lobbyLabel: lobby?.label ?? null,
                lobbyTier: lobby?.tier ?? null,
                sampleSize: m.sampleSize,
                suspectedDuo: m.suspectedDuo ?? false,
              };
            })}
          />
        </div>
      </div>
      </HistorySummaryProvider>
    </div>
  );
}
