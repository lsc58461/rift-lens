import { NextResponse, after, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginCrawl,
  getCrawlState,
  runCrawlRound,
  stopCrawl,
} from "@/lib/crawl-seed";
import { getRefreshAllState } from "@/lib/refresh-all";
import { isCronSecretAuth } from "@/lib/round-chain";
import { getRunefillState } from "@/lib/rune-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 자기 자신을 호출할 공개 주소 — 배포 환경의 해시 URL은 Vercel 인증에 막힌다
function publicOrigin(req: NextRequest): string {
  return req.nextUrl.hostname === "localhost"
    ? req.nextUrl.origin
    : "https://rift-lens.xyz";
}


export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ state: await getCrawlState() });
}

export async function POST(req: NextRequest) {
  const cronAuth = isCronSecretAuth(req.headers.get("authorization"));
  if (
    !cronAuth &&
    !(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const action = req.nextUrl.searchParams.get("action") ?? "start";
  // 서버 self-chain은 continue만 허용 (start/stop은 관리자 전용)
  if (cronAuth && action !== "continue") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (action === "stop") {
    await stopCrawl();
    return NextResponse.json({ state: await getCrawlState() });
  }
  if (action === "start") {
    // 대량 백그라운드 작업은 한 번에 하나만 — 라이엇 예산과 부하를 나눠 갖지 않게
    const refreshAll = await getRefreshAllState();
    const runefill = await getRunefillState();
    if (refreshAll?.running || runefill?.running) {
      return NextResponse.json(
        { error: "전체 유저 데이터 갱신이 진행 중이에요 — 끝난 뒤 시작해 주세요" },
        { status: 409 },
      );
    }
    const target = Number(req.nextUrl.searchParams.get("target") ?? 30);
    const mode =
      req.nextUrl.searchParams.get("mode") === "recent" ? "recent" : "balanced";
    const withDeep = req.nextUrl.searchParams.get("deep") === "1";
    await beginCrawl(Number.isFinite(target) ? target : 30, mode, withDeep);
  }
  // continue는 상태를 초기화하지 않고 라운드만 잇는다
  const origin = publicOrigin(req);
  after(() => runCrawlRound(origin).catch(() => {}));
  return NextResponse.json({ state: await getCrawlState() });
}
