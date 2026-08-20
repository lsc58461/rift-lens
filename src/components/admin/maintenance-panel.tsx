"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MigrationCard } from "./migration-card";
import { PageHeader } from "./ui";

interface Maintenance {
  active: boolean;
  on: boolean;
  reason: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MaintenancePanel() {
  const [mnt, setMnt] = useState<Maintenance | null>(null);
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/maintenance")
      .then((r) => r.json())
      .then((d: Maintenance) => {
        setMnt(d);
        setReason(d.reason ?? "");
        setStartsAt(isoToLocalInput(d.startsAt));
        setEndsAt(isoToLocalInput(d.endsAt));
      })
      .catch(() => {});
  }, []);

  async function save(on: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          on,
          reason: reason || null,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error();
      const data: Maintenance = await res.json();
      setMnt(data);
      toast.success(
        data.on
          ? data.active
            ? "점검 모드가 켜졌어요 — 최대 10초 내 전체 적용"
            : "점검이 예약됐어요 — 시작 시각에 자동 활성화"
          : "점검 모드를 껐어요",
      );
    } catch {
      toast.error("점검 설정 저장에 실패했어요");
    } finally {
      setSaving(false);
    }
  }

  const state = !mnt?.on
    ? {
        label: "꺼짐",
        note: "방문자에게 사이트가 정상 노출돼요",
        dot: "bg-muted-foreground/50",
        cls: "border-border bg-muted/40 text-muted-foreground",
      }
    : mnt.active
      ? {
          label: "점검 중",
          note: "모든 페이지가 점검 안내로 대체되고 있어요",
          dot: "bg-destructive",
          cls: "border-destructive/30 bg-destructive/10 text-destructive",
        }
      : {
          label: "예약됨",
          note: "시작 시각이 되면 자동으로 활성화돼요",
          dot: "bg-amber-500",
          cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        };

  return (
    <div className="space-y-5">
      <PageHeader
        title="점검 모드"
        description="어드민·API는 점검 중에도 접속 가능해요"
      />

      <MigrationCard />

      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 ${state.cls}`}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className={`size-2 rounded-full ${state.dot}`} />
          {state.label}
        </span>
        <span className="text-xs opacity-80">{state.note}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">설정</CardTitle>
          <CardDescription>
            사유·기간을 설정하고 켜면 방문자에게 점검 페이지가 표시돼요. 종료
            시각이 지나면 자동으로 해제됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="점검 사유 (예: 서버 업그레이드 작업)"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              시작 (비우면 즉시)
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              종료 (비우면 수동 해제까지)
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mnt?.on ? "secondary" : "destructive"}
              disabled={saving}
              onClick={() => save(true)}
            >
              {mnt?.on ? "설정 업데이트" : "점검 켜기"}
            </Button>
            {mnt?.on && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => save(false)}
              >
                점검 끄기
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
