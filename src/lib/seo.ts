// SEO 메타 헬퍼 — 페이지마다 canonical 과 OG(title/description/url)를 빠짐없이 내기 위한 한 곳.
//
// 함정: Next 메타데이터는 최상위 키 단위로 얕게 합쳐진다. 루트 레이아웃 openGraph 에 title/url 을
// 적어 두면 openGraph 를 안 적은 하위 페이지가 그걸 통째로 물려받아 모든 페이지의 og:title/og:url 이
// 메인 값이 됐다(2026-09-03 발견). 그래서 루트엔 type/locale/siteName 만 두고, 페이지는 이 헬퍼로
// 자기 값을 직접 낸다(하위 페이지가 openGraph 를 적으면 루트 것은 통째로 대체되므로 공통값도 같이).
import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const OG_BASE = { type: "website", locale: "ko_KR", siteName: SITE_NAME } as const;

/** 정적/동적 페이지 공통 메타 — path 는 "/champions" 처럼 canonical 로 삼을 경로(+쿼리) */
export function pageMeta(opts: { title: string; description: string; path: string }): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...OG_BASE, title, description, url: path },
  };
}

/** BreadcrumbList JSON-LD — items 는 홈부터 현재 페이지까지 순서대로 */
export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}

/** FAQPage JSON-LD — 답변은 평문 */
export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}
