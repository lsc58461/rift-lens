import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getChampionStats, listPatches } from "@/lib/champion-stats";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
// 재집계(기본 + 패치 2개, 각 ~6초)가 응답 안에 끝나도록
export const maxDuration = 300;

/** 챔피언 통계 재집계 — 캐시를 비우고 그 자리에서 다시 계산해 채운다.
 * 비우기만 하면 다음 방문자가 콜드 집계(5초+)를 그대로 맞기 때문. */
export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const sql = await getSql();
  console.log("[재집계] 삭제 시작");
  const rows = await sql`
    DELETE FROM cache_entries WHERE key LIKE 'champstats:%' RETURNING 1`;
  console.log("[재집계] 삭제", rows.length, "건 — 기본 집계 시작");

  // 유저가 실제로 조회하는 조합(기본 + 드롭다운 패치)을 미리 데운다
  await getChampionStats(null);
  console.log("[재집계] 기본 완료 — 패치 목록");
  const patches = (await listPatches()).slice(0, 2);
  console.log("[재집계] 패치", patches.map((p) => p.patch).join(","));
  for (const p of patches) {
    await getChampionStats(p.patch);
    console.log("[재집계] 패치", p.patch, "완료");
  }

  return NextResponse.json({
    cleared: rows.length,
    warmed: 1 + patches.length,
    tookMs: Date.now() - started,
  });
}
