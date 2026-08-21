import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import {
  getSummonerPage,
  type AnalysisState,
} from "@/lib/admin-summoners";

export const dynamic = "force-dynamic";

const STATES: (AnalysisState | "all")[] = [
  "all",
  "deep",
  "deep-stale",
  "quick",
  "quick-stale",
  "none",
];

export async function GET(req: NextRequest) {
  if (!(await isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const rawFilter = sp.get("filter") ?? "all";
  const filter = (
    STATES.includes(rawFilter as AnalysisState | "all") ? rawFilter : "all"
  ) as AnalysisState | "all";

  return NextResponse.json(
    await getSummonerPage({
      page: Number(sp.get("page") ?? 1),
      size: Number(sp.get("size") ?? 50),
      q: sp.get("q") ?? "",
      filter,
    }),
  );
}
