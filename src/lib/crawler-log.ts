// 크롤러(봇) 방문 기록 — 어떤 봇이 얼마나 들어오는지 관리자 대시보드에 보여준다.
// visit_log 는 사람 방문만 남기므로 봇은 여기(crawler_hits)에 봇·시간대 단위로 집계한다.
// 기록은 루트 레이아웃의 <CrawlerProbe/> 가 after() 로 남긴다 (응답 지연 없음).
import "server-only";
import { getSql } from "@/lib/db";

// 'bot' 이 안 들어가는 UA 도 있다: 네이버 Yeti, 다음 Daum, 화웨이 PetalBot 은 있지만 ChatGPT-User,
// anthropic-ai/Claude-Web, meta-externalagent, Bytespider 등. 네이버는 9/2 첫 방문이 이 누락 때문에
// 기록도 안 되고 봇 경로도 안 탔다 — KNOWN 목록과 반드시 같이 맞춘다.
const BOT_RE =
  /bot|crawl|spider|scrap|yeti\/|daum|chatgpt-user|anthropic-ai|claude-web|meta-externalagent|facebookexternalhit|kakaotalk|slack|twitter|discord|telegram|whatsapp|preview|embed/i;

/** 소환사 페이지의 봇 판정과 같은 기준 (분석 실행·방문 기록 분기용) */
export function isCrawlerUa(ua: string): boolean {
  return BOT_RE.test(ua);
}

const KNOWN: [RegExp, string][] = [
  [/Googlebot|Google-InspectionTool|AdsBot-Google|Storebot-Google|GoogleOther/i, "Googlebot"],
  [/bingbot|BingPreview/i, "Bingbot"],
  [/Yeti\//i, "네이버 (Yeti)"],
  [/Daum/i, "다음 (Daum)"],
  [/kakaotalk-scrap|kakao/i, "카카오톡 미리보기"],
  [/AhrefsBot/i, "AhrefsBot"],
  [/SemrushBot/i, "SemrushBot"],
  [/PetalBot/i, "PetalBot (화웨이)"],
  [/Bytespider/i, "Bytespider (틱톡)"],
  [/GPTBot/i, "GPTBot (OpenAI)"],
  [/ChatGPT-User|OAI-SearchBot/i, "ChatGPT"],
  [/ClaudeBot|anthropic-ai|Claude-Web/i, "ClaudeBot"],
  [/PerplexityBot/i, "PerplexityBot"],
  [/Applebot/i, "Applebot"],
  [/DuckDuckBot/i, "DuckDuckBot"],
  [/YandexBot/i, "YandexBot"],
  [/facebookexternalhit|meta-externalagent/i, "페이스북/메타"],
  [/Discordbot/i, "디스코드 미리보기"],
  [/Twitterbot/i, "트위터/X"],
  [/Slackbot/i, "슬랙"],
  [/TelegramBot/i, "텔레그램"],
  [/MJ12bot/i, "MJ12bot (Majestic)"],
  [/DotBot/i, "DotBot (Moz)"],
  [/DataForSeoBot/i, "DataForSeoBot"],
  [/BLEXBot/i, "BLEXBot"],
  [/SeekportBot/i, "SeekportBot"],
  [/rift-lens-seed/i, "내부 시드 도구"],
];

/** UA → 표시용 봇 이름. 모르는 봇은 "xxxbot" 토큰을 그대로, 그것도 없으면 "기타" */
export function crawlerName(ua: string): string {
  for (const [re, name] of KNOWN) if (re.test(ua)) return name;
  const m = ua.match(/([A-Za-z0-9_.-]{2,40}(?:bot|crawler|spider|scraper))/i);
  return m ? m[1] : "기타";
}

export async function recordCrawlerHit(ua: string, path: string): Promise<void> {
  const sql = await getSql();
  const bot = crawlerName(ua);
  const p = path.split("?")[0].slice(0, 160);
  await sql`
    INSERT INTO crawler_hits (bot, hour, hits, last_at, last_path)
    VALUES (${bot}, date_trunc('hour', now()), 1, now(), ${p})
    ON CONFLICT (bot, hour) DO UPDATE
    SET hits = crawler_hits.hits + 1, last_at = now(), last_path = EXCLUDED.last_path`;
  // 30일 넘은 집계는 가끔 정리 (1% 확률 — 별도 크론 없이 유지)
  if (Math.random() < 0.01) {
    await sql`DELETE FROM crawler_hits WHERE hour < now() - interval '30 days'`.catch(() => {});
  }
}

export interface CrawlerStat {
  bot: string;
  hits24h: number;
  hits7d: number;
  lastAt: number; // epoch ms
  lastPath: string | null;
}

let memo: { at: number; value: CrawlerStat[] } | null = null;

/** 최근 7일 봇별 집계 (30초 메모 — 대시보드가 자주 폴링해도 가볍게) */
export async function crawlerStats(): Promise<CrawlerStat[]> {
  if (memo && Date.now() - memo.at < 30_000) return memo.value;
  const sql = await getSql();
  const rows = (await sql`
    SELECT bot,
           coalesce(sum(hits) FILTER (WHERE hour >= now() - interval '24 hours'), 0)::int AS h24,
           sum(hits)::int AS h7,
           (extract(epoch from max(last_at)) * 1000)::bigint AS last_at,
           (array_agg(last_path ORDER BY last_at DESC))[1] AS last_path
    FROM crawler_hits
    WHERE hour >= now() - interval '7 days'
    GROUP BY bot
    ORDER BY h24 DESC, h7 DESC
    LIMIT 25`) as unknown as {
    bot: string; h24: number; h7: number; last_at: string | number; last_path: string | null;
  }[];
  const value = rows.map((r) => ({
    bot: r.bot,
    hits24h: r.h24,
    hits7d: r.h7,
    lastAt: Number(r.last_at),
    lastPath: r.last_path,
  }));
  memo = { at: Date.now(), value };
  return value;
}
