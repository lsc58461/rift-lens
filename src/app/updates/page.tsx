import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getPublishedChangelog, type ChangelogTag } from "@/lib/changelog";

export const metadata = {
  title: "업데이트 내역",
  description: "Rift Lens의 기능 추가와 개선 사항 기록",
};

// 내용은 DB에서 관리(재배포 없이 어드민에서 수정)하므로 요청 시 렌더한다
// (빌드 프리렌더는 DB가 없어 실패하고, 어드민 수정도 즉시 반영돼야 한다)
export const dynamic = "force-dynamic";

const TAG_VARIANT: Record<ChangelogTag, "default" | "secondary" | "outline"> = {
  신규: "default",
  개선: "secondary",
  수정: "outline",
};

export default async function UpdatesPage() {
  // DB 장애 시에도 페이지는 떠야 하므로 빈 목록으로 방어
  const changelog = await getPublishedChangelog().catch(() => []);
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Megaphone className="size-4.5" />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            업데이트 내역
          </h1>
          <p className="text-sm text-muted-foreground">
            Rift Lens가 이렇게 좋아지고 있어요
          </p>
        </div>
      </div>

      <div className="relative space-y-8 border-l pl-6">
        {changelog.map((entry) => (
          <section key={entry.id} className="relative">
            <span className="absolute left-[-1.85rem] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" />
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-semibold">{entry.title}</h2>
              <time className="text-xs text-muted-foreground">{entry.date}</time>
            </div>
            <ul className="space-y-1.5">
              {entry.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge
                    variant={TAG_VARIANT[item.tag]}
                    className="mt-px shrink-0 text-[10px]"
                  >
                    {item.tag}
                  </Badge>
                  <span className="text-muted-foreground">{item.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
