import Image from "next/image";
import { pageMeta } from "@/lib/seo";
import { Newspaper, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-kit";
import { getRecentPatchNotes, PATCH_NOTES_HUB } from "@/lib/patch-notes";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "패치노트",
  description: "리그 오브 레전드 최신 패치노트 바로가기",
  path: "/patch-notes",
});

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function PatchNotesPage() {
  const notes = await getRecentPatchNotes().catch(() => []);
  const [latest, ...rest] = notes;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Newspaper}
        title="패치노트"
        description="리그 오브 레전드 공식 패치노트로 바로 이동해요"
      />

      {/* 최신 패치 — 히어로 카드 */}
      {latest && (
        <a
          href={latest.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block overflow-hidden rounded-2xl border transition-colors hover:border-primary/50"
        >
          {latest.image && (
            <div className="relative aspect-[1200/630] w-full overflow-hidden bg-muted">
              <Image
                src={latest.image}
                alt={`패치 ${latest.patch}`}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  최신
                </span>
                <span className="font-semibold">패치 {latest.patch}</span>
                {latest.date && (
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(latest.date)}
                  </span>
                )}
              </div>
              {latest.summary && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {latest.summary}
                </p>
              )}
            </div>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </div>
        </a>
      )}

      {/* 이전 패치 — 썸네일 리스트 */}
      <div className="grid gap-2">
        {rest.map((n) => (
          <a
            key={n.patch}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border p-2.5 transition-colors hover:bg-accent"
          >
            {n.image ? (
              <div className="relative aspect-video h-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                <Image
                  src={n.image}
                  alt=""
                  fill
                  unoptimized
                  sizes="120px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="grid h-14 w-24 shrink-0 place-items-center rounded-lg bg-muted">
                <Newspaper className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold tabular-nums">패치 {n.patch}</div>
              {n.date && (
                <div className="text-xs text-muted-foreground">
                  {fmtDate(n.date)}
                </div>
              )}
            </div>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
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
