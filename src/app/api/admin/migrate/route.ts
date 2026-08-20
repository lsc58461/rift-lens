import { NextResponse, after, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  beginMigration,
  getMigrationStatus,
  runMigrationBatch,
  stopMigration,
} from "@/lib/migrate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function guard(req: NextRequest): Promise<boolean> {
  return isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await guard(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getMigrationStatus());
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const action = req.nextUrl.searchParams.get("action") ?? "start";
  if (action === "stop") {
    await stopMigration();
    return NextResponse.json(await getMigrationStatus());
  }

  // 응답을 먼저 보내고 백그라운드에서 한 배치 진행 (저우선순위라 유저 요청에 양보)
  const state = await beginMigration();
  after(() => runMigrationBatch().catch(() => {}));
  return NextResponse.json({ state, started: true });
}
