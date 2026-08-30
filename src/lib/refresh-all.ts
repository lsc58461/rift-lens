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
import { withLowPriority } from "@/lib/riot/limiter";
import { ALGO_VERSION } from "@/lib/mmr/estimate";
import { riotKeyFp } from "@/lib/riot/client";
import { buildRefreshQueue, listRefreshQueue } from "@/lib/store";
import { chainNextRound } from "@/lib/round-chain";
import { claimRound, getSetting, setSetting } from "@/lib/store";

const STATE_KEY = "refresh-all:state";
// 라운드 상한 — 커서 방식에선 한 바퀴(2.5만 명)에 650라운드+가 들고 바퀴는 여러 번
// 돌 수 있으므로 사실상 무제한. 종료 판정은 "한 바퀴 내내 한 일 없음"이 담당한다.
// (400이던 시절 커서 도입 후 9,718명에서 상한에 걸려 '완료'로 끝난 사고 있음)
const MAX_ROUNDS = 1_000_000;
const ROUND_STALE_MS = 300_000; // 이 시간 넘게 갱신이 없으면 죽은 라운드로 간주
// 라운드당 처리량 — 한때 응답 지연의 범인으로 보고 2로 줄였으나, 실제 원인은
// 동결된 인스턴스의 죽은 DB 소켓 재사용이었다(db.ts 헬스체크로 해결). 라이엇
// 호출도 저우선순위라 유저 요청에 밀리므로 원래 값으로 되돌린다.
const ROUND_LIMIT = 40; // 라운드당 갱신할 소환사 수 (220초 예산 안에서)
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
  /** 현재 바퀴에서 훑은 위치 (목록 전체 기준 절대 위치, 실시간 진행 표시용) */
  scanned: number;
  /** 전체 순회 대상 소환사 수 */
  target: number;
  /** 다음 라운드가 이어서 볼 목록 위치 — 라운드는 처음부터가 아니라 여기서부터 */
  cursor: number;
  /** 완료한 바퀴 수 */
  passes: number;
  /** 현재 바퀴에서 한 일(빠른 갱신+정밀) — 한 바퀴 다 돌았는데 0이면 끝 */
  passWork: number;
  /** 현재 바퀴 시작 시각 — 남은 시간 추정은 바퀴 단위 속도로 */
  passStartedAt: number;
  /** 현재 바퀴의 큐 id(refresh_queue.pass_id). 0이면 큐 없음(레거시) */
  passId: number;
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
    scanned: 0,
    target: 0,
    cursor: 0,
    passes: 0,
    passWork: 0,
    passStartedAt: Date.now(),
    passId: 0,
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

/** 새 바퀴 큐 생성 — 상태 우선순위(캐시 만료 먼저) → 최근 검색순으로 순서 고정 */
async function newPassQueue(prevPassId: number): Promise<{ passId: number; total: number }> {
  const passId = (prevPassId || 0) + 1;
  const total = await buildRefreshQueue(riotKeyFp(), passId, ALGO_VERSION);
  return { passId, total };
}

export async function beginRefreshAll(): Promise<RefreshAllState> {
  const q = await newPassQueue(0);
  const next: RefreshAllState = { ...empty(), running: true, passId: q.passId, target: q.total };
  await save(next);
  return next;
}

/** 중단/상한 종료된 자리(커서)에서 이어서 시작 — 상태가 없으면 처음부터 */
export async function resumeRefreshAll(): Promise<RefreshAllState> {
  const s = await getRefreshAllState();
  if (!s) return beginRefreshAll();
  const next: RefreshAllState = {
    ...s,
    running: true,
    done: false,
    roundActive: false,
    idleRounds: 0,
    lastError: null,
    // 커서 도입 전 상태엔 없을 수 있는 필드 보정
    cursor: s.cursor ?? 0,
    passId: s.passId ?? 0,
    passes: s.passes ?? 0,
    passWork: s.passWork ?? 0,
    passStartedAt: s.passStartedAt ?? Date.now(),
  };
  await save(next);
  return next;
}

export async function stopRefreshAll(): Promise<void> {
  const s = await getRefreshAllState();
  if (s) await save({ ...s, running: false, roundActive: false });
}

/** 프로세스 종료(배포로 컨테이너 교체) 직전 — 돌던 라운드를 "놓았다"고 표시해
 *  새 인스턴스가 5분 스테일 타이머를 기다리지 않고 바로 이어받게 한다. */
