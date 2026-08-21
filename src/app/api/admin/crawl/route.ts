import { NextResponse, after, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginCrawl,
  getCrawlState,
  runCrawlRound,
  stopCrawl,
} from "@/lib/crawl-seed";
import { getRefreshAllState } from "@/lib/refresh-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ state: await getCrawlState() });
}

export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const action = req.nextUrl.searchParams.get("action") ?? "start";
  if (action === "stop") {
    await stopCrawl();
    return NextResponse.json({ state: await getCrawlState() });
  }
  if (action === "start") {
    // 대량 백그라운드 작업은 한 번에 하나만 — 라이엇 예산과 부하를 나눠 갖지 않게
    const refreshAll = await getRefreshAllState();
    if (refreshAll?.running) {
      return NextResponse.json(
        { error: "전체 유저 데이터 갱신이 진행 중이에요 — 끝난 뒤 시작해 주세요" },
        { status: 409 },
      );
    }
    const target = Number(req.nextUrl.searchParams.get("target") ?? 30);
    await beginCrawl(Number.isFinite(target) ? target : 30);
  }
  // continue는 상태를 초기화하지 않고 라운드만 잇는다
  after(() => runCrawlRound().catch(() => {}));
  return NextResponse.json({ state: await getCrawlState() });
}
