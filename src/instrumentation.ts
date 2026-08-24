// 서버 수명주기 훅 — 배포(컨테이너 교체)로 백그라운드 작업이 끊기지 않게 한다.
//
// 문제: 전체 갱신·백필·크롤 라운드는 프로세스 안에서 돌고 상태만 DB에 있다.
// 롤링 배포로 프로세스가 죽으면 DB엔 roundActive=true가 남아, 5분 스테일
// 타이머(+어드민 탭 폴링)가 찰 때까지 멈춘 것처럼 보였다.
//
// 해법: ① 종료(SIGTERM) 직전에 돌던 라운드를 "놓았다"(roundActive=false)고
// 표시하고 ② 새 프로세스가 뜨면 running인데 놓여 있는 작업을 즉시 continue한다.
// continue는 멱등이라(라운드가 살아 있으면 무시) 두 인스턴스가 겹쳐도 안전하다.
// NEXT_MANUAL_SIG_HANDLE=true 여야 Next가 SIGTERM에 즉시 exit하지 않고 우리 훅이 돈다.

const INTERNAL_ORIGIN = "http://127.0.0.1:3000";
const BOOT_DELAY_MS = 20_000; // 서버·DB 워밍 뒤 확인
const JOBS = ["refresh-all", "rune-backfill", "crawl"] as const;

async function continueJob(job: (typeof JOBS)[number]): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  await fetch(`${INTERNAL_ORIGIN}/api/admin/${job}?action=continue`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ getRefreshAllState, releaseRefreshAllRound }, { getRunefillState, releaseRunefillRound }, { getCrawlState, releaseCrawlRound }] =
    await Promise.all([
      import("@/lib/refresh-all"),
      import("@/lib/rune-backfill"),
      import("@/lib/crawl-seed"),
    ]);

  // ② 부팅 후: running인데 라운드가 놓여 있는(또는 하트비트가 죽은) 작업을 이어받는다
  setTimeout(async () => {
    const checks: [string, () => Promise<{ running: boolean; roundActive: boolean; updatedAt: number } | null>][] = [
      ["refresh-all", getRefreshAllState],
      ["rune-backfill", getRunefillState],
      ["crawl", getCrawlState],
    ];
    for (const [job, get] of checks) {
      const s = await get().catch(() => null);
      if (!s?.running) continue;
      // 놓인 라운드거나, 하트비트가 2분 넘게 죽어 있으면(이전 프로세스가 놓지 못하고 죽음) 재개
      const stale = Date.now() - s.updatedAt > 120_000;
      if (!s.roundActive || stale) {
        console.log(`[boot] ${job} 이어받기 (roundActive=${s.roundActive}, stale=${stale})`);
        await continueJob(job as (typeof JOBS)[number]);
      }
    }
  }, BOOT_DELAY_MS).unref();

  // ① 종료 직전: 돌던 라운드를 놓고 나서 종료한다
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      const released = await Promise.race([
        Promise.all([releaseRefreshAllRound(), releaseRunefillRound(), releaseCrawlRound()]),
        new Promise<boolean[]>((r) => setTimeout(() => r([]), 5_000)),
      ]);
      if (released.some(Boolean)) console.log(`[${signal}] 진행 중 라운드 놓음 → 새 인스턴스가 이어받음`);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
