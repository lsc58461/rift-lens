import { generateSitemaps } from "@/app/sitemap";
import { SITE_URL } from "@/lib/site";

// 사이트맵 인덱스(/sitemap-index.xml) — Next는 generateSitemaps로 /sitemap/N.xml 만 만들고 인덱스는
// 안 만들어 주고 /sitemap.xml 경로는 예약돼 있어 여기서 직접 낸다. robots.txt가 이 주소를 가리킨다.
export const dynamic = "force-dynamic";

const BASE = SITE_URL;

// lastmod 는 내지 않는다 — 매 요청 '지금'을 찍으면 늘 바뀌는 값이라 구글이 lastmod 를 불신한다
// (정적 페이지에 lastmod 를 안 내는 sitemap.ts 와 같은 이유).
export async function GET() {
  const ids = await generateSitemaps();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ids
      .map(({ id }) => `  <sitemap><loc>${BASE}/sitemap/${id}.xml</loc></sitemap>`)
      .join("\n") +
    `\n</sitemapindex>\n`;
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
