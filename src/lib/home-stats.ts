// 메인 페이지 라이브 지표 — 가벼운 count 3종을 10분 캐시로 제공한다.
import "server-only";
import { cached } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { riotKeyFp } from "@/lib/riot/client";

export interface HomeStats {
  totalMatches: number; // 수집·분석에 쓰인 경기 수
  totalSummoners: number; // 기록된 소환사 수
  visits24h: number; // 최근 24시간 소환사 조회 수
}

export async function getHomeStats(): Promise<HomeStats> {
  return cached("home:stats:v1", 60 * 10, async () => {
    const sql = await getSql();
    const [m, s, v] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM matches WHERE fp = ${riotKeyFp()}`,
      sql`SELECT count(*)::int AS n FROM recent_searches`,
      sql`SELECT count(*)::int AS n FROM visit_log WHERE at > now() - interval '24 hours'`,
    ]);
    return {
      totalMatches: (m[0]?.n as number) ?? 0,
      totalSummoners: (s[0]?.n as number) ?? 0,
      visits24h: (v[0]?.n as number) ?? 0,
    };
  });
}
