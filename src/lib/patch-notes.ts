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

/** 공식 패치노트 URL (ko-kr). 예: DDragon 16.16 → league-of-legends-patch-26-16-notes */
export function patchNotesUrl(version: string): string {
  const { maj, min } = marketing(version);
  return `https://www.leagueoflegends.com/ko-kr/news/game-updates/league-of-legends-patch-${maj}-${min}-notes/`;
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

/** 공식 패치노트 페이지에서 히어로 이미지·게시일·요약을 뽑는다(메타태그/JSON-LD). */
async function enrich(url: string): Promise<Partial<PatchNote>> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "Mozilla/5.0 RiftLens" },
    });
    if (!res.ok) return {};
    const html = await res.text();
    const og = (prop: string) =>
      html.match(
        new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]+)"`, "i"),
      )?.[1];
    let image = og("og:image");
    // og:image에 붙은 리사이즈 쿼리를 다듬어 과한 크기 방지 (원본 파라미터 유지)
    if (image) image = image.replace(/&amp;/g, "&");
    const summary = og("og:description");
    const date = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
    return { image, summary, date };
  } catch {
    return {};
  }
}

/** 최근 패치 목록(중복 major.minor 제거, 최신순). */
export async function getRecentPatchNotes(limit = 16): Promise<PatchNote[]> {
  return cached(`patchnotes:list:v1:${limit}`, 60 * 60 * 6, async () => {
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
    const base: PatchNote[] = [];
    for (const v of versions) {
      const label = patchLabel(v);
      if (seen.has(label)) continue;
      seen.add(label);
      base.push({ patch: label, url: patchNotesUrl(v) });
      if (base.length >= limit) break;
    }
    // 각 패치 페이지에서 히어로 이미지·게시일을 병렬로 채운다(6h 캐시 내 1회).
    return Promise.all(
      base.map(async (n) => ({ ...n, ...(await enrich(n.url)) })),
    );
  });
}
