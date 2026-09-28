// 내전 팀 나누기 — 인원을 k개 팀으로 고르게 가른다.
// 클라이언트 컴포넌트에서도 쓰므로 "server-only" 를 붙이지 않는다.
//
// 2팀은 전수탐색으로 최적해를 구한다(20명이라도 92,378가지라 수십 ms).
// 3팀부터는 전수탐색이 불가능하다 — 4팀×5명(20명)이 4억 8천만 가지다.
// 그래서 무작위 재시작 + 교환 개선(local search)으로 근사한다. 15명 3팀(126,126가지)
// 정도면 사실상 매번 최적해가 나온다.

/** 한 가지 팀 구성. teams[i] 는 그 팀에 속한 참가자 인덱스, spread 는 팀 합계의 최대-최소 */
export interface Split {
  teams: number[][];
  spread: number;
}

export interface SplitResult {
  list: Split[];
  /** 전체 가짓수 (전수탐색일 때만. 근사 탐색이면 null) */
  total: number | null;
  /** 최적해를 보장하는가 */
  exact: boolean;
}

/**
 * 이 인원으로 가능한 팀 수 (최대 4팀, 딱 나누어떨어질 것).
 * 3·4팀은 팀당 2명 이상을 요구하지만 2팀만은 1:1도 허용한다 — 듀오 비교로 쓰던 기존 용법이다.
 */
export function teamCountOptions(n: number): number[] {
  const out: number[] = [];
  for (let k = 2; k <= 4; k++) {
    if (n % k !== 0) continue;
    if (n / k >= 2 || k === 2) out.push(k);
  }
  return out;
}

/** 기본 팀 수 — 5명씩 나뉘면 그걸, 아니면 2팀 */
export function defaultTeamCount(n: number): number {
  const opts = teamCountOptions(n);
  return opts.find((k) => n / k === 5) ?? opts[0] ?? 2;
}

const spreadOf = (sums: number[]) => Math.max(...sums) - Math.min(...sums);

/** teams 를 보기 좋은 순서로 — 팀장이 다 있으면 팀장 입력 순, 아니면 가장 작은 인덱스 순 */
function orderTeams(teams: number[][], captains: number[]): number[][] {
  const t = teams.map((m) => [...m].sort((a, b) => a - b));
  if (captains.length === t.length) {
    return captains.map((c) => t.find((m) => m.includes(c))!).filter(Boolean);
  }
  return t.sort((x, y) => x[0] - y[0]);
}

const keyOf = (teams: number[][]) => teams.map((m) => m.join(".")).join("|");

/** 정렬된 목록에 끼워 넣고 limit 를 넘으면 가장 나쁜 걸 버린다 */
function insert(list: Split[], s: Split, limit: number): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].spread <= s.spread) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, s);
  if (list.length > limit) list.pop();
}

/**
 * 2팀 전수탐색.
 * 팀장이 없으면 0번을 A팀에 고정해 좌우 대칭 중복을 없앤다 — 안 그러면 같은 구성이
 * 색만 바뀐 채 두 번 나오고 계산량도 2배가 된다.
 * 팀장이 있으면 팀장 배치 자체가 대칭을 깨므로 그걸 기준으로 삼는다.
 */
function exactTwo(pts: number[], captains: number[], limit: number): SplitResult {
  const n = pts.length;
  const half = n / 2;
  const total = pts.reduce((s, v) => s + v, 0);
  const anchor = captains[0] ?? 0; // A팀에 반드시 들어가는 사람
  const banned = captains[1] ?? -1; // A팀에 들어가면 안 되는 사람 (두 번째 팀장)

  const list: Split[] = [];
  let worst = Infinity;
  let count = 0;
  const picked = new Array<number>(half);
  picked[0] = anchor;

  const walk = (start: number, depth: number, sumA: number) => {
    if (depth === half) {
      count++;
      const spread = Math.abs(2 * sumA - total);
      if (list.length >= limit && spread >= worst) return;
      const inA = new Uint8Array(n);
      for (let i = 0; i < half; i++) inA[picked[i]] = 1;
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < n; i++) (inA[i] ? a : b).push(i);
      insert(list, { teams: orderTeams([a, b], captains), spread }, limit);
      if (list.length === limit) worst = list[list.length - 1].spread;
      return;
    }
    for (let i = start; i <= n - (half - depth); i++) {
      if (i === anchor || i === banned) continue;
      picked[depth] = i;
      walk(i + 1, depth + 1, sumA + pts[i]);
    }
  };
  walk(0, 1, pts[anchor]);
  return { list, total: count, exact: true };
}

