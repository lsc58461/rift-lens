// 디스코드 봇 공개 정보 — 초대 링크는 클라이언트 ID(공개값)와 권한 비트로 구성된다.
// 봇 본체는 bots/discord (별도 컨테이너). 토큰·시크릿은 서버 env에만 있다.

import { DISCORD_CLIENT_ID } from "@/lib/site";
export { DISCORD_CLIENT_ID };

// 필요한 권한만: 채널 보기(1024) + 메시지 보내기(2048) + 링크 임베드(16384)
// 패치노트 이미지는 임베드 URL로 붙이므로 파일 첨부 권한은 필요 없다.
export const DISCORD_BOT_PERMISSIONS = 1024 + 2048 + 16384;

export const DISCORD_INVITE_URL =
  `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}` +
  `&scope=bot%20applications.commands&permissions=${DISCORD_BOT_PERMISSIONS}`;
