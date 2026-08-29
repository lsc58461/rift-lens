// 룬 백필 — 룬 저장 도입 전에 기록된 매치를 라이엇에서 다시 받아
// 룬 필드를 채운다. 매치는 불변이라 한 번 채우면 끝. 호출은 전부
// 저우선순위라 유저 검색이 먼저다.

import "server-only";
import { cache } from "@/lib/cache";
import { resyncMatches } from "@/lib/match-participants";
import { getSql } from "@/lib/db";
import { getMatch, getMatchTimeline, harvestStartItems, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { chainNextRound } from "@/lib/round-chain";
import { claimRound, getSetting, setSetting } from "@/lib/store";
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

// 백필 대상 판정은 플래그 컬럼만 본다 — 예전엔 participants->0 ? 'keystone'
// (JSON 파싱)도 조건에 있었는데 매치 33만 건에서 카드 폴링마다 4.7초가 걸렸다.
// 룬 누락 매치는 fields_captured=false로도 잡히고, 404로 영구 제외된 매치는
// 플래그가 true라 의도대로 빠진다. 같은 조건의 부분 인덱스(db.ts)를 탄다.
const PENDING_WHERE = `(patch IS NULL OR NOT build_harvested OR NOT fields_captured)`;

/** 룬·빌드·확장 필드가 비어 있는 저장 매치 수 */
export async function countMissingRunes(): Promise<number> {
  const sql = await getSql();
  const r = await sql.unsafe(
    `SELECT count(*)::int AS n FROM matches WHERE fp = $1 AND ${PENDING_WHERE}`,
    [riotKeyFp()],
  );
  return (r as unknown as { n: number }[])[0]?.n ?? 0;
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

/** 종료 직전 라운드 놓기 — 새 인스턴스가 즉시 이어받도록 (refresh-all과 동일) */
export async function releaseRunefillRound(): Promise<boolean> {
  const s = await getRunefillState();
  if (!s?.running || !s.roundActive) return false;
  await save({ ...s, roundActive: false });
  return true;
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
  // 원자적 점유 — 동시 트리거는 하나만 통과
  const claimed = await claimRound<RunefillState>(STATE_KEY, ROUND_STALE_MS);
  if (!claimed) return;
  state = claimed;

  try {
    const sql = await getSql();
    const fp = riotKeyFp();
    // 최고속 모드: 저우선순위를 풀어 라이엇 한도를 유저 검색과 동등하게 쓰고,
    // 라운드 배치도 키운다. 평시엔 저우선순위로 유저에 양보한다.
    const turbo = state.turbo === true;
    const runAt = <T>(fn: () => Promise<T>): Promise<T> =>
      turbo ? fn() : withLowPriority(fn);
    const perRound = turbo ? TURBO_PER_ROUND : PER_ROUND;
    const rows = await sql.unsafe(
      `SELECT m.match_id, m.platform,
              (EXISTS (SELECT 1 FROM match_participants p
                       WHERE p.fp = m.fp AND p.match_id = m.match_id AND p.keystone IS NOT NULL)
               AND m.patch IS NOT NULL) AS body_ok,
              m.build_harvested, m.fields_captured
       FROM matches m
       WHERE m.fp = $1 AND ${PENDING_WHERE}
       ORDER BY m.game_creation DESC LIMIT $2`,
      [fp, perRound],
    );

    if (rows.length === 0) {
      await save({ ...state, running: false, roundActive: false, done: true });
      return;
    }

    let filled = 0;
    let failed = 0;
    let i = 0;
    for (const r of rows as unknown as {
      match_id: string;
      platform: PlatformRegion;
      body_ok: boolean;
      build_harvested: boolean;
      fields_captured: boolean;
    }[]) {
      // 5개마다 취소 확인
      if (i++ % 5 === 0 && !((await getRunefillState())?.running ?? false)) break;
      try {
        // 본문 재수집이 필요한 경우: 룬/패치 누락(!body_ok) 또는 확장 필드 미캡처.
        // getMatch(force)가 밴·팀·participant 확장 필드까지 다시 저장하고
        // fields_captured=true로 만든다.
        if (!r.body_ok || !r.fields_captured) {
          await runAt(() => getMatch(r.platform, r.match_id, true));
        }
        // 타임라인 빌드 수확은 아직 안 한 매치만 (이미 수확했으면 콜 낭비 안 함)
        if (!r.build_harvested) {
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
        }
        filled++;
      } catch (e) {
        failed++;
        // 404(라이엇에 진짜 없는 매치)만 영구 제외한다 — 레이트리밋·5xx 같은
        // 일시 오류로 실패한 매치는 그대로 둬서 다음 백필이 다시 시도한다.
        // fields_captured도 true로 박아 이 매치가 무한 재시도되지 않게 한다.
        const permanent = e instanceof RiotApiError && e.status === 404;
        if (permanent) {
          await sql`
            UPDATE matches
            SET participants = jsonb_set(participants, '{0,keystone}', 'null'),
                build_harvested = true, fields_captured = true
            WHERE fp = ${fp} AND match_id = ${r.match_id}`.catch(() => {});
          await resyncMatches(fp, [r.match_id]).catch(() => {});
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
