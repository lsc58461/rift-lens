import { NextResponse, type NextRequest } from "next/server";
import {
  getAccountByRiotId,
  getMatch,
  getRankedMatchIds,
  riotKeyFp,
} from "@/lib/riot/client";
import { currentNamesByPuuid } from "@/lib/store";
import {
  PLATFORM_LABELS,
  RiotApiError,
  type PlatformRegion,
} from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COUNT = 20; // 전적 표시·요약 통계 기준 경기 수 (매치 상세는 장기 캐시라 대부분 재사용)

interface GameLike {
  win: boolean;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  gameDuration: number;
  position: string;
  teamKills: number;
  team: { name: string; champ: string; self?: boolean }[];
}

/** 최근 경기 요약 — 저장된 매치에서 계산하므로 추가 API 호출이 없다 */
function summarize(games: GameLike[]) {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win).length;
  const sum = (f: (g: GameLike) => number) => games.reduce((a, g) => a + f(g), 0);

  const kills = sum((g) => g.kills);
  const deaths = sum((g) => g.deaths);
  const assists = sum((g) => g.assists);

  // 킬관여율 — 팀 킬이 0인 경기는 분모에서 제외
  const kpGames = games.filter((g) => g.teamKills > 0);
  const kp = kpGames.length
    ? kpGames.reduce(
        (a, g) => a + (g.kills + g.assists) / g.teamKills,
        0,
      ) / kpGames.length
    : null;

  // 분당 CS — CS 정보가 있는 경기만
  const csGames = games.filter((g) => g.cs !== null && g.gameDuration > 0);
  const csPerMin = csGames.length
    ? csGames.reduce((a, g) => a + (g.cs as number) / (g.gameDuration / 60), 0) /
      csGames.length
    : null;

  const positions: Record<string, number> = {};
  for (const g of games) {
    if (g.position) positions[g.position] = (positions[g.position] ?? 0) + 1;
  }

  const champAgg = new Map<
    string,
    { games: number; wins: number; k: number; d: number; a: number }
  >();
  for (const g of games) {
    const c = champAgg.get(g.championName) ?? {
      games: 0,
      wins: 0,
      k: 0,
      d: 0,
      a: 0,
    };
    c.games += 1;
    if (g.win) c.wins += 1;
    c.k += g.kills;
    c.d += g.deaths;
    c.a += g.assists;
    champAgg.set(g.championName, c);
  }
  const champions = [...champAgg.entries()]
    .map(([champ, c]) => ({
      champ,
      games: c.games,
      wins: c.wins,
      kda: c.d > 0 ? (c.k + c.a) / c.d : null,
    }))
    .sort((x, y) => y.games - x.games || y.wins - x.wins)
    .slice(0, 3);

  // 함께 플레이한 소환사 — 같은 팀에 2회 이상 등장한 사람
  const mateAgg = new Map<string, { games: number; wins: number; champ: string }>();
  for (const g of games) {
    for (const p of g.team) {
      if (p.self) continue;
      const m = mateAgg.get(p.name) ?? { games: 0, wins: 0, champ: p.champ };
      m.games += 1;
      if (g.win) m.wins += 1;
      mateAgg.set(p.name, m);
    }
  }
  const mates = [...mateAgg.entries()]
    .filter(([, m]) => m.games >= 2)
    .map(([name, m]) => ({ name, games: m.games, wins: m.wins }))
    .sort((x, y) => y.games - x.games || y.wins - x.wins)
    .slice(0, 4);

  return {
    games: games.length,
    wins,
    losses: games.length - wins,
    kills: kills / games.length,
    deaths: deaths / games.length,
    assists: assists / games.length,
    kda: deaths > 0 ? (kills + assists) / deaths : null,
    kp,
    csPerMin,
    positions,
    champions,
    mates,
  };
}

// 최근 전적 — 최근 경기 ID를 조회해 매치 상세(대부분 캐시)를 반환한다.
export async function POST(req: NextRequest) {
  let body: { region?: string; riotId?: string; start?: number; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const region = body.region ?? "kr";
  const riotId = (body.riotId ?? "").trim().normalize("NFKC");
  const hash = riotId.lastIndexOf("#");
  if (!(region in PLATFORM_LABELS) || hash <= 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  const platform = region as PlatformRegion;
  // 더보기 — 매치 ID는 한 번에 start+count만큼 받아 잘라 쓴다(상세는 장기 캐시)
  const start = Math.min(180, Math.max(0, Math.floor(Number(body.start ?? 0))));
  const count = Math.min(40, Math.max(1, Math.floor(Number(body.count ?? COUNT))));

  try {
    const account = await getAccountByRiotId(
      platform,
      riotId.slice(0, hash),
      riotId.slice(hash + 1),
    );
    // 다음 페이지 존재 여부를 알기 위해 한 개 더 받는다
    const allIds = await getRankedMatchIds(
      platform,
      account.puuid,
      start + count + 1,
    );
    const ids = allIds.slice(start, start + count);
    const matches = await Promise.all(
      ids.map((id) => getMatch(platform, id).catch(() => null)),
    );
    const hasMore = allIds.length > start + count;

    // 닉변한 참가자는 경기 시점 이름이 박제돼 있어 현재 이름으로 바로잡는다
    const known = matches.filter((m) => m !== null);
    const nameMap = await currentNamesByPuuid(
      riotKeyFp(),
      [...new Set(known.flatMap((m) => m.participants.map((p) => p.puuid)))],
    ).catch(() => new Map<string, string>());

    const games = matches
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => {
        const self = m.participants.find((p) => p.puuid === account.puuid);
        if (!self) return null;
        const mine = m.participants.filter((p) => p.teamId === self.teamId);
        const theirs = m.participants.filter((p) => p.teamId !== self.teamId);
        // 킬관여율·딜량 비중 계산용 (경기 내 상대 비교라 별도 조회 불필요)
        const teamKills = mine.reduce((a, p) => a + p.kills, 0);
        const maxDamage = Math.max(
          1,
          ...m.participants.map((p) => p.damage ?? 0),
        );
        const player = (p: (typeof m.participants)[number]) => ({
          name:
            nameMap.get(p.puuid) ??
            `${p.riotIdGameName}#${p.riotIdTagline}`,
          champ: p.championName,
          position: p.teamPosition,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          cs: p.cs ?? null,
          damage: p.damage ?? null,
          items: p.items ?? [],
          self: p.puuid === account.puuid,
        });
        return {
          matchId: m.matchId,
          gameCreation: m.gameCreation,
          gameDuration: m.gameDuration,
          win: self.win,
          championName: self.championName,
          champLevel: self.champLevel ?? null,
          kills: self.kills,
          deaths: self.deaths,
          assists: self.assists,
          cs: self.cs ?? null,
          damage: self.damage ?? null,
          gold: self.goldEarned ?? null,
          vision: self.visionScore ?? null,
          position: self.teamPosition,
          spells: [self.spell1Id ?? 0, self.spell2Id ?? 0],
          items: self.items ?? [],
          teamKills,
          maxDamage,
          team: mine.map(player),
          enemy: theirs.map(player),
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      games,
      hasMore,
      summary: start === 0 ? summarize(games as GameLike[]) : null,
    });
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
