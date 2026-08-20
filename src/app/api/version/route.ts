import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 배포·설정 확인용 (값은 노출하지 않고 존재 여부만)
export function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    storage: "tables",
    riot: {
      apiKey: Boolean(process.env.RIOT_API_KEY),
      rateLimits: process.env.RIOT_RATE_LIMITS ?? null,
    },
  });
}
