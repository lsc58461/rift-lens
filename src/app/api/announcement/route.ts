import { NextResponse } from "next/server";
import { getSetting } from "@/lib/store";

export const dynamic = "force-dynamic";

export interface Announcement {
  enabled: boolean;
  text: string;
  href: string | null;
  tone: "info" | "event" | "warn";
  updatedAt: number; // 닫기(dismiss) 식별자로도 쓴다 — 내용이 바뀌면 다시 보임
}

export async function GET() {
  const a = await getSetting<Announcement>("announcement").catch(() => null);
  const res = NextResponse.json(
    a?.enabled && a.text.trim() ? a : { enabled: false },
  );
  // CDN 60초 캐시 — 모든 페이지뷰가 DB를 두드리지 않게
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
