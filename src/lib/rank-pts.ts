// 매치 평균 랭크점수 계산 + 랭크 브라켓 정의.
// 참가자 player_id를 league_snapshots(최신)에 조인해 rankToPoints와 같은 스케일로
// 점수화하고 평균낸다. 랭크 필터(챔피언 통계)의 근거가 된다.
import "server-only";
import { getSql } from "@/lib/db";
import { riotKeyFp } from "@/lib/riot/client";

// rank.ts와 동일한 점수 스케일을 SQL로 재현한 표현식.
// IRON=0..DIAMOND=6 (×400) + division(IV=0..I=3)×100 + min(lp,99),
// MASTER+ = 2800 + lp. ls = league_snapshots 별칭.
const LS_POINTS = `
  CASE
    WHEN ls.solo_tier IN ('MASTER','GRANDMASTER','CHALLENGER')
      THEN 2800 + COALESCE(ls.solo_lp, 0)
    WHEN ls.solo_tier IS NULL THEN NULL
    ELSE (CASE ls.solo_tier
            WHEN 'IRON' THEN 0 WHEN 'BRONZE' THEN 1 WHEN 'SILVER' THEN 2
            WHEN 'GOLD' THEN 3 WHEN 'PLATINUM' THEN 4 WHEN 'EMERALD' THEN 5
            WHEN 'DIAMOND' THEN 6 ELSE 0 END) * 400
       + (CASE ls.solo_rank
            WHEN 'IV' THEN 0 WHEN 'III' THEN 1 WHEN 'II' THEN 2 WHEN 'I' THEN 3
            ELSE 0 END) * 100
       + LEAST(COALESCE(ls.solo_lp, 0), 99)
  END`;

export type RankBracketKey = "all" | "brpl" | "emerald" | "diamond" | "master";

export const RANK_BRACKETS: {
  key: RankBracketKey;
  label: string;
  min: number | null;
  max: number | null; // 상한(미만), null이면 없음
}[] = [
  { key: "all", label: "전체 랭크", min: null, max: null },
  { key: "brpl", label: "브·실·골·플", min: 400, max: 2000 },
  { key: "emerald", label: "에메랄드 이상", min: 2000, max: null },
  { key: "diamond", label: "다이아 이상", min: 2400, max: null },
  { key: "master", label: "마스터 이상", min: 2800, max: null },
];

export function bracketOf(key: string): (typeof RANK_BRACKETS)[number] {
  return RANK_BRACKETS.find((b) => b.key === key) ?? RANK_BRACKETS[0];
}

/** rank_pts가 아직 없는 매치를 배치로 계산해 채운다. 반환=이번에 채운 매치 수.
 *  참가자 중 랭크를 아는 인원이 없으면 -1(계산 불가 표시)로 박아 재시도를 막는다. */
export async function recomputeRankPtsBatch(limit = 500): Promise<number> {
  const sql = await getSql();
  const fp = riotKeyFp();
  const rows = await sql.unsafe(
    `
    WITH todo AS (
      SELECT match_id FROM matches
      WHERE fp = $1 AND rank_pts IS NULL
      ORDER BY game_creation DESC LIMIT $2
    ),
    calc AS (
      SELECT t.match_id,
             avg(pts.p)::int AS avg_pts,
             count(pts.p) AS known
      FROM todo t
      JOIN match_participants mp ON mp.fp = $1 AND mp.match_id = t.match_id
      LEFT JOIN LATERAL (
        SELECT ${LS_POINTS} AS p
        FROM league_snapshots ls
        WHERE ls.fp = $1 AND ls.player_id = mp.player_id
        ORDER BY ls.created_at DESC LIMIT 1
      ) pts ON true
      GROUP BY t.match_id
    )
    UPDATE matches m
    SET rank_pts = CASE WHEN c.known > 0 THEN c.avg_pts ELSE -1 END
    FROM calc c
    WHERE m.fp = $1 AND m.match_id = c.match_id
    RETURNING m.match_id, m.rank_pts`,
    [fp, limit],
  );
  const updated = rows as unknown as { match_id: string; rank_pts: number }[];
  if (updated.length > 0) {
    // 참가자 정규화 테이블에도 같은 값 전파
    await sql`
      UPDATE match_participants p SET rank_pts = v.rank_pts
      FROM (SELECT * FROM jsonb_to_recordset(${sql.json(updated as never)}) AS x(match_id text, rank_pts real)) v
      WHERE p.fp = ${fp} AND p.match_id = v.match_id`.catch(() => {});
  }
  return updated.length;
}

/** rank_pts 미계산 매치 수 */
export async function countRankPtsPending(): Promise<number> {
  const sql = await getSql();
  const r = await sql`
    SELECT count(*)::int AS n FROM matches
    WHERE fp = ${riotKeyFp()} AND rank_pts IS NULL`;
  return (r[0]?.n as number) ?? 0;
}

/** 랭크가 갱신되면(새 스냅샷) 이미 계산된 매치도 오래되니, 특정 puuid가 낀
 *  매치의 rank_pts를 무효화(NULL)해 다음 배치가 다시 계산하게 한다. */
export async function invalidateRankPtsForPuuids(puuids: string[]): Promise<void> {
  if (puuids.length === 0) return;
  const sql = await getSql();
  const fp = riotKeyFp();
  await sql`
    UPDATE matches m SET rank_pts = NULL
    WHERE m.fp = ${fp} AND m.rank_pts IS NOT NULL
      AND EXISTS (SELECT 1 FROM match_participants p
                  WHERE p.fp = m.fp AND p.match_id = m.match_id
                    AND p.player_id IN (SELECT id FROM players WHERE puuid = ANY(${puuids})))`;
  await sql`
    UPDATE match_participants p SET rank_pts = NULL
    WHERE p.fp = ${fp} AND p.rank_pts IS NOT NULL
      AND p.match_id IN (SELECT match_id FROM match_participants
                         WHERE fp = ${fp}
                           AND player_id IN (SELECT id FROM players WHERE puuid = ANY(${puuids})))`.catch(() => {});
}
