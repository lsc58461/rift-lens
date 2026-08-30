// 매치 ID 표현 — API·화면에선 "KR_8352054344" 문자열, DB(matches/match_participants/
// match_bans/match_teams.match_id)엔 숫자 부분만 bigint 로 저장한다 (2026-08-30).
// 플랫폼 접두어는 행의 platform 컬럼(현재 KR 전용)으로 복원한다.

/** "KR_8352054344" → "8352054344" (DB 파라미터용 — 문자열로 넘겨 PG 가 bigint 로 받게 한다) */
export function matchNo(matchId: string): string {
  const i = matchId.indexOf("_");
  const digits = i >= 0 ? matchId.slice(i + 1) : matchId;
  if (!/^\d{1,18}$/.test(digits)) throw new Error(`잘못된 매치 ID: ${matchId}`);
  return digits;
}

/** DB 의 bigint(문자열/숫자) + platform → "KR_8352054344" */
export function matchIdOf(no: string | number | bigint, platform: string = "kr"): string {
  return `${platform.toUpperCase()}_${no}`;
}
