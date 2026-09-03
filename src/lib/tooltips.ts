// 아이템·룬·스펠 툴팁 데이터 (서버) — DDragon 설명을 우리 블록 구조로 변환해 /api/tooltip 이 내려준다.
//
// DDragon 설명은 <mainText><stats>주문력 <attention>105</attention><br>…</stats><br><active>시간 정지</active><br>…
// 처럼 자체 태그가 섞인 HTML 이다. 브라우저에 그대로 꽂지 않고(라이엇 HTML 을 dangerouslySetInnerHTML 로
// 넣지 않는다) 여기서 태그를 해석해 "스탯 줄 / 패시브·액티브(제목+본문) / 본문 / 규칙(흐리게)" 블록으로 만든다.
// 클라이언트(asset-tip.tsx)는 블록만 그린다. 전체 맵은 Redis 1일 + 프로세스 메모.
import "server-only";
import { cached } from "@/lib/cache";

export interface TipBlock {
  kind: "stats" | "passive" | "active" | "text" | "rules";
  title?: string;
  text: string;
}
export interface Tip {
  name: string;
  /** 이름 아래 한 줄 (스펠 쿨타임 등) */
  sub?: string;
  blocks: TipBlock[];
  price?: { total: number; base: number };
}

const DD = "https://ddragon.leagueoflegends.com/cdn";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** DDragon 설명 HTML → 블록. 알려진 구조 태그만 해석하고 나머지 태그(attention·keyword·font·b 등)는 버린다 */
export function parseDescription(html: string): TipBlock[] {
  const blocks: TipBlock[] = [];
  let cur: TipBlock | null = null;
  let mode: "text" | "stats" | "title" | "rules" = "text";
  const flush = () => {
    if (cur && (cur.text.trim() || cur.title)) {
      cur.text = cur.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      blocks.push(cur);
    }
    cur = null;
  };
  const ensure = (kind: TipBlock["kind"]): TipBlock => {
    if (!cur) cur = { kind, text: "" };
    return cur;
  };
  const re = /<(\/?)([a-zA-Z-]+)[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      const t = decodeEntities(m[3]);
      if (mode === "title" && cur) cur.title = (cur.title ?? "") + t;
      else ensure(mode === "stats" ? "stats" : mode === "rules" ? "rules" : "text").text += t;
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      if (cur) cur.text += "\n";
      continue;
    }
    if (tag === "li") {
      if (!close) ensure("text").text += "\n• ";
      continue;
    }
    if (tag === "stats") {
      if (!close) {
        flush();
        cur = { kind: "stats", text: "" };
        mode = "stats";
      } else {
        flush();
        mode = "text";
      }
      continue;
    }
    if (tag === "passive" || tag === "active") {
      if (!close) {
        flush();
        cur = { kind: tag, title: "", text: "" };
        mode = "title";
      } else {
        mode = "text";
      }
      continue;
    }
    if (tag === "rules") {
      if (!close) {
        flush();
        cur = { kind: "rules", text: "" };
        mode = "rules";
      } else {
        flush();
        mode = "text";
      }
      continue;
    }
    // 그 외 태그는 무시 (mainText, attention, keyword, healing, scaleAP, font, lol-uikit-tooltipped-keyword, b, i …)
  }
  flush();
  return blocks;
}

// ── 원본 맵 (버전별, 1일) ────────────────────────────────

interface ItemRaw {
  name: string;
  description: string;
  gold: { total: number; base: number };
}
interface RuneRaw {
  name: string;
  longDesc?: string;
}
interface SpellRaw {
  name: string;
  description: string;
  cooldownBurn: string;
}

const memo = new Map<string, unknown>();
async function memoized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  const v = await cached(key, 60 * 60 * 24, fn);
  memo.set(key, v);
  return v;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

async function itemMap(version: string): Promise<Record<string, ItemRaw>> {
  return memoized(`ddragon:tip-items:ko:${version}`, async () => {
    const d = await fetchJson<{ data: Record<string, { name: string; description: string; gold: { total: number; base: number } }> }>(
      `${DD}/${version}/data/ko_KR/item.json`,
    );
    const out: Record<string, ItemRaw> = {};
    for (const [id, it] of Object.entries(d.data)) {
      out[id] = { name: it.name, description: it.description, gold: { total: it.gold.total, base: it.gold.base } };
    }
    return out;
  }).catch(() => ({}));
}

async function runeMap(version: string): Promise<Record<string, RuneRaw>> {
  return memoized(`ddragon:tip-runes:ko:${version}`, async () => {
    const styles = await fetchJson<
      { id: number; name: string; slots: { runes: { id: number; name: string; longDesc: string }[] }[] }[]
    >(`${DD}/${version}/data/ko_KR/runesReforged.json`);
    const out: Record<string, RuneRaw> = {};
    for (const st of styles) {
      out[String(st.id)] = { name: st.name };
      for (const sl of st.slots) for (const r of sl.runes) out[String(r.id)] = { name: r.name, longDesc: r.longDesc };
    }
    return out;
  }).catch(() => ({}));
}

async function spellMap(version: string): Promise<Record<string, SpellRaw>> {
  return memoized(`ddragon:tip-spells:ko:${version}`, async () => {
    const d = await fetchJson<{ data: Record<string, { key: string; name: string; description: string; cooldownBurn: string }> }>(
      `${DD}/${version}/data/ko_KR/summoner.json`,
    );
    const out: Record<string, SpellRaw> = {};
    for (const s of Object.values(d.data)) out[s.key] = { name: s.name, description: s.description, cooldownBurn: s.cooldownBurn };
    return out;
  }).catch(() => ({}));
}

// ── 공개 API ─────────────────────────────────────────────

export type TipKind = "item" | "rune" | "spell";

export async function getTooltip(kind: TipKind, id: number, version: string): Promise<Tip | null> {
  const key = String(id);
  if (kind === "item") {
    const it = (await itemMap(version))[key];
    if (!it) return null;
    return { name: it.name, blocks: parseDescription(it.description), price: it.gold };
  }
  if (kind === "rune") {
    const r = (await runeMap(version))[key];
    if (!r) return null;
    return { name: r.name, blocks: r.longDesc ? parseDescription(r.longDesc) : [] };
  }
  const s = (await spellMap(version))[key];
  if (!s) return null;
  return {
    name: s.name,
    sub: s.cooldownBurn ? `재사용 대기시간 ${s.cooldownBurn}초` : undefined,
    blocks: [{ kind: "text", text: s.description }],
  };
}
