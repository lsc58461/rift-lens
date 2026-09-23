// 롤 패치노트 — DDragon 버전 목록에서 major.minor를 뽑아 공식 패치노트 링크를 만든다.
// 라이엇에 패치노트 API가 없어 공식 페이지 URL을 규칙으로 구성한다(ko-kr).
import { cached } from "@/lib/cache";

const FALLBACK = "16.16.1";

// 라이엇 마케팅 패치번호는 DDragon major + 10 (DDragon 16.x = 패치 26.x, 2026 시즌).
function marketing(version: string): { maj: number; min: number } {
  const [maj, min] = version.split(".").map((n) => parseInt(n, 10));
  return { maj: (maj || 0) + 10, min: min || 0 };
}

/** 표시용 패치 라벨 (마케팅 번호). "16.16.1" → "26.16" */
export function patchLabel(version: string): string {
  const { maj, min } = marketing(version);
  return `${maj}.${min}`;
}

const BASE = "https://www.leagueoflegends.com/ko-kr/news/game-updates";

/** 마케팅 라벨("26.16")로 공식 패치노트 URL 두 벌을 만든다.
 *  legacy 는 구형식 — 라이엇이 26.4부터 앞에 'league-of-legends-'를 붙였고,
 *  그 이전(예: 26.1~26.3)은 'patch-26-1-notes' 형태다. 404면 그쪽으로 폴백한다. */
export function urlsForLabel(label: string): { url: string; legacy: string } {
  const [maj, min] = label.split(".").map((n) => parseInt(n, 10));
  return {
    url: `${BASE}/league-of-legends-patch-${maj}-${min}-notes/`,
    legacy: `${BASE}/patch-${maj}-${min}-notes/`,
  };
}

/** 공식 패치노트 URL (ko-kr). 예: DDragon 16.16 → league-of-legends-patch-26-16-notes */
export function patchNotesUrl(version: string): string {
  return urlsForLabel(patchLabel(version)).url;
}

/** DDragon 최신 바로 "다음" 후보 라벨들.
 *  DDragon 버전 목록은 공식 패치노트보다 늦게 올라온다 — 2026-09-23 실측에서 26.19 노트가
 *  이미 공개됐는데도 DDragon 최신은 여전히 16.18 이었다. 그래서 다음 번호를 미리 후보에 넣고,
 *  실제로 페이지가 있는지로 판단한다. 연도가 바뀌는 지점(26.24 → 27.1)도 같이 본다.
 *  없는 패치는 호출부에서 404 로 걸러지므로 후보를 넉넉히 줘도 안전하다. */
export function nextLabels(label: string): string[] {
  const [maj, min] = label.split(".").map((n) => parseInt(n, 10));
  if (!maj || !min) return [];
  return [`${maj}.${min + 1}`, `${maj + 1}.1`];
}

/** 패치노트 허브(개별 링크가 안 열릴 때 대비) */
export const PATCH_NOTES_HUB =
  "https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/";

export interface PatchNote {
  patch: string; // "26.16" (마케팅 번호)
  url: string;
  image?: string; // 히어로/썸네일 (og:image)
  date?: string; // 게시일 ISO (datePublished)
  summary?: string; // og:description
}

/** og:description 은 HTML 이라 엔티티가 그대로 들어온다(&#x27; 등) — 화면·디스코드에 날것으로
 *  보이지 않게 푼다. 숫자 참조와 흔한 이름 참조만 처리하면 충분하다. */
function decodeEntities(s: string): string {
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

/** 공식 패치노트 페이지에서 히어로 이미지·게시일·요약을 뽑는다(메타태그/JSON-LD). */
async function enrich(
  url: string,
  fallbackUrl?: string,
): Promise<Partial<PatchNote>> {
  try {
    const get = (u: string) =>
      fetch(u, {
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        headers: { "user-agent": "Mozilla/5.0 RiftLens" },
      });
    let usedUrl = url;
    let res = await get(url);
    // 신형식이 없으면 구형식으로 폴백 (라이엇이 26.4부터 URL 스킴을 바꿈)
    if (!res.ok && fallbackUrl) {
      const alt = await get(fallbackUrl);
      if (alt.ok) {
        res = alt;
        usedUrl = fallbackUrl;
      }
    }
    if (!res.ok) return {};
    const html = await res.text();
    const og = (prop: string) =>
      html.match(
        new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]+)"`, "i"),
      )?.[1];
    let image = og("og:image");
    if (image) {
      image = image.replace(/&amp;/g, "&");
      // 라이엇 og:image는 "...jpg?accountingTag=LoL?w=1200&..."처럼 물음표가 둘이다.
      // 두 번째 '?'부터를 &로 바꿔 정상 쿼리스트링으로 정리한다.
      const first = image.indexOf("?");
      if (first >= 0) {
        image =
          image.slice(0, first + 1) +
          image.slice(first + 1).replace(/\?/g, "&");
      }
    }
    const summary = og("og:description");
    const date = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
    return { image, summary: summary ? decodeEntities(summary) : undefined, date, url: usedUrl };
  } catch {
    return {};
  }
}

/** 최근 패치 목록(중복 major.minor 제거, 최신순). */
export async function getRecentPatchNotes(limit = 16): Promise<PatchNote[]> {
  return cached(`patchnotes:list:v2:${limit}`, 60 * 60 * 6, async () => {
    let versions: string[] = [];
    try {
      const res = await fetch(
        "https://ddragon.leagueoflegends.com/api/versions.json",
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (res.ok) versions = await res.json();
    } catch {
      versions = [FALLBACK];
    }
    const seen = new Set<string>();
    const base: { patch: string; url: string; legacy: string }[] = [];
    // DDragon 이 아직 못 따라온 최신 패치를 먼저 후보로 넣는다(위 nextLabels 주석 참고).
    // 실재하지 않으면 아래 enrich 가 404 로 떨어뜨리므로 목록엔 안 남는다.
    for (const label of nextLabels(patchLabel(versions[0] ?? FALLBACK))) {
      seen.add(label);
      base.push({ patch: label, ...urlsForLabel(label) });
    }
    for (const v of versions) {
      const label = patchLabel(v);
      if (seen.has(label)) continue;
      seen.add(label);
      base.push({ patch: label, ...urlsForLabel(label) });
      if (base.length >= limit) break;
    }
    // 각 패치 페이지에서 히어로 이미지·게시일을 병렬로 채우고, 404면 구형식 URL로
    // 폴백한다(6h 캐시 내 1회). 어느 쪽도 없으면 해당 패치는 목록에서 제외한다.
    const enriched = await Promise.all(
      base.map(async ({ patch, url, legacy }) => {
        const meta = await enrich(url, legacy);
        return meta.url ? { patch, ...meta, url: meta.url } : null;
      }),
    );
    return enriched.filter((n): n is PatchNote => n !== null);
  });
}
