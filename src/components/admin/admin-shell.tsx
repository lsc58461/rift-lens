"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  Users,
  Wrench,
} from "lucide-react";
import { LogoMark } from "@/components/logo-mark";

const NAV = [
  { href: "/admin", label: "대시보드", icon: LayoutDashboard },
  { href: "/admin/summoners", label: "소환사", icon: Users },
  { href: "/admin/maintenance", label: "점검", icon: Wrench },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }

  const isActive = (href: string) =>
    href === "/admin" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
      {/* 사이드 레일 (모바일에선 가로 스크롤 탭) */}
      <aside className="lg:sticky lg:top-20 lg:h-fit lg:w-52 lg:shrink-0">
        <div className="rounded-xl border bg-card/60 p-2">
          <div className="mb-1 hidden items-center gap-2.5 px-2 pb-2.5 pt-1.5 lg:flex">
            <LogoMark className="size-8 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight tracking-tight">
                관리자 콘솔
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                Rift Lens
              </div>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-primary lg:block"
                    />
                  )}
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-1.5 flex gap-1 border-t pt-1.5 lg:flex-col">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowUpRight className="size-4 shrink-0" />
              사이트로
            </Link>
            <button
              type="button"
              onClick={logout}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-4 shrink-0" />
              로그아웃
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
