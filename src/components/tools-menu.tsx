"use client";

import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Heart,
  Sparkles,
  Swords,
  Wrench,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TOOLS = [
  { icon: Swords, label: "내전 팀 밸런서", href: "/team" },
  { icon: Heart, label: "듀오 궁합 분석", href: "/duo" },
  { icon: Sparkles, label: "시즌 결산", href: "/recap" },
] as const;

export function ToolsMenu() {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground">
        <Wrench className="size-4" />
        <span className="hidden sm:inline">도구</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {TOOLS.map(({ icon: Icon, label, href }) => (
          <DropdownMenuItem key={href} onClick={() => router.push(href)}>
            <Icon className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
