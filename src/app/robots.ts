import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /api/ 는 막되 공유 미리보기 이미지(/api/share-image)는 연다 — 소환사 페이지 og:image 가 이 경로라,
    // 막아두면 robots.txt 를 지키는 미리보기 봇(X/트위터 카드 등)이 이미지를 못 가져가 링크 미리보기에
    // 이미지가 빠진다(2026-09-15). 더 구체적인 Allow 가 Disallow 보다 우선한다.
    rules: { userAgent: "*", allow: ["/", "/api/share-image"], disallow: ["/admin", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
