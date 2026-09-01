import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
      // AhrefsBot — SEO 백링크 인덱스용(검색 노출과 무관)이고 크롤 빈도가 높아 차단 (2026-08-30)
      { userAgent: "AhrefsBot", disallow: "/" },
    ],
    sitemap: "https://rift-lens.xyz/sitemap.xml",
  };
}
