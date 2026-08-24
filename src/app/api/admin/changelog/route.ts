import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  deleteChangelog,
  listChangelog,
  upsertChangelog,
  type ChangelogItem,
} from "@/lib/changelog";

export const dynamic = "force-dynamic";

async function ok(req: NextRequest): Promise<boolean> {
  return isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ entries: await listChangelog() });
}

export async function POST(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: {
    id?: number;
    date?: string;
    title?: string;
    items?: ChangelogItem[];
    published?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const date = (body.date ?? "").trim();
  const title = (body.title ?? "").trim();
  if (!date || !title)
    return NextResponse.json({ error: "날짜와 제목은 필수예요" }, { status: 400 });
  const items = (body.items ?? [])
    .filter((i) => i && typeof i.text === "string" && i.text.trim())
    .map((i) => ({
      tag: (["신규", "개선", "수정"].includes(i.tag) ? i.tag : "개선") as ChangelogItem["tag"],
      text: i.text.trim(),
    }));
  const entry = await upsertChangelog({
    id: body.id,
    date,
    title,
    items,
    published: body.published !== false,
  });
  return NextResponse.json({ entry });
}

export async function DELETE(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await deleteChangelog(id);
  return NextResponse.json({ ok: true });
}
