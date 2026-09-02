import { NextResponse, after, type NextRequest } from "next/server";
import { SITE_URL } from "@/lib/site";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginRefreshAll,
  getRefreshAllState,
  resumeRefreshAll,
  runRefreshAllRound,
  stopRefreshAll,
} from "@/lib/refresh-all";
import { getCrawlState } from "@/lib/crawl-seed";
import { getRunefillState } from "@/lib/rune-backfill";
import { isCronSecretAuth } from "@/lib/round-chain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 크론 라우트를 호출할 주소 — 배포 환경에서는 해시 붙은 URL이 Vercel 인증에
// 막히므로 반드시 공개 도메인을 쓴다(로컬만 예외).
function publicOrigin(req: NextRequest): string {
  return req.nextUrl.hostname === "localhost"
    ? req.nextUrl.origin
    : SITE_URL;
}

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ state: await getRefreshAllState() });
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
  // 서버 시크릿은 continue 외에 start/stop도 허용 (운영 스크립트용). resume은 관리자만.
  if (cronAuth && !["continue", "start", "stop"].includes(action)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (action === "stop") {
    await stopRefreshAll();
    return NextResponse.json({ state: await getRefreshAllState() });
  }

  // 이어하기(continue)는 상태를 초기화하지 않는다.
  // resume은 중단/종료된 자리(커서)에서 다시 running으로 켠다.
  if (action === "resume") {
    await resumeRefreshAll();
  }
  if (action === "start") {
    // 대량 백그라운드 작업은 한 번에 하나만
    const crawl = await getCrawlState();
    const runefill = await getRunefillState();
    if (crawl?.running || runefill?.running) {
      return NextResponse.json(
        { error: "소환사 시드 수집이 진행 중이에요 — 끝난 뒤 시작해 주세요" },
        { status: 409 },
      );
    }
    await beginRefreshAll();
  }
  const origin = publicOrigin(req);
  after(() => runRefreshAllRound(origin).catch(() => {}));
  return NextResponse.json({ state: await getRefreshAllState() });
}
