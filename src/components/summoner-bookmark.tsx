"use client";

// 소환사 페이지 이름 옆 ☆ — 즐겨찾기 토글. 이 페이지를 보는 순간 '최근 검색'에도 남긴다
// (검색창·링크·디스코드·버튼 어느 경로로 와도 기록되게 페이지에서 한다). 기록은 이 브라우저에만.
import { useEffect } from "react";
import { Star } from "lucide-react";
import { addRecent, useHistory } from "@/lib/personal-history";

export function SummonerBookmark({
  name,
  tag,
  tier,
}: {
  name: string;
  tag: string;
  tier: string | null;
}) {
  const { isFav, toggleFav } = useHistory();
  const fav = isFav(name, tag);

  useEffect(() => {
    addRecent(name, tag, tier);
  }, [name, tag, tier]);

  return (
    <button
      type="button"
      onClick={() => toggleFav(name, tag, tier)}
      aria-label={fav ? "즐겨찾기 해제" : "즐겨찾기"}
      aria-pressed={fav}
      title={fav ? "즐겨찾기 해제" : "즐겨찾기"}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-amber-500"
    >
      <Star className={`size-5 ${fav ? "fill-amber-500 text-amber-500" : ""}`} />
    </button>
  );
}
