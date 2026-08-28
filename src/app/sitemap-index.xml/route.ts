import { generateSitemaps } from "@/app/sitemap";

// 사이트맵 인덱스(/sitemap-index.xml) — Next는 generateSitemaps로 /sitemap/N.xml 만 만들고 인덱스는
// 안 만들어 주고 /sitemap.xml 경로는 예약돼 있어 여기서 직접 낸다. robots.txt가 이 주소를 가리킨다.
export const revalidate = 3600;

const BASE = "https://rift-lens.xyz";

export async function GET() {
  const ids = await generateSitemaps();
  const now = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ids
      .map(({ id }) => `  <sitemap><loc>${BASE}/sitemap/${id}.xml</loc><lastmod>${now}</lastmod></sitemap>`)
      .join("\n") +
    `\n</sitemapindex>\n`;
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
