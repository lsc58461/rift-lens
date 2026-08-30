// 아펙스 래더(챌린저·그랜드마스터) — 라이엇 league-v4의 리그 전체 목록을 주기적으로
// 받아 저장한다. 콜 2개로 명단 전체(LP·승패)가 오므로 값싸고, 명단의 최소 LP가
// 곧 그 티어의 실제 컷이다(포인트→티어 역산, 랭킹 페이지, 컷 표시에 쓴다).
//
// 이름은 목록에 없다(puuid만). summoners 테이블에 있으면 그걸 쓰고, 없는 사람은
// 폴링마다 일부씩 저우선순위로 account-v1을 조회해 채운다 — 며칠이면 전원 확보.
import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { getAccountByPuuid, getApexLeague, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { getApexCutoffsSync, setApexCutoffs } from "@/lib/mmr/rank";
import { currentNamesByPuuid, getSetting, setSetting } from "@/lib/store";
import type { PlatformRegion } from "@/lib/riot/types";

export const APEX_LADDER_TIERS = ["CHALLENGER", "GRANDMASTER"] as const;
export type ApexLadderTier = (typeof APEX_LADDER_TIERS)[number];

const CUTOFF_KEY = "apex:cutoffs";
const POLL_LOCK_KEY = "apex:poll:lock";
const POLL_LOCK_SEC = 25 * 60; // 폴링 주기(30분)보다 조금 짧게 — 인스턴스 2개 중복 방지
const NAMES_PER_POLL = 80; // 폴링마다 이름을 새로 조회할 최대 인원 (콜 = 인원 수)

export interface ApexCutoffs {
  grandmaster: number; // 그마 명단 최소 LP
  challenger: number; // 챌 명단 최소 LP
  counts: { challenger: number; grandmaster: number };
  at: number;
}

export interface LadderRow {
  rankNo: number;
  puuid: string;
  name: string | null; // "게임명#태그" — 아직 못 채웠으면 null
  lp: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
  veteran: boolean;
  freshBlood: boolean;
}

export function getApexCutoffs(): Promise<ApexCutoffs | null> {
  return getSetting<ApexCutoffs>(CUTOFF_KEY);
}

/** 렌더 직전 호출 — 이 프로세스에 컷이 없거나 1시간 넘게 오래됐으면 설정에서 읽어 반영.
 *  (instrumentation의 주기 갱신과 별개로, 페이지 청크가 먼저 뜬 경우를 막는다) */
export async function ensureApexCutoffs(): Promise<void> {
  const cur = getApexCutoffsSync();
  if (cur.loadedAt && Date.now() - cur.loadedAt < 60 * 60_000) return;
  const c = await getApexCutoffs().catch(() => null);
  if (c) setApexCutoffs(c);
}

/** 한 번 폴링: 두 티어 명단 갱신 + 컷 저장 + 이름 일부 보충. 반환: 갱신했는지 */
export async function pollApexLadder(platform: PlatformRegion = "kr"): Promise<boolean> {
  // 인스턴스 2개가 같은 주기에 겹치지 않게 (원자적이진 않지만 30분 주기엔 충분)
  if (await cache.get<number>(POLL_LOCK_KEY).catch(() => null)) return false;
  await cache.set(POLL_LOCK_KEY, Date.now(), POLL_LOCK_SEC).catch(() => {});

  const sql = await getSql();
  const fp = riotKeyFp();
  const now = new Date();
  const counts = { challenger: 0, grandmaster: 0 };
  const mins: Partial<Record<ApexLadderTier, number>> = {};

  for (const tier of APEX_LADDER_TIERS) {
    const list = await getApexLeague(platform, tier);
    const entries = [...list.entries].sort((a, b) => b.leaguePoints - a.leaguePoints);
    if (entries.length === 0) continue;
    mins[tier] = entries[entries.length - 1].leaguePoints;
    if (tier === "CHALLENGER") counts.challenger = entries.length;
    else counts.grandmaster = entries.length;

    // 명단 교체: 티어 단위로 지우고 다시 넣는다 (한 트랜잭션)
    await sql.begin(async (tx) => {
      await tx`DELETE FROM apex_ladder WHERE fp = ${fp} AND platform = ${platform} AND tier = ${tier}`;
      const rows = entries.map((e, i) => ({
        fp,
        platform,
        tier,
        rank_no: i + 1,
        puuid: e.puuid,
        lp: e.leaguePoints,
        wins: e.wins,
        losses: e.losses,
        hot_streak: e.hotStreak ?? false,
        veteran: e.veteran ?? false,
        fresh_blood: e.freshBlood ?? false,
        fetched_at: now,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        await tx`INSERT INTO apex_ladder ${tx(rows.slice(i, i + 200))}`;
      }
    });
  }

  if (mins.CHALLENGER !== undefined && mins.GRANDMASTER !== undefined) {
    await setSetting<ApexCutoffs>(CUTOFF_KEY, {
      grandmaster: mins.GRANDMASTER,
      challenger: mins.CHALLENGER,
      counts,
      at: Date.now(),
    });
  }

  await fillApexNames(platform, NAMES_PER_POLL);
  return true;
}

const NAMES_LOCK_KEY = "apex:names:lock";

/** 래더 명단 중 이름(summoners) 없는 puuid를 저우선순위로 조회해 채운다.
 *  폴링과 별개로 10분마다도 돌린다 — 배포가 잦아 30분 폴링이 자주 끊겨도 이름은 채워지게. */
export async function fillApexNames(platform: PlatformRegion = "kr", limit = 100): Promise<number> {
  if (await cache.get<number>(NAMES_LOCK_KEY).catch(() => null)) return 0;
  await cache.set(NAMES_LOCK_KEY, Date.now(), 8 * 60).catch(() => {});
  try {
    const sql = await getSql();
    const fp = riotKeyFp();
    const unknown = (await sql`
      SELECT a.puuid FROM apex_ladder a
      LEFT JOIN summoners s ON s.fp = a.fp AND s.puuid = a.puuid
      WHERE a.fp = ${fp} AND a.platform = ${platform} AND s.puuid IS NULL
      ORDER BY a.tier = 'CHALLENGER' DESC, a.rank_no
      LIMIT ${limit}`) as unknown as { puuid: string }[];
    if (unknown.length === 0) return 0;
    let ok = 0;
    await withLowPriority(async () => {
      for (const r of unknown) {
        if (await getAccountByPuuid(platform, r.puuid)) ok++; // 성공 시 summoners에 이름 저장됨
      }
    });
    return ok;
  } finally {
    await cache.delete(NAMES_LOCK_KEY).catch(() => {});
  }
}

/** 랭킹 페이지용 명단 (이름은 summoners 테이블에서 조인) */
/** 특정 소환사의 래더(챌·그마) 행 — 없으면(마스터 이하) null. 30분 폴링이라 저장 분석보다 새롭다 */
export async function apexLadderEntry(
  puuid: string,
  platform: PlatformRegion = "kr",
): Promise<{ tier: ApexLadderTier; lp: number; wins: number; losses: number; fetchedAt: number } | null> {
  const sql = await getSql();
  const rows = (await sql`
    SELECT tier, lp, wins, losses, (extract(epoch from fetched_at) * 1000)::bigint AS fetched_at
    FROM apex_ladder WHERE fp = ${riotKeyFp()} AND platform = ${platform} AND puuid = ${puuid}
    LIMIT 1`) as unknown as { tier: ApexLadderTier; lp: number; wins: number; losses: number; fetched_at: string | number }[];
  const r = rows[0];
  return r ? { tier: r.tier, lp: r.lp, wins: r.wins, losses: r.losses, fetchedAt: Number(r.fetched_at) } : null;
}

export async function getApexLadder(
  tier: ApexLadderTier,
  platform: PlatformRegion = "kr",
): Promise<{ rows: LadderRow[]; fetchedAt: number | null }> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const rows = (await sql`
    SELECT rank_no, puuid, lp, wins, losses, hot_streak, veteran, fresh_blood,
           (extract(epoch from fetched_at) * 1000)::bigint AS fetched_at
    FROM apex_ladder WHERE fp = ${fp} AND platform = ${platform} AND tier = ${tier}
    ORDER BY rank_no`) as unknown as {
    rank_no: number;
    puuid: string;
    lp: number;
    wins: number;
    losses: number;
    hot_streak: boolean;
    veteran: boolean;
    fresh_blood: boolean;
    fetched_at: string | number;
  }[];
  const names = await currentNamesByPuuid(fp, rows.map((r) => r.puuid)).catch(
    () => new Map<string, string>(),
  );
  return {
    rows: rows.map((r) => ({
      rankNo: r.rank_no,
      puuid: r.puuid,
      name: names.get(r.puuid) ?? null,
      lp: r.lp,
      wins: r.wins,
      losses: r.losses,
      hotStreak: r.hot_streak,
      veteran: r.veteran,
      freshBlood: r.fresh_blood,
    })),
    fetchedAt: rows[0] ? Number(rows[0].fetched_at) : null,
  };
}
