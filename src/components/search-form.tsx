"use client";

import { useRouter } from "next/navigation";
import { summonerPath } from "@/lib/summoner-url";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { SummonerAutocomplete } from "@/components/summoner-autocomplete";
import { Button } from "@/components/ui/button";

// 한국 서버 전용 — 리전 탭 없이 kr로 고정 검색한다.
export function SearchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim().normalize("NFKC");
    const hashIndex = trimmed.lastIndexOf("#");
    if (hashIndex <= 0 || hashIndex === trimmed.length - 1) {
      toast.error("게임명#태그 형식으로 입력해 주세요 (예: Hide on bush#KR1)");
      return;
    }
    startTransition(() => {
      router.push(summonerPath("kr", trimmed));
    });
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex gap-2">
        <SummonerAutocomplete
          value={query}
          onChange={setQuery}
          placeholder="게임명#태그 (예: Hide on bush#KR1)"
          className={compact ? "h-9" : "h-11 text-base"}
        />
        <Button
          type="submit"
          disabled={isPending}
          className={compact ? "h-9" : "h-11 px-5"}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          {!compact && "검색"}
        </Button>
      </div>
    </form>
  );
}
