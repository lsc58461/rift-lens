import { NextResponse, type NextRequest } from "next/server";
import { resolvePlayers } from "@/lib/mmr/team";
import { PLATFORM_LABELS, type PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PLAYERS = 20;

// 내전 팀 밸런서용 — 각 플레이어의 실력 점수를 해석한다.
export async function POST(req: NextRequest) {
  let body: { region?: string; names?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const region = body.region ?? "kr";
  if (!(region in PLATFORM_LABELS)) {
    return NextResponse.json({ error: "invalid region" }, { status: 400 });
  }
  const names = (body.names ?? [])
    .map((n) => n.trim().normalize("NFKC"))
    .filter(Boolean)
    .slice(0, MAX_PLAYERS);
  if (names.length < 2) {
    return NextResponse.json({ error: "need at least 2" }, { status: 400 });
  }

  const players = await resolvePlayers(region as PlatformRegion, names);
  return NextResponse.json({ players });
}
