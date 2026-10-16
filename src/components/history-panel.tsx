"use client";

// 검색창을 빈 채로 열었을 때 나오는 '최근 검색 | 즐겨찾기' 목록 — 스포트라이트(SearchPalette)와
// 인풋형(SummonerAutocomplete)이 함께 쓴다. 기록은 이 브라우저에만 있다(lib/personal-history).
// 목록 상태(어느 탭, 무엇이 보이는지)는 부모가 들고 있어야 방향키로 고를 수 있어서 훅으로 뺐다.
import { useState } from "react";
import { Star, X } from "lucide-react";
import { useHistory, type HistoryEntry } from "@/lib/personal-history";

export type HistoryTab = "recent" | "fav";

/** 지금 보이는 탭과 그 목록 — 부모가 방향키 선택에 쓴다 */
export function useHistoryList() {
  const { recent, favs } = useHistory();
  const [tab, setTab] = useState<HistoryTab>("recent");
  return { tab, setTab, list: tab === "recent" ? recent : favs };
}

// 인풋 포커스를 뺏지 않게 — 실행은 onClick 에서 한다(키보드 Tab→Enter 로도 눌리게)
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function HistoryPanel({
  tab,
  onTab,
  list,
  highlight,
  onHighlight,
  onSelect,
}: {
  tab: HistoryTab;
  onTab: (t: HistoryTab) => void;
  list: HistoryEntry[];
  highlight: number;
  onHighlight: (i: number) => void;
  onSelect: (e: HistoryEntry) => void;
}) {
  const { isFav, toggleFav, removeRecent } = useHistory();

  return (
    <div>
      <div role="tablist" className="grid grid-cols-2 border-b text-xs">
        {(
          [
            ["recent", "최근 검색"],
            ["fav", "즐겨찾기"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onMouseDown={keepFocus}
            onClick={() => onTab(key)}
            className={`py-2 font-medium transition-colors ${
              tab === key
                ? "bg-accent/60 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
          {tab === "recent"
            ? "최근에 본 소환사가 없어요. 게임명#태그를 입력해 보세요."
            : "☆ 을 누르면 즐겨찾기에 담겨요."}
        </p>
      ) : (
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {list.map((e, i) => {
            const fav = isFav(e.name, e.tag);
            return (
              <li
                key={`${e.name}#${e.tag}`}
                onMouseEnter={() => onHighlight(i)}
                className={`flex items-center gap-1 rounded-md pr-1 ${
                  i === highlight ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <button
                  type="button"
                  onMouseDown={keepFocus}
                  onClick={() => onSelect(e)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm"
                >
                  <span className="shrink-0 rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                    KR
                  </span>
                  <span className="min-w-0 truncate">
                    {e.name}
                    <span className="text-muted-foreground"> #{e.tag}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onMouseDown={keepFocus}
                  onClick={() => toggleFav(e.name, e.tag, e.tier)}
                  aria-label={fav ? "즐겨찾기 해제" : "즐겨찾기"}
                  aria-pressed={fav}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-amber-500"
                >
                  <Star className={`size-4 ${fav ? "fill-amber-500 text-amber-500" : ""}`} />
                </button>
                {tab === "recent" && (
                  <button
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={() => removeRecent(e.name, e.tag)}
                    aria-label="최근 검색에서 지우기"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
