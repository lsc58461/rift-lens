import { NextResponse, after, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginRefreshAll,
  getRefreshAllState,
  runRefreshAllRound,
  stopRefreshAll,
} from "@/lib/refresh-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 크론 라우트를 호출할 주소 — 배포 환경에서는 해시 붙은 URL이 Vercel 인증에
// 막히므로 반드시 공개 도메인을 쓴다(로컬만 예외).
function publicOrigin(req: NextRequest): string {
  return req.nextUrl.hostname === "localhost"
    ? req.nextUrl.origin
    : "https://rift-lens.xyz";
}

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ state: await getRefreshAllState() });
}

export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const action = req.nextUrl.searchParams.get("action") ?? "start";
  if (action === "stop") {
    await stopRefreshAll();
    return NextResponse.json({ state: await getRefreshAllState() });
  }

  // 이어하기(continue)는 상태를 초기화하지 않는다
  if (action === "start") await beginRefreshAll();
  const origin = publicOrigin(req);
  after(() => runRefreshAllRound(origin).catch(() => {}));
  return NextResponse.json({ state: await getRefreshAllState() });
}
