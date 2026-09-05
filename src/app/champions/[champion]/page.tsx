// 챔피언 상세 페이지 — 예전엔 목록 위의 모달이라 주소가 없었고, 그래서 검색엔진도 AI 도
// 룬·빌드 내용에 닿지 못했다(2026-09-03). 챔피언마다 주소를 주고 목록에서 링크로 연결한다.
// 슬러그는 DDragon 챔피언 키 소문자(LeeSin → leesin) — shared.ts 의 championSlug 와 같은 규칙.
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, pageMeta } from "@/lib/seo";
import { getChampionStats, listPatches, type ChampionStat } from "@/lib/champion-stats";
import { RANK_BRACKETS } from "@/lib/rank-pts";
import { patchLabel } from "@/lib/patch-notes";
import {
  championIconUrl,
  championNameKo,
  getChampionNamesKo,
  getDDragonVersion,
  getRuneMapKo,
  getRuneTreesKo,
} from "@/lib/ddragon";
import { safeDecode } from "@/lib/summoner-url";
import { ChampionDetail } from "../champion-detail";
import { POSITION_LABEL, WinrateText, wr } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = Promise<{ champion: string }>;
type Search = Promise<{ patch?: string; rank?: string }>;

/** 목록과 같은 규칙으로 패치·브라켓을 정한다 (쿼리 없으면 최신 패치·에메랄드 이상) */
async function resolve(search: Search) {
  const { patch: rawPatch, rank: rawRank } = await search;
  const bracket = RANK_BRACKETS.some((b) => b.key === rawRank)
    ? (rawRank as (typeof RANK_BRACKETS)[number]["key"])
    : "emerald";
  const patches = (await listPatches()).slice(0, 2);
  const patch =
    rawPatch && patches.some((p) => p.patch === rawPatch) ? rawPatch : (patches[0]?.patch ?? null);
  return { patch, bracket };
}

async function findChampion(slug: string, search: Search) {
  const { patch, bracket } = await resolve(search);
  const stats = await getChampionStats(patch, bracket);
  const key = safeDecode(slug).toLowerCase();
  const c = stats.champions.find((x) => x.champ.toLowerCase() === key) ?? null;
  return { c, patch, bracket, stats };
}

/** 가장 많이 쓰인 포지션 — 제목·설명에 넣는다 */
function mainPosition(c: ChampionStat): string | null {
  const top = Object.entries(c.positions).sort((a, b) => b[1].games - a[1].games)[0];
  return top ? (POSITION_LABEL[top[0]] ?? null) : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { champion } = await params;
  const { c } = await findChampion(champion, searchParams);
  const version = await getDDragonVersion();
  if (!c) {
    return pageMeta({
      title: "챔피언 통계",
      description: "수집된 솔로랭크 경기 기준 챔피언별 승률과 스펠·아이템·룬 통계",
      path: "/champions",
    });
  }
  const names = await getChampionNamesKo(version);
  const nameKo = championNameKo(names, c.champ);
  const runeMap = await getRuneMapKo(version);
  const keystone = c.runes[0] ? runeMap[c.runes[0].keystone]?.name : null;
  const pos = mainPosition(c);
  return {
    ...pageMeta({
      title: `${nameKo} 룬·아이템 빌드`,
      description:
        `${nameKo} 솔로랭크 통계 — 승률 ${wr(c.wins, c.games)}%, ${c.games.toLocaleString()}판 표본` +
        `${pos ? ` · 주 포지션 ${pos}` : ""}${keystone ? ` · 가장 많이 쓰는 핵심룬 ${keystone}` : ""}. ` +
        `추천 룬 페이지와 스펠·시작 아이템·빌드 순서를 확인해 보세요.`,
      path: `/champions/${c.champ.toLowerCase()}`,
    }),
    openGraph: {
      images: [{ url: championIconUrl(version, c.champ) }],
    },
  };
}

export default async function ChampionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { champion } = await params;
  const { c, patch, stats } = await findChampion(champion, searchParams);
  if (!c) notFound();

  const version = await getDDragonVersion();
  const [names, runeMap, runeTrees] = await Promise.all([
    getChampionNamesKo(version),
    getRuneMapKo(version),
    getRuneTreesKo(version),
  ]);
  const nameKo = championNameKo(names, c.champ);
  const pos = mainPosition(c);
  const banRate =
    c.bans && stats.bansMatchTotal ? Math.round((c.bans / stats.bansMatchTotal) * 100) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <JsonLd
        data={breadcrumbLd([
          { name: "홈", path: "/" },
          { name: "챔피언 통계", path: "/champions" },
          { name: nameKo, path: `/champions/${c.champ.toLowerCase()}` },
        ])}
      />

      <Link
        href="/champions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        챔피언 통계
      </Link>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3.5">
        <Image
          src={championIconUrl(version, c.champ)}
          alt=""
          width={48}
          height={48}
          unoptimized
          className="size-12 shrink-0 rounded-xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-tight">{nameKo}</h1>
          <p className="text-xs text-muted-foreground">
            {patch ? `패치 ${patchLabel(patch)} · ` : ""}
            {c.games.toLocaleString()}판 · 승률 <WinrateText wins={c.wins} games={c.games} />
            {pos && ` · 주 포지션 ${pos}`}
            {banRate !== null && ` · 밴률 ${banRate}%`}
          </p>
        </div>
      </div>

      <ChampionDetail c={c} version={version} runeMap={runeMap} runeTrees={runeTrees} />

      <p className="text-xs text-muted-foreground">
        이 사이트에서 분석된 소환사들의 경기에서 집계한 표본이라 전체 서버 통계와 다를 수 있어요.
      </p>
    </div>
  );
}
