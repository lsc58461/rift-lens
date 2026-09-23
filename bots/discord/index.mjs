// rift-lens 게이트웨이 봇 — 상시 접속 컨테이너.
// 역할: ① presence 표시 ② 사이트 헬스체크 → 등록 채널에 다운/복구 알림
// 알림 채널은 각 길드 관리자가 /rift-alerts로 지정한다 (discord_alert_channels).
import { Client, GatewayIntentBits, ActivityType, EmbedBuilder } from "discord.js";
import postgres from "postgres";

const SITE = "https://rift-lens.xyz";
const CHECK_INTERVAL_MS = 60_000;
const PATCH_CHECK_INTERVAL_MS = 30 * 60_000; // 새 패치 감지 주기(30분)
const CHANGELOG_CHECK_INTERVAL_MS = 10 * 60_000; // 업데이트 내역 감지 주기(10분)
const FAIL_THRESHOLD = 3; // 연속 실패 N회부터 다운으로 판정 (일시 오류 오탐 방지)

const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 10 });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── 헬스체크 ────────────────────────────────────────────
// 다운 상태는 DB(app_settings 'discord:down_since')에도 둔다 — 배포로 봇이 재시작되면
// 메모리 상태가 날아가 복구 알림을 못 보내던 문제(2026-08-30) 방지.
let failCount = 0;
let isDown = false;
let downSince = null;

async function loadDownState() {
  const r = await sql`SELECT value FROM app_settings WHERE key = 'discord:down_since'`.catch(() => []);
  const since = Number(r[0]?.value);
  if (Number.isFinite(since) && since > 0) {
    isDown = true;
    downSince = since;
    console.log(`[bot] 재시작 전 다운 상태 복원 (since ${new Date(since).toISOString()})`);
  }
}
async function saveDownState(since) {
  if (since) {
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('discord:down_since', ${sql.json(since)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.catch(() => {});
  } else {
    await sql`DELETE FROM app_settings WHERE key = 'discord:down_since'`.catch(() => {});
  }
}

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
      await saveDownState(null);
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
      await saveDownState(downSince);
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
/** og:description 은 HTML 이라 엔티티가 그대로 들어온다(&#x27; 등) — 디스코드에 날것으로 나가지 않게 푼다 */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
    const summary = og("og:description");
    return { image, summary: summary ? decodeEntities(summary) : undefined, url: usedUrl };
  } catch {
    return {};
  }
}

const PATCH_BASE = "https://www.leagueoflegends.com/ko-kr/news/game-updates";
/** 마케팅 라벨("26.19") → 공식 패치노트 URL 두 벌 (구형식은 26.3 이하 폴백) */
function urlsForLabel(label) {
  const [maj, min] = label.split(".").map((n) => parseInt(n, 10));
  return {
    url: `${PATCH_BASE}/league-of-legends-patch-${maj}-${min}-notes/`,
    legacy: `${PATCH_BASE}/patch-${maj}-${min}-notes/`,
  };
}
/** 저장값을 마케팅 라벨로 맞춘다 — 예전엔 DDragon 형식("16.18")으로 저장했다 */
function toMarketing(label) {
  const [maj, min] = String(label ?? "").split(".").map((n) => parseInt(n, 10));
  if (!maj || Number.isNaN(min)) return null;
  return maj < 20 ? `${maj + 10}.${min}` : `${maj}.${min}`;
}
const newerThan = (a, b) => {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am !== bm ? am > bm : an > bn;
};

