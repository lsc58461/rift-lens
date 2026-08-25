// 슬래시 커맨드 전역 등록 — 봇이 어느 서버에 초대돼도 커맨드가 보인다.
// 실행: node scripts/register-discord-commands.mjs  (.env.local의 토큰 사용)
// 기존 길드 스코프 커맨드는 중복 표시를 막기 위해 비운다.
import { readFileSync } from "node:fs";

// .env.local 간이 로더 (의존성 없이)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const APP = process.env.DISCORD_CLIENT_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
if (!APP || !TOKEN) throw new Error("DISCORD_CLIENT_ID / DISCORD_BOT_TOKEN 필요");

const MANAGE_GUILD = String(1 << 5);
const summoner = (name, desc) => ({
  type: 3, // STRING
  name,
  description: desc,
  required: true,
});

const commands = [
  {
    name: "rift",
    description: "소환사 매칭 구간 조회 (최근 로비 평균 랭크)",
    options: [summoner("소환사", "닉네임#태그")],
  },
  {
    name: "rift-team",
    description: "참가자들을 실력 균형 맞춰 두 팀으로 나누기",
    options: [summoner("참가자", "닉네임#태그를 쉼표/줄바꿈으로 구분")],
  },
  {
    name: "rift-duo",
    description: "두 소환사 듀오 시너지 분석",
    options: [summoner("소환사1", "닉네임#태그"), summoner("소환사2", "닉네임#태그")],
  },
  { name: "rift-recent", description: "최근 조회된 소환사 목록" },
  {
    name: "rift-alerts",
    description: "사이트 다운/복구 알림 채널 관리 — 서버 관리 권한자에게만 보이는 명령이에요",
    default_member_permissions: MANAGE_GUILD,
    dm_permission: false,
    options: [
      {
        type: 1, // SUB_COMMAND
        name: "설정",
        description: "알림 받을 채널 지정 (서버 관리 권한자에게만 보이는 명령)",
        options: [
          {
            type: 7, // CHANNEL
            name: "채널",
            description: "알림 채널",
            required: true,
            channel_types: [0], // 텍스트 채널만
          },
        ],
      },
      { type: 1, name: "해제", description: "이 서버의 알림 끄기 (서버 관리 권한자에게만 보이는 명령)" },
    ],
  },
];

const api = (path, body) =>
  fetch(`https://discord.com/api/v10${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
    return r.json();
  });

const global_ = await api(`/applications/${APP}/commands`, commands);
console.log(`전역 커맨드 ${global_.length}개 등록`);
if (GUILD) {
  await api(`/applications/${APP}/guilds/${GUILD}/commands`, []);
  console.log(`길드(${GUILD}) 스코프 커맨드 비움 (중복 방지)`);
}
