"use client";

import { useEffect, useRef, useState } from "react";
import { HistoryPanel, useHistoryList } from "@/components/history-panel";
import { Input } from "@/components/ui/input";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { useSuggestions, type Suggestion } from "@/lib/use-suggestions";

// 소환사 입력 인풋 — 빈 칸일 땐 '내' 최근 검색·즐겨찾기(이 브라우저에만 저장),
// 입력하면 DB 기록에서 후보를 보여준다. 팀 밸런서·듀오처럼 여러 칸을 채울 때도 내 기록에서 고르면 된다.
// 방향키·엔터로 선택 가능 (엔터는 후보가 하이라이트된 경우에만 가로챈다)
export function SummonerAutocomplete({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { items, fetchSuggest } = useSuggestions();
  const { tab, setTab, list: history } = useHistoryList();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const empty = value.trim() === "";
  const pickable: { name: string; tag: string }[] = empty ? history : items;

  // 후보가 새로 오면 하이라이트를 지운다(옛 인덱스가 다른 사람을 가리키지 않게)
  useEffect(() => {
    setHighlight(-1);
  }, [items]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  function select(s: { name: string; tag: string }) {
    onChange(`${s.name}#${s.tag}`);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // 빈 칸이면 서버에 묻지 않는다 — 내 기록을 보여준다
          if (e.target.value.trim()) fetchSuggest(e.target.value);
          setHighlight(-1);
          setOpen(true);
        }}
        onFocus={() => {
          if (value.trim()) fetchSuggest(value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          const n = pickable.length;
          if (!open || n === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % n);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + n) % n);
          } else if (e.key === "Enter" && highlight >= 0 && pickable[highlight]) {
            e.preventDefault();
            select(pickable[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && empty && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <HistoryPanel
            tab={tab}
            onTab={(t) => {
              setTab(t);
              setHighlight(-1);
            }}
            list={history}
            highlight={highlight}
            onHighlight={setHighlight}
            onSelect={select}
          />
        </div>
      )}
      {open && !empty && items.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md">
          {items.map((s: Suggestion, i) => (
            <li key={`${s.name}#${s.tag}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // 인풋 블러 방지 (실행은 onClick)
                onClick={() => select(s)} // 키보드(Tab→Enter)로도 눌리게 — onMouseDown 만으론 안 된다
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                  i === highlight ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  {s.name}
                  <span className="text-muted-foreground">#{s.tag}</span>
                </span>
                {s.label && (
                  <span
                    className="shrink-0 text-xs"
                    style={s.tier ? { color: TIER_COLORS[s.tier] } : undefined}
                  >
                    {s.label}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
