"use client";

// 데이터베이스 용량 — 실데이터는 안 지우는 방침이라 계속 늘어난다.
// 그래서 'DB 몇 GB'보다 '디스크 얼마 남았나'를 크게 보여준다.
import { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TableSize {
  table: string;
  bytes: number;
  dataBytes: number;
  indexBytes: number;
  rows: number;
}
interface DbStats {
  dbBytes: number;
  disk: { totalBytes: number; freeBytes: number } | null;
  tables: TableSize[];
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

export function DbSizeCard() {
  const [data, setData] = useState<DbStats | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db-stats");
      if (res.ok) setData((await res.json()) as DbStats);
    } finally {
      setBusy(false);
    }
  }, []);

  // 첫 로드는 load() 를 쓰지 않는다 — load 는 시작 즉시 setBusy 를 불러
  // 'effect 안 동기 setState' 가 되고, 떠난 뒤 도착한 응답도 못 버린다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/db-stats").catch(() => null);
      if (!alive || !res?.ok) return;
      setData((await res.json()) as DbStats);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const disk = data?.disk ?? null;
  const usedPct = disk ? ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100 : 0;
  const tight = usedPct >= 80;
  const max = data?.tables[0]?.bytes ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4 text-chart-2" />
          데이터베이스 용량
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
          경기·참가자 기록은 지우지 않아서 계속 늘어나요. 디스크 여유를 같이 봐요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-sm">
                DB <span className="text-lg font-semibold tabular-nums">{size(data.dbBytes)}</span>
              </span>
              {disk && (
                <span className="text-sm text-muted-foreground">
                  디스크 여유{" "}
                  <span
                    className={`text-lg font-semibold tabular-nums ${tight ? "text-destructive" : "text-foreground"}`}
                  >
                    {size(disk.freeBytes)}
                  </span>{" "}
                  / {size(disk.totalBytes)}
                </span>
              )}
            </div>

            {disk && (
              <div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  {/* DB 가 차지하는 몫을 디스크 사용량 안에서 따로 보여준다 */}
                  <div
                    className="bg-chart-2 transition-all"
                    style={{ width: `${(data.dbBytes / disk.totalBytes) * 100}%` }}
                  />
                  <div
                    className={tight ? "bg-destructive/70" : "bg-muted-foreground/40"}
                    style={{
                      width: `${Math.max(
                        0,
                        ((disk.totalBytes - disk.freeBytes - data.dbBytes) / disk.totalBytes) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-chart-2" /> 우리 DB
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-muted-foreground/40" /> 그 외 사용
                  </span>
                  <span className="ml-auto flex items-center gap-1 tabular-nums">
                    <HardDrive className="size-3" />
                    {usedPct.toFixed(0)}% 사용
                  </span>
                </div>
              </div>
            )}

            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                테이블별 — 데이터 + 인덱스
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border/40">
                  {data.tables.map((t) => (
                    <tr key={t.table}>
                      <td className="py-1.5 pr-2 font-mono">{t.table}</td>
                      <td className="w-24 py-1.5 px-1">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-chart-2/70"
                            style={{ width: `${(t.bytes / max) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{size(t.bytes)}</td>
                      <td className="py-1.5 px-1 text-right tabular-nums text-muted-foreground">
                        색인 {size(t.indexBytes)}
                      </td>
                      <td className="py-1.5 pl-1 text-right tabular-nums text-muted-foreground">
                        {t.rows.toLocaleString()}행
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