async function patchLoop() {
  let ddragon;
  try {
    const res = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return;
    const versions = await res.json();
    ddragon = String(versions[0] ?? "").split(".").slice(0, 2).join("."); // DDragon "16.16"
  } catch {
    return;
  }
  // 마케팅 패치번호 = DDragon major + 10 (DDragon 16.16 → 패치 26.16)
  let label = toMarketing(ddragon);
  if (!label) return;

  // DDragon 버전 목록은 공식 패치노트보다 늦게 올라온다 — 2026-09-23 실측에서 26.19 노트가
  // 이미 공개됐는데도 DDragon 최신은 여전히 16.18 이었다. DDragon 만 보고 있으면 그동안 새 패치를
  // 통째로 놓친다. 그래서 다음 번호(와 연도가 바뀌는 27.1)의 페이지를 찔러 보고, 실제로 있으면
  // 그걸 최신으로 삼는다. 없으면 fetchPatchMeta 가 빈 값을 주므로 DDragon 기준 그대로 간다.
  const [lMaj, lMin] = label.split(".").map((n) => parseInt(n, 10));
  let meta = null;
  for (const cand of [`${lMaj}.${lMin + 1}`, `${lMaj + 1}.1`]) {
    const u = urlsForLabel(cand);
    const m = await fetchPatchMeta(u.url, u.legacy);
    if (m.url) {
      label = cand;
      meta = m;
      break;
    }
  }

  const last = toMarketing(await getLastAnnouncedPatch());
  if (last && !newerThan(label, last)) return;
  // 첫 실행(기록 없음)엔 기준만 저장하고 알리지 않는다 — 봇 재시작 스팸 방지
  if (last) {
    const u = urlsForLabel(label);
    if (!meta) meta = await fetchPatchMeta(u.url, u.legacy);
    const finalUrl = meta.url || u.url;
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`새 패치 ${label} 노트가 나왔어요`)
      .setDescription(
        meta.summary
          ? `${meta.summary}
${finalUrl}`
          : `리그 오브 레전드 패치 ${label} 노트를 확인해 보세요.
${finalUrl}`,
      )
      .setURL(finalUrl)
      .setTimestamp();
    if (meta.image) embed.setImage(meta.image);
    await broadcast(embed);
  }
  await setLastAnnouncedPatch(label);
}

// ── 업데이트 내역 알림 ──────────────────────────────────
// changelog_entries(관리자가 /admin/updates 에서 관리)에 새 항목이 생기면 알림 채널로.
// 같은 날짜 행에 항목이 덧붙는 경우가 많아, 행별로 "알린 항목 수"를 기억해 새 항목만 보낸다
// (app_settings 'discord:changelog_seen' = { "<id>": n }).
const TAG_EMOJI = { "신규": "✨", "개선": "🔧", "수정": "🐛" };

async function getChangelogSeen() {
  const r = await sql`SELECT value FROM app_settings WHERE key = 'discord:changelog_seen'`.catch(() => []);
  const v = r[0]?.value;
  return v && typeof v === "object" ? v : null;
}
async function setChangelogSeen(seen) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('discord:changelog_seen', ${sql.json(seen)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.catch(() => {});
}

async function changelogLoop() {
  const rows = await sql`
    SELECT id, entry_date, title, items FROM changelog_entries
    WHERE published ORDER BY entry_date DESC, id DESC LIMIT 20`.catch(() => null);
  if (!rows) return;
  const seen = await getChangelogSeen();
  const next = {};
  for (const r of rows) next[String(r.id)] = Array.isArray(r.items) ? r.items.length : 0;
  // 첫 실행(기록 없음)엔 기준만 저장하고 알리지 않는다 — 봇 재시작 스팸 방지
  if (!seen) {
    await setChangelogSeen(next);
    return;
  }
  // 오래된 순으로 — 여러 건이면 시간순으로 올라간다
  for (const r of [...rows].reverse()) {
    const items = Array.isArray(r.items) ? r.items : [];
    const already = Number(seen[String(r.id)] ?? 0);
    const fresh = items.slice(already);
    if (fresh.length === 0) continue;
    const lines = fresh
      .map((it) => `${TAG_EMOJI[it?.tag] ?? "•"} **${it?.tag ?? ""}** ${it?.text ?? ""}`.trim())
      .join("\n");
    const embed = new EmbedBuilder()
      .setColor(0xa855f7)
      .setTitle(`📝 Rift Lens 업데이트 — ${r.title}`)
      .setDescription(`${lines}\n\n${SITE}/updates`)
      .setURL(`${SITE}/updates`)
      .setFooter({ text: r.entry_date })
      .setTimestamp();
    await broadcast(embed);
  }
  await setChangelogSeen(next);
}

client.once("clientReady", async () => {
  console.log(`[bot] 로그인: ${client.user.tag}, 길드 ${client.guilds.cache.size}개`);
  await loadDownState();
  // 상태에 링크는 클릭이 안 되므로 커맨드 안내를 띄운다 (주소는 봇 프로필 소개에)
  client.user.setActivity({
    type: ActivityType.Custom,
    name: "custom",
    state: "🔍 /rift 로 매칭 구간 조회",
  });
  setInterval(healthLoop, CHECK_INTERVAL_MS);
  patchLoop().catch(() => {});
  setInterval(() => patchLoop().catch(() => {}), PATCH_CHECK_INTERVAL_MS);
  changelogLoop().catch(() => {});
  setInterval(() => changelogLoop().catch(() => {}), CHANGELOG_CHECK_INTERVAL_MS);
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
