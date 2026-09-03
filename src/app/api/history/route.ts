import { canon } from "@/lib/identity";
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  getAccountByRiotId,
  getLeagueEntries,
  getMatch,
  getRankedMatchIds,
  riotKeyFp,
} from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { currentNamesByPuuid, nearestRankSnapshots } from "@/lib/store";
import { pointsToShortLabel, rankToPoints, TIER_LABELS, TIER_SHORT } from "@/lib/mmr/rank";
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

    // 경기 시점의 참가자 랭크 — 우리가 쌓은 스냅샷 중 그 경기와 가장 가까운 것 (API 호출 없음)
    const rankAt = await nearestRankSnapshots(
      riotKeyFp(),
      platform,
      known.flatMap((m) => m.participants.map((p) => ({ puuid: p.puuid, at: m.gameCreation }))),
    ).catch(() => new Map());
    // 스냅샷이 없는 참가자는 지금 조회해서 채운다 — 한 번 받으면 스냅샷으로
    // 저장돼 다음부턴 공짜. 시간 예산(3초) 안에서 병렬로 받고, 못 받은 나머지는
    // 응답 뒤 저우선순위로 마저 받아 다음 조회부터 나오게 한다.
    const allPuuids = [...new Set(known.flatMap((m) => m.participants.map((p) => p.puuid)))];
    const missing = allPuuids.filter(
      (id) => !known.some((m) => rankAt.has(`${id}|${m.gameCreation}`)),
    );
    const fetchedNow = new Map<string, { tier: string; rank: string | null; lp: number | null }>();
    const solo = (entries: Awaited<ReturnType<typeof getLeagueEntries>>) =>
      entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
    const fillDeadline = Date.now() + 3_000;
    const queue = [...missing];
    while (queue.length > 0 && Date.now() < fillDeadline) {
      const batch = queue.splice(0, 5);
      await Promise.all(
        batch.map(async (id) => {
          const e = solo(await getLeagueEntries(platform, id).catch(() => []));
          if (e) fetchedNow.set(id, { tier: e.tier, rank: e.rank, lp: e.leaguePoints });
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
    const now = Date.now();

    const rankOf = (puuid: string, at: number) => {
      const r =
        rankAt.get(`${puuid}|${at}`) ??
        (() => {
          const f = fetchedNow.get(puuid);
          return f ? { tier: f.tier, rank: f.rank, lp: f.lp, snapAt: now } : null;
        })();
      if (!r) return null;
      const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier);
      const label = apex
        ? `${TIER_LABELS[r.tier] ?? r.tier} ${r.lp ?? 0}LP`
        : `${TIER_LABELS[r.tier] ?? r.tier} ${r.rank ?? ""} ${r.lp ?? 0}LP`.replace(/\s+/g, " ");
      return {
        tier: r.tier,
        label,
        // 마스터 이상은 스냅샷의 실제 티어로 (포인트 역산은 LP만 보고 챌린저로 올려버린다)
        short: apex
          ? (TIER_SHORT[r.tier] ?? r.tier)
          : pointsToShortLabel(rankToPoints(r.tier, r.rank ?? "IV", r.lp ?? 0)),
        ageDays: Math.round(Math.abs(r.snapAt - at) / 86_400_000),
      };
    };

    const games = matches
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => {
        // PUUID는 API 키 단위 암호화라 키가 바뀌면 구키 매치에서 매칭이 깨진다.
        // 라이엇 ID(이름#태그)로 폴백해 매치를 재수집 없이 계속 쓸 수 있게 한다.
        const isSelf = (p: (typeof m.participants)[number]) =>
          p.puuid === account.puuid ||
          (canon(p.riotIdGameName) === canon(account.gameName) &&
            canon(p.riotIdTagline) === canon(account.tagLine));
        const self = m.participants.find(isSelf);
        if (!self) return null;
        const mine = m.participants.filter((p) => p.teamId === self.teamId);
        const theirs = m.participants.filter((p) => p.teamId !== self.teamId);
        // 킬관여율·딜량 비중 계산용 (경기 내 상대 비교라 별도 조회 불필요)
        const teamKills = mine.reduce((a, p) => a + p.kills, 0);
        const maxDamage = Math.max(
          1,
          ...m.participants.map((p) => p.damage ?? 0),
        );
        // 팀 내 기여도 — 경기 안 상대 비교라 별도 조회 없음. 승팀 1위 MVP, 패팀 1위 ACE.
        // KDA(팀 내 최고 대비)·딜 비중·킬관여·골드 비중의 가중합 (OP Score식 단순 버전)
        type P = (typeof m.participants)[number];
        const bestOf = (team: P[]): P | null => {
          if (team.length === 0) return null;
          const tKills = Math.max(1, team.reduce((a, q) => a + q.kills, 0));
          const tDmg = Math.max(1, team.reduce((a, q) => a + (q.damage ?? 0), 0));
          const tGold = Math.max(1, team.reduce((a, q) => a + (q.goldEarned ?? 0), 0));
          const kdaOf = (q: P) => (q.kills + q.assists) / Math.max(1, q.deaths);
          const maxKda = Math.max(0.01, ...team.map(kdaOf));
          const score = (q: P) =>
            (kdaOf(q) / maxKda) * 0.35 +
            ((q.damage ?? 0) / tDmg) * 0.3 +
            ((q.kills + q.assists) / tKills) * 0.2 +
            ((q.goldEarned ?? 0) / tGold) * 0.15;
          return team.reduce((best, q) => (score(q) > score(best) ? q : best), team[0]);
        };
        const winners = m.participants.filter((q) => q.win);
        const losers = m.participants.filter((q) => !q.win);
        const mvp = bestOf(winners);
        const ace = bestOf(losers);
        const badgeOf = (q: P): "MVP" | "ACE" | undefined =>
          q === mvp ? "MVP" : q === ace ? "ACE" : undefined;
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
          gold: p.goldEarned ?? null,
          vision: p.visionScore ?? null,
          level: p.champLevel ?? null,
          spells: [p.spell1Id ?? 0, p.spell2Id ?? 0],
          keystone: p.keystone ?? null,
          subStyle: p.subStyle ?? null,
          items: p.items ?? [],
          self: isSelf(p),
          badge: badgeOf(p),
          rank: rankOf(p.puuid, m.gameCreation),
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
          keystone: self.keystone ?? null,
          subStyle: self.subStyle ?? null,
          perks: self.perks ?? null,
          subPerks: self.subPerks ?? null,
          statPerks: self.statPerks ?? null,
          items: self.items ?? [],
          // 멀티킬 (확장 필드 미수집 매치는 0)
          badge: badgeOf(self) ?? null,
          multikills: {
            double: self.doubleKills ?? 0,
            triple: self.tripleKills ?? 0,
            quadra: self.quadraKills ?? 0,
            penta: self.pentaKills ?? 0,
          },
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
