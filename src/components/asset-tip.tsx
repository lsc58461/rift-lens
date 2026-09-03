"use client";

// 아이템·룬·스펠 아이콘 툴팁 — op.gg 처럼 이름·스탯·패시브·가격(아이템), 설명(룬·파편), 쿨타임·설명(스펠).
// 내용은 처음 열릴 때 /api/tooltip 에서 받아 모듈 캐시에 둔다 (페이지에 설명 전체를 싣지 않기 위해).
//
// 터치 기기(hover 불가)에선 탭으로 연다 — op.gg 는 모바일에 툴팁이 아예 없지만 우리 방문의 약 8%가
// 모바일이라 정보를 못 보는 사람이 생긴다(2026-09-03 접근로그). 탭은 부모(전적 행 펼치기·룬 페이지 선택)로
// 전파하지 않고, 바깥을 누르거나 스크롤하면 닫힌다.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tip, TipKind } from "@/lib/tooltips";

const store = new Map<string, Promise<Tip | null>>();

function load(kind: TipKind, id: number): Promise<Tip | null> {
  const key = `${kind}:${id}`;
  let p = store.get(key);
  if (!p) {
    p = fetch(`/api/tooltip?kind=${kind}&id=${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Tip>) : null))
      .catch(() => null);
    store.set(key, p);
  }
  return p;
}

function TipBody({ tip }: { tip: Tip | null | undefined }) {
  if (tip === undefined) return <span className="opacity-70">불러오는 중…</span>;
  if (tip === null) return <span className="opacity-70">정보 없음</span>;
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-[13px] font-semibold">{tip.name}</div>
        {tip.sub && <div className="opacity-70">{tip.sub}</div>}
      </div>
      {tip.blocks.map((b, i) => (
        <div key={i} className={b.kind === "rules" ? "whitespace-pre-line opacity-70" : "whitespace-pre-line"}>
          {b.title && <span className="font-semibold">{b.title}</span>}
          {b.title && b.text && "\n"}
          {b.text}
        </div>
      ))}
      {tip.price && tip.price.total > 0 && (
        <div className="opacity-80">
          가격: <span className="font-medium">{tip.price.total.toLocaleString()}</span>
          {tip.price.base > 0 && tip.price.base !== tip.price.total && ` (${tip.price.base.toLocaleString()})`}
        </div>
      )}
    </div>
  );
}

export function AssetTip({
  kind,
  id,
  children,
  className = "inline-flex",
}: {
  kind: TipKind;
  id: number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const [tip, setTip] = useState<Tip | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // 터치 판정은 마운트 후에 — 서버 렌더와 첫 렌더가 어긋나지 않게
  const [touch, setTouch] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openedAt = useRef(0);

  useEffect(() => {
    setTouch(window.matchMedia("(hover: none)").matches);
  }, []);

  // 탭으로 연 툴팁은 바깥을 누르거나 스크롤하면 닫는다 (hover 처럼 저절로 닫히지 않으므로)
  useEffect(() => {
    if (!open || !touch) return;
    const onDown = (e: Event) => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // 열린 직후의 스크롤 이벤트는 무시한다 — 툴팁이 뜨며 생기는 레이아웃 이동(툴팁을 보이게 하려는
    // 브라우저 스크롤 포함)에 바로 닫혀 버리는 것 방지. 그 뒤 실제 스크롤엔 닫는다.
    const onScroll = () => {
      if (Date.now() - openedAt.current > 250) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, touch]);

  if (!id) return <>{children}</>;

  const show = (next: boolean) => {
    if (next) openedAt.current = Date.now();
    setOpen(next);
    if (next && tip === undefined) void load(kind, id).then(setTip);
  };

  return (
    <TooltipProvider delay={120}>
      {/* 열림 상태를 우리가 쥔다 — 데스크톱은 Base UI 의 hover 신호로, 터치는 아래 onClick 으로 */}
      <Tooltip open={open} onOpenChange={(next) => !touch && show(next)}>
        <TooltipTrigger
          render={
            <span
              ref={triggerRef}
              className={className}
              onClick={(e) => {
                if (!touch) return;
                // 부모(전적 행 펼치기·룬 페이지 선택)가 같이 반응하지 않게
                e.preventDefault();
                e.stopPropagation();
                show(!open);
              }}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="top" className="block max-w-[300px] px-3 py-2 text-left text-xs leading-relaxed">
          <TipBody tip={tip} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
