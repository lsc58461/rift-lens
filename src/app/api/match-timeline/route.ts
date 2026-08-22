import { NextResponse, type NextRequest } from "next/server";
import {
  getAccountByRiotId,
  getMatchTimeline,
} from "@/lib/riot/client";
import { RiotApiError, type PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 펼친 경기의 아이템 빌드·스킬 순서 — 본인 참가자 것만 돌려준다 */
export async function POST(req: NextRequest) {
  try {
    const body: { region?: string; matchId?: string; riotId?: string } =
      await req.json();
    const region = (body.region ?? "kr") as PlatformRegion;
    const matchId = body.matchId ?? "";
    const riotId = body.riotId ?? "";
    const hash = riotId.indexOf("#");
    if (!/^[A-Z0-9]+_\d+$/i.test(matchId) || hash <= 0) {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }

    const account = await getAccountByRiotId(
      region,
      riotId.slice(0, hash),
      riotId.slice(hash + 1),
    );
    const timeline = await getMatchTimeline(region, matchId);
    const me = timeline[account.puuid];
    if (!me) {
      return NextResponse.json({ error: "not in match" }, { status: 404 });
    }
    return NextResponse.json(me);
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
