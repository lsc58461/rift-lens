import type { MetadataRoute } from "next";
import { listQuickAnalysisPages } from "@/lib/store";

const BASE = "https://rift-lens.xyz";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 분석된 소환사 전체(analyses 테이블)를 색인 대상에 포함 —
  // "닉네임 MMR" 롱테일 검색 유입용
  let summonerPages: MetadataRoute.Sitemap = [];
  try {
    const pages = await listQuickAnalysisPages();
    summonerPages = pages.map((p) => ({
      url: `${BASE}/summoner/${p.platform}/${encodeURIComponent(`${p.game_name}#${p.tag_line}`)}`,
      lastModified: p.analyzed_at ? new Date(p.analyzed_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
  } catch {
    // DB 조회 실패 시 정적 페이지만이라도 반환
  }

  return [
    {
      url: BASE,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE}/recent`,
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${BASE}/faq`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE}/discord`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE}/feedback`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/updates`,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    { url: `${BASE}/team`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/duo`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/recap`, changeFrequency: "monthly", priority: 0.6 },
    ...summonerPages,
  ];
}
