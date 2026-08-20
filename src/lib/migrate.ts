// API 키 교체 데이터 이관.
//
// PUUID는 키 단위로 암호화되므로 키를 바꾸면 옛 지문(fp) 데이터가 통째로
// 조회 불가능해진다. 이름은 키와 무관하니, 옛 행의 이름으로 새 키에서 puuid를
// 다시 받아 랭크 스냅샷(LP 히스토리)을 새 키 기준으로 되살린다.
//
// 모든 라이엇 호출은 저우선순위(withLowPriority)로 나가므로, 유저 요청이
// 들어오면 리미터가 그쪽에 먼저 슬롯을 준다 — 이관은 자동으로 뒤로 밀린다.
// Vercel 함수 시간제한 때문에 한 번에 다 돌리지 않고 배치로 끊어 재개한다.

import "server-only";
import { getAccountByRiotId, riotKeyFp } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import {
  getSetting,
  legacyStats,
  listLegacyIdentities,
  migrateLegacyIdentity,
  purgeLegacyMatches,
  purgeOrphanSnapshots,
  setSetting,
  vacuumMigratedTables,
  type LegacyStats,
} from "@/lib/store";

const STATE_KEY = "migration:key-fp";
const BATCH_BUDGET_MS = 60_000; // 한 번 호출에서 쓰는 시간 상한
const IDENTITY_CHUNK = 20; // 한 배치에서 조회할 소환사 수
const PURGE_CHUNK = 500; // 한 배치에서 지울 매치/고아 스냅샷 수

export interface MigrationState {
  running: boolean;
  fp: string; // 이 지문 기준으로 이관 중
  migrated: number; // 이관 완료한 소환사 수
  snapshotsMoved: number; // 옮긴 스냅샷 행 수
  matchesPurged: number;
  failed: number; // 계정 조회 실패(삭제된 계정 등)
  startedAt: number;
  updatedAt: number;
  lastError: string | null;
  done: boolean;
}

function emptyState(fp: string): MigrationState {
  return {
    running: false,
    fp,
    migrated: 0,
    snapshotsMoved: 0,
    matchesPurged: 0,
    failed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastError: null,
    done: false,
  };
}

export async function getMigrationState(): Promise<MigrationState | null> {
  return getSetting<MigrationState>(STATE_KEY);
}

export async function getMigrationStatus(): Promise<{
  state: MigrationState | null;
  stats: LegacyStats;
  fp: string;
}> {
  const fp = riotKeyFp();
  const [state, stats] = await Promise.all([getMigrationState(), legacyStats(fp)]);
  return { state, stats, fp };
}

async function save(s: MigrationState): Promise<void> {
  await setSetting(STATE_KEY, { ...s, updatedAt: Date.now() });
}

/** 실행 중이면 무시하고, 아니면 상태를 running으로 표시 */
export async function beginMigration(): Promise<MigrationState> {
  const fp = riotKeyFp();
  const prev = await getMigrationState();
  // 지문이 바뀌었으면(또 키를 교체했으면) 새로 시작
  const base = prev && prev.fp === fp ? prev : emptyState(fp);
  const next: MigrationState = { ...base, running: true, done: false };
  await save(next);
  return next;
}

/**
 * 한 배치 진행. 시간 예산을 넘기면 상태를 저장하고 반환하며,
 * 남은 작업이 있으면 done=false로 남아 다음 호출에서 이어진다.
 */
export async function runMigrationBatch(): Promise<MigrationState> {
  const fp = riotKeyFp();
  let state = (await getMigrationState()) ?? emptyState(fp);
  if (state.fp !== fp) state = emptyState(fp);
  state.running = true;
  const deadline = Date.now() + BATCH_BUDGET_MS;

  try {
    // 1단계: 옛 소환사 → 새 키 puuid 재확보 + 스냅샷 이관
    while (Date.now() < deadline) {
      const ids = await listLegacyIdentities(fp, IDENTITY_CHUNK);
      if (ids.length === 0) break;
      for (const id of ids) {
        if (Date.now() >= deadline) break;
        try {
          const account = await withLowPriority(() =>
            getAccountByRiotId(id.platform, id.game_name, id.tag_line),
          );
          const moved = await migrateLegacyIdentity(id, fp, account.puuid);
          state.migrated += 1;
          state.snapshotsMoved += moved;
        } catch (e) {
          // 삭제·닉변된 계정 — 옛 행을 정리하고 넘어간다
          await migrateLegacyIdentity(id, id.old_fp, id.old_puuid).catch(
            () => {},
          );
          state.failed += 1;
          state.lastError = e instanceof Error ? e.message : String(e);
        }
        await save(state);
      }
    }

    // 2단계: 이관 불가능한 옛 매치·고아 스냅샷 정리 (API 호출 없음)
    while (Date.now() < deadline) {
      const purged = await purgeLegacyMatches(fp, PURGE_CHUNK);
      state.matchesPurged += purged;
      if (purged < PURGE_CHUNK) break;
      await save(state);
    }
    while (Date.now() < deadline) {
      const orphans = await purgeOrphanSnapshots(fp, PURGE_CHUNK);
      if (orphans === 0) break;
      state.snapshotsMoved += 0;
      await save(state);
    }

    const stats = await legacyStats(fp);
    state.done =
      stats.identities === 0 && stats.matches === 0 && stats.snapshots === 0;
    state.running = !state.done;
    // 다 끝났으면 삭제된 공간을 실제로 회수한다 (DELETE만으로는 파일이 안 줄어듦)
    if (state.done) await vacuumMigratedTables();
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    state.running = false;
  }
  await save(state);
  return state;
}

export async function stopMigration(): Promise<void> {
  const state = await getMigrationState();
  if (state) await save({ ...state, running: false });
}
