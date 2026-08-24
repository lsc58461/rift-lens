import { NextResponse, type NextRequest } from "next/server";

// 점검 모드 미들웨어 — 어드민이 /admin에서 토글하면 모든 페이지가
// /maintenance로 rewrite된다. 플래그는 /api/maintenance에서 조회하고
// 엣지 인스턴스별로 10초 캐시해 요청마다 DB를 두드리지 않는다.
// /admin·/api는 매처에서 제외 — 점검 중에도 끌 수 있어야 한다.

let cached: { on: boolean; at: number } | null = null;
const CACHE_MS = 10_000;

// 자체 호스팅에선 req.nextUrl.origin이 바인딩 주소(https://0.0.0.0:3000)로 잡혀
// self-fetch가 실패한다 — 내부 API 호출은 루프백으로 고정한다.
// (matcher가 /api를 제외하므로 미들웨어 재귀는 없다)
const INTERNAL_ORIGIN = "http://127.0.0.1:3000";

async function isMaintenanceOn(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.on;
  try {
    const res = await fetch(`${INTERNAL_ORIGIN}/api/maintenance`, {
      signal: AbortSignal.timeout(3_000),
    });
    const data: { active: boolean } = await res.json();
    cached = { on: data.active === true, at: Date.now() };
  } catch {
    // 조회 실패 시 서비스를 막지 않는다
    cached = { on: false, at: Date.now() };
  }
  return cached.on;
}

// 닉변 리다이렉트 — 옛 이름으로 들어온 소환사 페이지를 새 이름으로 보낸다.
// (저장된 분석이 남아 있으면 페이지가 404를 안 내므로 여기서 먼저 처리)
const renameCache = new Map<string, { to: string | null; at: number }>();
const RENAME_CACHE_MS = 60_000;

async function lookupRenamed(
  region: string,
  riotId: string,
): Promise<string | null> {
  const key = `${region}:${riotId}`;
  const hit = renameCache.get(key);
  if (hit && Date.now() - hit.at < RENAME_CACHE_MS) return hit.to;
  try {
    const res = await fetch(
      `${INTERNAL_ORIGIN}/api/renamed?region=${region}&riotId=${encodeURIComponent(riotId)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    const data: { renamed: string | null } = await res.json();
    if (renameCache.size > 500) renameCache.clear();
    renameCache.set(key, { to: data.renamed, at: Date.now() });
    return data.renamed;
  } catch (e) {
    console.error("[mw] renamed 조회 실패:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/maintenance") return NextResponse.next();
  if (await isMaintenanceOn()) {
    return NextResponse.rewrite(new URL("/maintenance", req.url));
  }

  const m = req.nextUrl.pathname.match(/^\/summoner\/([^/]+)\/([^/]+)$/);
  if (m) {
    const region = m[1];
    // 한국 서버 전용 — 타 리전은 여기서 404를 확정한다. 페이지의 notFound()는
    // 스트리밍 셸(loading.tsx)이 먼저 200을 보내 상태코드를 바꾸지 못한다.
    if (region !== "kr") {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (!req.nextUrl.searchParams.has("renamed")) {
      const riotId = decodeURIComponent(m[2]).normalize("NFKC");
      const to = await lookupRenamed(region, riotId);
      if (to && to !== riotId) {
        const url = new URL(
          `/summoner/${region}/${encodeURIComponent(to)}`,
          req.url,
        );
        url.searchParams.set("renamed", riotId);
        return NextResponse.redirect(url, 308);
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  // 페이지 요청만 대상 — api/admin/정적 파일 제외
  matcher: [
    "/((?!api|admin|_next|favicon|icon|opengraph-image|robots|sitemap|ranked-emblems|.*\\..*).*)",
  ],
};
