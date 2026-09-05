// 없어진 계정 정리 — 전체 갱신 스윕이 라이엇 404 를 만난 계정(recent_searches.gone_at)을
// puuid 로 다시 확인해, 정말 소멸했으면 지우고 닉변이면 새 이름으로 승계한다.
//
// 왜 재확인이 필요한가: 404 는 닉변·일시 장애로도 난다. 확인 없이 지우면 살아 있는 계정을
// 날린다. 그래서 404(소멸)와 그 외 오류를 구분하는 probeAccountByPuuid 만 판정에 쓴다.
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin";
import { probeAccountByPuuid } from "@/lib/riot/client";
import { withLowPriority } from "@/lib/riot/limiter";
import { canon } from "@/lib/identity";
import {
  clearAccountGone,
  countGoneAccounts,
  listGoneAccounts,
  migrateIdentity,
  purgeAccounts,
  recordNameChange,
  type GoneAccount,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 한 번에 확인할 수 있는 최대 인원 — 라이엇 호출 1건/명 */
const MAX_BATCH = 200;

async function authed(req: NextRequest): Promise<boolean> {
  return isValidAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [count, items] = await Promise.all([countGoneAccounts(), listGoneAccounts(50)]);
  return NextResponse.json({
    count,
    items: items.map((a) => ({
      riotId: `${a.gameName}#${a.tagLine}`,
      platform: a.platform,
      hasPuuid: Boolean(a.puuid),
      goneAt: a.goneAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(
    MAX_BATCH,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || MAX_BATCH),
  );
  const candidates = await listGoneAccounts(limit);

  const dead: GoneAccount[] = [];
  const renamed: string[] = [];
  let alive = 0;
  let unknown = 0;

  for (const a of candidates) {
    if (!a.puuid) {
      // puuid 가 없으면 확인할 방법이 없다 — 지우지 않고 남긴다
      unknown++;
      continue;
    }
    const res = await withLowPriority(() => probeAccountByPuuid(a.platform, a.puuid!));
    if (res.status === "gone") {
      dead.push(a);
      continue;
    }
    if (res.status === "error") {
      unknown++; // 레이트리밋·장애 — 다음 확인으로 미룬다
      continue;
    }
    const cur = res.account;
    if (canon(cur.gameName) !== canon(a.gameName) || canon(cur.tagLine) !== canon(a.tagLine)) {
      // 닉변 — 새 이름으로 승계하고 표시 해제
      await recordNameChange(a.platform, a.gameName, a.tagLine, cur.gameName, cur.tagLine).catch(
        () => {},
      );
      await migrateIdentity(a.platform, cur.puuid, cur.gameName, cur.tagLine).catch(() => {});
      renamed.push(`${a.gameName}#${a.tagLine} → ${cur.gameName}#${cur.tagLine}`);
      continue;
    }
    // 살아 있고 이름도 그대로 — 일시적 오류였다
    await clearAccountGone(a.platform, a.gameName, a.tagLine).catch(() => {});
    alive++;
  }

  const purged = await purgeAccounts(
    dead.map((a) => ({ platform: a.platform, gameName: a.gameName, tagLine: a.tagLine })),
  );

  return NextResponse.json({
    checked: candidates.length,
    purged: dead.length,
    purgedAnalyses: purged.analyses,
    renamed: renamed.length,
    renamedList: renamed.slice(0, 20),
    alive,
    unknown,
    remaining: await countGoneAccounts(),
  });
}
