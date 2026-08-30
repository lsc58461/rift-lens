// 루트 레이아웃에 끼워 두는 보이지 않는 서버 컴포넌트 — 봇 UA 면 방문을 crawler_hits 에 남긴다.
// after() 로 기록하므로 응답을 붙잡지 않고, 사람 방문엔 아무 일도 하지 않는다.
// 경로는 Caddy 가 붙여 주는 X-Request-Uri 헤더에서 읽는다 (Next 서버 컴포넌트엔 pathname 이 없음).
import { headers } from "next/headers";
import { after } from "next/server";
import { isCrawlerUa, recordCrawlerHit } from "@/lib/crawler-log";

export async function CrawlerProbe() {
  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  if (ua && isCrawlerUa(ua)) {
    const path = h.get("x-request-uri") ?? "";
    after(() => recordCrawlerHit(ua, path).catch(() => {}));
  }
  return null;
}
