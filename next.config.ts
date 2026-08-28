import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 구 사이트맵 주소(서치콘솔에 등록돼 있던 /sitemap.xml)를 인덱스로 — Next가
  // sitemap.ts + generateSitemaps 조합에선 /sitemap.xml을 만들지 않는다
  async redirects() {
    return [{ source: "/sitemap.xml", destination: "/sitemap-index.xml", permanent: true }];
  },
  // 자체 서버(Docker) 빌드에서만 standalone 출력 — Vercel 빌드에는 영향 없음
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  // 서버리스 번들에 fs.readFile 대상 파일 포함 (Vercel 배포용)
  outputFileTracingIncludes: {
    "/api/share-image": ["./src/assets/fonts/**", "./public/ranked-emblems/**"],
    "/opengraph-image": ["./src/assets/fonts/**", "./public/ranked-emblems/**"],
  },
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
