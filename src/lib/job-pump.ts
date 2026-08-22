// 대량 작업 펌프 — Vercel은 함수→함수 호출 사슬을 깊이 ~5에서 끊기 때문에
// 서버 자체 이어달리기만으로는 긴 작업을 완주할 수 없다. 브라우저에서 온
// 요청은 사슬 깊이가 0이므로, 공개 트래픽(공지 API 등)의 after()에서
// 멈춰 있는 라운드를 직접 이어준다. 방문이 있는 한 작업은 계속 전진한다.

import "server-only";
import { getCrawlState, runCrawlRound } from "@/lib/crawl-seed";
import { getRefreshAllState, runRefreshAllRound } from "@/lib/refresh-all";
import { getRunefillState, runRunefillRound } from "@/lib/rune-backfill";

// 직전 갱신 후 이만큼 지나야 펌프가 개입 — 자체 이어달리기와 중복 방지
const IDLE_BEFORE_PUMP_MS = 20_000;

export async function pumpBulkJobs(origin: string): Promise<void> {
  const now = Date.now();
  const [refresh, crawl, runefill] = await Promise.all([
    getRefreshAllState().catch(() => null),
    getCrawlState().catch(() => null),
    getRunefillState().catch(() => null),
  ]);

  const stalled = (s: { running: boolean; roundActive: boolean; updatedAt: number } | null) =>
    Boolean(s?.running && !s.roundActive && now - s.updatedAt > IDLE_BEFORE_PUMP_MS);

  // 상호 배타 정책과 동일하게 한 번에 하나만 잇는다
  if (stalled(refresh)) {
    await runRefreshAllRound(origin).catch(() => {});
  } else if (stalled(crawl)) {
    await runCrawlRound(origin).catch(() => {});
  } else if (stalled(runefill)) {
    await runRunefillRound(origin).catch(() => {});
  }
}
