import "server-only";
import { createHash } from "crypto";
import {
  currentPriority,
  riotLimiter,
  withLowPriority as withLowPriorityFn,
} from "./limiter";
import { recordRateLimitHit, trackRateLimiter } from "./rate-status";
import { cache, cached } from "@/lib/cache";
import { getSql as getDbSql } from "@/lib/db";
import { getCompletedItemIds, getDDragonVersion } from "@/lib/ddragon";
import { canon } from "@/lib/identity";
import {
  clearRenameMapping,
  findSummonerByName,
  findSummonerByPuuid,
  getMatchRow,
  insertLeagueSnapshot,
  latestLeagueSnapshot,
  listLeagueSnapshots,
  migrateIdentity,
  recordNameChange,
  saveMatchRow,
  updateSummonerProfile,
  recentSearchPuuid,
  upsertSummonerNames,
  type LeagueSnapRow,
} from "@/lib/store";
import {
  PLATFORM_TO_ROUTING,
  RiotApiError,
  type LeagueEntry,
  type MatchInfo,
  type PlatformRegion,
  type RiotAccount,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUMMONER_FRESH_MS = 24 * 60 * 60_000;
// 참가자 랭크는 "로비 수준"을 재는 표본이라 며칠 묵어도 평균에 미치는 영향이 작다 —
// 72h 캐시로 재사용률을 극대화한다. 한 분석에서 조회·적재한 참가자 랭크
// (league_snapshots)를 이후 다른 소환사 분석·같은 로비·quick→deep 사이에서 공유해
// 라이엇 API 콜을 크게 아낀다.
// 검색 대상 본인 랭크는 bypassCache로 항상 최신을 받아 표시 정확도를 유지한다.
const LEAGUE_FRESH_MS = 72 * 60 * 60_000;

// PUUID는 API 키 단위로 암호화되므로, 키가 바뀌면 저장 데이터를 새로 받도록
// 키 지문(fingerprint)으로 스코프한다
let cachedFp: string | null = null;
function keyFp(): string {
  if (!cachedFp) {
    cachedFp = createHash("sha256")
      .update(process.env.RIOT_API_KEY ?? "")
      .digest("hex")
      .slice(0, 8);
  }
  return cachedFp;
}

async function riotFetch<T>(url: string): Promise<T> {
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) throw new Error("RIOT_API_KEY가 설정되지 않았습니다 (.env.local)");

  // 429는 다른 인스턴스와의 합산 한도 초과일 수 있어 더 끈질기게 재시도한다
  for (let attempt = 0; attempt < 6; attempt++) {
    trackRateLimiter(); // 어드민 관측용 — 대기가 시작되기 전에 발행을 켠다
    await riotLimiter.acquire(currentPriority());
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-Riot-Token": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // 커넥션 정체/타임아웃 — 잠시 후 재시도
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
      await recordRateLimitHit(retryAfter, url).catch(() => {});
      await sleep(retryAfter * 1000 + 500);
      continue;
    }
    if (res.status >= 500) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    throw new RiotApiError(res.status, url);
  }
  throw new RiotApiError(429, url);
}

