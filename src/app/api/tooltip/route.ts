// 아이템·룬·스펠 툴팁 — 아이콘에 마우스를 올릴 때 클라이언트(asset-tip.tsx)가 한 번 받아 캐시한다.
// 페이지에 전체 설명(아이템만 150KB)을 싣지 않기 위한 온디맨드 경로. 브라우저·CDN 1일 캐시.
import { NextResponse, type NextRequest } from "next/server";
import { getDDragonVersion } from "@/lib/ddragon";
import { getTooltip, type TipKind } from "@/lib/tooltips";

export const dynamic = "force-dynamic";

const KINDS = new Set<string>(["item", "rune", "spell"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") ?? "";
  const id = Number(sp.get("id"));
  if (!KINDS.has(kind) || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  const version = await getDDragonVersion();
  const tip = await getTooltip(kind as TipKind, id, version);
  if (!tip) return NextResponse.json({ error: "not found" }, { status: 404 });
  const res = NextResponse.json(tip);
  res.headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
  return res;
}
