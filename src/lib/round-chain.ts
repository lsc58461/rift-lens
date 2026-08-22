// 백그라운드 라운드 이어달리기 — 라운드가 끝나면 서버가 스스로 다음 라운드를
// 요청한다. 관리자 탭의 폴링에 의존하지 않으므로 탭을 닫아도 완주된다.
// continue 요청은 CRON_SECRET으로 인증한다 (관리자 세션 불필요).

import "server-only";

export async function chainNextRound(
  origin: string,
  path: string,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // 시크릿이 없으면 기존 폴링 방식만으로 동작
  try {
    // continue 라우트는 after()로 라운드를 예약하고 즉시 응답하므로 짧게 끝난다
    await fetch(`${origin}${path}?action=continue`, {
      method: "POST",
      // 주의: 이 사슬은 Vercel이 깊이 ~5에서 끊는다. 그 뒤는 공개 트래픽
      // 펌프(job-pump.ts)와 관리자 탭 폴링이 이어준다.
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // 실패해도 관리자 탭 폴링이 백업으로 이어준다
  }
}

/** 관리자 세션이 없어도 CRON_SECRET Bearer면 통과시킬 때 사용 */
export function isCronSecretAuth(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}
