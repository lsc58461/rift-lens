import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getChampionStats, listPatches } from "@/lib/champion-stats";
import { cache } from "@/lib/cache";

export const dynamic = "force-dynamic";
// 재집계(기본 + 패치 몇 개 × 브라켓, 각 ~6초)가 응답 안에 끝나도록
export const maxDuration = 300;

/** 챔피언 통계 재집계 — 캐시를 비우고 그 자리에서 다시 계산해 채운다.
 * 캐시는 Redis(REDIS_URL) 또는 Postgres 폴백 — cache 추상화로 지워야 실제로 비워진다.
 * (예전엔 cache_entries를 직접 DELETE해서 Redis 환경에선 안 비워지는 버그가 있었다.) */
export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const keys = await cache.keys("champstats:");
  for (const k of keys) await cache.delete(k);

  // 유저가 실제로 조회하는 조합을 미리 데운다: 기본 브라켓(에메+)로
  // 최신 몇 개 패치 + '전체 랭크'도 함께.
  await getChampionStats(null, "emerald");
  const patches = (await listPatches()).slice(0, 3);
  for (const p of patches) {
    await getChampionStats(p.patch, "emerald");
  }
  await getChampionStats(patches[0]?.patch ?? null, "all");

  return NextResponse.json({
    cleared: keys.length,
    warmed: 2 + patches.length,
    tookMs: Date.now() - started,
  });
}