export async function releaseRefreshAllRound(): Promise<boolean> {
  const s = await getRefreshAllState();
  if (!s?.running || !s.roundActive) return false;
  await save({ ...s, roundActive: false });
  return true;
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

  // 라운드 시작 표시 (하트비트 겸용) — 원자적 점유라 동시 트리거는 하나만 통과
  const cursor = state.cursor ?? 0;
  const claimed = await claimRound<RefreshAllState>(STATE_KEY, ROUND_STALE_MS, {
    scanned: cursor,
  });
  if (!claimed) return;
  state = claimed;

  try {
    // 취소 확인은 5초에 한 번만 DB를 읽는다
    let lastCheck = 0;
    let lastRunning = true;
    const shouldContinue = async () => {
      if (Date.now() - lastCheck > 5_000) {
        lastCheck = Date.now();
        lastRunning = (await getRefreshAllState())?.running ?? false;
      }
      return lastRunning;
    };

    // 크론을 HTTP로 부르면 함수가 자기 자신을 호출하는 사슬이 생겨
    // Vercel 루프 감지(508)에 걸린다 — 같은 로직을 직접 실행한다
    // 라운드 중 실시간 진행 저장 (2초 스로틀) — 중지 클릭을 덮어쓰지 않도록
    // 매번 최신 상태를 읽고 그 위에 얹는다
    let lastProgressSave = 0;
    // 스윕 전체(최신 매치 확인·빠른 추정·정밀)를 저우선순위로 — 예전엔 정밀만
    // 저우선순위라 빠른 추정·매치 확인 콜이 유저 검색과 동등하게 경쟁했다
    // 큐가 없는 옛 상태(passId 0)면 지금 만든다 — 그 시점부터 순서 고정
    let passId = state.passId ?? 0;
    if (!passId) {
      const q = await newPassQueue(0);
      passId = q.passId;
      const cur = await getRefreshAllState();
      if (cur) await save({ ...cur, passId, target: q.total });
    }
    const queue = await listRefreshQueue(riotKeyFp(), passId);
    const list = queue.map((r) => ({ region: r.platform, gameName: r.game_name, tagLine: r.tag_line }));
    const d = await withLowPriority(() => runRefreshSweep({
      limit: ROUND_LIMIT,
      budgetMs: 220_000,
      deepDeadlineMs: 180_000,
      startIndex: cursor,
      list,
      shouldContinue,
      onProgress: async (p) => {
        if (Date.now() - lastProgressSave < 2_000) return;
        lastProgressSave = Date.now();
        const cur = await getRefreshAllState();
        if (!cur?.running) return;
        await save({ ...cur, scanned: p.scanned, target: p.total });
      },
    }));

    const refreshed = d.quickRefreshed.length;
    const deep = d.deepCompleted;
    // 라운드 도는 사이 중지됐을 수 있다 — 옛 상태로 running을 되살리지 않도록
    // 반드시 최신 상태를 다시 읽고 그 위에 누적한다
    const fresh = await getRefreshAllState();
    if (!fresh?.running) {
      if (fresh) await save({ ...fresh, roundActive: false });
      return;
    }
    // 라운드 도는 사이 "취소 후 새로 시작"이나 커서 되돌리기가 있었으면(시작 시각·커서가
    // 내가 점유할 때와 다름) 내 커서로 덮어쓰지 않는다 — 옛 라운드가 새 바퀴의 커서를
    // 6천으로 밀어 올려 앞쪽을 통째로 건너뛰던 사고(2026-08-30) 방지
    if (fresh.startedAt !== state.startedAt || (fresh.cursor ?? 0) !== cursor) {
      console.log(`[refresh-all] 바퀴가 바뀌어 옛 라운드 결과를 버림 (cursor ${cursor} → ${fresh.cursor})`);
      await save({ ...fresh, roundActive: false });
      return;
    }
    const didWork = refreshed > 0 || deep > 0;
    const passWork = (fresh.passWork ?? 0) + refreshed + deep;
    state = {
      ...fresh,
      roundActive: false,
      rounds: state.rounds + 1,
      refreshed: state.refreshed + refreshed,
      deepCompleted: state.deepCompleted + deep,
      failed: state.failed + d.failed,
      target: d.total,
      scanned: d.nextIndex,
      cursor: d.reachedEnd ? 0 : d.nextIndex,
      passes: fresh.passes ?? 0,
      passWork,
      // 커서 도입 전에 시작된 작업은 첫 커서 라운드를 바퀴 시작으로 본다(ETA 과대 방지)
      passStartedAt: fresh.passStartedAt ?? Date.now(),
      // 실패가 있으면 첫 몇 건의 사유를 남겨 진단 가능하게 한다
      lastError: d.failures.length
        ? d.failures
            .slice(0, 3)
            .map((f) => `${f.who}: ${f.error}`)
            .join(" | ")
        : null,
    };
    // 진전 없는 라운드 카운트 — 러너 락이 다른 분석에 잡혀 계속 못 도는 경우 감지
    state.idleRounds = didWork ? 0 : (fresh.idleRounds ?? 0) + 1;
    if (d.reachedEnd) {
      // 한 바퀴 완료. 바퀴 내내 한 일이 없고 정밀 대기도 없으면 더 할 게 없다
      if (passWork === 0 && !d.deepPending) {
        state.running = false;
        state.done = true;
      } else {
        // 다음 바퀴 — 큐를 새로 만들어 상태 우선순위로 다시 정렬
        const q = await newPassQueue(fresh.passId ?? 0);
        state.passId = q.passId;
        state.target = q.total;
        state.passes = (fresh.passes ?? 0) + 1;
        state.passWork = 0;
        state.passStartedAt = Date.now();
        state.scanned = 0;
      }
    } else if (state.idleRounds >= 8) {
      // 이어서 돌 목록은 남았는데 8라운드 연속 아무것도 못 했으면(락 점유 등) 멈춘다
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
