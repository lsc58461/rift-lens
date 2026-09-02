import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 구 사이트맵 주소(서치콘솔에 등록돼 있던 /sitemap.xml)에서 인덱스를 그대로 낸다 — Next가
  // sitemap.ts + generateSitemaps 조합에선 /sitemap.xml을 만들지 않는다.
  // 리다이렉트(308)로 두면 서치콘솔이 "가져올 수 없음"으로 표시해서(2026-08-30) rewrite 로 200 응답.
  async rewrites() {
    return [{ source: "/sitemap.xml", destination: "/sitemap-index.xml" }];
  },
  // 자체 서버(Docker) 빌드에서만 standalone 출력 — Vercel 빌드에는 영향 없음
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  // 서버리스 번들에 fs.readFile 대상 파일 포함 (Vercel 배포용)
  outputFileTracingIncludes: {
    "/api/share-image": ["./src/assets/fonts/**", "./public/ranked-emblems/**"],
    "/opengraph-image": ["./src/assets/fonts/**", "./public/ranked-emblems/**"],
  },
  // CSS 를 <link> 대신 HTML 에 인라인 — 첫 렌더를 막는 요청(라이트하우스 "렌더링 차단 요청",
  // 18KB/170ms) 제거. 페이지 이동은 클라이언트 라우팅이라 CSS 캐시 손실은 첫 진입 한 번뿐.
  experimental: { inlineCss: true },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ddragon.leagueoflegends.com",
        pathname: "/cdn/**",
      },
      {
        // 공식 패치노트 히어로 이미지 (Riot CMS)
        protocol: "https",
        hostname: "cmsassets.rgpub.io",
      },
    ],
  },
};

export default nextConfig;
