// 루트 레이아웃에 끼워 두는 보이지 않는 서버 컴포넌트 — 요청 경로를 한 번 분류해서
// 공격 성격이면 security_events 에, 평범한 봇 방문이면 crawler_hits 에 남긴다.
// after() 로 기록하므로 응답을 붙잡지 않고, 사람의 정상 방문엔 아무 일도 하지 않는다.
// 경로는 Caddy 가 붙여 주는 X-Request-Uri 헤더에서 읽는다 (Next 서버 컴포넌트엔 pathname 이 없음).
//
// 분류가 먼저인 이유: 스캐너는 UA 를 봇으로 사칭한다. UA 만 보고 crawler_hits 에 넣으면
// /.env, /api/exec 같은 요청 1000여 건이 "GPTBot 방문"으로 집계돼 크롤러 통계가 망가진다
// (2026-09-13 실제 발생). 경로는 사칭할 수 없으므로 경로를 먼저 본다.
import { headers } from "next/headers";
import { after } from "next/server";
import { isCrawlerUa, recordCrawlerHit } from "@/lib/crawler-log";
import { classifyPath, recordSecurityEvent } from "@/lib/security-log";

export async function CrawlerProbe() {
  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  const path = h.get("x-request-uri") ?? "";
  if (!path) return null;

  const threat = classifyPath(path);
  if (threat) {
    // 스캐너는 UA 를 사람으로도 봇으로도 위장하므로 UA 조건 없이 기록한다
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    after(() => recordSecurityEvent(ip, ua, path, threat).catch(() => {}));
  } else if (ua && isCrawlerUa(ua)) {
    after(() => recordCrawlerHit(ua, path).catch(() => {}));
  }
  return null;
}
