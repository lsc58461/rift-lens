import { NextResponse, type NextRequest } from "next/server";

// 한국 서버 전용 — 타 리전 소환사 URL은 스트리밍(loading.tsx) 전에
// 여기서 404를 확정한다. 페이지/메타데이터의 notFound()는 스트리밍
// 셸이 먼저 200으로 나가 상태코드를 바꾸지 못한다(Next 스트리밍 메타데이터).
export function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/summoner\/([^/]+)\//);
  if (m && m[1] !== "kr") {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/summoner/:region/:riotId*"],
};
