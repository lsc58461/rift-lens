import {
  getMaintenanceInfo,
  isMaintenanceActive,
} from "@/lib/maintenance";
import { summonerPath } from "@/lib/summoner-url";
import { SITE_URL } from "@/lib/site";
import { createPublicKey, verify as cryptoVerify } from "crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import {
  getLatestMatchId,
  getStoredResult,
  runQuickAnalysis,
} from "@/lib/mmr/deep-jobs";
import type { MmrEstimate } from "@/lib/mmr/estimate";
import { FRESH_MAX_AGE_MS } from "@/lib/freshness";
import { bestPartition, resolvePlayers, shuffled } from "@/lib/mmr/team";
import { getRecentSearches } from "@/lib/recent";
import type { PlatformRegion } from "@/lib/riot/types";
import {
  findSummonersByName,
  searchRecentSummoners,
  type SummonerSuggestion,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SITE = SITE_URL;
const PLATFORM: PlatformRegion = "kr";
const BLUE = 0x3b82f6;
const RED = 0xef4444;

// ── 서명 검증 (Ed25519, 내장 crypto) ────────────────────
function verifySignature(raw: string, sig: string, ts: string): boolean {
  const pub = process.env.DISCORD_PUBLIC_KEY;
  if (!pub || !sig || !ts) return false;
  try {
    // raw 32B 공개키를 SPKI DER로 감싸 KeyObject 생성
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(pub, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(ts + raw),
      key,
      Buffer.from(sig, "hex"),
    );
  } catch {
    return false;
  }
}

// ── 응답 헬퍼 ───────────────────────────────────────────
interface Embed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  image?: { url: string };
  footer?: { text: string };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Payload = { content?: string; embeds?: Embed[]; components?: unknown[] };

/**
 * 웹훅으로 보낸다. 성공하면 메시지 id(못 읽으면 "?"), 실패하면 null — 실패는 로그로 남긴다.
 * 예전엔 전부 삼켜서 '갱신 중…'에서 멈춘 메시지(2026-10-15)의 원인을 확인할 방법이 없었다.
 * 429 는 retry_after 만큼 기다렸다 다시 보낸다. 같은 내용을 다시 보내는 건 안전하다.
 */
async function sendWebhook(
  token: string,
  payload: Payload,
  mode: "edit" | "new",
): Promise<string | null> {
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId) return null;
  const base = `https://discord.com/api/v10/webhooks/${appId}/${token}`;
  const url = mode === "edit" ? `${base}/messages/@original` : `${base}?wait=true`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { id?: string } | null;
        return j?.id ?? "?";
      }
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        let wait = 1000;
        try {
          wait = Math.ceil(Number(JSON.parse(text).retry_after ?? 1) * 1000);
        } catch {}
        console.warn(`[discord] ${mode} 429 — ${wait}ms 뒤 재시도 (${attempt}/3)`);
        await sleep(Math.min(wait, 5_000));
        continue;
      }
      console.error(`[discord] ${mode} 실패 ${res.status}: ${text.slice(0, 300)}`);
      return null;
    } catch (e) {
      console.error(`[discord] ${mode} 오류 (${attempt}/3): ${(e as Error).message}`);
    }
  }
  return null;
}

/** defer 이후 결과 전송 (원본 메시지 수정) */
async function followUp(token: string, payload: Payload): Promise<boolean> {
  return (await sendWebhook(token, payload, "edit")) !== null;
}

/** 최종 결과는 반드시 닿아야 한다 — 수정이 끝내 안 되면 새 메시지로라도 보낸다 */
async function deliver(
  token: string,
  payload: Payload,
): Promise<{ how: "edit" | "new" | "fail"; id: string | null }> {
  const e = await sendWebhook(token, payload, "edit");
  if (e) return { how: "edit", id: e };
  const n = await sendWebhook(token, payload, "new");
  if (n) return { how: "new", id: n };
  return { how: "fail", id: null };
}

