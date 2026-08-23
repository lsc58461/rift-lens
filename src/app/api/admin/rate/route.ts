import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getRateLimitStatus } from "@/lib/riot/rate-status";

export const dynamic = "force-dynamic";

// 라이엇 API 한도 카드 전용 경량 폴링(1초) — 리미터 스냅샷은 인메모리라
// 세션 검증(PK 조회) 말고는 비용이 없다. 나머지 대시보드는 /api/admin/status(2초).
export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ rate: await getRateLimitStatus(), serverTime: Date.now() });
}
