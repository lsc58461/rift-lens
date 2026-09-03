import Link from "next/link";
import { summonerPath } from "@/lib/summoner-url";
import { ArrowLeft, Hand } from "lucide-react";
import { PLATFORM_LABELS } from "@/lib/riot/types";

// 인앱 브라우저·iOS에서 이미지 공유 버튼이 여는 안내 페이지.
// 웹뷰는 파일 공유/다운로드가 안 되므로, 이미지를 길게 눌러 저장하게 안내한다.
export const metadata = {
  title: "이미지 공유",
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ region: string; riotId: string }>;
}) {
  const { region, riotId } = await params;
  const decoded = decodeURIComponent(riotId);
  if (!(region in PLATFORM_LABELS) || !decoded.includes("#")) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        잘못된 접근이에요.
      </p>
    );
  }
  const imageUrl = `/api/share-image?region=${region}&riotId=${encodeURIComponent(decoded)}`;

  return (
    <div className="mx-auto max-w-xl space-y-4 py-4 text-center sm:py-8">
      <div className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium">
        <Hand className="size-4 shrink-0 text-primary" />
        <span>
          아래 이미지를 <span className="text-primary">길게 눌러</span> ‘사진
          저장’ 또는 ‘공유’를 선택하세요
        </span>
      </div>

      {/* 동적 생성 이미지라 next/image 최적화 대상이 아님 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={`${decoded} 매칭 구간 분석 결과 카드`}
        className="w-full rounded-xl border shadow-lg"
      />

      <Link
        href={summonerPath(region, decoded)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" />
        결과 페이지로 돌아가기
      </Link>
    </div>
  );
}
