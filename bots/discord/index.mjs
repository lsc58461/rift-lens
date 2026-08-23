// rift-lens 게이트웨이 봇 — 상시 접속 컨테이너.
// 역할: ① presence 표시 ② 사이트 헬스체크 → 등록 채널에 다운/복구 알림
// 알림 채널은 각 길드 관리자가 /rift-alerts로 지정한다 (discord_alert_channels).
import { Client, GatewayIntentBits, ActivityType, EmbedBuilder } from "discord.js";
import postgres from "postgres";

const SITE = "https://rift-lens.xyz";
const CHECK_INTERVAL_MS = 60_000;
const FAIL_THRESHOLD = 3; // 연속 실패 N회부터 다운으로 판정 (일시 오류 오탐 방지)

const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 10 });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── 헬스체크 ────────────────────────────────────────────
let failCount = 0;
let isDown = false;
let downSince = null;

async function checkOnce() {
  try {
    const res = await fetch(SITE + "/api/maintenance", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch {
    return false;
  }
}

async function alertChannels() {
  return sql`SELECT guild_id, channel_id FROM discord_alert_channels`;
}

async function broadcast(embed) {
  const rows = await alertChannels().catch(() => []);
  for (const { guild_id, channel_id } of rows) {
    try {
      const ch = await client.channels.fetch(channel_id);
      await ch.send({ embeds: [embed] });
    } catch (e) {
      // 채널 삭제/권한 회수 — 조용히 넘어간다 (길드 탈퇴 시엔 guildDelete가 정리)
      console.error(`[alert] ${guild_id}/${channel_id} 전송 실패:`, e?.message);
    }
  }
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

async function healthLoop() {
  const ok = await checkOnce();
  if (ok) {
    if (isDown) {
      isDown = false;
      const dur = downSince ? fmtDuration(Date.now() - downSince) : "?";
      downSince = null;
      await broadcast(
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle("✅ Rift Lens 복구")
          .setDescription(`사이트가 다시 정상이에요 (다운타임 약 ${dur})\n${SITE}`)
          .setTimestamp(),
      );
    }
    failCount = 0;
  } else {
    failCount++;
    if (!isDown && failCount >= FAIL_THRESHOLD) {
      isDown = true;
      downSince = Date.now();
      await broadcast(
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🚨 Rift Lens 다운")
          .setDescription(`사이트 응답이 ${FAIL_THRESHOLD}회 연속 실패했어요\n${SITE}`)
          .setTimestamp(),
      );
    }
  }
}

// ── 라이프사이클 ────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`[bot] 로그인: ${client.user.tag}, 길드 ${client.guilds.cache.size}개`);
  // 상태에 링크는 클릭이 안 되므로 커맨드 안내를 띄운다 (주소는 봇 프로필 소개에)
  client.user.setActivity({
    type: ActivityType.Custom,
    name: "custom",
    state: "🔍 /rift 로 매칭 실력대 분석",
  });
  setInterval(healthLoop, CHECK_INTERVAL_MS);
});

// 길드에서 쫓겨나면 등록된 알림 채널도 정리
client.on("guildDelete", async (guild) => {
  await sql`DELETE FROM discord_alert_channels WHERE guild_id = ${guild.id}`.catch(() => {});
  console.log(`[bot] 길드 이탈, 알림 채널 정리: ${guild.id}`);
});

process.on("SIGTERM", async () => {
  await client.destroy().catch(() => {});
  await sql.end().catch(() => {});
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
