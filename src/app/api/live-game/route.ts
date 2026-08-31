// 현재 진행 중인 게임 — 소환사 페이지의 "지금 게임 중" 카드가 페이지 로드 뒤 따로 부른다
// (페이지 렌더를 늦추지 않기 위해). Spectator-v5 1콜(60초 캐시) + 참가자 랭크는 72h 스냅샷
// 캐시 위주, 없는 사람만 3초 예산 안에서 조회하고 나머지는 응답 뒤 저우선으로 채운다.
import { NextResponse, after, type NextRequest } from "next/server";
import {
  getAccountByRiotId,
  getActiveGame,
  getLeagueEntries,
  riotKeyFp,
} from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { RiotApiError, PLATFORM_LABELS, type PlatformRegion } from "@/lib/riot/types";
import { championIconUrl, getChampionKeyToId, getChampionNamesKo, getDDragonVersion } from "@/lib/ddragon";
import { currentNamesByPuuid, estimatesByPuuid } from "@/lib/store";
import { entryToRank } from "@/lib/mmr/rank";
import { isCrawlerUa } from "@/lib/crawler-log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const QUEUE_LABEL: Record<number, string> = {
  420: "솔로랭크",
  440: "자유랭크",
  450: "칼바람 나락",
  400: "일반 (드래프트)",
  430: "일반 (블라인드)",
  490: "빠른 대전",
  700: "격전",
  720: "칼바람 (교전)",
  900: "URF",
  1700: "아레나",
  1900: "URF",
};

export interface LivePlayer {
  puuid: string;
  riotId: string | null; // "이름#태그"
  champion: { id: number; key: string | null; name: string; icon: string | null };
  rank: { tier: string; label: string } | null;
  estimated: { tier: string; label: string } | null;
  self: boolean;
}
export interface LiveGameResponse {
  inGame: boolean;
  queue?: string;
  startedAt?: number; // epoch ms (0 = 아직 로딩 화면)
  lengthSec?: number;
  fetchedAt?: number;
  teams?: { teamId: number; players: LivePlayer[] }[];
}

export async function GET(req: NextRequest) {
  if (isCrawlerUa(req.headers.get("user-agent") ?? "")) {
    return new NextResponse(null, { status: 204 });
  }
  const sp = req.nextUrl.searchParams;
  const region = sp.get("region") ?? "";
  const gameName = sp.get("gameName") ?? "";
  const tagLine = sp.get("tagLine") ?? "";
  if (!(region in PLATFORM_LABELS) || !gameName || !tagLine) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  const platform = region as PlatformRegion;

  try {
    const account = await getAccountByRiotId(platform, gameName, tagLine);
    const game = await getActiveGame(platform, account.puuid);
    if (!game) return NextResponse.json({ inGame: false } satisfies LiveGameResponse);

    const players = game.participants.filter((p) => p && p.puuid);
    const puuids = players.map((p) => p.puuid);
    const version = await getDDragonVersion();
    const [keyToId, namesKo, storedNames, estimates] = await Promise.all([
      getChampionKeyToId(version),
      getChampionNamesKo(version),
      currentNamesByPuuid(riotKeyFp(), puuids).catch(() => new Map<string, string>()),
      estimatesByPuuid(platform, puuids).catch(() => new Map()),
    ]);

    // 랭크 — 72h 스냅샷 캐시가 있으면 콜 없음. 없는 사람만 3초 예산 안에서 5명씩 병렬.
    const ranks = new Map<string, { tier: string; label: string }>();
    const deadline = Date.now() + 3_000;
    const queue = [...puuids];
    while (queue.length > 0 && Date.now() < deadline) {
      const batch = queue.splice(0, 5);
      await Promise.all(
        batch.map(async (id) => {
          const entries = await getLeagueEntries(platform, id).catch(() => []);
          const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
          if (solo) ranks.set(id, entryToRank(solo.tier, solo.rank, solo.leaguePoints));
        }),
      );
    }
    if (queue.length > 0) {
      const rest = [...queue];
      after(() =>
        withLowPriority(async () => {
          for (const id of rest) await getLeagueEntries(platform, id).catch(() => {});
        }),
      );
    }

    const toPlayer = (p: (typeof players)[number]): LivePlayer => {
      const key = keyToId[p.championId] ?? null;
      return {
        puuid: p.puuid,
        riotId: p.riotId && p.riotId.includes("#") ? p.riotId : (storedNames.get(p.puuid) ?? null),
        champion: {
          id: p.championId,
          key,
          name: key ? (namesKo[key] ?? key) : `#${p.championId}`,
          icon: key ? championIconUrl(version, key) : null,
        },
        rank: ranks.get(p.puuid) ?? null,
        estimated: estimates.get(p.puuid) ?? null,
        self: p.puuid === account.puuid,
      };
    };
    const teamIds = [...new Set(players.map((p) => p.teamId))].sort((a, b) => a - b);
    const teams = teamIds.map((teamId) => ({
      teamId,
      players: players.filter((p) => p.teamId === teamId).map(toPlayer),
    }));

    const body: LiveGameResponse = {
      inGame: true,
      queue: QUEUE_LABEL[game.gameQueueConfigId ?? -1] ?? game.gameMode ?? "일반 게임",
      startedAt: game.gameStartTime || 0,
      lengthSec: game.gameLength ?? 0,
      fetchedAt: Date.now(),
      teams,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      return NextResponse.json({ inGame: false } satisfies LiveGameResponse);
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
