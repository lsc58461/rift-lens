// 챔피언 통계 목록(champions-table)과 상세 페이지(champion-detail)가 함께 쓰는 표시 헬퍼.
// 한쪽에서만 쓰는 것은 각 파일에 둔다.
//
// "use client" 를 붙이지 않는다 — 서버 컴포넌트(상세 페이지의 generateMetadata)가 wr()·POSITION_LABEL 을
// 직접 쓴다. 지시자를 붙이면 서버에서 부를 때 클라이언트 참조가 돼 "Attempted to call wr() from the
// server" 로 죽고, 메타데이터가 통째로 빠진다(2026-09-03에 실제로 겪음 — 페이지는 200이라 눈에 안 띈다).
// 훅·이벤트 핸들러가 없는 순수 함수·컴포넌트만 여기 둘 것.

export const POSITION_LABEL: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};

export function wr(wins: number, games: number): number {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
}

/** 표본 보정 승률(윌슨 하한) — 판수가 적은 항목이 높은 승률만으로
 * 추천되는 것을 막는다. 130판 52%보다 1368판 47%가 위에 올 수 있다. */
export function adjustedRate(wins: number, games: number): number {
  if (games === 0) return 0;
  const z = 1.96;
  const p = wins / games;
  return (
    (p + (z * z) / (2 * games) -
      z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)) /
    (1 + (z * z) / games)
  );
}

export function WinrateText({ wins, games }: { wins: number; games: number }) {
  const v = wr(wins, games);
  return (
    <span
      className={`tabular-nums ${
        v >= 55 ? "text-emerald-500" : v < 45 ? "text-red-500" : ""
      }`}
    >
      {v}%
    </span>
  );
}

/** 챔피언 상세 페이지 주소 — 슬러그는 DDragon 챔피언 키 소문자(LeeSin → leesin).
 *  기본값(최신 패치·에메랄드 이상)은 쿼리에서 생략해 색인이 한 주소로 모이게 한다. */
export function championSlug(champ: string): string {
  return champ.toLowerCase();
}

export function championHref(champ: string, patch: string | null, bracket: string): string {
  const p = new URLSearchParams();
  if (patch) p.set("patch", patch);
  if (bracket && bracket !== "emerald") p.set("rank", bracket);
  const qs = p.toString();
  return `/champions/${championSlug(champ)}${qs ? `?${qs}` : ""}`;
}
