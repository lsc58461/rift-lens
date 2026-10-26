// 챔피언 장인 — 최근 2개 패치에서 그 챔피언을 가장 많이 한 소환사(페이지가 있는 사람만).
// 챔피언 상세 페이지의 '장인' 카드가 쓰고, 소환사 페이지로 가는 링크가 검색엔진에도 보이게 한다
// (소환사 페이지가 사이트 안 어디에서도 링크되지 않아 구글이 거의 긁지 않던 문제, 2026-10-26).
//
// 챔피언 하나씩 뽑으면 이즈리얼처럼 판수 많은 챔피언은 12초가 걸려 페이지에서 바로 못 부른다.
// 전 챔피언을 한 번에 집계해(참가자 293만 행) KV 에 두고 12시간마다 뒤에서 갈아 끼운다.
// 집계는 GROUP BY 가 work_mem(4MB)을 넘겨 디스크로 새면 65초, 128MB 면 9초라(실측) 이 쿼리만
// 트랜잭션 안에서 work_mem 을 올린다.

import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";
import { listPatches, oneAtATime, tryLock } from "@/lib/champion-stats";
import { riotKeyFp } from "@/lib/riot/client";

export interface ChampionMain {
  platform: string;
  name: string; // 닉네임#태그
  tier: string | null;
  label: string | null; // 현재 티어 표기 (예: "마스터 988LP")
  games: number;
  wins: number;
}

interface MainsPayload {
  builtAt: number;
  patches: string[];
  byChamp: Record<string, ChampionMain[]>;
}

const KEY = "champmains:v1";
const TTL_SEC = 7 * 24 * 60 * 60; // 갱신이 한동안 실패해도 낡은 목록이나마 나가게
const REFRESH_AFTER_MS = 12 * 60 * 60_000;
const MIN_GAMES = 5;
const PER_CHAMP = 10;

let building: Promise<void> | null = null;

async function build(): Promise<MainsPayload> {
  const sql = await getSql();
  const patches = (await listPatches()).slice(0, 2).map((p) => p.patch);
  if (patches.length === 0) return { builtAt: Date.now(), patches, byChamp: {} };
  const rows = (await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL work_mem = '128MB'");
    return tx.unsafe(
      `SELECT champ, platform, game_name, tag_line, tier, label, games, wins FROM (
         SELECT x.champion_name AS champ, r.platform, r.game_name, r.tag_line,
                r.current_tier AS tier, r.current_label AS label, x.games, x.wins,
                row_number() OVER (PARTITION BY x.champion_name
                                   ORDER BY x.games DESC, x.wins DESC, r.game_name_lower) AS rn
         FROM (
           SELECT champion_name, player_id,
                  count(*)::int AS games, count(*) FILTER (WHERE win)::int AS wins
           FROM match_participants
           WHERE fp = $1 AND patch = ANY($2::text[]) AND player_id IS NOT NULL
           GROUP BY 1, 2 HAVING count(*) >= $3
         ) x
         JOIN players pl ON pl.id = x.player_id
         JOIN recent_searches r ON r.puuid = pl.puuid AND r.gone_at IS NULL
         JOIN analyses a ON a.platform = r.platform AND a.game_name_lower = r.game_name_lower
          AND a.tag_line_lower = r.tag_line_lower AND a.kind = 'quick'
       ) t WHERE rn <= $4
       ORDER BY champ, rn`,
      [riotKeyFp(), patches, MIN_GAMES, PER_CHAMP],
    );
  })) as unknown as {
    champ: string;
    platform: string;
    game_name: string;
    tag_line: string;
    tier: string | null;
    label: string | null;
    games: number;
    wins: number;
  }[];

  const byChamp: Record<string, ChampionMain[]> = {};
  for (const r of rows) {
    (byChamp[r.champ] ??= []).push({
      platform: r.platform,
      name: `${r.game_name}#${r.tag_line}`,
      tier: r.tier,
      label: r.label,
      games: r.games,
      wins: r.wins,
    });
  }
  return { builtAt: Date.now(), patches, byChamp };
}

function refreshInBackground(): void {
  if (building) return;
  building = (async () => {
    const lockKey = `${KEY}:refreshing`;
    if (!(await tryLock(lockKey, 600).catch(() => false))) return;
    try {
      const startedAt = Date.now();
      const payload = await oneAtATime(build);
      await cache.set(KEY, payload, TTL_SEC);
      console.log(
        `[champmains] 집계 — 챔피언 ${Object.keys(payload.byChamp).length}개 · ` +
          `패치 ${payload.patches.join(",")} · took=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      console.error("[champmains] 집계 실패:", (e as Error)?.message);
    } finally {
      await cache.delete(lockKey).catch(() => {});
    }
  })().finally(() => {
    building = null;
  });
}

/** 이 챔피언의 장인 목록. 아직 한 번도 집계되지 않았으면 null(뒤에서 집계를 시작한다). */
export async function getChampionMains(champ: string): Promise<ChampionMain[] | null> {
  const hit = await cache.get<MainsPayload>(KEY).catch(() => null);
  if (!hit || Date.now() - hit.builtAt > REFRESH_AFTER_MS) refreshInBackground();
  return hit ? (hit.byChamp[champ] ?? []) : null;
}