/**
 * 디스코드가 카드 이미지를 실제로 해석했는지 10초 뒤 확인해 로그로 남긴다.
 * 이미지가 '0×0'으로 남으면 클라이언트가 그리지 않는다(떴다가 사라지는 증상의 실체).
 * 봇이 속하지 않은 서버에서 쓴 명령도 인터랙션 토큰으로 조회할 수 있어, 다음엔 추측 대신 이걸 본다.
 */
async function logCardState(token: string, messageId: string, who: string): Promise<void> {
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId || messageId === "?") return;
  await sleep(10_000);
  const j = (await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/${messageId}`,
    { signal: AbortSignal.timeout(10_000) },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as {
    edited_timestamp?: string | null;
    embeds?: { image?: { width?: number; height?: number; placeholder?: string } }[];
  } | null;
  const img = j?.embeds?.[0]?.image;
  const state = !j
    ? "조회 실패"
    : !img
      ? "이미지 없음"
      : img.width
        ? `${img.width}x${img.height} 정상`
        : "0x0 해석 안 됨";
  console.log(
    `[discord/rift] 카드 상태 ${who}: ${state} · 수정 ${j?.edited_timestamp ? "있음" : "없음"}`,
  );
}

function parseRiotId(s: string): { gameName: string; tagLine: string } | null {
  const v = s.trim().normalize("NFKC");
  const hash = v.lastIndexOf("#");
  if (hash <= 0 || hash === v.length - 1) return null;
  return { gameName: v.slice(0, hash), tagLine: v.slice(hash + 1) };
}

// v 는 분석 시각이다(예전엔 Date.now()). 같은 분석이면 같은 주소라 디스코드·우리 서버 양쪽 캐시가
// 산다 — 매번 새 주소였을 땐 늘 처음부터 그려 1.5초 안에 못 받은 디스코드가 이미지를 지웠다.
function cardImage(name: string, analyzedAt: number | undefined): string {
  return `${SITE}/api/share-image?region=${PLATFORM}&riotId=${encodeURIComponent(name)}&v=${analyzedAt ?? 0}`;
}

const INTERNAL_ORIGIN = "http://127.0.0.1:3000";

/**
 * 카드 이미지를 결과를 보내기 **전에** 미리 그려 둔다. 그러면 디스코드가 받으러 올 땐 이미
 * 저장돼 있어 즉시 나간다. 디스코드는 일부 서버가 1.5초 안에 못 받으면 이미지를 지운다.
 * 실패해도 메시지는 보낸다(이미지만 늦거나 빠질 뿐).
 */
async function warmCard(est: MmrEstimate): Promise<void> {
  const name = `${est.account.gameName}#${est.account.tagLine}`;
  await fetch(
    `${INTERNAL_ORIGIN}/api/share-image?region=${PLATFORM}&riotId=${encodeURIComponent(name)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
    .then((r) => r.arrayBuffer())
    .catch(() => {});
}

// ── 커맨드 처리 ─────────────────────────────────────────

/** 조회 결과 카드. note 는 푸터에 덧붙일 상태 문구 */
function riftCard(stored: MmrEstimate, note: string): Embed {
  const name = `${stored.account.gameName}#${stored.account.tagLine}`;
  const est = stored.estimatedRank?.label ?? "표본 부족";
  const cur = stored.currentRank?.label ?? "언랭크";
  return {
    title: `${name} 의 최근 매칭 구간`,
    description: `**${est}** (최근 솔로랭크 로비 평균 랭크)\n현재 티어 ${cur}`,
    url: `${SITE}${summonerPath(PLATFORM, name)}`,
    color: BLUE,
    image: { url: cardImage(name, stored.analyzedAt) },
    footer: { text: note ? `Rift Lens · ${note}` : "Rift Lens" },
  };
}

/** 저장된 분석이 지금도 쓸 만한가 — 새 경기를 했으면 매치 ID 가 달라지고, 안 했어도 너무 오래되면 다시 본다 */
function isStale(stored: MmrEstimate, latestMatchId: string | null): boolean {
  if (latestMatchId !== null && stored.latestMatchId !== latestMatchId) return true;
  return Date.now() - (stored.analyzedAt ?? 0) > FRESH_MAX_AGE_MS;
}

// 동명이인 선택 버튼의 custom_id 머리말 — 뒤에 '게임명#태그'가 붙는다
const PICK_PREFIX = "rift:";
const MAX_PICK = 25; // 디스코드 한 메시지 버튼 상한 (5줄 × 5개)

/** 소환사 목록을 버튼으로 — 누르면 그 사람으로 /rift 를 다시 돈다. 티어를 붙여 고르기 쉽게 한다 */
function pickerRows(list: SummonerSuggestion[]): unknown[] {
  const buttons = list.slice(0, MAX_PICK).map((s) => {
    const riotId = `${s.game_name}#${s.tag_line}`;
    return {
      type: 2, // BUTTON
      style: 2, // SECONDARY
      label: `${riotId}${s.current_label ? ` · ${s.current_label}` : ""}`.slice(0, 80),
      custom_id: `${PICK_PREFIX}${riotId}`, // 게임명 16자 + 태그 5자라 상한 100자에 한참 못 미친다
    };
  });
  const rows: unknown[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: 1, components: buttons.slice(i, i + 5) }); // ACTION_ROW
  }
  return rows;
}

