import Link from "next/link";
import { ArrowRight, BellRing, Bot, Gauge, ShieldAlert, Users } from "lucide-react";
import { DISCORD_INVITE_URL } from "@/lib/discord";

export const metadata = {
  title: "디스코드 봇",
  description:
    "Rift Lens 디스코드 봇 — 새 패치노트와 서비스 상태를 여러분의 서버 채널로 알려드려요",
};

const FEATURES = [
  {
    icon: Gauge,
    title: "실력대 조회",
    command: "/rift",
    description: "닉네임#태그를 입력하면 매칭 로비 기반 추정 실력대와 현재 랭크를 카드로 보여줘요.",
    tile: "bg-primary/12 text-primary",
  },
  {
    icon: Users,
    title: "팀 나누기 · 듀오 분석",
    command: "/rift-team · /rift-duo",
    description: "내전 인원을 실력 균형 맞춰 두 팀으로 나누거나, 두 소환사의 듀오 시너지를 분석해요.",
    tile: "bg-sky-500/12 text-sky-500 dark:text-sky-400",
  },
  {
    icon: BellRing,
    title: "패치노트 · 상태 알림",
    command: "/rift-alerts",
    description: "새 패치노트가 뜨면 이미지와 함께, 서비스 점검·복구 소식도 지정한 채널로 알려드려요.",
    tile: "bg-amber-500/12 text-amber-500 dark:text-amber-400",
  },
] as const;

export default function DiscordPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <section className="space-y-5 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#5865F2]/12 text-[#5865F2]">
          <Bot className="size-7" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Rift Lens 디스코드 봇
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            새 패치노트와 서비스 상태를 여러분의 서버 채널로 알려드려요. 무료이고, 메시지를 읽는
            권한은 요청하지 않아요.
          </p>
        </div>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#4752C4]"
        >
          서버에 초대하기
          <ArrowRight className="size-4" />
        </a>
        <p className="text-xs text-muted-foreground">
          디스코드에서 서버를 선택하면 바로 추가돼요 — 서버 관리 권한이 있어야 해요.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, command, description, tile }) => (
          <div key={title} className="rounded-xl border bg-card p-5">
            <span className={`mb-3 flex size-9 items-center justify-center rounded-lg ${tile}`}>
              <Icon className="size-4.5" />
            </span>
            <h2 className="mb-1 text-sm font-semibold">{title}</h2>
            <code className="mb-1.5 block text-xs text-muted-foreground">{command}</code>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-muted-foreground" />
          초대한 다음엔
        </h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">/rift-alerts 설정 채널:#알림채널</code>{" "}
            로 패치노트·상태 알림을 받을 텍스트 채널을 지정해요 (서버당 하나).
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">/rift-alerts 해제</code>{" "}
            로 끌 수 있고, 봇을 내보내면 설정도 함께 지워져요.
          </li>
          <li>이 명령어는 서버 관리 권한이 있는 사람에게만 보여요. 조회 명령어는 누구나 쓸 수 있어요.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          봇은 알림 전송을 위해 서버 ID·채널 ID와 설정한 관리자의 ID만 저장해요 — 자세한 내용은{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            개인정보처리방침
          </Link>
          을 참고하세요.
        </p>
      </section>
    </div>
  );
}
