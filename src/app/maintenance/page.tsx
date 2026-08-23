import { CalendarClock, Wrench } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { getMaintenanceInfo } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "점검 중",
  robots: { index: false, follow: false },
};

function formatKst(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MaintenancePage() {
  const info = await getMaintenanceInfo().catch(() => null);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-24 text-center">
      <LogoMark className="size-14" />
      <div className="space-y-2">
        <h1 className="flex items-center justify-center gap-2 text-xl font-bold tracking-tight">
          <Wrench className="size-5 text-primary" />
          잠시 점검 중이에요
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {info?.reason ?? "더 나은 서비스를 위해 점검을 진행하고 있어요."}
        </p>
      </div>

      {(info?.startsAt || info?.endsAt) && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm">
          <CalendarClock className="size-4 shrink-0 text-primary" />
          <span>
            {info.startsAt && info.endsAt
              ? `${formatKst(info.startsAt)} ~ ${formatKst(info.endsAt)}`
              : info.endsAt
                ? `예상 종료: ${formatKst(info.endsAt)}`
                : `${formatKst(info.startsAt!)} 시작 · 종료 미정`}
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        점검이 끝나면 자동으로 정상 접속됩니다. 잠시 후 다시 방문해 주세요.
      </p>
    </div>
  );
}
