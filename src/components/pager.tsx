import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** 목록 페이지 공통 페이저 — ?page=N 쿼리로 동작하고 다른 쿼리는 보존한다.
 *  서버 컴포넌트에서 쓰는 순수 링크라 JS 없이도 동작. */
export function Pager({
  page,
  totalPages,
  basePath,
  query = {},
}: {
  page: number;
  totalPages: number;
  basePath: string;
  /** 보존할 다른 쿼리 (예: { tier: "GRANDMASTER" }) */
  query?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  // 현재 페이지 주변 ±2 + 양 끝. 사이가 벌어지면 "…"
  const pages: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs tabular-nums transition-colors";
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="페이지">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`${btn} hover:bg-accent`} aria-label="이전 페이지">
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span className={`${btn} opacity-40`}>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">
            …
          </span>
        ) : p === page ? (
          <span key={p} className={`${btn} border-primary bg-primary text-primary-foreground`} aria-current="page">
            {p}
          </span>
        ) : (
          <Link key={p} href={href(p)} className={`${btn} hover:bg-accent`}>
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={href(page + 1)} className={`${btn} hover:bg-accent`} aria-label="다음 페이지">
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={`${btn} opacity-40`}>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}

/** ?page= 파싱 — 범위 밖이면 1 */
export function parsePage(raw: string | undefined, totalPages: number): number {
  const n = Math.floor(Number(raw ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, totalPages));
}
