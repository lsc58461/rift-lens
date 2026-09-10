"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { useSuggestions, type Suggestion } from "@/lib/use-suggestions";

// 기록된 소환사 기반 자동완성 인풋 — 포커스/입력 시 DB 기록에서 후보를 보여준다.
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
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

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

  function select(s: Suggestion) {
    onChange(`${s.name}#${s.tag}`);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          fetchSuggest(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          fetchSuggest(value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + items.length) % items.length);
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault();
            select(items[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && items.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md">
          {items.map((s, i) => (
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
                    style={
                      s.tier ? { color: TIER_COLORS[s.tier] } : undefined
                    }
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
