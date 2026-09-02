// JSON-LD 구조화 데이터 스크립트 — 서버 컴포넌트에서 <JsonLd data={…}/> 로 쓴다.
// "<" 를 이스케이프해 </script> 로 스크립트가 닫히는 것을 막는다.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\u003c") }}
    />
  );
}
