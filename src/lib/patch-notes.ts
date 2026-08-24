// 롤 패치노트 — DDragon 버전 목록에서 major.minor를 뽑아 공식 패치노트 링크를 만든다.
// 라이엇에 패치노트 API가 없어 공식 페이지 URL을 규칙으로 구성한다(ko-kr).
import { cached } from "@/lib/cache";

const FALLBACK = "16.16.1";

/** "16.16.1" → "16.16" */
export function patchLabel(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/** 공식 패치노트 URL (ko-kr). 예: 16.16 → patch-16-16-notes */
export function patchNotesUrl(version: string): string {
  const [maj, min] = version.split(".");
  return `https://www.leagueoflegends.com/ko-kr/news/game-updates/patch-${maj}-${min}-notes/`;
}

/** 패치노트 허브(개별 링크가 안 열릴 때 대비) */
export const PATCH_NOTES_HUB =
  "https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/";

export interface PatchNote {
  patch: string; // "16.16"
  url: string;
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
    const out: PatchNote[] = [];
    for (const v of versions) {
      const label = patchLabel(v);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ patch: label, url: patchNotesUrl(v) });
      if (out.length >= limit) break;
    }
    return out;
  });
}
