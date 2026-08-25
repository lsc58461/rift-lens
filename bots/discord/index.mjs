// rift-lens 게이트웨이 봇 — 상시 접속 컨테이너.
// 역할: ① presence 표시 ② 사이트 헬스체크 → 등록 채널에 다운/복구 알림
// 알림 채널은 각 길드 관리자가 /rift-alerts로 지정한다 (discord_alert_channels).
import { Client, GatewayIntentBits, ActivityType, EmbedBuilder } from "discord.js";
import postgres from "postgres";

const SITE = "https://rift-lens.xyz";
const CHECK_INTERVAL_MS = 60_000;
const PATCH_CHECK_INTERVAL_MS = 30 * 60_000; // 새 패치 감지 주기(30분)
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
// ── 패치노트 알림 ───────────────────────────────────────
// DDragon 최신 버전을 주기적으로 확인해 새 패치가 뜨면 알림 채널로 링크 발송.
// 마지막으로 알린 패치는 app_settings(discord:last_patch)에 저장.
async function getLastAnnouncedPatch() {
  const r = await sql`SELECT value FROM app_settings WHERE key = 'discord:last_patch'`.catch(
    () => [],
  );
  return r[0]?.value ?? null;
}
async function setLastAnnouncedPatch(patch) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('discord:last_patch', ${sql.json(patch)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.catch(
    () => {},
  );
}
/** 공식 패치노트 페이지에서 히어로 이미지·요약을 뽑는다 (임베드에 첨부용).
 *  라이엇이 26.4부터 URL 스킴을 바꿔, 신형식 404면 구형식으로 폴백한다. */
async function fetchPatchMeta(url, fallbackUrl) {
  try {
    const get = (u) =>
      fetch(u, {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "Mozilla/5.0 RiftLensBot" },
      });
    let usedUrl = url;
    let res = await get(url);
    if (!res.ok && fallbackUrl) {
      const alt = await get(fallbackUrl);
      if (alt.ok) {
        res = alt;
        usedUrl = fallbackUrl;
      }
    }
    if (!res.ok) return {};
    const html = await res.text();
    const og = (p) =>
      html.match(new RegExp(`<meta[^>]*property="${p}"[^>]*content="([^"]+)"`, "i"))?.[1];
    let image = og("og:image");
    if (image) {
      image = image.replace(/&amp;/g, "&");
      // 라이엇 og:image는 물음표가 둘("...?accountingTag=LoL?w=1200") — 정리한다
      const first = image.indexOf("?");
      if (first >= 0) {
        image = image.slice(0, first + 1) + image.slice(first + 1).replace(/\?/g, "&");
      }
    }
    return { image, summary: og("og:description"), url: usedUrl };
  } catch {
    return {};
  }
}

async function patchLoop() {
  let latest;
  try {
    const res = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return;
    const versions = await res.json();
    latest = String(versions[0] ?? "").split(".").slice(0, 2).join("."); // DDragon "16.16"
  } catch {
    return;
  }
  if (!latest) return;
  const last = await getLastAnnouncedPatch();
  if (last === latest) return;
  // 첫 실행(기록 없음)엔 기준만 저장하고 알리지 않는다 — 봇 재시작 스팸 방지
  if (last) {
    // 마케팅 패치번호 = DDragon major + 10 (DDragon 16.16 → 패치 26.16)
    const [dMaj, dMin] = latest.split(".").map((n) => parseInt(n, 10));
    const mkt = `${(dMaj || 0) + 10}.${dMin || 0}`;
    const base = "https://www.leagueoflegends.com/ko-kr/news/game-updates";
    const url = `${base}/league-of-legends-patch-${(dMaj || 0) + 10}-${dMin || 0}-notes/`;
    const legacy = `${base}/patch-${(dMaj || 0) + 10}-${dMin || 0}-notes/`;
    const meta = await fetchPatchMeta(url, legacy);
    const finalUrl = meta.url || url;
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`새 패치 ${mkt} 노트가 나왔어요`)
      .setDescription(
        meta.summary
          ? `${meta.summary}\n${finalUrl}`
          : `리그 오브 레전드 패치 ${mkt} 노트를 확인해 보세요.\n${finalUrl}`,
      )
      .setURL(finalUrl)
      .setTimestamp();
    if (meta.image) embed.setImage(meta.image);
    await broadcast(embed);
  }
  await setLastAnnouncedPatch(latest);
}

client.once("clientReady", () => {
  console.log(`[bot] 로그인: ${client.user.tag}, 길드 ${client.guilds.cache.size}개`);
  // 상태에 링크는 클릭이 안 되므로 커맨드 안내를 띄운다 (주소는 봇 프로필 소개에)
  client.user.setActivity({
    type: ActivityType.Custom,
    name: "custom",
    state: "🔍 /rift 로 매칭 구간 조회",
  });
  setInterval(healthLoop, CHECK_INTERVAL_MS);
  patchLoop().catch(() => {});
  setInterval(() => patchLoop().catch(() => {}), PATCH_CHECK_INTERVAL_MS);
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
