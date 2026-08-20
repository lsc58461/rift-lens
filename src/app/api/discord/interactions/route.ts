import { createPublicKey, verify as cryptoVerify } from "crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { getStoredResult, runQuickAnalysis } from "@/lib/mmr/deep-jobs";
import { bestPartition, resolvePlayers } from "@/lib/mmr/team";
import { getRecentSearches } from "@/lib/recent";
import { getAccountByRiotId } from "@/lib/riot/client";
import type { PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SITE = "https://rift-lens.xyz";
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

/** defer 이후 결과 전송 (원본 메시지 수정) */
async function followUp(
  token: string,
  payload: { content?: string; embeds?: Embed[] },
): Promise<void> {
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId) return;
  await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => {});
}

function parseRiotId(s: string): { gameName: string; tagLine: string } | null {
  const v = s.trim().normalize("NFKC");
  const hash = v.lastIndexOf("#");
  if (hash <= 0 || hash === v.length - 1) return null;
  return { gameName: v.slice(0, hash), tagLine: v.slice(hash + 1) };
}

function cardImage(name: string): string {
  return `${SITE}/api/share-image?region=${PLATFORM}&riotId=${encodeURIComponent(name)}&v=${Date.now()}`;
}

// ── 커맨드 처리 ─────────────────────────────────────────

async function handleRift(token: string, summoner: string): Promise<void> {
  const id = parseRiotId(summoner);
  if (!id) {
    await followUp(token, { content: "게임명#태그 형식으로 입력해 주세요" });
    return;
  }
  try {
    let stored =
      (await getStoredResult("deep", PLATFORM, id.gameName, id.tagLine)) ??
      (await getStoredResult("quick", PLATFORM, id.gameName, id.tagLine));
    if (!stored) {
      // 저장된 분석이 없으면 안내 메시지를 먼저 띄우고 분석 후 결과로 수정
      await followUp(token, {
        content: `🔍 **${id.gameName}#${id.tagLine}** 분석 중이에요… 최대 1~2분 걸릴 수 있어요`,
      });
      stored = await runQuickAnalysis(PLATFORM, id.gameName, id.tagLine);
    }
    const name = `${stored.account.gameName}#${stored.account.tagLine}`;
    const est = stored.estimatedRank?.label ?? "표본 부족";
    const cur = stored.currentRank?.label ?? "언랭크";
    const gap =
      stored.gap !== null ? `${stored.gap > 0 ? "+" : ""}${stored.gap}pt` : "-";
    await followUp(token, {
      content: "", // 분석 중 안내 문구 제거
      embeds: [
        {
          title: `${name} 의 매칭 실력대`,
          description: `**${est}**\n현재 티어 ${cur} · 갭 ${gap}`,
          url: `${SITE}/summoner/${PLATFORM}/${encodeURIComponent(name)}`,
          color: BLUE,
          image: { url: cardImage(name) },
          footer: { text: "Rift Lens" },
        },
      ],
    });
  } catch {
    await followUp(token, {
      content: "조회에 실패했어요. 계정명을 확인해 주세요.",
    });
  }
}

async function handleTeam(token: string, raw: string): Promise<void> {
  const names = raw
    .split(/[,\n]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (names.length < 2 || names.length % 2 !== 0) {
    await followUp(token, {
      content:
        "짝수 인원(2·4·6·8·10명)을 쉼표로 구분해 입력해 주세요\n예) `A#KR1, B#KR1, C#KR1, D#KR1`",
    });
    return;
  }
  const players = await resolvePlayers(PLATFORM, names);
  const valid = players.filter((p) => !p.error);
  const failed = players.filter((p) => p.error);
  const part = bestPartition(valid);
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
  const sum = (ps: typeof valid) =>
    ps.reduce((s, p) => s + p.points, 0).toLocaleString();
  await followUp(token, {
    embeds: [
      {
        title: "내전 팀 밸런싱 결과",
        description: `**🔵 블루팀** (합계 ${sum(part.a)}pt)\n${line(part.a)}\n\n**🔴 레드팀** (합계 ${sum(part.b)}pt)\n${line(part.b)}\n\n전력차 **${part.diff.toLocaleString()}pt**${
          failed.length
            ? `\n\n⚠️ 조회 실패: ${failed.map((f) => f.input).join(", ")}`
            : ""
        }`,
        color: BLUE,
        url: `${SITE}/team`,
        footer: { text: "Rift Lens · 매칭 실력대 기준" },
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
        url: `${SITE}/recent`,
        color: BLUE,
        footer: { text: "Rift Lens" },
      },
    ],
  });
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

  // APPLICATION_COMMAND
  if (body.type === 2) {
    const name: string = body.data?.name;
    const opts: Option[] = body.data?.options ?? [];
    const get = (k: string) => opts.find((o) => o.name === k)?.value ?? "";
    const token: string = body.token;

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
