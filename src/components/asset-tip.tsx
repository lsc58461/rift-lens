"use client";

// 아이템·룬·스펠 아이콘 툴팁 — op.gg 처럼 이름·스탯·패시브·가격(아이템), 설명(룬), 쿨타임·설명(스펠).
// 내용은 처음 열릴 때 /api/tooltip 에서 받아 모듈 캐시에 둔다 (페이지에 설명 전체를 싣지 않기 위해).
// 마우스 hover 전용 — 터치 기기에선 op.gg 도 툴팁이 없다.
import { useState, type ReactNode } from "react";
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
  if (!id) return <>{children}</>;
  return (
    <TooltipProvider delay={120}>
      <Tooltip
        onOpenChange={(open) => {
          if (open && tip === undefined) void load(kind, id).then(setTip);
        }}
      >
        <TooltipTrigger render={<span className={className} />}>{children}</TooltipTrigger>
        <TooltipContent side="top" className="block max-w-[300px] px-3 py-2 text-left text-xs leading-relaxed">
          <TipBody tip={tip} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
