// 보안 위험 감지 — 스캐너가 때린 "우리 사이트에 없는, 공격 성격의 경로"를 기록한다.
// 루트 레이아웃의 <CrawlerProbe/> 가 모든 요청에서 경로를 분류하고, 수상하면 여기에,
// 평범한 봇 방문이면 crawler_hits 에 남긴다 (둘은 배타적이다).
//
// IP 차단은 하지 않는다 — 스캐너는 IP를 바꿔 가며 다시 오므로 차단 목록 관리 비용만 들고
// 실익이 없다. 대신 "무엇을 노렸는지"를 보이게 해서, 실제로 뚫릴 만한 표면이 생겼을 때
// (예: 새로 연 API가 SSRF 로 쓰일 수 있는 경우) 바로 알아채는 쪽을 택했다.
//
// 이 분류는 크롤러 통계 오염 방지도 겸한다: 2026-09-13 한 스캐너가 UA 163종을 돌려가며
// GPTBot·ChatGPT·트위터 등 17개 봇을 사칭해 1165건을 때렸고, 그게 전부 "크롤러 방문"으로
// 집계돼 통계를 망쳤다. 사칭 UA 는 막을 수 없지만 경로는 못 숨긴다 — 96%가 없는 경로였다.
import "server-only";
import { getSql } from "@/lib/db";
import { safeDecode } from "@/lib/summoner-url";

/** 실제 존재하는 페이지의 첫 경로 구간 (동적 구간은 아래에서 통과) */
const PAGE_ROOTS = new Set([
  "admin", "champions", "discord", "duo", "faq", "feedback", "maintenance",
  "patch-notes", "privacy", "ranking", "recap", "recent", "share", "sitemap",
  "summoner", "team", "terms", "tools", "updates",
]);

/** 실제 존재하는 API 경로 — /api 아래는 첫 구간만으로 판단하면 /api/exec 같은 걸 놓친다 */
const API_PATHS = new Set([
  "/api/admin/announcement", "/api/admin/changelog", "/api/admin/clear-stats-cache",
  "/api/admin/crawl", "/api/admin/dead-accounts", "/api/admin/feedback", "/api/admin/login",
  "/api/admin/logout", "/api/admin/migrate", "/api/admin/rate", "/api/admin/refresh-all",
  "/api/admin/rune-backfill", "/api/admin/season-archive", "/api/admin/security",
  "/api/admin/status", "/api/admin/summoners",
  "/api/announcement", "/api/cron/refresh", "/api/deep", "/api/discord/interactions",
  "/api/duo", "/api/feedback", "/api/history", "/api/live-game", "/api/maintenance",
  "/api/match-timeline", "/api/quick-refresh", "/api/reanalyze", "/api/recap",
  "/api/renamed", "/api/share-image", "/api/summoners/suggest", "/api/team/resolve",
  "/api/tooltip", "/api/updates", "/api/version",
]);

/** 루트에 그대로 있는 파일들 */
// (Next 가 자동 생성하는 /opengraph-image·/icon.png 도 여기 포함 — 확장자 없는 건 놓치기 쉽다)
const ROOT_FILES = new Set([
  "/", "/robots.txt", "/sitemap.xml", "/sitemap-index.xml", "/favicon.ico",
  "/riot.txt", "/manifest.json", "/manifest.webmanifest",
  "/opengraph-image", "/icon.png", "/icon.svg", "/apple-icon.png",
]);

export type SecurityCategory =
  | "명령어 주입"
  | "비밀파일 탐색"
  | "경로 탐색"
  | "워드프레스·PHP"
  | "SSRF·프록시"
  | "기타 스캔";

