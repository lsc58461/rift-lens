"use client";

// 홈 검색창 아래 '최근 본' 칩 — 이 브라우저에 남은 내 기록에서.
// (예전엔 모든 방문자의 '방금 조회'를 보여줬다 — 2026-10-16 개인 기록으로 바꿈)
// 서버에선 비어 있다가 브라우저에서 채워진다(기록이 로컬스토리지에만 있으므로).
import Link from "next/link";
import { useHistory } from "@/lib/personal-history";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { summonerPath } from "@/lib/summoner-url";

export function MyRecentChips() {
  const { recent } = useHistory();
  if (recent.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">최근 본</span>
      {recent.slice(0, 6).map((r) => (
        <Link
          key={`${r.name}#${r.tag}`}
          href={summonerPath("kr", `${r.name}#${r.tag}`)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-card/50 px-2.5 py-1 text-xs backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-white/8"
        >
          <span
            className="size-1.5 rounded-full"
            style={{
              background: r.tier ? TIER_COLORS[r.tier] : "var(--color-muted-foreground)",
            }}
          />
          <span className="max-w-28 truncate">{r.name}</span>
        </Link>
      ))}
    </div>
  );
}
