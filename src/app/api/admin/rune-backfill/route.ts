import { NextResponse, after, type NextRequest } from "next/server";
import { SITE_URL } from "@/lib/site";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getCrawlState } from "@/lib/crawl-seed";
import { getRefreshAllState } from "@/lib/refresh-all";
import { isCronSecretAuth } from "@/lib/round-chain";
import {
  beginRunefill,
  countMissingRunes,
  getRunefillState,
  runRunefillRound,
  setRunefillTurbo,
  stopRunefill,
} from "@/lib/rune-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 자기 자신을 호출할 공개 주소 — 배포 환경의 해시 URL은 Vercel 인증에 막힌다
function publicOrigin(req: NextRequest): string {
  return req.nextUrl.hostname === "localhost"
    ? req.nextUrl.origin
    : SITE_URL;
}


export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [state, missing] = await Promise.all([
    getRunefillState(),
    countMissingRunes().catch(() => null),
  ]);
  return NextResponse.json({ state, missing });
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
  if (cronAuth && action !== "continue") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (action === "stop") {
    await stopRunefill();
    return NextResponse.json({ state: await getRunefillState() });
  }
  // 진행 중 최고속 모드 토글 (?turbo=on|off)
  if (action === "turbo") {
    const on = req.nextUrl.searchParams.get("turbo") !== "off";
    return NextResponse.json({ state: await setRunefillTurbo(on) });
  }
  if (action === "start") {
    // 대량 백그라운드 작업은 한 번에 하나만
    const [ra, cr] = await Promise.all([getRefreshAllState(), getCrawlState()]);
    if (ra?.running || cr?.running) {
      return NextResponse.json(
        { error: "다른 백그라운드 작업이 진행 중이에요 — 끝난 뒤 시작해 주세요" },
        { status: 409 },
      );
    }
    await beginRunefill(req.nextUrl.searchParams.get("turbo") === "on");
  }
  const origin = publicOrigin(req);
  after(() => runRunefillRound(origin).catch(() => {}));
  return NextResponse.json({ state: await getRunefillState() });
}