// 앞쪽이 더 구체적이고 위험한 순서 — 한 경로가 여러 개에 걸리면 먼저 맞는 쪽으로 분류한다.
// (예: /@fs/..%252f..%252froot/.env 는 경로 탐색이자 비밀파일이지만 '비밀파일 탐색'이 더 알아보기 쉽다)
// 'system'·'run' 같은 흔한 단어는 반드시 경로의 마지막 구간일 때만 본다 —
// \bsystem\b 으로 느슨하게 잡으면 /media/system/js/core.js(줌라 스캔) 까지 '명령어 주입'이 된다.
const RULES: [RegExp, SecurityCategory][] = [
  [/\$\{|jndi:|%24%7b|[/.]exec\b|[/.]eval\b|\/cgi-bin\/|\/(system|run|shell|console)(?:$|[?#])|[?&]cmd=|[;|`]\s*(cat|curl|wget|bash|sh|id)\b/i, "명령어 주입"],
  [/\.env|\.git|\.aws|\.ssh|id_rsa|credentials|rootkey|\.npmrc|\.htpasswd|\.ds_store|\/@fs\/|serviceaccount|\/secrets?\/|\.(sql|bak|pem|key|p12)\b|backup|dump/i, "비밀파일 탐색"],
  [/\.\.[/\\]|%2e%2e|%252f|%c0%af/i, "경로 탐색"],
  [/\bwp-|xmlrpc|phpmyadmin|\.php\b|\/vendor\/|\/laravel\b|joomla|\/media\/system\//i, "워드프레스·PHP"],
  [/\/(proxy|fetch|url|redirect|request|webhook|out|load|ping)(?:$|[?#/])|[?&](url|uri|path|target|dest|next|redirect)=https?:/i, "SSRF·프록시"],
];

// 없는 경로여도 공격이 아닌 것들 — 옛 링크·아이콘 탐색·브라우저 자동 요청
const BENIGN = /\.(png|jpe?g|gif|svg|ico|webp|css|js|map|woff2?|txt|xml|json)$|^\/\.well-known\/|^\/_next\//i;

/** 우리 사이트에 실제로 있는 경로인가 */
function isKnownRoute(path: string): boolean {
  if (ROOT_FILES.has(path)) return true;
  if (path.startsWith("/api/")) return API_PATHS.has(path.replace(/\/$/, ""));
  const root = path.split("/")[1] ?? "";
  return PAGE_ROOTS.has(root);
}

/**
 * 경로를 보고 공격 시도인지 분류한다. 정상 경로거나 평범한 404면 null.
 * UA 는 보지 않는다 — 스캐너는 UA 를 마음대로 바꾸지만 노리는 경로는 못 바꾼다.
 */
export function classifyPath(rawPath: string): SecurityCategory | null {
  const path = rawPath.split("?")[0] || "/";
  if (isKnownRoute(path)) return null;
  const full = rawPath.slice(0, 500);
  for (const [re, cat] of RULES) if (re.test(full)) return cat;
  if (BENIGN.test(path)) return null;
  return "기타 스캔";
}

/** 한 IP가 한 시간에 남길 수 있는 최대 기록 — 대량 스캔이 DB를 채우지 못하게 */
const HOURLY_CAP = 600;

export async function recordSecurityEvent(
  ip: string,
  ua: string,
  path: string,
  category: SecurityCategory,
): Promise<void> {
  const sql = await getSql();
  // 상한 검사를 INSERT 안에 넣어 왕복 한 번으로 끝낸다
  await sql`
    INSERT INTO security_events (ip, ua, path, category)
    SELECT ${ip}, ${ua.slice(0, 300)}, ${safeDecode(path).slice(0, 300)}, ${category}
    WHERE (SELECT count(*) FROM security_events
           WHERE ip = ${ip} AND at > now() - interval '1 hour') < ${HOURLY_CAP}`;
  if (Math.random() < 0.01) {
    await sql`DELETE FROM security_events WHERE at < now() - interval '30 days'`.catch(() => {});
  }
}

export interface SecurityOverview {
  total24h: number;
  total7d: number;
  categories: { category: string; hits24h: number; hits7d: number }[];
  ips: { ip: string; hits: number; uas: number; paths: number; lastAt: number; category: string }[];
  paths: { path: string; hits: number; category: string }[];
  lastAt: number | null;
}

let memo: { at: number; value: SecurityOverview } | null = null;

/** 관리자 카드용 집계 (30초 메모 — 대시보드 폴링에 대비) */
export async function securityOverview(): Promise<SecurityOverview> {
  if (memo && Date.now() - memo.at < 30_000) return memo.value;
  const sql = await getSql();
  const [cats, ips, paths, tot] = await Promise.all([
    sql`SELECT category,
               count(*) FILTER (WHERE at > now() - interval '24 hours')::int AS h24,
               count(*)::int AS h7
        FROM security_events WHERE at > now() - interval '7 days'
        GROUP BY category ORDER BY h7 DESC` as unknown as Promise<
      { category: string; h24: number; h7: number }[]
    >,
    sql`SELECT ip, count(*)::int AS hits, count(DISTINCT ua)::int AS uas,
               count(DISTINCT path)::int AS paths,
               (extract(epoch from max(at)) * 1000)::bigint AS last_at,
               mode() WITHIN GROUP (ORDER BY category) AS category
        FROM security_events WHERE at > now() - interval '7 days'
        GROUP BY ip ORDER BY hits DESC LIMIT 8` as unknown as Promise<
      { ip: string; hits: number; uas: number; paths: number; last_at: string; category: string }[]
    >,
    sql`SELECT path, count(*)::int AS hits,
               mode() WITHIN GROUP (ORDER BY category) AS category
        FROM security_events WHERE at > now() - interval '7 days'
        GROUP BY path ORDER BY hits DESC LIMIT 8` as unknown as Promise<
      { path: string; hits: number; category: string }[]
    >,
    sql`SELECT count(*) FILTER (WHERE at > now() - interval '24 hours')::int AS h24,
               count(*) FILTER (WHERE at > now() - interval '7 days')::int AS h7,
               (extract(epoch from max(at)) * 1000)::bigint AS last_at
        FROM security_events` as unknown as Promise<
      { h24: number; h7: number; last_at: string | null }[]
    >,
  ]);
  const value: SecurityOverview = {
    total24h: tot[0]?.h24 ?? 0,
    total7d: tot[0]?.h7 ?? 0,
    lastAt: tot[0]?.last_at ? Number(tot[0].last_at) : null,
    categories: cats.map((c) => ({ category: c.category, hits24h: c.h24, hits7d: c.h7 })),
    ips: ips.map((r) => ({
      ip: r.ip,
      hits: r.hits,
      uas: r.uas,
      paths: r.paths,
      lastAt: Number(r.last_at),
      category: r.category,
    })),
    paths,
  };
  memo = { at: Date.now(), value };
  return value;
}
