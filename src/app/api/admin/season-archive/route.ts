import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  cancelSeasonArchive,
  getSeasonArchive,
  scheduleSeasonArchive,
} from "@/lib/season-archive";

export const dynamic = "force-dynamic";

async function ok(req: NextRequest): Promise<boolean> {
  return isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ archive: await getSeasonArchive() });
}

export async function POST(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { action?: string; season?: string; closesAt?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (body.action === "cancel") {
    await cancelSeasonArchive();
    return NextResponse.json({ archive: await getSeasonArchive() });
  }
  const season = (body.season ?? "").trim();
  const closesAt = new Date(body.closesAt ?? "").getTime();
  if (!season || season.length > 30)
    return NextResponse.json({ error: "시즌 이름을 입력해 주세요 (예: 2026 S2)" }, { status: 400 });
  if (!Number.isFinite(closesAt) || closesAt < Date.now())
    return NextResponse.json({ error: "마감 시각은 미래여야 해요" }, { status: 400 });
  return NextResponse.json({ archive: await scheduleSeasonArchive(season, closesAt) });
}
