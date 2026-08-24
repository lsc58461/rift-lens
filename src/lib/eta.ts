// 백그라운드 작업 남은 시간 추정 — 시작 이후 평균 처리 속도로 잔여량을 나눈다.
// 클라이언트·서버 어디서든 쓸 수 있게 순수 함수만 둔다.

const MIN_ELAPSED_MS = 30_000; // 이보다 짧으면 속도가 튀어 추정하지 않음
const MIN_DONE = 3;

export interface EtaInput {
  startedAt: number;
  /** 지금까지 처리한 양 */
  done: number;
  /** 전체 양 */
  total: number;
  now?: number;
}

/** 남은 시간(ms). 아직 추정할 근거가 없으면 null, 끝났으면 0. */
export function estimateEtaMs({ startedAt, done, total, now = Date.now() }: EtaInput): number | null {
  const remaining = total - done;
  if (remaining <= 0) return 0;
  const elapsed = now - startedAt;
  if (elapsed < MIN_ELAPSED_MS || done < MIN_DONE) return null;
  return Math.round((remaining / done) * elapsed);
}

export function formatEta(ms: number | null): string {
  if (ms === null) return "계산 중";
  if (ms <= 0) return "곧 완료";
  const min = Math.ceil(ms / 60_000);
  if (min < 1) return "1분 미만";
  if (min < 60) return `약 ${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) return `약 ${Math.round(h / 24)}일 ${h % 24}시간`;
  return m ? `약 ${h}시간 ${m}분` : `약 ${h}시간`;
}