/** Riot ID(게임명#태그)로 계정 조회 — summoners 테이블 24h 신선도 */
export async function getAccountByRiotId(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<RiotAccount> {
  const row = await findSummonerByName(
    keyFp(),
    platform,
    gameName,
    tagLine,
    SUMMONER_FRESH_MS,
  );
  if (row) {
    return { puuid: row.puuid, gameName: row.game_name, tagLine: row.tag_line };
  }
  const routing = PLATFORM_TO_ROUTING[platform];
  let account: RiotAccount;
  try {
    account = await riotFetch<RiotAccount>(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  } catch (e) {
    // 닉변 추적 — riot-id가 사라졌으면(404) 저장된 puuid로 현재 이름을 역조회한다.
    // 검색뿐 아니라 전체 갱신 sweep도 이 경로를 타므로, 닉변 계정이 자동 승계된다.
    if (e instanceof RiotApiError && e.status === 404) {
      const known = await findSummonerByName(
        keyFp(),
        platform,
        gameName,
        tagLine,
        Number.POSITIVE_INFINITY, // 오래된 행이어도 puuid만 있으면 된다
      );
      // 시드 수집으로 등록된 계정은 summoners엔 없고 recent_searches에만 puuid가 있다
      const knownPuuid =
        known?.puuid ??
        (await recentSearchPuuid(platform, gameName, tagLine).catch(() => null));
      if (knownPuuid) {
        const current = await getAccountByPuuid(platform, knownPuuid);
        if (
          current &&
          (canon(current.gameName) !== canon(gameName) ||
            canon(current.tagLine) !== canon(tagLine))
        ) {
          // 이름만 바뀌고 계정은 살아있음 — 새 이름으로 승계 후 반환
          await recordNameChange(
            platform,
            gameName,
            tagLine,
            current.gameName,
            current.tagLine,
          ).catch(() => {});
          await migrateIdentity(
            platform,
            current.puuid,
            current.gameName,
            current.tagLine,
          ).catch(() => {});
          return current;
        }
      }
    }
    throw e; // 폴백 실패(진짜 삭제 등) — 원래 오류 유지
  }
  await upsertSummonerNames(
    keyFp(),
    platform,
    account.puuid,
    account.gameName,
    account.tagLine,
  );
  // 닉변 감지 — 입력한 이름과 실제 반환된 이름이 다르면(대소문자 제외) 이력 기록
  if (
    canon(gameName) !== canon(account.gameName) ||
    canon(tagLine) !== canon(account.tagLine)
  ) {
    await recordNameChange(
      platform,
      gameName,
      tagLine,
      account.gameName,
      account.tagLine,
    ).catch(() => {});
  } else {
    // 이 이름이 실존 계정으로 확인됨 — 남이 옛 이름을 가져간 경우를 대비해
    // 이 이름을 old로 갖는 닉변 매핑을 무효화한다 (잘못된 리다이렉트 방지)
    await clearRenameMapping(platform, account.gameName, account.tagLine).catch(
      () => {},
    );
  }
  // 닉변 승계 — 같은 puuid의 옛 닉네임 기록을 새 닉네임으로 정리
  await migrateIdentity(
    platform,
    account.puuid,
    account.gameName,
    account.tagLine,
  ).catch(() => {});
  return account;
}

// 닉네임 점유 확인 캐시 — 리다이렉트 경로마다 API를 두드리지 않도록 6시간 보관
const TAKEN_TTL_SEC = 6 * 60 * 60;

/**
 * 해당 Riot ID를 지금 쓰고 있는 계정이 있는지 확인한다 (summoners 캐시 우회 raw 조회).
 * 롤 닉네임은 재사용 가능해서, 닉변 리다이렉트 전에 옛 이름이 비어 있는지 확인하는 용도.
 * true=주인 있음 / false=비어 있음 / null=확인 실패(레이트리밋·장애 등)
 */
export async function isRiotIdTaken(
  platform: PlatformRegion,
  gameName: string,
  tagLine: string,
): Promise<boolean | null> {
  const key = `taken:${keyFp()}:${platform}:${canon(gameName)}#${canon(tagLine)}`;
  const hit = await cache.get<boolean>(key);
  if (hit !== null) return hit;

  const routing = PLATFORM_TO_ROUTING[platform];
  let taken: boolean;
  try {
    const account = await riotFetch<RiotAccount>(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
    taken = true;
    // 실존 계정이니 이름 기록도 최신화해 둔다
    await upsertSummonerNames(
      keyFp(),
      platform,
      account.puuid,
      account.gameName,
      account.tagLine,
    ).catch(() => {});
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) taken = false;
    else return null;
  }
  await cache.set(key, taken, TAKEN_TTL_SEC);
  return taken;
}

/**
 * puuid로 현재 Riot ID 조회 — 닉변 후 새 이름을 찾을 때 사용.
 * 저장된 기록의 옛 이름으로 검색됐을 때 리다이렉트 대상을 알아낸다.
 */
export async function getAccountByPuuid(
  platform: PlatformRegion,
  puuid: string,
): Promise<RiotAccount | null> {
  const routing = PLATFORM_TO_ROUTING[platform];
  try {
    const account = await riotFetch<RiotAccount>(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
    );
    await upsertSummonerNames(
      keyFp(),
      platform,
      account.puuid,
      account.gameName,
      account.tagLine,
    ).catch(() => {});
    return account;
  } catch {
    return null;
  }
}

/** 소환사 프로필(아이콘/레벨) 조회. bypassCache=true면 항상 최신(아이콘 인증용) */
export async function getSummoner(
  platform: PlatformRegion,
  puuid: string,
  bypassCache = false,
): Promise<{ profileIconId: number; summonerLevel: number }> {
  const row = bypassCache ? null : await findSummonerByPuuid(keyFp(), puuid);
  if (
    row?.profile_icon_id != null &&
    row.summoner_level != null &&
    Date.now() - new Date(row.updated_at).getTime() < SUMMONER_FRESH_MS
  ) {
    return {
      profileIconId: row.profile_icon_id,
      summonerLevel: row.summoner_level,
    };
  }
  const summoner = await riotFetch<{
    profileIconId: number;
    summonerLevel: number;
  }>(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
  );
  await updateSummonerProfile(
    keyFp(),
    puuid,
    summoner.profileIconId,
    summoner.summonerLevel,
  ).catch(() => {});
  return summoner;
}

/**
 * 현재 랭크(솔로랭크/자유랭크) 조회. 언랭이면 빈 배열.
 * league_snapshots에 히스토리로 적재된다 (향후 LP 득실 추적 기반).
 */
export async function getLeagueEntries(
  platform: PlatformRegion,
  puuid: string,
  bypassCache = false,
): Promise<LeagueEntry[]> {
  if (!bypassCache) {
    const snap = await latestLeagueSnapshot(
      keyFp(),
      platform,
      puuid,
      LEAGUE_FRESH_MS,
    );
    if (snap) return snap;
  }
  const entries = await riotFetch<LeagueEntry[]>(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
  );
  // 랭크 히스토리 적재 (LP 인사이트용)
  await insertLeagueSnapshot(keyFp(), platform, puuid, entries).catch(() => {});
  return entries;
}

/** 현재 API 키 지문 — puuid 스코프 데이터 조회 시 사용 */
export function riotKeyFp(): string {
  return keyFp();
}

/** 시즌 랭크 총 판수 — 매치 ID 페이징으로 센다 (100판당 1콜, 상한 500) */
export async function riotCountRankedMatches(
  platform: PlatformRegion,
  puuid: string,
): Promise<{ total: number; capped: boolean }> {
  const routing = PLATFORM_TO_ROUTING[platform];
  let total = 0;
  for (let start = 0; start < 500; start += 100) {
    const ids = await riotFetch<string[]>(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&start=${start}&count=100`,
    );
    total += ids.length;
    if (ids.length < 100) return { total, capped: false };
  }
  return { total, capped: true };
}

/** 랭크 스냅샷 히스토리 — LP 득실 추적용 (API 호출 없음, DB만 조회) */
export function getLeagueHistory(
  platform: PlatformRegion,
  puuid: string,
): Promise<LeagueSnapRow[]> {
  return listLeagueSnapshots(keyFp(), platform, puuid);
}

/** 최근 솔로랭크 매치 ID 목록 — 짧은 신선도라 KV 캐시 유지 */
export async function getRankedMatchIds(
  platform: PlatformRegion,
  puuid: string,
  count: number,
  bypassCache = false,
): Promise<string[]> {
  const routing = PLATFORM_TO_ROUTING[platform];
  const key = `${keyFp()}:matchids:${routing}:${puuid}:${count}`;
  const url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&start=0&count=${count}`;
  if (bypassCache) {
    const ids = await riotFetch<string[]>(url);
    await cache.set(key, ids, 60 * 10);
    return ids;
  }
  return cached(key, 60 * 10, () => riotFetch<string[]>(url));
}

/** 매치 상세 — 불변 데이터라 matches 테이블에 영구 보관 */
export async function getMatch(
  platform: PlatformRegion,
  matchId: string,
  /** true면 저장분을 무시하고 다시 받아 덮어쓴다 (룬 백필용) */
  force = false,
): Promise<MatchInfo> {
  const row = force ? null : await getMatchRow(keyFp(), matchId);
  // 확장 필드(cs)가 있으면 저장분 사용, 없으면(구버전 저장) 재조회해 채운다
  if (row && row.participants[0]?.cs !== undefined) return row;

  const routing = PLATFORM_TO_ROUTING[platform];
  interface RawParticipant {
    puuid: string;
    riotIdGameName: string;
    riotIdTagline: string;
    teamId: number;
    win: boolean;
    championName: string;
    kills: number;
    deaths: number;
    assists: number;
    teamPosition: string;
    champLevel: number;
    totalMinionsKilled: number;
    neutralMinionsKilled: number;
    goldEarned: number;
    totalDamageDealtToChampions: number;
    visionScore: number;
    summoner1Id: number;
    summoner2Id: number;
    perks?: {
      statPerks?: { offense?: number; flex?: number; defense?: number };
      styles?: {
        description?: string;
        style?: number;
        selections?: { perk?: number }[];
      }[];
    };
    item0: number;
    item1: number;
    item2: number;
    item3: number;
    item4: number;
    item5: number;
    item6: number;
    // 확장 캡처 필드 (전부 옵셔널 — 응답에 있으면 저장)
    championId?: number;
    individualPosition?: string;
    goldSpent?: number;
    totalDamageTaken?: number;
    damageSelfMitigated?: number;
    damageDealtToObjectives?: number;
    damageDealtToTurrets?: number;
    totalHeal?: number;
    totalHealsOnTeammates?: number;
    totalDamageShieldedOnTeammates?: number;
    timeCCingOthers?: number;
    turretKills?: number;
    inhibitorKills?: number;
    dragonKills?: number;
    baronKills?: number;
    objectivesStolen?: number;
    wardsPlaced?: number;
    wardsKilled?: number;
    visionWardsBoughtInGame?: number;
    largestKillingSpree?: number;
    largestMultiKill?: number;
    doubleKills?: number;
    tripleKills?: number;
    quadraKills?: number;
    pentaKills?: number;
    firstBloodKill?: boolean;
    firstTowerKill?: boolean;
    gameEndedInSurrender?: boolean;
    gameEndedInEarlySurrender?: boolean;
    challenges?: { killParticipation?: number; soloKills?: number };
  }
  interface RawTeam {
    teamId: number;
    win: boolean;
    objectives?: Record<string, { first?: boolean; kills?: number }>;
    bans?: { championId: number }[];
  }
  const raw = await riotFetch<{
    info: {
      gameCreation: number;
      gameDuration: number;
      gameVersion?: string;
      queueId: number;
      teams?: RawTeam[];
      participants: RawParticipant[];
    };
  }>(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
  // 전적 표시에 필요한 필드만 남긴다 (풀 응답은 매우 큼)
  // 라이엇이 유실된 매치를 404가 아닌 '모든 필드 0 + 참가자 빈 배열'의
  // 정상 응답으로 주는 경우가 있다 — 저장하면 손상 행이 되므로 걸러낸다
  if (!raw.info.participants?.length || !raw.info.gameCreation) {
    throw new RiotApiError(404, `empty match husk: ${matchId}`);
  }
  const match: MatchInfo = {
    matchId,
    gameCreation: raw.info.gameCreation,
    gameDuration: raw.info.gameDuration,
    queueId: raw.info.queueId,
    patch: raw.info.gameVersion?.split(".").slice(0, 2).join("."),
    bans: (raw.info.teams ?? [])
      .flatMap((t) => (t.bans ?? []).map((b) => b.championId))
      .filter((id) => typeof id === "number" && id > 0),
    teams: (raw.info.teams ?? []).map((t) => {
      const o = t.objectives ?? {};
      return {
        teamId: t.teamId,
        win: t.win,
        firstBlood: o.champion?.first,
        firstTower: o.tower?.first,
        dragon: o.dragon?.kills,
        herald: o.riftHerald?.kills,
        baron: o.baron?.kills,
        tower: o.tower?.kills,
        inhibitor: o.inhibitor?.kills,
        atakhan: o.atakhan?.kills,
      };
    }),
    participants: raw.info.participants.map((p) => ({
      puuid: p.puuid,
      riotIdGameName: p.riotIdGameName,
      riotIdTagline: p.riotIdTagline,
      teamId: p.teamId,
      win: p.win,
      championName: p.championName,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      teamPosition: p.teamPosition,
      champLevel: p.champLevel,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      goldEarned: p.goldEarned,
      damage: p.totalDamageDealtToChampions,
      visionScore: p.visionScore,
      spell1Id: p.summoner1Id,
      spell2Id: p.summoner2Id,
      keystone: p.perks?.styles?.find((s) => s.description === "primaryStyle")
        ?.selections?.[0]?.perk,
      subStyle: p.perks?.styles?.find((s) => s.description === "subStyle")
        ?.style,
      perks: p.perks?.styles
        ?.find((s) => s.description === "primaryStyle")
        ?.selections?.map((sel) => sel.perk ?? 0),
      subPerks: p.perks?.styles
        ?.find((s) => s.description === "subStyle")
        ?.selections?.map((sel) => sel.perk ?? 0),
      statPerks: p.perks?.statPerks
        ? [
            p.perks.statPerks.offense ?? 0,
            p.perks.statPerks.flex ?? 0,
            p.perks.statPerks.defense ?? 0,
          ]
        : undefined,
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      // 확장 캡처 필드
      championId: p.championId,
      individualPosition: p.individualPosition,
      csTotal: p.totalMinionsKilled,
      csJungle: p.neutralMinionsKilled,
      goldSpent: p.goldSpent,
      damageTaken: p.totalDamageTaken,
      damageMitigated: p.damageSelfMitigated,
      damageToObjectives: p.damageDealtToObjectives,
      damageToTurrets: p.damageDealtToTurrets,
      totalHeal: p.totalHeal,
      healOnTeammates: p.totalHealsOnTeammates,
      shieldOnTeammates: p.totalDamageShieldedOnTeammates,
      ccScore: p.timeCCingOthers,
      turretKills: p.turretKills,
      inhibitorKills: p.inhibitorKills,
      dragonKills: p.dragonKills,
      baronKills: p.baronKills,
      objectivesStolen: p.objectivesStolen,
      wardsPlaced: p.wardsPlaced,
      wardsKilled: p.wardsKilled,
      controlWardsBought: p.visionWardsBoughtInGame,
      largestKillingSpree: p.largestKillingSpree,
      largestMultiKill: p.largestMultiKill,
      doubleKills: p.doubleKills,
      tripleKills: p.tripleKills,
      quadraKills: p.quadraKills,
      pentaKills: p.pentaKills,
      firstBloodKill: p.firstBloodKill,
      firstTowerKill: p.firstTowerKill,
      killParticipation: p.challenges?.killParticipation,
      soloKills: p.challenges?.soloKills,
      gameEndedInSurrender: p.gameEndedInSurrender,
      gameEndedInEarlySurrender: p.gameEndedInEarlySurrender,
    })),
  };
  await saveMatchRow(keyFp(), platform, match).catch(() => {});
  return match;
}

// ── 매치 타임라인 (아이템 빌드·스킬 순서) ────────────────
// 풀 타임라인 응답은 수백 KB라 참가자별 필요한 이벤트만 파싱해 30일 캐시한다.
// 매치는 불변이므로 한 번 파싱하면 다시 부를 일이 없다.

export interface TimelineItemEvent {
  minute: number;
  itemId: number;
  type: "buy" | "sell";
}

export interface TimelinePlayer {
  items: TimelineItemEvent[];
  /** 스킬 슬롯 순서 (1=Q 2=W 3=E 4=R) */
  skills: number[];
}

export async function getMatchTimeline(
  platform: PlatformRegion,
  matchId: string,
): Promise<Record<string, TimelinePlayer>> {
  const routing = PLATFORM_TO_ROUTING[platform];
  return cached(`timeline:${keyFp()}:${matchId}`, 60 * 60 * 24 * 30, async () => {
    const raw = await riotFetch<{
      metadata: { participants: string[] };
      info: {
        frames: {
          events: {
            type: string;
            timestamp: number;
            participantId?: number;
            itemId?: number;
            beforeId?: number;
            skillSlot?: number;
          }[];
        }[];
      };
    }>(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
    );

    const byId = new Map<number, TimelinePlayer>();
    for (let i = 1; i <= raw.metadata.participants.length; i++) {
      byId.set(i, { items: [], skills: [] });
    }
    for (const frame of raw.info.frames) {
      for (const ev of frame.events) {
        const pl = ev.participantId ? byId.get(ev.participantId) : undefined;
        if (!pl) continue;
        const minute = Math.floor(ev.timestamp / 60_000);
        if (ev.type === "ITEM_PURCHASED" && ev.itemId) {
          pl.items.push({ minute, itemId: ev.itemId, type: "buy" });
        } else if (ev.type === "ITEM_SOLD" && ev.itemId) {
          pl.items.push({ minute, itemId: ev.itemId, type: "sell" });
        } else if (ev.type === "ITEM_UNDO") {
          // 마지막 구매/판매를 되돌린다
          const idx = pl.items.findLastIndex(
            (e) => e.itemId === (ev.beforeId || ev.itemId),
          );
          if (idx >= 0) pl.items.splice(idx, 1);
        } else if (ev.type === "SKILL_LEVEL_UP" && ev.skillSlot) {
          pl.skills.push(ev.skillSlot);
        }
      }
    }

    const out: Record<string, TimelinePlayer> = {};
    raw.metadata.participants.forEach((puuid, i) => {
      out[puuid] = byId.get(i + 1)!;
    });
    return out;
  });
}

// ── 시작 아이템 수확 ─────────────────────────────────────
// 타임라인의 첫 90초 구매를 챔피언별로 집계한다. 최종 인벤토리(매치 저장분)
// 에는 시작 아이템이 남지 않으므로 타임라인이 유일한 출처다.
// 매치당 1회만 집계되도록 마커를 남긴다 (백필 재시도·빌드탭 중복 방지).

const START_WINDOW_MS = 90_000;

export async function harvestStartItems(
  platform: PlatformRegion,
  matchId: string,
  /** 이미 받아둔 타임라인이 있으면 재사용 (없으면 새로 호출) */
  timeline?: Record<string, TimelinePlayer>,
): Promise<void> {
  const fp = keyFp();
  const [tl, row, completedIds] = await Promise.all([
    timeline ? Promise.resolve(timeline) : getMatchTimeline(platform, matchId),
    getMatchRow(fp, matchId),
    getDDragonVersion().then(getCompletedItemIds),
  ]);
  if (!row) return;
  const completed = new Set(completedIds);
  const sql = await getDbSql();

  // 시작 아이템 (매치당 1회 마커)
  const sihMarker = `sih:${fp}:${matchId}`;
  if (!(await cache.get(sihMarker))) {
    for (const p of row.participants) {
      const pl = tl[p.puuid];
      if (!pl) continue;
      const starts = pl.items
        .filter((e) => e.type === "buy" && e.minute * 60_000 <= START_WINDOW_MS)
        .map((e) => e.itemId)
        .sort((a, b) => a - b);
      if (starts.length === 0) continue;
      await sql`
        INSERT INTO start_items (fp, champ, items, games, wins)
        VALUES (${fp}, ${p.championName}, ${starts.join(",")}, 1, ${p.win ? 1 : 0})
        ON CONFLICT (fp, champ, items) DO UPDATE
        SET games = start_items.games + 1,
            wins = start_items.wins + ${p.win ? 1 : 0}`;
    }
    await cache.set(sihMarker, 1, 60 * 60 * 24 * 60);
  }

  // 코어 빌드 순서: 완성 아이템의 첫 구매 3개 (판매·중복 제외, 매치당 1회 마커)
  const bpMarker = `bp:${fp}:${matchId}`;
  if (!(await cache.get(bpMarker)) && completed.size > 0) {
    for (const p of row.participants) {
      const pl = tl[p.puuid];
      if (!pl) continue;
      const path: number[] = [];
      for (const e of pl.items) {
        if (e.type !== "buy" || !completed.has(e.itemId)) continue;
        if (path.includes(e.itemId)) continue;
        path.push(e.itemId);
        if (path.length >= 3) break;
      }
      if (path.length < 2) continue; // 코어 2개도 못 갔으면 표본 제외
      await sql`
        INSERT INTO build_paths (fp, champ, path, games, wins)
        VALUES (${fp}, ${p.championName}, ${path.join(">")}, 1, ${p.win ? 1 : 0})
        ON CONFLICT (fp, champ, path) DO UPDATE
        SET games = build_paths.games + 1,
            wins = build_paths.wins + ${p.win ? 1 : 0}`;
    }
    await cache.set(bpMarker, 1, 60 * 60 * 24 * 60);
  }

  await sql`
    UPDATE matches SET build_harvested = true
    WHERE fp = ${fp} AND match_id = ${matchId}`.catch(() => {});
}

/** 분석에 쓰인 매치 중 빌드 데이터(시작 아이템·코어 순서)가 아직 없는 것을
 * 골라 타임라인을 수확한다. 정밀 분석 완료 훅에서 호출 — 활동 중인 유저의
 * 새 매치는 대부분 1~5개뿐이라 저우선순위 몇 콜로 끝난다. 상한으로 지연을
 * 묶고, 남은 것은 다음 분석이나 백필이 이어받는다. */
export async function harvestMissingBuildData(
  platform: PlatformRegion,
  matchIds: string[],
  cap = 10,
): Promise<void> {
  if (matchIds.length === 0) return;
  const sql = await getDbSql();
  const fp = keyFp();
  const rows = await sql`
    SELECT match_id FROM matches
    WHERE fp = ${fp} AND match_id = ANY(${matchIds})
      AND NOT build_harvested AND jsonb_array_length(participants) > 0
    ORDER BY game_creation DESC LIMIT ${cap}`;
  for (const r of rows as unknown as { match_id: string }[]) {
    try {
      const tl = await withLowPriorityFn(() =>
        getMatchTimeline(platform, r.match_id),
      );
      await harvestStartItems(platform, r.match_id, tl);
      // 수확용으로 받은 타임라인 캐시는 남기지 않는다 (KV 비대 방지)
      await cache.delete(`timeline:${fp}:${r.match_id}`).catch(() => {});
    } catch (e) {
      // 타임라인이 진짜 없는 매치(404)만 완료 표시 — 일시 오류는 다음 기회에
      if (e instanceof RiotApiError && e.status === 404) {
        await sql`
          UPDATE matches SET build_harvested = true
          WHERE fp = ${fp} AND match_id = ${r.match_id}`.catch(() => {});
      }
    }
  }
}
