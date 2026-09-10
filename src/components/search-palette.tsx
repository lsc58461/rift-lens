"use client";

// 스포트라이트 검색 — GNB 돋보기 버튼이나 ⌘K(Ctrl+K)·`/` 로 어디서든 열린다.
// 예전엔 소환사를 찾으려면 홈이나 전적 상세로 가야만 검색창이 있었다(2026-09-10).
// 빈 상태에선 최근 검색된 소환사를 보여주고, 입력하면 초성·띄어쓰기 무시 검색이 걸린다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { summonerPath } from "@/lib/summoner-url";
import { useSuggestions, type Suggestion } from "@/lib/use-suggestions";

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMac, setIsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, fetchSuggest, setItems } = useSuggestions();

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    setError(null);
    setHighlight(-1);
    fetchSuggest("");
  }, [fetchSuggest]);

  // ⌘K / Ctrl+K, 그리고 `/` (입력 중이 아닐 때만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => (v ? v : (show(), true)));
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  // 열려 있는 동안 배경 스크롤 잠금 + 인풋 포커스
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setBusy(false);
  };

  const go = (riotId: string) => {
    setBusy(true);
    close();
    router.push(summonerPath("kr", riotId));
  };

  const submit = () => {
    if (highlight >= 0 && items[highlight]) {
      const s = items[highlight];
      go(`${s.name}#${s.tag}`);
      return;
    }
    const trimmed = query.trim().normalize("NFKC");
    const hash = trimmed.lastIndexOf("#");
    if (hash <= 0 || hash === trimmed.length - 1) {
      setError("게임명#태그 형식으로 입력해 주세요 (예: Hide on bush#KR1)");
      return;
    }
    go(trimmed);
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="소환사 검색"
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden md:inline">검색</span>
        <kbd className="hidden rounded border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground lg:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-[12vh]"
          onClick={close}
          role="dialog"
          aria-modal
          aria-label="소환사 검색"
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              {busy ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setError(null);
                  setHighlight(-1);
                  fetchSuggest(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  } else if (e.key === "ArrowDown" && items.length > 0) {
                    e.preventDefault();
                    setHighlight((h) => (h + 1) % items.length);
                  } else if (e.key === "ArrowUp" && items.length > 0) {
                    e.preventDefault();
                    setHighlight((h) => (h - 1 + items.length) % items.length);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="게임명#태그 (예: Hide on bush#KR1)"
                autoComplete="off"
                className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>

            {error && <p className="px-3.5 py-2 text-xs text-red-500">{error}</p>}

            {items.length > 0 && (
              <ul className="max-h-[50vh] overflow-y-auto p-1.5">
                {query.trim() === "" && (
                  <li className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    최근 검색
                  </li>
                )}
                {items.map((s: Suggestion, i) => (
                  <li key={`${s.name}#${s.tag}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        go(`${s.name}#${s.tag}`);
                      }}
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

            <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
              <span>초성·띄어쓰기 없이도 찾아요 (예: ㅎㅇㅂ, hideonbush)</span>
              <span className="hidden sm:inline">Enter 이동 · Esc 닫기</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
