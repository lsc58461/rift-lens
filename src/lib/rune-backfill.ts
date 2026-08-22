// 룬 백필 — 룬 저장 도입 전에 기록된 매치를 라이엇에서 다시 받아
// 룬 필드를 채운다. 매치는 불변이라 한 번 채우면 끝. 호출은 전부
// 저우선순위라 유저 검색이 먼저다.

import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { getMatch, getMatchTimeline, harvestStartItems, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { getSetting, setSetting } from "@/lib/store";
import type { PlatformRegion } from "@/lib/riot/types";

const STATE_KEY = "runefill:state";
const PER_ROUND = 25; // 라운드당 매치 수 (호출 2회/매치: 본문+타임라인)
const ROUND_STALE_MS = 300_000;

export interface RunefillState {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  total: number; // 시작 시점의 미보유 매치 수
  filled: number;
  failed: number;
  rounds: number;
  startedAt: number;
  updatedAt: number;
  lastError: string | null;
}

export function getRunefillState(): Promise<RunefillState | null> {
  return getSetting<RunefillState>(STATE_KEY);
}

async function save(s: RunefillState): Promise<void> {
  await setSetting(STATE_KEY, { ...s, updatedAt: Date.now() });
}

/** 룬이 없는 저장 매치 수 */
export async function countMissingRunes(): Promise<number> {
  const sql = await getSql();
  const r = await sql`
    SELECT count(*)::int AS n FROM matches
    WHERE fp = ${riotKeyFp()}
      AND (NOT (participants->0 ? 'keystone') OR patch IS NULL)`;
  return (r[0]?.n as number) ?? 0;
}

export async function beginRunefill(): Promise<RunefillState> {
  const total = await countMissingRunes();
  const next: RunefillState = {
    running: total > 0,
    roundActive: false,
    done: total === 0,
    total,
    filled: 0,
    failed: 0,
    rounds: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastError: null,
  };
  await save(next);
  return next;
}

export async function stopRunefill(): Promise<void> {
  const s = await getRunefillState();
  if (s) await save({ ...s, running: false, roundActive: false });
}

export async function runRunefillRound(): Promise<void> {
  let state = await getRunefillState();
  if (!state?.running) return;
  if (state.roundActive && Date.now() - state.updatedAt < ROUND_STALE_MS) return;
  await save({ ...state, roundActive: true });

  try {
    const sql = await getSql();
    const fp = riotKeyFp();
    const rows = await sql`
      SELECT match_id, platform FROM matches
      WHERE fp = ${fp}
        AND (NOT (participants->0 ? 'keystone') OR patch IS NULL)
      ORDER BY game_creation DESC LIMIT ${PER_ROUND}`;

    if (rows.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }

    let filled = 0;
    let failed = 0;
    for (const r of rows as unknown as { match_id: string; platform: PlatformRegion }[]) {
      try {
        await withLowPriority(() => getMatch(r.platform, r.match_id, true));
        // 같은 매치의 타임라인으로 시작 아이템도 수확 (매치당 1회 마커로 중복 방지).
        // 수확 후 타임라인 캐시는 지운다 — 수천 매치 분량이 KV에 쌓이는 것 방지
        await withLowPriority(() =>
          getMatchTimeline(r.platform, r.match_id).then(async (tl) => {
            await harvestStartItems(r.platform, r.match_id, tl);
            await cache.delete(`timeline:${fp}:${r.match_id}`).catch(() => {});
          }),
        ).catch(() => {});
        filled++;
      } catch {
        failed++;
        // 다시 받을 수 없는 매치(만료 등)는 키를 null로 박아 재시도 대상에서 제외
        await sql`
          UPDATE matches SET participants = jsonb_set(participants, '{0,keystone}', 'null')
          WHERE fp = ${fp} AND match_id = ${r.match_id}`.catch(() => {});
      }
    }

    state = (await getRunefillState()) ?? state;
    await save({
      ...state,
      roundActive: false,
      rounds: state.rounds + 1,
      filled: state.filled + filled,
      failed: state.failed + failed,
      lastError: null,
    });
  } catch (e) {
    const s = await getRunefillState();
    if (s) {
      await save({
        ...s,
        running: false,
        roundActive: false,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
