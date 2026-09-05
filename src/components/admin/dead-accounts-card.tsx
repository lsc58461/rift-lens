"use client";

// 없어진 계정 — 전체 갱신이 라이엇 404 를 만난 계정 목록. '확인하고 정리'를 누르면
// puuid 로 다시 조회해 소멸이 확인된 것만 지우고, 닉변이면 새 이름으로 승계한다.
import { useCallback, useEffect, useState } from "react";
import { Ghost, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DeadItem {
  riotId: string;
  platform: string;
  hasPuuid: boolean;
  goneAt: number;
}

interface Result {
  checked: number;
  purged: number;
  renamed: number;
  renamedList: string[];
  alive: number;
  unknown: number;
  remaining: number;
}

function ago(ts: number): string {
  const h = Math.floor((Date.now() - ts) / 3_600_000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function DeadAccountsCard() {
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<DeadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/dead-accounts");
    if (!res.ok) return;
    const d = (await res.json()) as { count: number; items: DeadItem[] };
    setCount(d.count);
    setItems(d.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/dead-accounts", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Result;
      setResult(d);
      toast.success(
        d.purged > 0 || d.renamed > 0
          ? `${d.purged}명 정리, ${d.renamed}명 닉변 승계`
          : "지울 계정이 없어요",
      );
      await load();
    } catch {
      toast.error("확인에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Ghost className="size-4 text-muted-foreground" />
          없어진 계정
        </CardTitle>
        <CardDescription>
          전체 갱신 중 라이엇이 못 찾은 계정이에요. 확인을 누르면 puuid로 다시 조회해서{" "}
          <b>정말 사라진 계정만</b> 등록 목록·분석 결과에서 지우고, 닉네임만 바뀐 계정은 새 이름으로
          옮겨요. 경기 기록은 그대로 둡니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            대상{" "}
            <span className="font-semibold tabular-nums">
              {count === null ? "…" : count.toLocaleString()}
            </span>
            명
          </span>
          <Button size="sm" onClick={run} disabled={busy || count === 0}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            확인하고 정리
          </Button>
          {count !== null && count > 200 && (
            <span className="text-xs text-muted-foreground">
              한 번에 200명씩 확인해요 — 여러 번 눌러 주세요
            </span>
          )}
        </div>

        {result && (
          <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            <div className="tabular-nums">
              확인 {result.checked} · 삭제 {result.purged} · 닉변 승계 {result.renamed} · 살아있음{" "}
              {result.alive} · 확인 못 함 {result.unknown} · 남음 {result.remaining}
            </div>
            {result.renamedList.length > 0 && (
              <ul className="space-y-0.5 text-muted-foreground">
                {result.renamedList.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/60">
                {items.map((it) => (
                  <tr key={`${it.platform}:${it.riotId}`}>
                    <td className="px-3 py-1.5">{it.riotId}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {it.hasPuuid ? ago(it.goneAt) : "puuid 없음"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
