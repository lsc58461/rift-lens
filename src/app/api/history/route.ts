import { NextResponse, type NextRequest } from "next/server";
import {
  getAccountByRiotId,
  getMatch,
  getRankedMatchIds,
} from "@/lib/riot/client";
import {
  PLATFORM_LABELS,
  RiotApiError,
  type PlatformRegion,
} from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COUNT = 10; // 전적 표시 경기 수

// 최근 전적 — 최근 경기 ID를 조회해 매치 상세(대부분 캐시)를 반환한다.
export async function POST(req: NextRequest) {
  let body: { region?: string; riotId?: string };
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

  try {
    const account = await getAccountByRiotId(
      platform,
      riotId.slice(0, hash),
      riotId.slice(hash + 1),
    );
    const ids = await getRankedMatchIds(platform, account.puuid, COUNT);
    const matches = await Promise.all(
      ids.map((id) => getMatch(platform, id).catch(() => null)),
    );

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
          name: `${p.riotIdGameName}#${p.riotIdTagline}`,
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

    return NextResponse.json({ games });
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
