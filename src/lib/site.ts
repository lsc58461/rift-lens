// 사이트 상수 — 도메인·운영자·연락처·외부 서비스 식별자·소유확인 토큰을 한곳에 모은다.
// 전부 공개 값(HTML·약관 문서에 그대로 노출됨). 비밀값(API 키·토큰·접속 문자열)은
// env(app.env / .env.local)에 두고 여기엔 절대 넣지 않는다.
// 서버·클라이언트 공용(순수 상수).

export const SITE_URL = "https://rift-lens.xyz";
export const SITE_NAME = "Rift Lens";

/** 약관·개인정보처리방침의 운영자 표기 */
export const OPERATOR_NAME = "이정윤";
export const CONTACT_EMAIL = "riftlens.contact@gmail.com";

/** 디스코드 앱(봇) — 초대 링크·인터랙션 검증용 공개 id */
export const DISCORD_CLIENT_ID = "1529391623400591390";

/** 네이버 서치어드바이저 사이트 소유확인 (메타 태그 방식) */
export const NAVER_SITE_VERIFICATION = "8c073171f9813db5457d01cf15a4097df25f0858";

/** 서버가 자기 자신을 부를 때 쓸 주소 — 로컬 개발이면 요청 origin, 배포면 공개 도메인
 *  (배포 환경에선 내부 호스트명·해시 붙은 주소가 인증에 막히므로 반드시 공개 도메인) */
export function publicOrigin(hostname: string, requestOrigin: string): string {
  return hostname === "localhost" ? requestOrigin : SITE_URL;
}