/**
 * 팀 합계가 가장 작은 팀부터 채우는 탐욕 배치.
 * 점수 큰 사람부터 넣어야 균형이 잘 잡히는데, 그렇게만 하면 매 재시작이 똑같은 해로 끝난다
 * (정렬이 입력 순서를 지워버리므로). 그래서 가끔 두 번째로 가벼운 팀을 고르게 해서 퍼뜨린다.
 */
function greedy(
  pts: number[],
  order: number[],
  k: number,
  size: number,
  seed: number[][],
  jitter: number,
): number[][] {
  const teams = seed.map((m) => [...m]);
  const sums = teams.map((m) => m.reduce((s, i) => s + pts[i], 0));
  const rest = [...order].sort((x, y) => pts[y] - pts[x]);
  const open: number[] = [];
  for (const p of rest) {
    open.length = 0;
    for (let t = 0; t < k; t++) if (teams[t].length < size) open.push(t);
    open.sort((a, b) => sums[a] - sums[b]);
    const pick = open.length > 1 && Math.random() < jitter ? open[1] : open[0];
    teams[pick].push(p);
    sums[pick] += pts[p];
  }
  return teams;
}

/** 두 팀 사이에서 한 명씩 맞바꿔 격차가 줄면 반영 — 더 못 줄일 때까지 */
function improve(teams: number[][], pts: number[], locked: Set<number>): number {
  const k = teams.length;
  const sums = teams.map((m) => m.reduce((s, i) => s + pts[i], 0));
  let best = spreadOf(sums);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let x = 0; x < k; x++) {
      for (let y = x + 1; y < k; y++) {
        for (let i = 0; i < teams[x].length; i++) {
          const px = teams[x][i];
          if (locked.has(px)) continue;
          for (let j = 0; j < teams[y].length; j++) {
            const py = teams[y][j];
            if (locked.has(py)) continue;
            const d = pts[py] - pts[px];
            if (d === 0) continue;
            sums[x] += d;
            sums[y] -= d;
            const s = spreadOf(sums);
            if (s < best) {
              best = s;
              teams[x][i] = py;
              teams[y][j] = px;
              moved = true;
              // px 는 이미 y팀으로 갔다 — 낡은 px 로 계속 맞바꾸면 같은 사람이 두 팀에 생긴다
              break;
            }
            sums[x] -= d;
            sums[y] += d;
          }
        }
      }
    }
    if (!moved) break;
  }
  return best;
}

/** 3팀 이상 — 무작위 재시작 + 교환 개선으로 근사 */
function approximate(
  pts: number[],
  k: number,
  captains: number[],
  limit: number,
  restarts: number,
): SplitResult {
  const n = pts.length;
  const size = n / k;
  const locked = new Set(captains);
  const list: Split[] = [];
  const seen = new Set<string>();

  // 팀장은 서로 다른 팀에 하나씩 고정한다
  const seed: number[][] = Array.from({ length: k }, (_, t) =>
    captains[t] !== undefined ? [captains[t]] : [],
  );
  const pool = Array.from({ length: n }, (_, i) => i).filter((i) => !locked.has(i));

  for (let r = 0; r < restarts; r++) {
    // 매 시도마다 순서를 섞어 다른 해로 수렴시킨다
    const order = [...pool];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // 처음 몇 번은 흔들지 않고(최적에 가까운 해 확보), 이후엔 흔드는 정도를 바꿔 가며
    // 서로 다른 조합을 모은다 — 한 세기로만 흔들면 같은 해로 수렴해 '다른 조합'이 몇 개 안 나온다
    const teams = greedy(pts, order, k, size, seed, r < 5 ? 0 : 0.2 + (r % 4) * 0.15);
    const spread = improve(teams, pts, locked);
    const ordered = orderTeams(teams, captains);
    const key = keyOf(ordered);
    if (seen.has(key)) continue;
    seen.add(key);
    insert(list, { teams: ordered, spread }, limit);
  }
  return { list, total: null, exact: false };
}

/**
 * 인원을 k개 팀으로 가른다. 전력차(팀 합계 최대-최소)가 작은 순으로 최대 limit개.
 * captains 는 서로 다른 팀에 한 명씩 배치되며, 팀 수보다 많으면 호출부에서 걸러야 한다.
 */
export function splitTeams(
  points: number[],
  k: number,
  captains: number[] = [],
  limit = 200,
): SplitResult {
  const n = points.length;
  if (k < 2 || n < k * 2 || n % k !== 0 || captains.length > k) {
    return { list: [], total: 0, exact: true };
  }
  return k === 2
    ? exactTwo(points, captains, limit)
    : approximate(points, k, captains, limit, 600);
}
