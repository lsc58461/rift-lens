import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 배포·설정 확인용 (값은 노출하지 않고 존재 여부만)
export function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    storage: "tables",
    db: (() => {
      try {
        const u = new URL(process.env.DATABASE_URL ?? "");
        return {
          port: u.port,
          // Supabase는 6543=트랜잭션 풀러(서버리스 권장), 5432=세션 모드(동시 15 제한)
          pooler: u.hostname.includes("pooler"),
          mode: u.port === "6543" ? "transaction" : "session",
        };
      } catch {
        return null;
      }
    })(),
    riot: {
      apiKey: Boolean(process.env.RIOT_API_KEY),
      rateLimits: process.env.RIOT_RATE_LIMITS ?? null,
    },
  });
}