/**
 * 태그 없이 닉네임만 들어왔을 때. 같은 닉네임을 그대로 쓰는 등록 소환사가
 * 한 명이면 그 사람으로 바로 진행(카드 제목에 태그가 보이니 틀리면 알아챈다),
 * 여러 명이면 버튼으로 고르게, 하나도 없으면 비슷한 이름을 '혹시 이 중에?'로 보여준다.
 * 바로 진행할 대상이 있으면 돌려주고, 이미 안내를 보냈으면 null.
 */
async function resolveNameOnly(
  token: string,
  raw: string,
): Promise<{ gameName: string; tagLine: string } | null> {
  const name = raw.trim().normalize("NFKC").replace(/#+$/, "").trim();
  if (!name) {
    await followUp(token, { content: "닉네임만 쓰거나 게임명#태그로 입력해 주세요" });
    return null;
  }
  const exact = await findSummonersByName(PLATFORM, name, MAX_PICK + 1).catch(() => []);
  if (exact.length === 1) return { gameName: exact[0].game_name, tagLine: exact[0].tag_line };
  if (exact.length > 1) {
    const more = exact.length > MAX_PICK ? ` (최근 검색된 ${MAX_PICK}명만 보여요 — 없으면 태그까지 입력해 주세요)` : "";
    await followUp(token, {
      content: `**${name}** 닉네임을 쓰는 소환사가 여러 명이에요. 골라 주세요.${more}`,
      components: pickerRows(exact),
    });
    return null;
  }
  const near = await searchRecentSummoners(PLATFORM, name, 10).catch(() => []);
  await followUp(
    token,
    near.length
      ? {
          content: `**${name}** 그대로인 소환사는 기록에 없어요. 혹시 이 중에 있나요? 없으면 게임명#태그로 입력해 주세요.`,
          components: pickerRows(near),
        }
      : { content: `**${name}** 은(는) 기록에 없는 이름이에요. 게임명#태그로 입력해 주세요.` },
  );
  return null;
}

/**
 * 카드(이미지 임베드)를 보낸다. **반드시 '첫 수정' 아니면 '새 메시지'로만** 보낸다.
 *
 * 같은 메시지를 몇 초 안에 두 번 이상 고치면, 디스코드가 이미지를 해석(크기 계산)하는 비동기
 * 작업이 꼬여 이미지가 0×0 으로 굳고, 클라이언트는 크기 없는 이미지를 그리지 않는다 —
 * '떴다가 사라지는' 증상의 실체다(2026-10-15 확인: 디스코드가 저장한 상태를 봇 토큰으로 조회해 보니
 * 0×0 으로 멈춘 3건이 전부 두 번 이상 수정된 메시지였고, 한 번에 보낸 메시지는 전부 정상.
 * 한 건은 두 번째 수정까지 반영됐는데 저장된 이미지가 '첫 번째 수정'의 주소였다 — 늦게 끝난 첫
 * 해석이 덮어쓴 것). 서버가 이미지를 200·0.01초로 줘도 생긴다 — 서버 쪽 문제가 아니었다.
 *
 * mode "edit": defer 된 원래 메시지의 첫 수정으로 카드를 넣는다(그 전에 아무 수정도 하지 않을 것).
 * mode "new":  이미 한 번 이상 쓰인 메시지(버튼 목록)라면 카드는 새 메시지로 보내고, 원래 메시지는
 *              글자만 고친다(글자만 바꾸는 수정은 이미지와 무관).
 */
async function sendCard(
  token: string,
  est: MmrEstimate,
  note: string,
  mode: "edit" | "new",
): Promise<string> {
  const who = `${est.account.gameName}#${est.account.tagLine}`;
  await warmCard(est);
  const payload = { content: "", embeds: [riftCard(est, note)] };
  if (mode === "new") {
    const id = await sendWebhook(token, payload, "new");
    await followUp(token, {
      content: id ? `✅ **${who}** 조회 결과는 아래에 있어요` : `**${who}** 결과를 보내지 못했어요`,
      components: [],
      embeds: [],
    });
    if (id) void logCardState(token, id, who);
    return id ? "새 메시지" : "실패";
  }
  const r = await deliver(token, payload);
  if (r.id) void logCardState(token, r.id, who);
  return r.how;
}

/**
 * 정밀 분석을 웹 화면과 같은 경로(/api/deep)로 걸고 끝날 때까지 기다린다.
 * 대기열 순서·사용자 우선(전체 갱신은 background 라 항상 뒤)·생존 신호를 그 라우트가 그대로
 * 처리하므로 여기서 새로 짜지 않는다 — 웹 화면처럼 몇 초마다 다시 부르기만 하면 된다.
 */
async function runDeepAndWait(
  id: { gameName: string; tagLine: string },
  deadlineMs: number,
): Promise<"done" | "error" | "timeout"> {
  const qs =
    `region=${PLATFORM}&gameName=${encodeURIComponent(id.gameName)}` +
    `&tagLine=${encodeURIComponent(id.tagLine)}`;
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const r = (await fetch(`${INTERNAL_ORIGIN}/api/deep?${qs}`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then((x) => x.json())
      .catch(() => null)) as { state?: string } | null;
    if (r?.state === "done") return "done";
    if (r?.state === "error") return "error";
    await sleep(3_000);
  }
  return "timeout";
}

// 정밀 분석 대기 상한. 디스코드 응답 수정은 15분까지라 그 안쪽으로 잡는다.
// 실측(2026-10-15, 프로덕션 키, 24시간 1,079건): 한 건 p50 14초 · p90 31초 · 최대 193초.
// 사용자 요청이 전체 갱신보다 앞서므로 최악은 '돌던 정밀 하나 + 내 것'이라 몇 분이면 끝난다.
const DEEP_WAIT_MS = 12 * 60_000;

/**
 * /rift 한 건. 최신 정밀 결과가 있으면 그대로, 아니면 정밀 분석을 돌려 그 결과로 답한다.
 * 기다리는 동안 중간 메시지는 보내지 않는다 — 디스코드의 '생각 중…'이 그대로 보인다.
 * (예전엔 예전 기록 카드를 먼저 띄웠다가 결과로 다시 고쳤는데, 그게 바로 '두 번 수정'이라
 *  이미지가 0×0 으로 굳는 원인이었다. sendCard 주석 참고)
 * mode: 슬래시 명령은 "edit"(defer 된 메시지를 처음 고침), 버튼 선택은 "new"(목록 메시지는 이미 쓰임).
 */
async function handleRift(
  token: string,
  summoner: string,
  mode: "edit" | "new" = "edit",
): Promise<void> {
  const id = parseRiotId(summoner) ?? (await resolveNameOnly(token, summoner));
  if (!id) return;
  try {
    const deepStored = await getStoredResult("deep", PLATFORM, id.gameName, id.tagLine);
    const quickStored = deepStored
      ? null
      : await getStoredResult("quick", PLATFORM, id.gameName, id.tagLine);
    const shown = deepStored ?? quickStored; // 분석이 다 실패했을 때의 마지막 보루

    // 기록이 하나도 없으면 여기서 계정 확인을 겸한다 — 없는 계정이면 실패해 안내로 빠진다
    const latestMatchId = shown
      ? await getLatestMatchId(PLATFORM, id.gameName, id.tagLine).catch(() => null)
      : await getLatestMatchId(PLATFORM, id.gameName, id.tagLine);

    const t0 = Date.now();
    let final: MmrEstimate | null;
    let note = "";
    let status: string;
    if (deepStored && !isStale(deepStored, latestMatchId)) {
      // 정밀 결과가 최신(새 경기 없음 + 7일 이내)이면 그대로
      final = deepStored;
      status = "최신";
    } else {
      status = await runDeepAndWait(id, DEEP_WAIT_MS);
      final =
        status === "done"
          ? await getStoredResult("deep", PLATFORM, id.gameName, id.tagLine)
          : null;
      note = "방금 정밀 분석했어요";
      if (!final) {
        // 정밀이 실패했거나 대기 상한을 넘겼다 — 빠른 분석으로라도 최신값을 낸다
        final = await runQuickAnalysis(PLATFORM, id.gameName, id.tagLine).catch(() => null);
        note =
          status === "timeout"
            ? "정밀 분석이 밀려 빠른 분석 결과예요"
            : "정밀 분석에 실패해 빠른 분석 결과예요";
        if (!final && shown) {
          final = shown;
          note = "분석에 실패해 예전 기록을 보여드려요";
        }
      }
    }
    if (!final) throw new Error("분석 결과 없음");

    const how = await sendCard(token, final, note, mode);
    console.log(
      `[discord/rift] ${id.gameName}#${id.tagLine} 정밀 ${status} ${Date.now() - t0}ms · 전달 ${how}`,
    );
  } catch {
    await deliver(token, {
      content: "조회에 실패했어요. 계정명을 확인해 주세요.",
      embeds: [],
      components: [],
    });
  }
}

async function handleTeam(token: string, raw: string): Promise<void> {
  const names = raw
    .split(/[,\n]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (names.length < 2 || names.length % 2 !== 0) {
    await followUp(token, {
      content:
        "짝수 인원(2~20명)을 쉼표로 구분해 입력해 주세요\n예) `A#KR1, B#KR1, C#KR1, D#KR1`",
    });
    return;
  }
  const players = await resolvePlayers(PLATFORM, names);
  const valid = players.filter((p) => !p.error);
  const failed = players.filter((p) => p.error);
  // 섞어서 넣는다 — bestPartition 이 0번을 A팀에 고정하므로, 안 섞으면 맨 앞에 적은 사람이 늘 블루팀이 된다
  const part = bestPartition(shuffled(valid));
  if (!part) {
    await followUp(token, {
      content: `팀을 나눌 수 없어요 (유효 인원 ${valid.length}명)${
        failed.length ? `\n실패: ${failed.map((f) => f.input).join(", ")}` : ""
      }`,
    });
    return;
  }
  const line = (ps: typeof valid) =>
    ps.map((p) => `• ${p.name} — ${p.label}`).join("\n");
  const total = (ps: typeof valid) => ps.reduce((s, p) => s + p.points, 0);
  const all = total(part.a) + total(part.b);
  const pctA = all > 0 ? ((total(part.a) / all) * 100).toFixed(1) : "50.0";
  const pctB = all > 0 ? (100 - Number(pctA)).toFixed(1) : "50.0";
  await followUp(token, {
    embeds: [
      {
        title: "내전 팀 밸런싱 결과",
        description: `**🔵 블루팀** (${pctA}%)\n${line(part.a)}\n\n**🔴 레드팀** (${pctB}%)\n${line(part.b)}${
          failed.length
            ? `\n\n⚠️ 조회 실패: ${failed.map((f) => f.input).join(", ")}`
            : ""
        }`,
        color: BLUE,
        url: `${SITE}/team`,
        footer: { text: "Rift Lens · 로비 평균 랭크 기준" },
      },
    ],
  });
}

async function handleDuo(
  token: string,
  a: string,
  b: string,
): Promise<void> {
  const res = await fetch(`${SITE}/api/duo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: PLATFORM, a, b }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  const data = res && res.ok ? await res.json() : null;
  if (!data) {
    await followUp(token, { content: "조회에 실패했어요" });
    return;
  }
  const t = data.together;
  const rate = t.games > 0 ? Math.round((t.wins / t.games) * 100) : null;
  await followUp(token, {
    embeds: [
      {
        title: `${data.a.name} × ${data.b.name} 듀오 궁합`,
        description:
          t.games > 0
            ? `함께 **${t.games}판** ${t.wins}승 ${t.games - t.wins}패 (**${rate}%**)\n맞대결 ${data.versus.games}판`
            : "최근 100경기 안에서 함께한 기록이 없어요",
        url: `${SITE}/duo`,
        color: rate !== null && rate >= 50 ? BLUE : RED,
        footer: { text: "Rift Lens" },
      },
    ],
  });
}

async function handleRecent(token: string): Promise<void> {
  const list = (await getRecentSearches()).slice(0, 10);
  await followUp(token, {
    embeds: [
      {
        title: "최근 검색된 소환사",
        description:
          list
            .map(
              (r, i) =>
                `${i + 1}. **${r.gameName}#${r.tagLine}** — ${r.estimatedLabel ?? "?"}`,
            )
            .join("\n") || "기록이 없어요",
        url: SITE,
        color: BLUE,
        footer: { text: "Rift Lens" },
      },
    ],
  });
}

