"use client";

// 보안 위험 감지 — 스캐너가 노린 "없는 경로"를 종류별로 보여준다.
// IP 차단은 일부러 하지 않는다(바꿔서 다시 옴). 목적은 차단이 아니라
// "무엇을 노리고 있는지"를 눈에 띄게 해서, 실제로 위험한 표면이 새로 생겼을 때 알아채는 것.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
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

interface IpDetail {
  ip: string;
  hits: number;
  firstAt: number;
  lastAt: number;
  paths: { path: string; category: string; hits: number; lastAt: number }[];
  truncated: number;
  uas: { ua: string; hits: number }[];
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
  const [openIp, setOpenIp] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, IpDetail>>({});
  const [loadingIp, setLoadingIp] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/security");
      if (res.ok) setData((await res.json()) as Overview);
    } finally {
      setBusy(false);
    }
  }, []);

  // IP 를 펼치면 그 IP 가 시도한 경로 전부를 받아 온다 (한 번 받으면 캐시)
  const toggleIp = useCallback(
    async (ip: string) => {
      if (openIp === ip) {
        setOpenIp(null);
        return;
      }
      setOpenIp(ip);
      if (detail[ip]) return;
      setLoadingIp(ip);
      try {
        const res = await fetch(`/api/admin/security?ip=${encodeURIComponent(ip)}`);
        if (res.ok) {
          const d = (await res.json()) as IpDetail;
          setDetail((prev) => ({ ...prev, [ip]: d }));
        }
      } finally {
        setLoadingIp(null);
      }
    },
    [openIp, detail],
  );

  // 첫 로드는 load() 를 쓰지 않는다 — load 는 시작하자마자 setBusy 를 호출해서
  // "effect 안 동기 setState" 가 되고, 떠난 뒤 도착한 응답을 버릴 수도 없다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/security").catch(() => null);
      if (!alive || !res?.ok) return;
      setData((await res.json()) as Overview);
    })();
    return () => {
      alive = false;
    };
  }, []);

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

            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                출발지 IP <span className="font-normal">— 누르면 그 IP가 시도한 경로를 전부 봐요</span>
              </h4>
              <ul className="divide-y divide-border/40 rounded-lg border">
                {data.ips.map((r) => {
                  const open = openIp === r.ip;
                  const d = detail[r.ip];
                  return (
                    <li key={r.ip}>
                      <button
                        type="button"
                        onClick={() => void toggleIp(r.ip)}
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/50"
                      >
                        {open ? (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-mono">{r.ip}</span>
                        <span className="ml-auto tabular-nums">{r.hits.toLocaleString()}회</span>
                        <span
                          className="tabular-nums text-muted-foreground"
                          title="사용한 User-Agent 종류 — 많을수록 사칭하며 돌려 쓴다는 뜻"
                        >
                          UA {r.uas}
                        </span>
                        <span className="tabular-nums text-muted-foreground">경로 {r.paths}</span>
                        <span className="w-16 text-right whitespace-nowrap text-muted-foreground">
                          {ago(r.lastAt)}
                        </span>
                      </button>

                      {open && (
                        <div className="border-t bg-muted/20 px-2.5 py-2">
                          {loadingIp === r.ip && !d ? (
                            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" /> 불러오는 중…
                            </div>
                          ) : d ? (
                            <div className="space-y-2">
                              <div className="text-[11px] text-muted-foreground">
                                최근 30일 · {d.hits.toLocaleString()}회 · 경로 {d.paths.length.toLocaleString()}종
                                {d.truncated > 0 && ` (많이 때린 순 ${d.paths.length}개만 표시)`}
                                {d.firstAt > 0 && ` · 처음 ${ago(d.firstAt)} ~ 마지막 ${ago(d.lastAt)}`}
                              </div>

                              <div className="max-h-80 overflow-y-auto rounded-md border bg-background">
                                <table className="w-full text-[11px]">
                                  <thead className="sticky top-0 bg-background text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
                                    <tr>
                                      <th className="px-2 py-1 text-left font-medium">경로</th>
                                      <th className="px-2 py-1 text-left font-medium whitespace-nowrap">종류</th>
                                      <th className="px-2 py-1 text-right font-medium">횟수</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/40">
                                    {d.paths.map((p) => (
                                      <tr key={p.path}>
                                        <td className="px-2 py-1 font-mono break-all">{p.path}</td>
                                        <td className="px-2 py-1 whitespace-nowrap">
                                          <span
                                            className={`rounded px-1.5 py-0.5 ${TONE[p.category] ?? TONE["기타 스캔"]}`}
                                          >
                                            {p.category}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                                          {p.hits.toLocaleString()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {d.uas.length > 0 && (
                                <details className="text-[11px]">
                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                    사용한 User-Agent {d.uas.length}종 보기
                                  </summary>
                                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-background p-2">
                                    {d.uas.map((u) => (
                                      <li key={u.ua} className="flex gap-2 font-mono break-all">
                                        <span className="shrink-0 tabular-nums text-muted-foreground">
                                          {u.hits}
                                        </span>
                                        <span>{u.ua || "(없음)"}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          ) : (
                            <p className="py-2 text-xs text-muted-foreground">불러오지 못했어요</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                노린 경로 — 전체 상위
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border/40">
                  {data.paths.map((r) => (
                    <tr key={r.path}>
                      <td className="max-w-md truncate py-1.5 pr-2 font-mono" title={r.path}>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
