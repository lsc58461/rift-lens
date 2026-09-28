// 내전 팀 밸런싱 — 웹(/api/team/resolve)과 디스코드 봇이 공유하는 로직.

import "server-only";
import { getStoredResult } from "./deep-jobs";
import { pointsToRank, rankToPoints } from "./rank";
import { getAccountByRiotId, getLeagueEntries } from "@/lib/riot/client";
import { RiotApiError, type PlatformRegion } from "@/lib/riot/types";

export interface ResolvedPlayer {
  input: string;
  name: string; // 캐노니컬 게임명#태그
  points: number;
  label: string; // "에메랄드 2 · 30LP"
  tier: string;
  source: "analysis" | "rank" | "unranked";
  error?: string;
}

const UNRANKED_POINTS = 800; // 실버 4 상당 기본값

/**
 * 각 플레이어의 실력 점수를 해석한다.
 * 우선순위: 저장된 매칭 실력대(정밀>빠른, 신선도 무관) → 현재 랭크 → 언랭 기본값
 */
export async function resolvePlayers(
  platform: PlatformRegion,
  names: string[],
): Promise<ResolvedPlayer[]> {
  return Promise.all(
    names.map(async (input): Promise<ResolvedPlayer> => {
      const hash = input.lastIndexOf("#");
      if (hash <= 0 || hash === input.length - 1) {
        return {
          input,
          name: input,
          points: 0,
          label: "-",
          tier: "IRON",
          source: "unranked",
          error: "게임명#태그 형식이 아니에요",
        };
      }
      const gameName = input.slice(0, hash);
      const tagLine = input.slice(hash + 1);
      try {
        const stored =
          (await getStoredResult("deep", platform, gameName, tagLine)) ??
          (await getStoredResult("quick", platform, gameName, tagLine));
        if (stored?.estimatedPoints != null) {
          const pts = Math.round(stored.estimatedPoints);
          const rank = pointsToRank(pts);
          return {
            input,
            name: `${stored.account.gameName}#${stored.account.tagLine}`,
            points: pts,
            label: rank.label,
            tier: rank.tier,
            source: "analysis",
          };
        }
        const account = await getAccountByRiotId(platform, gameName, tagLine);
        const entries = await getLeagueEntries(platform, account.puuid);
        const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
        if (solo) {
          const pts = rankToPoints(solo.tier, solo.rank, solo.leaguePoints);
          const rank = pointsToRank(pts);
          return {
            input,
            name: `${account.gameName}#${account.tagLine}`,
            points: pts,
            label: rank.label,
            tier: rank.tier,
            source: "rank",
          };
        }
        return {
          input,
          name: `${account.gameName}#${account.tagLine}`,
          points: UNRANKED_POINTS,
          label: "언랭크 (기본값)",
          tier: "SILVER",
          source: "unranked",
        };
      } catch (e) {
        return {
          input,
          name: input,
          points: 0,
          label: "-",
          tier: "IRON",
          source: "unranked",
          error:
            e instanceof RiotApiError && e.status === 404
              ? "계정을 찾을 수 없어요"
              : "조회에 실패했어요",
        };
      }
    }),
  );
}

/** 순서를 한 번 섞은 새 배열 (Fisher-Yates). bestPartition 에 넣기 전에 쓴다 — 아래 주석 참고 */
export function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 전력차가 가장 작은 팀 분할 (짝수 인원 전제, 최대 20명).
 *
 * 0번 참가자는 항상 A팀에 둔다 — {A,B}와 {B,A}는 같은 분할이라, 고정하지 않으면 모든 조합을
 * 좌우만 바꿔 두 번 훑는다. 20명이면 C(20,10)=184,756 → C(19,9)=92,378 로 절반이 된다.
 * 대신 0번이 늘 A팀에 뜨므로, 호출부에서 shuffled() 로 순서를 섞어 매번 다른 사람이 걸리게 한다.
 *
 * 합계는 재귀를 내려가며 누적하고(sumA) 반대편은 전체합에서 뺀다 — 잎마다 배열을 두 번
 * 순회하던 옛 방식으로는 20명을 감당하지 못한다.
 */
export function bestPartition(players: ResolvedPlayer[]): {
  a: ResolvedPlayer[];
  b: ResolvedPlayer[];
  diff: number;
} | null {
  const n = players.length;
  if (n < 2 || n % 2 !== 0) return null;
  const half = n / 2;
  const pts = players.map((p) => p.points);
  const total = pts.reduce((s, v) => s + v, 0);

  const picked = new Array<number>(half);
  picked[0] = 0;
  let bestDiff = Infinity;
  let bestA: number[] = [];

  const walk = (start: number, depth: number, sumA: number) => {
    if (depth === half) {
      const diff = Math.abs(2 * sumA - total); // |sumA - (total - sumA)|
      if (diff < bestDiff) {
        bestDiff = diff;
        bestA = picked.slice();
      }
      return;
    }
    // 남은 자리를 다 채울 수 없는 시작점은 아예 들어가지 않는다
    for (let i = start; i <= n - (half - depth); i++) {
      picked[depth] = i;
      walk(i + 1, depth + 1, sumA + pts[i]);
    }
  };
  walk(1, 1, pts[0]);
  if (bestA.length === 0) return null;

  const inA = new Uint8Array(n);
  for (const i of bestA) inA[i] = 1;
  return {
    a: bestA.map((i) => players[i]),
    b: players.filter((_, i) => !inA[i]),
    diff: bestDiff,
  };
}
