import { NextResponse } from "next/server";
import { getPublishedChangelog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

// 공개 — published 업데이트 내역
export async function GET() {
  return NextResponse.json(
    { entries: await getPublishedChangelog() },
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
}
