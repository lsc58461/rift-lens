import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { apexLadderEntry, ensureApexCutoffs } from "@/lib/apex-ladder";
import { getSeasonRanks, type SeasonRankRow } from "@/lib/season-archive";
import {
  Crown,
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
import { MatchSection, type LobbyInfoMap } from "@/components/match-section";
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
import { pointsToRank, TIER_COLORS, TIERS, entryToRank, isApexPoints, rankToPoints } from "@/lib/mmr/rank";

// 시즌 최고 비교키 — 티어 우선, 그다음 점수. 마스터 이상은 같은 LP라도 챌 > 그마 > 마스터
// (라이엇이 승격을 일괄 반영해서 같은 LP가 다른 티어로 관측될 수 있다)
const peakKey = (tier: string, pts: number) => TIERS.indexOf(tier as (typeof TIERS)[number]) * 100_000 + pts;
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
  // 한국 서버 전용 — 스트리밍(loading.tsx) 시작 전인 메타데이터 단계에서
  // 404를 확정해야 상태코드가 200으로 굳지 않는다.
  if (!(region in PLATFORM_LABELS)) {
    notFound();
  }
  const decoded = decodeURIComponent(riotId);
  const title = `${decoded} 매칭 구간`;
  const description = `${decoded}의 최근 매칭 구간 — 최근 솔로랭크 경기 로비의 평균 랭크와 전적을 확인해 보세요.`;
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

// 표현 원칙: "최근 로비 평균 랭크가 현재 티어보다 높다/낮다"는 사실만 말한다.
// 시스템이 실력을 어떻게 평가한다거나 LP·티어 전망 같은 해석은 붙이지 않는다
// (라이엇 API 정책 — 공식 랭킹 시스템의 대체물(MMR/ELO 계산기) 금지).
// 시즌 시작(KST) — 시즌 최고 티어 집계 기준. 새 시즌이 열리면 갱신한다.
const SEASON_START = "2026-01-08T00:00:00+09:00";

function estimatedPointsOf(r: { estimatedPoints: number | null }): number | null {
  return r.estimatedPoints;
}

function gapVerdict(gap: number, apex = false): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (apex) {
    // 마스터 이상은 디비전이 없어 "한 티어"가 의미 없다 — LP 차이로 말한다
    const lp = Math.abs(Math.round(gap));
    if (lp < 100) return { text: "최근 매칭 로비의 평균이 현재 LP와 비슷한 구간이에요.", tone: "flat" };
    return gap > 0
      ? { text: `최근 매칭 로비의 평균이 현재보다 약 ${lp}LP 높은 구간이에요.`, tone: "up" }
      : { text: `최근 매칭 로비의 평균이 현재보다 약 ${lp}LP 낮은 구간이에요.`, tone: "down" };
  }
  if (gap >= 150)
    return {
      text: "최근 매칭 로비의 평균 랭크가 현재 티어보다 한 티어 이상 높은 구간이에요.",
      tone: "up",
    };
  if (gap >= 50)
    return {
      text: "최근 매칭 로비의 평균 랭크가 현재 티어보다 조금 높은 구간이에요.",
      tone: "up",
    };
  if (gap <= -150)
    return {
      text: "최근 매칭 로비의 평균 랭크가 현재 티어보다 한 티어 이상 낮은 구간이에요.",
      tone: "down",
    };
  if (gap <= -50)
    return {
      text: "최근 매칭 로비의 평균 랭크가 현재 티어보다 조금 낮은 구간이에요.",
      tone: "down",
    };
  return { text: "최근 매칭 로비의 평균 랭크가 현재 티어와 비슷한 구간이에요.", tone: "flat" };
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
  // 한국 서버 전용 — 타 리전 URL은 404 (SEO에 잘못된 200이 남지 않게)
  if (!(region in PLATFORM_LABELS)) {
    notFound();
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
        description="사이트에서 검색하면 매칭 구간 분석이 시작됩니다."
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
  // 시즌 최고 티어 — 라이엇은 과거 랭크를 안 주므로 우리 스냅샷 히스토리에서
  // 시즌 시작 이후 최고점을 뽑는다 (관측한 범위 안에서의 최고라 화면에 그렇게 표기)
  let peak: { label: string; tier: string; at: number; pts: number } | null = null;
  let seasonRanks: SeasonRankRow[] = [];
  try {
    const acct = await getAccountByRiotId(platform, gameName, tagLine);
    selfPuuid = acct.puuid;
    const history = await getLeagueHistory(platform, acct.puuid);
    lpInsight = computeLpInsight(history);
    seasonRanks = await getSeasonRanks(platform, acct.puuid).catch(() => []);
    const seasonStart = new Date(SEASON_START).getTime();
    for (const h of history) {
      if (!h.solo_tier || h.solo_lp === null) continue;
      const at = new Date(h.created_at).getTime();
      if (at < seasonStart) continue;
      const pts = rankToPoints(h.solo_tier, h.solo_rank ?? "IV", h.solo_lp);
      if (!peak || peakKey(h.solo_tier, pts) > peakKey(peak.tier, peak.pts)) {
        peak = { ...entryToRank(h.solo_tier, h.solo_rank ?? "IV", h.solo_lp), at, pts };
      }
    }
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

  await ensureApexCutoffs(); // 마스터 이상 컷(그마·챌) 최신화 — 라벨 재계산 전에
  // 챌·그마 승격/강등은 라이엇이 일괄 반영해서, 저장된 분석(최대 24h+)의 티어가 래더(30분 폴링)와
  // 어긋날 수 있다 — 래더가 더 새로우면 현재 티어·LP·전적은 래더 기준으로 보여준다
  const ladder = result.soloEntry && selfPuuid ? await apexLadderEntry(selfPuuid, platform).catch(() => null) : null;
  const soloEntry =
    result.soloEntry && ladder && ladder.fetchedAt > (result.analyzedAt ?? 0)
      ? { ...result.soloEntry, tier: ladder.tier, rank: "I", leaguePoints: ladder.lp, wins: ladder.wins, losses: ladder.losses }
      : result.soloEntry;
  // 저장된 라벨 대신 지금 기준으로 다시 라벨링 — 마스터 이상 컷이 갱신되거나
  // 예전 결과가 포인트 역산 라벨을 갖고 있어도 화면은 항상 현재 기준으로 맞춘다
  const currentRank = soloEntry
    ? entryToRank(soloEntry.tier, soloEntry.rank, soloEntry.leaguePoints)
    : result.currentRank;
  // 래더로 보정된 현재 랭크가 관측 최고보다 높으면 시즌 최고도 그걸로
  if (soloEntry && ladder && currentRank) {
    const pts = rankToPoints(soloEntry.tier, soloEntry.rank, soloEntry.leaguePoints);
    if (!peak || peakKey(soloEntry.tier, pts) > peakKey(peak.tier, peak.pts)) {
      peak = { ...currentRank, at: ladder.fetchedAt, pts };
    }
  }

  // 봇 트래픽은 최근 검색에 기록하지 않는다
  if (!isBot)
    await recordSearch({
      region: platform,
      gameName: result.account.gameName,
      tagLine: result.account.tagLine,
      currentLabel: currentRank?.label ?? null,
      currentTier: currentRank?.tier ?? null,
      estimatedLabel: result.estimatedRank?.label ?? null,
      estimatedTier: result.estimatedRank?.tier ?? null,
      estimatedPoints: result.estimatedPoints,
      puuid: selfPuuid,
    });

  const {
    account,
    currentPoints,
    estimatedRank: storedEstimatedRank,
    gap,
    recentWinrate,
    matches,
    sampledPlayers,
    confidence,
  } = result;
  const estimatedRank =
    estimatedPointsOf(result) !== null
      ? pointsToRank(estimatedPointsOf(result)!)
      : storedEstimatedRank;
  const apex =
    currentPoints !== null && isApexPoints(currentPoints) &&
    estimatedPointsOf(result) !== null && isApexPoints(estimatedPointsOf(result)!);
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

  const verdict = gap !== null ? gapVerdict(gap, apex) : null;
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

      {/* 본문 2단 — 좌: 매칭 구간 요약 / 우: 추이·전적.
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
                    최근 매칭 구간
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
                  {estimatedRank && (
                    <p className="text-sm text-muted-foreground">
                      최근 솔로랭크 경기 로비의 평균 랭크
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
              {peak && (
                <div
                  className="flex items-center gap-2 text-muted-foreground"
                  title="Rift Lens가 관측한 랭크 기록 중 이번 시즌 최고점 (라이엇 공식 최고 기록과 다를 수 있어요)"
                >
                  <Crown className="size-4" />
                  시즌 최고{" "}
                  <span className="font-medium" style={{ color: TIER_COLORS[peak.tier] }}>
                    {peak.label}
                  </span>
                  <span className="text-xs">
                    · {new Date(peak.at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })} 관측
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="size-4" />
                표본 {sampledPlayers}명의 현재 랭크 분석
              </div>
              {seasonRanks.length > 0 && (
                <div className="space-y-1 border-t pt-2.5">
                  <div className="text-xs text-muted-foreground">지난 시즌 (마감 시점 기준)</div>
                  {seasonRanks.map((r) => (
                    <div key={r.season} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{r.season}</span>
                      <span
                        className="font-medium"
                        style={r.tier !== "UNRANKED" ? { color: TIER_COLORS[r.tier] } : undefined}
                      >
                        {r.tier === "UNRANKED"
                          ? "언랭크"
                          : entryToRank(r.tier, r.rank ?? "IV", r.lp ?? 0).label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* LP 흐름 — 스냅샷이 쌓여야 표시됨 */}
          {lpInsight && hasLpSignal(lpInsight) && (
            <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-backwards">
              <CardHeader>
                <CardTitle className="text-base">LP 흐름</CardTitle>
                <CardDescription>
                  랭크 스냅샷 관측 {lpInsight.observedWins}승{" "}
                  {lpInsight.observedLosses}패 기준 · 승리·패배당 평균 LP 득실이에요
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
              <CardTitle className="text-base">경기별 매칭 구간 추이</CardTitle>
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

          {/* 경기 목록 — 최근 전적 한 개. 집계에 쓰인 경기는 로비 랭크 칩으로 표시 */}
          <MatchSection
            runeMap={runeMap}
            region={region}
            riotId={decoded}
            ddVersion={ddVersion}
            champNames={champNames}
            analyzedCount={matches.length}
            lobbyByMatch={Object.fromEntries(
              matches.map((m) => {
                const lobby =
                  m.lobbyPoints !== null ? pointsToRank(Math.round(m.lobbyPoints)) : null;
                return [
                  m.matchId,
                  { label: lobby?.label ?? null, tier: lobby?.tier ?? null, duo: m.suspectedDuo ?? false },
                ];
              }),
            ) satisfies LobbyInfoMap}
          />
        </div>
      </div>
      </HistorySummaryProvider>
    </div>
  );
}
