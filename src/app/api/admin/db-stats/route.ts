// DB 용량 집계 — 관리자 카드가 직접 부른다.
// /api/admin/status 는 2초마다 폴링되므로 pg_total_relation_size 같은 무거운 질의는 여기에 둔다.
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { databaseStats } from "@/lib/db-stats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await databaseStats());
}
