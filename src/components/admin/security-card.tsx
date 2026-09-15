"use client";

// 보안 위험 감지 — 스캐너가 노린 "없는 경로"를 종류별로 보여준다.
// IP 차단은 일부러 하지 않는다(바꿔서 다시 옴). 목적은 차단이 아니라
// "무엇을 노리고 있는지"를 눈에 띄게 해서, 실제로 위험한 표면이 새로 생겼을 때 알아채는 것.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "./ui";

interface Overview {
  total24h: number;
  total7d: number;
  categories: { category: string; hits24h: number; hits7d: number }[];
  ips: { ip: string; hits: number; uas: number; paths: number; lastAt: number; category: string }[];
  paths: { path: string; hits: number; category: string }[];
  lastAt: number | null;
}

const TONE: Record<string, string> = {
  "명령어 주입": "bg-red-500/10 text-red-600 dark:text-red-400",
  "비밀파일 탐색": "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "경로 탐색": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "워드프레스·PHP": "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "SSRF·프록시": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "기타 스캔": "bg-muted text-muted-foreground",
};

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function SecurityCard() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/security");
      if (res.ok) setData((await res.json()) as Overview);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quiet = !data || data.total7d === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {quiet ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="size-4 text-amber-500" />
          )}
          보안 위험 감지
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
            aria-label="새로고침"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
        </CardTitle>
        <CardDescription>
          최근 7일 · 우리 사이트에 없는 공격성 경로로 들어온 요청이에요. IP는 막지 않아요 — 바꿔서 다시
          오니까요. 대신 <b>무엇을 노리는지</b>를 봐서, 여기 뜨는 종류에 해당하는 기능을 새로 열 때
          한 번 더 확인하는 용도예요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {quiet ? (
          <EmptyState icon={ShieldCheck}>최근 7일간 감지된 스캔이 없어요</EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span>
                24시간 <span className="font-semibold tabular-nums">{data.total24h.toLocaleString()}</span>건
              </span>
              <span className="text-muted-foreground">
                7일 <span className="tabular-nums">{data.total7d.toLocaleString()}</span>건
              </span>
              {data.lastAt && (
                <span className="text-xs text-muted-foreground">마지막 {ago(data.lastAt)}</span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {data.categories.map((c) => (
                <span
                  key={c.category}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${TONE[c.category] ?? TONE["기타 스캔"]}`}
                >
                  {c.category}{" "}
                  <span className="tabular-nums opacity-80">{c.hits7d.toLocaleString()}</span>
                </span>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">출발지 IP</h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border/40">
                    {data.ips.map((r) => (
                      <tr key={r.ip}>
                        <td className="py-1.5 pr-2 font-mono">{r.ip}</td>
                        <td className="py-1.5 px-1 text-right tabular-nums">{r.hits.toLocaleString()}</td>
                        <td
                          className="py-1.5 px-1 text-right tabular-nums text-muted-foreground"
                          title="사용한 User-Agent 종류 — 많을수록 사칭하며 돌려 쓴다는 뜻"
                        >
                          UA {r.uas}
                        </td>
                        <td className="py-1.5 pl-1 text-right whitespace-nowrap text-muted-foreground">
                          {ago(r.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">노린 경로</h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border/40">
                    {data.paths.map((r) => (
                      <tr key={r.path}>
                        <td className="max-w-56 truncate py-1.5 pr-2 font-mono" title={r.path}>
                          {r.path}
                        </td>
                        <td className="py-1.5 pl-1 text-right tabular-nums text-muted-foreground">
                          {r.hits.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
