import { Newspaper, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import {
  getRecentPatchNotes,
  PATCH_NOTES_HUB,
} from "@/lib/patch-notes";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "패치노트",
  description: "리그 오브 레전드 최신 패치노트 바로가기",
};

export default async function PatchNotesPage() {
  const notes = await getRecentPatchNotes().catch(() => []);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        icon={Newspaper}
        title="패치노트"
        description="리그 오브 레전드 공식 패치노트로 바로 이동해요"
      />
      <div className="grid gap-2">
        {notes.map((n, i) => (
          <a
            key={n.patch}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-xl border px-4 py-3 transition-colors hover:bg-accent"
          >
            <span className="flex items-center gap-2.5">
              <span className="font-semibold tabular-nums">패치 {n.patch}</span>
              {i === 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  최신
                </span>
              )}
            </span>
            <ExternalLink className="size-4 text-muted-foreground" />
          </a>
        ))}
        {notes.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            패치 목록을 불러오지 못했어요.
          </p>
        )}
      </div>
      <a
        href={PATCH_NOTES_HUB}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        전체 패치노트 목록 <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
