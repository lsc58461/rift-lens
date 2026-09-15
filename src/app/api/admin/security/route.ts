// 보안 위험 감지 집계 — 관리자 카드가 직접 부른다.
// /api/admin/status 는 2초마다 폴링되므로 여기에 끼우지 않고 별도 라우트로 뺐다.
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { securityIpDetail, securityOverview } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // ?ip=1.2.3.4 — 그 IP가 시도한 경로 전부 (카드에서 IP를 펼쳤을 때)
  const ip = req.nextUrl.searchParams.get("ip");
  if (ip) return NextResponse.json(await securityIpDetail(ip));
  return NextResponse.json(await securityOverview());
}
