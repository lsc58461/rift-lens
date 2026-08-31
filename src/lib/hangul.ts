// 한글 검색 보조 — 초성 검색("ㅎㅇㄷ" → "Hide on bush"는 아님, "ㄹㅅ" → "리 신")과
// 띄어쓰기 무시("리신" → "리 신", "hideonbush" → "Hide on bush").
// 서버·클라이언트 공용(순수 함수).

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 비교용 정규화 — NFKC·소문자·공백 제거 */
export function compact(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** 한글 음절은 초성으로, 나머지 글자는 그대로 (예: "리 신" → "ㄹㅅ", "Kai'Sa" → "kai'sa") */
export function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) out += CHOSUNG[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

/** 질의에 초성 자모(ㄱ~ㅎ)가 하나라도 있으면 초성 검색으로 본다 */
export function hasChosung(s: string): boolean {
  return /[ㄱ-ㅎ]/.test(s);
}

/** target 이 query 에 맞는가 — 띄어쓰기 무시 부분 일치 또는 초성 부분 일치 */
export function matchesKo(target: string, query: string): boolean {
  const q = compact(query);
  if (!q) return true;
  const t = compact(target);
  if (t.includes(q)) return true;
  return hasChosung(q) && chosung(t).includes(q);
}
