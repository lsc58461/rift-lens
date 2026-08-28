import type { MetadataRoute } from "next";
import { countQuickAnalysisPages, listQuickAnalysisPages } from "@/lib/store";

// 사이트맵 구조 — 인덱스(/sitemap.xml, 별도 라우트) 아래에
//   /sitemap/0.xml : 정적 페이지  (인덱스는 /sitemap-index.xml — /sitemap.xml은 Next 예약 경로)
//   /sitemap/1.xml … : 소환사 페이지 10,000개씩 (최근 분석순)
// 소환사 페이지가 수만 개라 한 파일(5만 URL 상한)에 몰아넣지 않고 쪼갠다.
// 요청 시 생성(force-dynamic) — 빌드 환경엔 DB가 없어 프리렌더하면 빈 결과가 캐시된다.
// 크롤러 방문 빈도는 낮고 쿼리도 가벼워(count 1회 / 1만 행) 매 요청 계산으로 충분.

const BASE = "https://rift-lens.xyz";
export const SUMMONERS_PER_SITEMAP = 10_000;
export const dynamic = "force-dynamic";

export async function generateSitemaps(): Promise<{ id: number }[]> {
  const total = await countQuickAnalysisPages().catch(() => 0);
  const chunks = Math.max(0, Math.ceil(total / SUMMONERS_PER_SITEMAP));
  return [{ id: 0 }, ...Array.from({ length: chunks }, (_, i) => ({ id: i + 1 }))];
}

function staticPages(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: number,
  ) => ({ url: `${BASE}${path}`, lastModified: now, changeFrequency, priority });
  return [
    page("", "daily", 1),
    page("/champions", "daily", 0.9),
    page("/ranking", "hourly", 0.8),
    page("/ranking?tier=GRANDMASTER", "hourly", 0.7),
    page("/recent", "hourly", 0.6),
    page("/patch-notes", "weekly", 0.6),
    page("/tools", "monthly", 0.5),
    page("/team", "monthly", 0.5),
    page("/duo", "monthly", 0.5),
    page("/recap", "monthly", 0.5),
    page("/discord", "monthly", 0.4),
    page("/updates", "weekly", 0.4),
    page("/faq", "monthly", 0.4),
    page("/feedback", "yearly", 0.2),
    page("/terms", "yearly", 0.2),
    page("/privacy", "yearly", 0.2),
  ];
}

export default async function sitemap({
  id,
}: {
  id: number | string | Promise<number | string | undefined>;
}): Promise<MetadataRoute.Sitemap> {
  // Next 16은 id를 Promise("1")로 넘긴다(빌드 번들 확인) — 반드시 await
  const n = parseInt(String(await id), 10);
  if (!Number.isFinite(n) || n <= 0) return staticPages();
  try {
    const pages = await listQuickAnalysisPages(SUMMONERS_PER_SITEMAP, (n - 1) * SUMMONERS_PER_SITEMAP);
    return pages.map((p) => ({
      url: `${BASE}/summoner/${p.platform}/${encodeURIComponent(`${p.game_name}#${p.tag_line}`)}`,
      lastModified: p.analyzed_at ? new Date(p.analyzed_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}
