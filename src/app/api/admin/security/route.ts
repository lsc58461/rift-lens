// 보안 위험 감지 집계 — 관리자 카드가 직접 부른다.
// /api/admin/status 는 2초마다 폴링되므로 여기에 끼우지 않고 별도 라우트로 뺐다.
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { securityOverview } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await securityOverview());
}
