// 전체 유저 데이터 갱신 — 새벽 크론과 같은 작업을 관리자가 수동으로 돌린다.
//
// 크론 라우트(/api/cron/refresh)가 이미 "최근 검색된 소환사를 순회하며
// 빠른 추정 갱신 + 필요 시 정밀 분석"을 하므로, 로직을 복제하지 않고
// 그 라우트를 한 라운드씩 호출해 진행 상황만 누적한다.
//
// Vercel 함수 시간제한 때문에 한 번에 다 돌리지 않는다 — 관리자 화면이
// 폴링하며 다음 라운드를 이어서 요청한다(데이터 이관 카드와 같은 방식).

import "server-only";
import { getSetting, setSetting } from "@/lib/store";

const STATE_KEY = "refresh-all:state";
const MAX_ROUNDS = 40; // 폭주 방지 상한
const ROUND_STALE_MS = 300_000; // 이 시간 넘게 갱신이 없으면 죽은 라운드로 간주

export interface RefreshAllState {
  running: boolean;
  /** 한 라운드가 실제로 도는 중인지 — 라운드 사이 대기와 구분해 중복 실행을 막는다 */
  roundActive: boolean;
  done: boolean;
  rounds: number;
  refreshed: number; // 빠른 추정을 새로 돌린 소환사 수
  deepCompleted: number;
  failed: number;
  startedAt: number;
  updatedAt: number;
  lastError: string | null;
}

function empty(): RefreshAllState {
  return {
    running: false,
    roundActive: false,
    done: false,
    rounds: 0,
    refreshed: 0,
    deepCompleted: 0,
    failed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastError: null,
  };
}

export function getRefreshAllState(): Promise<RefreshAllState | null> {
  return getSetting<RefreshAllState>(STATE_KEY);
}

async function save(s: RefreshAllState): Promise<void> {
  await setSetting(STATE_KEY, { ...s, updatedAt: Date.now() });
}

export async function beginRefreshAll(): Promise<RefreshAllState> {
  const next: RefreshAllState = { ...empty(), running: true };
  await save(next);
  return next;
}

export async function stopRefreshAll(): Promise<void> {
  const s = await getRefreshAllState();
  if (s) await save({ ...s, running: false, roundActive: false });
}

/** 한 라운드 진행. 더 갱신할 대상이 없으면 done 처리한다. */
export async function runRefreshAllRound(origin: string): Promise<void> {
  let state = (await getRefreshAllState()) ?? empty();
  if (!state.running) return;
  // 이미 라운드가 도는 중이면(하트비트가 신선하면) 중복 실행하지 않는다
  if (state.roundActive && Date.now() - state.updatedAt < ROUND_STALE_MS) return;
  if (state.rounds >= MAX_ROUNDS) {
    await save({ ...state, running: false, roundActive: false, done: true });
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await save({
      ...state,
      running: false,
      roundActive: false,
      lastError: "CRON_SECRET이 설정되지 않았습니다",
    });
    return;
  }

  // 라운드 시작 표시 (하트비트 겸용)
  await save({ ...state, running: true, roundActive: true });

  try {
    const url = new URL("/api/cron/refresh?limit=5", origin);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`크론 응답 ${res.status}`);
    const d: {
      quickRefreshed?: string[];
      deepCompleted?: number;
      failed?: number;
    } = await res.json();

    const refreshed = d.quickRefreshed?.length ?? 0;
    const deep = d.deepCompleted ?? 0;
    state = {
      ...state,
      roundActive: false,
      rounds: state.rounds + 1,
      refreshed: state.refreshed + refreshed,
      deepCompleted: state.deepCompleted + deep,
      failed: state.failed + (d.failed ?? 0),
      lastError: null,
    };
    // 이번 라운드에 한 일이 없으면 갱신할 대상이 남지 않은 것
    if (refreshed === 0 && deep === 0) {
      state.running = false;
      state.done = true;
    }
    await save(state);
  } catch (e) {
    await save({
      ...state,
      running: false,
      roundActive: false,
      lastError: e instanceof Error ? e.message : String(e),
    });
  }
}
