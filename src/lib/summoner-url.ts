// 소환사 페이지 주소 — /summoner/{region}/{게임명-태그} (op.gg 와 같은 형식, 2026-09-03부터)
//
// 왜 '#' 대신 '-': 주소창에 '이름#태그'를 치면 '#태그'는 프래그먼트라 서버에 오지 않는다. '%23' 으로
// 인코딩해야 하는데 사람이 손으로 못 친다. 라이엇 ID 규칙상 게임명·태그에 '-' 가 못 들어가므로
// (DB 2.5만 건 확인, 2026-09-03) 마지막 '-' 를 구분자로 써도 모호하지 않다.
// 옛 '%23' 주소는 proxy 와 페이지에서 새 주소로 308 리다이렉트한다 (색인·공유 링크 유지).
// 순수 함수 — 서버/클라이언트 공용.

/** "이름#태그" → "이름-태그" (이미 '-' 형식이면 그대로) */
export function riotIdToSlug(riotId: string): string {
  const i = riotId.lastIndexOf("#");
  return i > 0 ? `${riotId.slice(0, i)}-${riotId.slice(i + 1)}` : riotId;
}

/** 소환사 페이지 경로. riotId 는 "이름#태그" 또는 "이름-태그" 둘 다 받는다 */
export function summonerPath(region: string, riotId: string): string {
  return `/summoner/${region}/${encodeURIComponent(riotIdToSlug(riotId))}`;
}

/** 경로 조각(디코딩된 값)을 게임명·태그로. '#' 형식(옛 주소)이면 legacy=true */
export function parseSummonerSlug(
  decoded: string,
): { gameName: string; tagLine: string; legacy: boolean } | null {
  const h = decoded.lastIndexOf("#");
  if (h > 0 && h < decoded.length - 1) {
    return { gameName: decoded.slice(0, h), tagLine: decoded.slice(h + 1), legacy: true };
  }
  const d = decoded.lastIndexOf("-");
  if (d > 0 && d < decoded.length - 1) {
    return { gameName: decoded.slice(0, d), tagLine: decoded.slice(d + 1), legacy: false };
  }
  return null;
}
