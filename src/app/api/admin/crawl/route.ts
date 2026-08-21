import { NextResponse, after, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginCrawl,
  getCrawlState,
  runCrawlRound,
  stopCrawl,
} from "@/lib/crawl-seed";

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
    const target = Number(req.nextUrl.searchParams.get("target") ?? 30);
    await beginCrawl(Number.isFinite(target) ? target : 30);
  }
  // continue는 상태를 초기화하지 않고 라운드만 잇는다
  after(() => runCrawlRound().catch(() => {}));
  return NextResponse.json({ state: await getCrawlState() });
}
