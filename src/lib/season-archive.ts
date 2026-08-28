// 시즌 마감 랭크 확정 — 라이엇은 과거 시즌 랭크를 안 주므로, 시즌(스플릿)이 닫히기
// 직전에 등록된 소환사 전원의 최종 솔로랭크를 우리가 기록해 둔다. 다음 시즌부터
// 소환사 페이지에 "지난 시즌: 2026 S2 에메랄드 1 · 75LP"로 보여준다.
//
// 흐름: 관리자가 시즌 이름·마감 시각을 예약 → 마감 36시간 전부터 5분마다 한 묶음씩
// (저우선순위) 최종 랭크를 받아 season_ranks에 넣는다 → 마감 시각이 지나면 종료.
// 마감 뒤엔 라이엇이 랭크를 초기화하므로 그 뒤의 값은 절대 쓰지 않는다.
import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { getAccountByRiotId, getLeagueEntries, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { getSetting, setSetting } from "@/lib/store";
import type { PlatformRegion } from "@/lib/riot/types";

const KEY = "season:archive";
const LOCK_KEY = "season:archive:lock";
const LEAD_MS = 36 * 60 * 60_000; // 마감 36시간 전부터 수집 시작
const BATCH = 150; // 틱(5분)당 처리 인원 — 저우선순위 콜 1~2개/명
const TICK_BUDGET_MS = 4 * 60_000;

export type SeasonArchiveStatus = "scheduled" | "running" | "done" | "cancelled";
export interface SeasonArchive {
  season: string; // "2026 S2"
  closesAt: number; // 마감 시각(ms, 이 시각 이후 값은 사용 금지)
  status: SeasonArchiveStatus;
  total: number;
  done: number;
  failed: number;
  startedAt: number | null;
  updatedAt: number;
  lastError: string | null;
}

export interface SeasonRankRow {
  season: string;
  tier: string; // UNRANKED 포함
  rank: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  capturedAt: number;
}

export function getSeasonArchive(): Promise<SeasonArchive | null> {
  return getSetting<SeasonArchive>(KEY);
}

async function save(a: SeasonArchive): Promise<void> {
  await setSetting(KEY, { ...a, updatedAt: Date.now() });
}

export async function scheduleSeasonArchive(season: string, closesAt: number): Promise<SeasonArchive> {
  const a: SeasonArchive = {
    season: season.trim(),
    closesAt,
    status: "scheduled",
    total: 0,
    done: 0,
    failed: 0,
    startedAt: null,
    updatedAt: Date.now(),
    lastError: null,
  };
  await save(a);
  return a;
}

export async function cancelSeasonArchive(): Promise<void> {
  const a = await getSeasonArchive();
  if (a && (a.status === "scheduled" || a.status === "running")) {
    await save({ ...a, status: "cancelled" });
  }
}

/** 5분마다 호출 — 수집 창(마감 36h 전 ~ 마감) 안에서만 한 묶음 처리한다 */
export async function runSeasonArchiveTick(platform: PlatformRegion = "kr"): Promise<void> {
  const a = await getSeasonArchive();
  if (!a || (a.status !== "scheduled" && a.status !== "running")) return;
  const now = Date.now();
  if (now < a.closesAt - LEAD_MS) return; // 아직 창 밖
  if (now > a.closesAt) {
    await save({ ...a, status: "done" });
    return;
  }
  if (await cache.get<number>(LOCK_KEY).catch(() => null)) return;
  await cache.set(LOCK_KEY, now, 4 * 60).catch(() => {});

  const sql = await getSql();
  const fp = riotKeyFp();
  try {
    if (a.status === "scheduled") {
      const t = await sql`SELECT count(*)::int AS n FROM recent_searches WHERE platform = ${platform}`;
      await save({ ...a, status: "running", startedAt: now, total: (t[0]?.n as number) ?? 0 });
    }
    const rows = (await sql`
      SELECT r.game_name, r.tag_line, r.puuid
      FROM recent_searches r
      WHERE r.platform = ${platform}
        AND NOT EXISTS (
          SELECT 1 FROM season_ranks s
          WHERE s.fp = ${fp} AND s.platform = ${platform} AND s.season = ${a.season}
            AND s.game_name_lower = r.game_name_lower AND s.tag_line_lower = r.tag_line_lower)
      ORDER BY r.searched_at DESC
      LIMIT ${BATCH}`) as unknown as { game_name: string; tag_line: string; puuid: string | null }[];

    if (rows.length === 0) {
      const cur = await getSeasonArchive();
      if (cur) await save({ ...cur, status: "done" });
      return;
    }

    let done = 0;
    let failed = 0;
    const deadline = now + TICK_BUDGET_MS;
    await withLowPriority(async () => {
      for (const r of rows) {
        if (Date.now() > deadline) break;
        if (Date.now() > a.closesAt) break; // 마감 지남 — 이후 값은 리셋된 랭크
        try {
          let puuid = r.puuid;
          if (!puuid) {
            const acct = await getAccountByRiotId(platform, r.game_name, r.tag_line);
            puuid = acct.puuid;
          }
          const entries = await getLeagueEntries(platform, puuid, true);
          const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
          await sql`
            INSERT INTO season_ranks
              (fp, platform, puuid, game_name, tag_line, game_name_lower, tag_line_lower,
               season, tier, rank, lp, wins, losses, captured_at)
            VALUES (${fp}, ${platform}, ${puuid}, ${r.game_name}, ${r.tag_line},
                    ${r.game_name.toLowerCase()}, ${r.tag_line.toLowerCase()},
                    ${a.season}, ${solo?.tier ?? "UNRANKED"}, ${solo?.rank ?? null},
                    ${solo?.leaguePoints ?? null}, ${solo?.wins ?? null}, ${solo?.losses ?? null}, now())
            ON CONFLICT (fp, platform, puuid, season) DO UPDATE
            SET tier = EXCLUDED.tier, rank = EXCLUDED.rank, lp = EXCLUDED.lp,
                wins = EXCLUDED.wins, losses = EXCLUDED.losses, captured_at = now()`;
          done++;
        } catch (e) {
          failed++;
          // 삭제·닉변 실패 계정은 UNRANKED로 표시해 무한 재시도를 막는다
          await sql`
            INSERT INTO season_ranks
              (fp, platform, puuid, game_name, tag_line, game_name_lower, tag_line_lower, season, tier, captured_at)
            VALUES (${fp}, ${platform}, ${r.puuid ?? `missing:${r.game_name}#${r.tag_line}`}, ${r.game_name},
                    ${r.tag_line}, ${r.game_name.toLowerCase()}, ${r.tag_line.toLowerCase()},
                    ${a.season}, 'UNRANKED', now())
            ON CONFLICT DO NOTHING`.catch(() => {});
          if (failed <= 3) console.error("[season] 확정 실패", r.game_name, (e as Error)?.message);
        }
      }
    });
    const cur = await getSeasonArchive();
    if (cur) await save({ ...cur, done: cur.done + done, failed: cur.failed + failed });
  } catch (e) {
    const cur = await getSeasonArchive();
    if (cur) await save({ ...cur, lastError: (e as Error)?.message ?? String(e) });
  } finally {
    await cache.delete(LOCK_KEY).catch(() => {});
  }
}

/** 소환사 페이지용 — 지난 시즌 확정 기록 (최근 시즌부터) */
export async function getSeasonRanks(
  platform: PlatformRegion,
  puuid: string,
): Promise<SeasonRankRow[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT season, tier, rank, lp, wins, losses,
           (extract(epoch from captured_at) * 1000)::bigint AS captured_at
    FROM season_ranks
    WHERE fp = ${riotKeyFp()} AND platform = ${platform} AND puuid = ${puuid}
    ORDER BY captured_at DESC`;
  return (rows as unknown as {
    season: string; tier: string; rank: string | null; lp: number | null;
    wins: number | null; losses: number | null; captured_at: string | number;
  }[]).map((r) => ({
    season: r.season,
    tier: r.tier,
    rank: r.rank,
    lp: r.lp,
    wins: r.wins,
    losses: r.losses,
    capturedAt: Number(r.captured_at),
  }));
}
