import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
      // SEO 스크레이퍼 — 소환사 페이지를 분당 수 회 긁어 라이엇 한도만 축낸다 (검색 노출과 무관)
      {
        userAgent: ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "PetalBot", "Bytespider", "DataForSeoBot", "BLEXBot", "SeekportBot"],
        disallow: "/",
      },
    ],
    sitemap: "https://rift-lens.xyz/sitemap-index.xml",
  };
}
