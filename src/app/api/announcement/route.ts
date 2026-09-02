import { NextResponse, after, type NextRequest } from "next/server";
import { SITE_URL } from "@/lib/site";
import { pumpBulkJobs } from "@/lib/job-pump";
import { getSetting } from "@/lib/store";

export const dynamic = "force-dynamic";
// 펌프가 잇는 라운드(최대 220초)가 응답 후 완주할 수 있도록
export const maxDuration = 300;

function publicOrigin(req: NextRequest): string {
  return req.nextUrl.hostname === "localhost"
    ? req.nextUrl.origin
    : SITE_URL;
}

export interface Announcement {
  enabled: boolean;
  text: string;
  href: string | null;
  tone: "info" | "event" | "warn";
  updatedAt: number; // 닫기(dismiss) 식별자로도 쓴다 — 내용이 바뀌면 다시 보임
}

export async function GET(req: NextRequest) {
  // 방문 트래픽으로 멈춘 대량 작업을 이어준다 — 브라우저발 요청이라
  // 함수 호출 사슬 깊이 제한에 걸리지 않는다 (자세한 이유는 job-pump.ts)
  const origin = publicOrigin(req);
  after(() => pumpBulkJobs(origin).catch(() => {}));

  const a = await getSetting<Announcement>("announcement").catch(() => null);
  const res = NextResponse.json(
    a?.enabled && a.text.trim() ? a : { enabled: false },
  );
  // CDN 60초 캐시 — 모든 페이지뷰가 DB를 두드리지 않게
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