// ── 알림 채널 설정 (/rift-alerts) ───────────────────────
// 봇이 초대된 길드별로 관리자가 다운/복구 알림 채널을 지정한다.
// 커맨드 자체에 default_member_permissions(서버 관리)가 걸려 있지만,
// 클라이언트 조작 가능성에 대비해 서버에서도 권한 비트를 재확인한다.

const MANAGE_GUILD = BigInt(32); // 1 << 5 (tsconfig target이 ES2020 미만이라 리터럴 대신)

async function handleAlerts(
  body: {
    guild_id?: string;
    member?: { permissions?: string; user?: { id: string } };
    data?: { options?: { name: string; options?: Option[] }[] };
  },
): Promise<{ content: string }> {
  const guildId = body.guild_id;
  if (!guildId) return { content: "서버 안에서만 쓸 수 있는 명령이에요" };
  const perms = BigInt(body.member?.permissions ?? "0");
  if ((perms & MANAGE_GUILD) === BigInt(0)) {
    return { content: "서버 관리 권한이 있어야 설정할 수 있어요" };
  }

  const sub = body.data?.options?.[0];
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();

  if (sub?.name === "해제") {
    await sql`DELETE FROM discord_alert_channels WHERE guild_id = ${guildId}`;
    return { content: "🔕 이 서버의 알림을 해제했어요" };
  }
  // 설정
  const channelId = sub?.options?.find((o) => o.name === "채널")?.value;
  if (!channelId) return { content: "채널을 지정해 주세요" };
  const setBy = body.member?.user?.id ?? "unknown";
  await sql`
    INSERT INTO discord_alert_channels (guild_id, channel_id, set_by, updated_at)
    VALUES (${guildId}, ${channelId}, ${setBy}, now())
    ON CONFLICT (guild_id) DO UPDATE
    SET channel_id = EXCLUDED.channel_id, set_by = EXCLUDED.set_by, updated_at = now()`;
  return {
    content: `🔔 알림 채널을 <#${channelId}> 로 설정했어요 — 사이트 다운/복구 시 여기로 알려드릴게요`,
  };
}

