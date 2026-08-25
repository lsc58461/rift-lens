import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  deleteFeedback,
  FEEDBACK_STATUSES,
  listFeedback,
  updateFeedback,
  type FeedbackStatus,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

async function ok(req: NextRequest): Promise<boolean> {
  return isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") as FeedbackStatus | null;
  const entries = await listFeedback(
    status && FEEDBACK_STATUSES.includes(status) ? status : undefined,
  );
  return NextResponse.json({ entries });
}

export async function PATCH(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { id?: number; status?: FeedbackStatus; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id))
    return NextResponse.json({ error: "id가 필요해요" }, { status: 400 });
  if (body.status && !FEEDBACK_STATUSES.includes(body.status))
    return NextResponse.json({ error: "잘못된 상태" }, { status: 400 });
  const entry = await updateFeedback(id, {
    status: body.status,
    note: body.note === undefined ? undefined : (body.note ?? "").slice(0, 2000) || null,
  });
  if (!entry) return NextResponse.json({ error: "없는 항목" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(req: NextRequest) {
  if (!(await ok(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id))
    return NextResponse.json({ error: "id가 필요해요" }, { status: 400 });
  await deleteFeedback(id);
  return NextResponse.json({ ok: true });
}
