import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  countParticipantsPending,
  getParticipantsBackfillState,
} from "@/lib/match-participants";
import { riotKeyFp } from "@/lib/riot/client";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const fp = riotKeyFp();
  const sql = await getSql();
  const [state, pending, counts] = await Promise.all([
    getParticipantsBackfillState(),
    countParticipantsPending(fp),
    sql`
      SELECT (SELECT count(*)::int FROM matches WHERE fp = ${fp}) AS matches,
             (SELECT count(*)::int FROM match_participants WHERE fp = ${fp}) AS participants`,
  ]);
  const c = counts[0] as { matches: number; participants: number } | undefined;
  return NextResponse.json({
    state,
    pending,
    matches: c?.matches ?? 0,
    participants: c?.participants ?? 0,
  });
}
