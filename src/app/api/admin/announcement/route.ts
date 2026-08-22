import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { getSetting, setSetting } from "@/lib/store";
import type { Announcement } from "@/app/api/announcement/route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    announcement: await getSetting<Announcement>("announcement"),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body: Partial<Announcement> = await req.json();
  const tone =
    body.tone === "event" || body.tone === "warn" ? body.tone : "info";
  const next: Announcement = {
    enabled: Boolean(body.enabled),
    text: String(body.text ?? "").slice(0, 200),
    href: body.href ? String(body.href).slice(0, 300) : null,
    tone,
    updatedAt: Date.now(),
  };
  await setSetting("announcement", next);
  return NextResponse.json({ announcement: next });
}
