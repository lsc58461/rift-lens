// 전체 유저 데이터 갱신 — 새벽 크론과 같은 작업을 관리자가 수동으로 돌린다.
//
// 크론 라우트(/api/cron/refresh)가 이미 "최근 검색된 소환사를 순회하며
// 빠른 추정 갱신 + 필요 시 정밀 분석"을 하므로, 로직을 복제하지 않고
// 그 라우트를 한 라운드씩 호출해 진행 상황만 누적한다.
//
// Vercel 함수 시간제한 때문에 한 번에 다 돌리지 않는다 — 관리자 화면이
// 폴링하며 다음 라운드를 이어서 요청한다(데이터 이관 카드와 같은 방식).

import "server-only";
import { runRefreshSweep } from "@/lib/refresh-sweep";
import { chainNextRound } from "@/lib/round-chain";
import { getSetting, setSetting } from "@/lib/store";

const STATE_KEY = "refresh-all:state";
const MAX_ROUNDS = 400; // 폭주 방지 상한 (소환사 수백 명 규모 대응)
const ROUND_STALE_MS = 300_000; // 이 시간 넘게 갱신이 없으면 죽은 라운드로 간주
// 라운드당 처리량 — 한때 응답 지연의 범인으로 보고 2로 줄였으나, 실제 원인은
// 동결된 인스턴스의 죽은 DB 소켓 재사용이었다(db.ts 헬스체크로 해결). 라이엇
// 호출도 저우선순위라 유저 요청에 밀리므로 원래 값으로 되돌린다.
const ROUND_LIMIT = 5; // 라운드당 갱신할 소환사 수
const ROUND_GAP_MS = 0; // 라운드 사이 최소 간격

export interface RefreshAllState {
  running: boolean;
  /** 한 라운드가 실제로 도는 중인지 — 라운드 사이 대기와 구분해 중복 실행을 막는다 */
  roundActive: boolean;
  done: boolean;
  rounds: number;
  refreshed: number; // 빠른 추정을 새로 돌린 소환사 수
  deepCompleted: number;
  failed: number;
  /** 연속으로 아무 일도 못 한 라운드 수 — 이게 쌓이면 종료한다 */
  idleRounds: number;
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
    idleRounds: 0,
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
  // 직전 라운드가 끝난 지 얼마 안 됐으면 잠시 쉰다 (부하 완화)
  if (!state.roundActive && Date.now() - state.updatedAt < ROUND_GAP_MS) return;
  if (state.rounds >= MAX_ROUNDS) {
    await save({ ...state, running: false, roundActive: false, done: true });
    return;
  }

  // 라운드 시작 표시 (하트비트 겸용)
  await save({ ...state, running: true, roundActive: true });

  try {
    // 크론을 HTTP로 부르면 함수가 자기 자신을 호출하는 사슬이 생겨
    // Vercel 루프 감지(508)에 걸린다 — 같은 로직을 직접 실행한다
    const d = await runRefreshSweep({
      limit: ROUND_LIMIT,
      budgetMs: 220_000,
      deepDeadlineMs: 180_000,
    });

    const refreshed = d.quickRefreshed.length;
    const deep = d.deepCompleted;
    state = {
      ...state,
      roundActive: false,
      rounds: state.rounds + 1,
      refreshed: state.refreshed + refreshed,
      deepCompleted: state.deepCompleted + deep,
      failed: state.failed + d.failed,
      lastError: null,
    };
    // 한 라운드가 놀았다고 곧장 끝내면 안 된다 — 목록 앞쪽이 최신이라 건너뛰었을
    // 뿐이거나, 러너 락이 잡혀 정밀을 못 돌린 것일 수 있다. 크론이 "남은 작업 없음"을
    // 알려주고 연속으로 놀았을 때만 종료한다.
    const didWork = refreshed > 0 || deep > 0;
    state.idleRounds = didWork ? 0 : state.idleRounds + 1;
    if (!didWork && !d.remaining && state.idleRounds >= 2) {
      state.running = false;
      state.done = true;
    } else if (state.idleRounds >= 5) {
      // 남은 작업이 있다고 하는데도 계속 진전이 없으면(락 점유 등) 멈춘다
      state.running = false;
      state.done = true;
      state.lastError = "진전이 없어 종료했어요 (다른 분석이 실행 중일 수 있음)";
    }
    await save(state);
    // 아직 할 일이 남았으면 탭 폴링 없이도 다음 라운드를 잇는다
    if (state.running && !state.done) {
      await chainNextRound(origin, "/api/admin/refresh-all");
    }
  } catch (e) {
    await save({
      ...state,
      running: false,
      roundActive: false,
      lastError: e instanceof Error ? e.message : String(e),
    });
  }
}
