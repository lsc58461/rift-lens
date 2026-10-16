"use client";

// 스포트라이트 검색 — GNB 돋보기 버튼이나 ⌘K(Ctrl+K)·`/` 로 어디서든 열린다.
// 예전엔 소환사를 찾으려면 홈이나 전적 상세로 가야만 검색창이 있었다(2026-09-10).
// 빈 상태에선 '내' 최근 검색·즐겨찾기(이 브라우저에만 저장)를, 입력하면 초성·띄어쓰기 무시 검색을 보여준다.
// (예전엔 빈 상태에서 모든 방문자의 최근 검색을 보여줬다 — 2026-10-16 개인 기록으로 바꿈)
//
// 접근성: 열면 인풋에 포커스, Tab 은 모달 안에서만 순환(포커스 트랩), Esc 로 닫으면 트리거로 복귀.
// 후보 항목은 onClick 으로 실행한다 — onMouseDown 만 두면 키보드(Tab→Enter)로는 눌리지 않는다.
//
// 오버레이는 반드시 body 로 포털한다: 이 컴포넌트는 헤더 안에 있고 헤더에 backdrop-blur 가 걸려 있어
// 그대로 두면 헤더가 fixed 자식의 기준 박스가 되어 inset-0 이 헤더 높이(124px)까지만 덮었다
// (2026-09-10 실측). 화면 전체를 덮으려면 헤더 밖으로 빼야 한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { HistoryPanel, useHistoryList } from "@/components/history-panel";
import { Input } from "@/components/ui/input";
import { TIER_COLORS } from "@/lib/mmr/rank";
import { summonerPath } from "@/lib/summoner-url";
import { useSuggestions, type Suggestion } from "@/lib/use-suggestions";

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMac, setIsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { items, loading, fetchSuggest, setItems } = useSuggestions();
  const { tab, setTab, list: history } = useHistoryList();
  const empty = query.trim() === "";
  // 방향키로 고르는 대상 — 빈 칸이면 내 기록, 아니면 자동완성 후보
  const pickable = empty ? history : items;

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    setError(null);
    setHighlight(-1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setNavigating(false);
    // 키보드로 열었으면 포커스를 트리거로 돌려준다 (안 그러면 문서 맨 위부터 다시 Tab)
    triggerRef.current?.focus();
  }, [setItems]);

  // ⌘K / Ctrl+K, `/`(입력 중이 아닐 때), 그리고 열려 있을 때의 Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!open) show();
        return;
      }
      if (open && e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (!open && e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, close]);

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

  const go = (riotId: string) => {
    setNavigating(true);
    setOpen(false);
    setQuery("");
    setItems([]);
    router.push(summonerPath("kr", riotId));
  };

  const submit = () => {
    if (highlight >= 0 && pickable[highlight]) {
      const s = pickable[highlight];
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

  // Tab 이 모달 밖(뒤에 가려진 테마 토글 등)으로 새지 않게 가둔다
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const busy = navigating || loading;

  const trigger = (
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-label="소환사 검색"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:py-1.5"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden md:inline">검색</span>
        <kbd className="hidden rounded border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground lg:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
  );

  const overlay = open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-[12vh]"
          onClick={close}
          role="dialog"
          aria-modal
          aria-label="소환사 검색"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
          >
            <div className="flex items-center gap-1 border-b px-2 py-2 sm:px-3 sm:py-2.5">
              <button
                type="button"
                onClick={submit}
                aria-label="검색"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" aria-hidden />
                )}
              </button>
              <Input
                ref={inputRef}
                value={query}
                enterKeyHint="search"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setError(null);
                  setHighlight(-1);
                  // 빈 칸이면 서버에 묻지 않는다 — 내 기록을 보여준다
                  if (e.target.value.trim()) fetchSuggest(e.target.value);
                  else setItems([]);
                }}
                onKeyDown={(e) => {
                  const n = pickable.length;
                  if (e.key === "ArrowDown" && n > 0) {
                    e.preventDefault();
                    setHighlight((h) => (h + 1) % n);
                  } else if (e.key === "ArrowUp" && n > 0) {
                    e.preventDefault();
                    setHighlight((h) => (h - 1 + n) % n);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="게임명#태그 (예: Hide on bush#KR1)"
                autoComplete="off"
                className="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>

            {error && (
              <p role="alert" className="px-3.5 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            {empty ? (
              <HistoryPanel
                tab={tab}
                onTab={(t) => {
                  setTab(t);
                  setHighlight(-1);
                }}
                list={history}
                highlight={highlight}
                onHighlight={setHighlight}
                onSelect={(h) => go(`${h.name}#${h.tag}`)}
              />
            ) : items.length > 0 ? (
              <ul className="max-h-[50vh] overflow-y-auto p-1.5">
                {items.map((s: Suggestion, i) => (
                  <li key={`${s.name}#${s.tag}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()} // 인풋 블러 방지 (실행은 onClick 에서)
                      onClick={() => go(`${s.name}#${s.tag}`)}
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
            ) : (
              // 후보가 없을 때 — "불러오는 중"과 "정말 없음"을 구분해 준다
              !error && (
                <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
                  {loading
                    ? "찾는 중…"
                    : "기록에 없는 소환사예요. 게임명#태그를 정확히 입력하면 새로 분석해 드려요."}
                </p>
              )
            )}

            <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
              <span>초성·띄어쓰기 없이도 찾아요</span>
              <span className="hidden sm:inline">Enter 이동 · Esc 닫기</span>
            </div>
          </div>
        </div>
  ) : null;

  return (
    <>
      {trigger}
      {typeof document === "undefined" ? null : createPortal(overlay, document.body)}
    </>
  );
}
