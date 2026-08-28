// Node 런타임 전용 수명주기 훅 — instrumentation.ts가 런타임을 확인한 뒤
// 동적 import하므로 Edge 번들에는 포함되지 않는다(process.on 등 Node API 사용).
//
// 문제: 전체 갱신·백필·크롤 라운드는 프로세스 안에서 돌고 상태만 DB에 있다.
// 롤링 배포로 프로세스가 죽으면 DB엔 roundActive=true가 남아, 5분 스테일
// 타이머(+어드민 탭 폴링)가 찰 때까지 멈춘 것처럼 보였다.
//
// 해법: ① 종료(SIGTERM) 직전에 돌던 라운드를 "놓았다"(roundActive=false)고
// 표시하고 ② 새 프로세스가 뜨면 running인데 놓여 있는 작업을 즉시 continue한다.
// continue는 멱등이라(라운드가 살아 있으면 무시) 두 인스턴스가 겹쳐도 안전하다.
// NEXT_MANUAL_SIG_HANDLE=true 여야 Next가 SIGTERM에 즉시 exit하지 않고 우리 훅이 돈다.
import { getCrawlState, releaseCrawlRound } from "@/lib/crawl-seed";
import { warmChampionStats } from "@/lib/champion-stats";
import { releaseDeepRunnerOnShutdown } from "@/lib/mmr/deep-jobs";
import { setApexCutoffs } from "@/lib/mmr/rank";
import { getRefreshAllState, releaseRefreshAllRound } from "@/lib/refresh-all";
import { getRunefillState, releaseRunefillRound } from "@/lib/rune-backfill";
import { apexCutoffsFromSnapshots } from "@/lib/store";

const INTERNAL_ORIGIN = "http://127.0.0.1:3000";
const BOOT_DELAY_MS = 20_000; // 서버·DB 워밍 뒤 확인
const DEAD_HEARTBEAT_MS = 120_000; // 이보다 오래 하트비트가 없으면 이전 프로세스가 놓지 못하고 죽은 것

type Job = "refresh-all" | "rune-backfill" | "crawl";
interface RoundState {
  running: boolean;
  roundActive: boolean;
  updatedAt: number;
}

async function continueJob(job: Job): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  await fetch(`${INTERNAL_ORIGIN}/api/admin/${job}?action=continue`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

export function registerNode(): void {
  // ② 부팅 후: running인데 라운드가 놓여 있는(또는 하트비트가 죽은) 작업을 이어받는다
  const checks: [Job, () => Promise<RoundState | null>][] = [
    ["refresh-all", getRefreshAllState],
    ["rune-backfill", getRunefillState],
    ["crawl", getCrawlState],
  ];
  const resumeOrphans = async (pass: number) => {
    for (const [job, get] of checks) {
      const s = await get().catch(() => null);
      if (!s?.running) continue;
      const stale = Date.now() - s.updatedAt > DEAD_HEARTBEAT_MS;
      if (!s.roundActive || stale) {
        console.log(`[boot#${pass}] ${job} 이어받기 (roundActive=${s.roundActive}, stale=${stale})`);
        await continueJob(job);
      }
    }
  };
  // 두 번 확인한다 — 이전 프로세스가 놓지 못하고 죽었을 때(핸들러 없던 구버전,
  // 강제 kill) 첫 확인 시점엔 하트비트가 아직 신선해 보일 수 있어서, 하트비트가
  // 죽었다고 판정 가능한 시점에 한 번 더 본다.
  setTimeout(() => void resumeOrphans(1), BOOT_DELAY_MS).unref();
  // 마스터 이상 티어 컷(그마·챌 LP) — 스냅샷에서 실측해 포인트→티어 역산에 반영
  const refreshApexCutoffs = async () => {
    const c = await apexCutoffsFromSnapshots().catch(() => null);
    if (c) {
      setApexCutoffs(c);
      console.log(`[apex] 컷 갱신 그마 ${c.grandmaster}LP · 챌 ${c.challenger}LP`);
    }
  };
  setTimeout(() => void refreshApexCutoffs(), 5_000).unref();
  setInterval(() => void refreshApexCutoffs(), 60 * 60_000).unref();
  // 챔피언 통계 캐시 워밍 — 배포 직후 첫 방문자가 재집계를 기다리지 않게.
  // 캐시가 이미 있으면 즉시 끝나고(오래됐으면 뒤에서 갱신), 없을 때만 집계한다.
  setTimeout(() => {
    warmChampionStats()
      .then(() => console.log("[boot] 챔피언 통계 캐시 워밍 완료"))
      .catch((e) => console.error("[boot] 챔피언 통계 워밍 실패:", (e as Error)?.message));
  }, BOOT_DELAY_MS + 10_000).unref();
  setTimeout(() => void resumeOrphans(2), BOOT_DELAY_MS + DEAD_HEARTBEAT_MS + 10_000).unref();

  // ① 종료 직전: 돌던 라운드를 놓고 나서 종료한다
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      const released = await Promise.race([
        Promise.all([
          releaseRefreshAllRound(),
          releaseRunefillRound(),
          releaseCrawlRound(),
          releaseDeepRunnerOnShutdown().then((k) => {
            if (k) console.log(`[${signal}] 정밀 잡 놓음: ${k} → 대기열 맨 앞`);
            return !!k;
          }),
        ]),
        new Promise<boolean[]>((r) => setTimeout(() => r([]), 5_000)),
      ]);
      if (released.some(Boolean)) {
        console.log(`[${signal}] 진행 중 작업 놓음 → 새 인스턴스가 이어받음`);
      }
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
