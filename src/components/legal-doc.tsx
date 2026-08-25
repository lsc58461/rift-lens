// 약관·개인정보처리방침 같은 법적 문서 공통 레이아웃 — 제목 헤더 + 조항 섹션.
import type { ReactNode } from "react";

export function LegalDoc({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-7 text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_li]:my-1 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
