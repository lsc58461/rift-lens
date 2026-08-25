import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { FeedbackForm } from "@/components/feedback-form";

export const metadata = {
  title: "문의 · 버그 신고",
  description: "Rift Lens에 문의하거나 버그를 신고하고, 내 데이터 정정·비노출을 요청하세요",
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const initialKind =
    kind === "bug" || kind === "data" || kind === "inquiry" ? kind : undefined;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <MessageSquareText className="size-4.5" />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">문의 · 버그 신고</h1>
          <p className="text-sm text-muted-foreground">
            답장은 적어 주신 이메일로 드려요
          </p>
        </div>
      </div>
      <FeedbackForm initialKind={initialKind} />
      <p className="text-xs text-muted-foreground">
        접수 내용의 처리 기준은{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          개인정보처리방침
        </Link>
        을 따라요. 급한 장애 소식은{" "}
        <Link href="/discord" className="underline underline-offset-2 hover:text-foreground">
          디스코드 봇
        </Link>
        으로도 받을 수 있어요.
      </p>
    </div>
  );
}
