import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ],
  },
};

export default nextConfig;