// ── 엔트리포인트 ────────────────────────────────────────

interface Option {
  name: string;
  value: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-signature-ed25519") ?? "";
  const ts = req.headers.get("x-signature-timestamp") ?? "";
  if (!verifySignature(raw, sig, ts)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const body = JSON.parse(raw);

  // PING
  if (body.type === 1) return NextResponse.json({ type: 1 });

  // MESSAGE_COMPONENT — /rift 에서 동명이인을 고르는 버튼
  if (body.type === 3) {
    const customId: string = body.data?.custom_id ?? "";
    if (!customId.startsWith(PICK_PREFIX)) return NextResponse.json({ type: 6 }); // 모르는 버튼은 무시
    const riotId = customId.slice(PICK_PREFIX.length);
    const maint = await getMaintenanceInfo().catch(() => null);
    if (isMaintenanceActive(maint)) {
      return NextResponse.json({
        type: 7, // UPDATE_MESSAGE
        data: { content: "🔧 지금은 점검 중이에요 — 점검이 끝나면 다시 시도해 주세요.", components: [] },
      });
    }
    const token: string = body.token;
    // 카드는 새 메시지로 보낸다 — 이 목록 메시지는 이미 한 번 쓰였고 지금 또 고치므로,
    // 여기에 카드를 넣으면 '두 번 이상 수정'이 돼 이미지가 0×0 으로 굳는다(sendCard 주석).
    after(() => handleRift(token, riotId, "new"));
    // 버튼을 바로 걷어 여러 번 눌러 중복 조회되는 것도 막는다
    return NextResponse.json({
      type: 7, // UPDATE_MESSAGE
      data: {
        content: `🔍 **${riotId}** 조회 중… 결과는 새 메시지로 보내드려요`,
        components: [],
        embeds: [],
      },
    });
  }

  // APPLICATION_COMMAND
  if (body.type === 2) {
    const name: string = body.data?.name;
    const opts: Option[] = body.data?.options ?? [];
    const get = (k: string) => opts.find((o) => o.name === k)?.value ?? "";
    const token: string = body.token;

    // 알림 채널 설정은 점검과 무관하게 동작해야 한다 (점검 중일수록 필요)
    if (name === "rift-alerts") {
      const res = await handleAlerts(body).catch(() => ({
        content: "설정 저장에 실패했어요 — 잠시 후 다시 시도해 주세요",
      }));
      return NextResponse.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: { ...res, flags: 64 }, // EPHEMERAL
      });
    }

    // 점검 중엔 분석을 돌리지 않는다 — 웹과 동일한 정책
    const maint = await getMaintenanceInfo().catch(() => null);
    if (isMaintenanceActive(maint)) {
      const until = maint?.endsAt
        ? ` (예상 종료: ${new Date(maint.endsAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })})`
        : "";
      return NextResponse.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: `🔧 지금은 점검 중이에요${until} — 점검이 끝나면 다시 시도해 주세요.${maint?.reason ? `
> ${maint.reason}` : ""}`,
          flags: 64, // EPHEMERAL
        },
      });
    }

    // 3초 룰 — 즉시 defer하고 백그라운드에서 결과 전송
    after(async () => {
      switch (name) {
        case "rift":
          await handleRift(token, get("소환사"));
          break;
        case "rift-team":
          await handleTeam(token, get("참가자"));
          break;
        case "rift-duo":
          await handleDuo(token, get("소환사1"), get("소환사2"));
          break;
        case "rift-recent":
          await handleRecent(token);
          break;
        default:
          await followUp(token, { content: "알 수 없는 명령이에요" });
      }
    });
    return NextResponse.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  }

  return NextResponse.json({ type: 1 });
}
