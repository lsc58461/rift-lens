// Data Dragon(라이엇 정적 에셋 CDN) 서버 헬퍼. 순수 URL 함수는 ddragon-assets에서 re-export.

import "server-only";
import { cached } from "@/lib/cache";
import { NAME_QUIRKS } from "./ddragon-assets";

export {
  championIconUrl,
  championNameKo,
  itemIconUrl,
  profileIconUrl,
  spellIconUrl,
  tierEmblemUrl,
} from "./ddragon-assets";

const FALLBACK_VERSION = "15.1.1";

export async function getDDragonVersion(): Promise<string> {
  try {
    return await cached("ddragon:version", 60 * 60 * 24, async () => {
      const res = await fetch(
        "https://ddragon.leagueoflegends.com/api/versions.json",
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) throw new Error(`versions.json ${res.status}`);
      const versions: string[] = await res.json();
      return versions[0];
    });
  } catch {
    return FALLBACK_VERSION;
  }
}

/** 챔피언 영문 키 → 한글 이름 매핑 (예: MonkeyKing → 오공) */
export async function getChampionNamesKo(
  version: string,
): Promise<Record<string, string>> {
  try {
    return await cached(
      `ddragon:champnames:ko:${version}`,
      60 * 60 * 24 * 7,
      async () => {
        const res = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`,
          { cache: "no-store", signal: AbortSignal.timeout(8_000) },
        );
        if (!res.ok) throw new Error(`champion.json ${res.status}`);
        const data: { data: Record<string, { id: string; name: string }> } =
          await res.json();
        const map: Record<string, string> = {};
        for (const c of Object.values(data.data)) map[c.id] = c.name;
        return map;
      },
    );
  } catch {
    return {};
  }
}

/** 룬 id → 한글 이름·아이콘 (핵심룬과 트리 모두 포함) */
export interface RuneInfo {
  name: string;
  icon: string; // https://ddragon.leagueoflegends.com/cdn/img/ 뒤에 붙는 경로
}

export async function getRuneMapKo(
  version: string,
): Promise<Record<number, RuneInfo>> {
  try {
    return await cached(`ddragon:runes:ko:${version}`, 60 * 60 * 24, async () => {
      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/runesReforged.json`,
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) throw new Error(`runesReforged ${res.status}`);
      const styles: {
        id: number;
        name: string;
        icon: string;
        slots: { runes: { id: number; name: string; icon: string }[] }[];
      }[] = await res.json();
      const map: Record<number, RuneInfo> = {};
      for (const st of styles) {
        map[st.id] = { name: st.name, icon: st.icon };
        for (const slot of st.slots) {
          for (const r of slot.runes) map[r.id] = { name: r.name, icon: r.icon };
        }
      }
      return map;
    });
  } catch {
    return {};
  }
}
