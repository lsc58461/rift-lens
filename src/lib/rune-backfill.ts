// 룬 백필 — 룬 저장 도입 전에 기록된 매치를 라이엇에서 다시 받아
// 룬 필드를 채운다. 매치는 불변이라 한 번 채우면 끝. 호출은 전부
// 저우선순위라 유저 검색이 먼저다.

import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { getMatch, getMatchTimeline, harvestStartItems, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { chainNextRound } from "@/lib/round-chain";
import { getSetting, setSetting } from "@/lib/store";
import { RiotApiError, type PlatformRegion } from "@/lib/riot/types";

const STATE_KEY = "runefill:state";
const PER_ROUND = 25; // 라운드당 매치 수 (호출 2회/매치: 본문+타임라인)
const TURBO_PER_ROUND = 60; // 최고속 모드 라운드당 매치 수 (라운드 오버헤드 절감)
const ROUND_STALE_MS = 300_000;

export interface RunefillState {
  running: boolean;
  roundActive: boolean;
  done: boolean;
  total: number; // 시작 시점의 미보유 매치 수
  filled: number;
  failed: number;
  rounds: number;
  /** 채운 것 없이 실패만 한 연속 라운드 수 — 쌓이면 안전 종료 */
  noProgressRounds?: number;
  /** 최고속 모드 — 저우선순위 해제 + 라운드 배치 확대(유저 검색과 한도 경쟁) */
  turbo?: boolean;
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
      AND jsonb_array_length(participants) > 0
      AND (NOT (participants->0 ? 'keystone') OR patch IS NULL
           OR NOT build_harvested)`;
  return (r[0]?.n as number) ?? 0;
}

export async function beginRunefill(turbo = false): Promise<RunefillState> {
  const total = await countMissingRunes();
  const next: RunefillState = {
    running: total > 0,
    roundActive: false,
    done: total === 0,
    total,
    filled: 0,
    failed: 0,
    rounds: 0,
    turbo,
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

/** 진행 중에도 최고속 모드를 켜고 끈다 (다음 라운드부터 반영) */
export async function setRunefillTurbo(turbo: boolean): Promise<RunefillState | null> {
  const s = await getRunefillState();
  if (!s) return null;
  const next = { ...s, turbo };
  await save(next);
  return next;
}

export async function runRunefillRound(origin?: string): Promise<void> {
  let state = await getRunefillState();
  if (!state?.running) return;
  if (state.roundActive && Date.now() - state.updatedAt < ROUND_STALE_MS) return;
  await save({ ...state, roundActive: true });

  try {
    const sql = await getSql();
    const fp = riotKeyFp();
    // 최고속 모드: 저우선순위를 풀어 라이엇 한도를 유저 검색과 동등하게 쓰고,
    // 라운드 배치도 키운다. 평시엔 저우선순위로 유저에 양보한다.
    const turbo = state.turbo === true;
    const runAt = <T>(fn: () => Promise<T>): Promise<T> =>
      turbo ? fn() : withLowPriority(fn);
    const perRound = turbo ? TURBO_PER_ROUND : PER_ROUND;
    const rows = await sql`
      SELECT match_id, platform,
             ((participants->0 ? 'keystone') AND patch IS NOT NULL) AS body_ok
      FROM matches
      WHERE fp = ${fp}
        AND jsonb_array_length(participants) > 0
        AND (NOT (participants->0 ? 'keystone') OR patch IS NULL
             OR NOT build_harvested)
      ORDER BY game_creation DESC LIMIT ${perRound}`;

    if (rows.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }

    let filled = 0;
    let failed = 0;
    let i = 0;
    for (const r of rows as unknown as { match_id: string; platform: PlatformRegion; body_ok: boolean }[]) {
      // 5개마다 취소 확인
      if (i++ % 5 === 0 && !((await getRunefillState())?.running ?? false)) break;
      try {
        // 본문(룬·패치)이 이미 채워진 매치는 타임라인만 받는다 — 호출 절약
        if (!r.body_ok) {
          await runAt(() => getMatch(r.platform, r.match_id, true));
        }
        // 같은 매치의 타임라인으로 시작 아이템도 수확 (매치당 1회 마커로 중복 방지).
        // 수확 후 타임라인 캐시는 지운다 — 수천 매치 분량이 KV에 쌓이는 것 방지
        await runAt(() =>
          getMatchTimeline(r.platform, r.match_id).then(async (tl) => {
            await harvestStartItems(r.platform, r.match_id, tl);
            await cache.delete(`timeline:${fp}:${r.match_id}`).catch(() => {});
          }),
        ).catch(async (e) => {
          // 타임라인이 진짜 없는 매치(404)만 완료 표시 — 일시 오류는 재시도 여지
          if (e instanceof RiotApiError && e.status === 404) {
            await sql`
              UPDATE matches SET build_harvested = true
              WHERE fp = ${fp} AND match_id = ${r.match_id}`.catch(() => {});
          }
        });
        filled++;
      } catch (e) {
        failed++;
        // 404(라이엇에 진짜 없는 매치)만 영구 제외한다 — 레이트리밋·5xx 같은
        // 일시 오류로 실패한 매치는 그대로 둬서 다음 백필이 다시 시도한다
        const permanent = e instanceof RiotApiError && e.status === 404;
        if (permanent) {
          await sql`
            UPDATE matches
            SET participants = jsonb_set(participants, '{0,keystone}', 'null'),
                build_harvested = true
            WHERE fp = ${fp} AND match_id = ${r.match_id}`.catch(() => {});
        }
      }
    }

    state = (await getRunefillState()) ?? state;
    // 404가 아닌 오류만 남은 꼬리 매치를 무한 재시도하지 않도록,
    // 채운 것 없이 실패만 한 라운드가 3번 이어지면 안전 종료한다
    // (남은 매치는 다음에 백필을 다시 시작하면 재시도된다)
    const noProgress = filled === 0 && failed > 0
      ? (state.noProgressRounds ?? 0) + 1
      : 0;
    const giveUp = noProgress >= 3;
    await save({
      ...state,
      running: giveUp ? false : state.running,
      roundActive: false,
      rounds: state.rounds + 1,
      filled: state.filled + filled,
      failed: state.failed + failed,
      noProgressRounds: noProgress,
      lastError: giveUp
        ? "일시 오류가 계속돼 잠시 멈췄어요 — 나중에 다시 시작하면 이어서 시도합니다"
        : null,
    });
    const next = await getRunefillState();
    if (origin && next?.running && !next.done) {
      await chainNextRound(origin, "/api/admin/rune-backfill");
    }
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
