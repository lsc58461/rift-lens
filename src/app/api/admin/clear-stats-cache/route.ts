import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 챔피언 통계 캐시(집계 + 패치 목록) 초기화 — 다음 조회 때 현재 데이터로 재집계 */
export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = await getSql();
  const rows = await sql`
    DELETE FROM cache_entries WHERE key LIKE 'champstats:%' RETURNING 1`;
  return NextResponse.json({ cleared: rows.length });
}
