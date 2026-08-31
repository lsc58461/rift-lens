// 한글 검색 보조 — 초성 검색("ㅎㅇㄷ" → "Hide on bush"는 아님, "ㄹㅅ" → "리 신")과
// 띄어쓰기 무시("리신" → "리 신", "hideonbush" → "Hide on bush").
// 서버·클라이언트 공용(순수 함수).

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 비교용 정규화 — NFKC·소문자·공백 제거.
 *  NFKC 는 호환 자모(ㄱ U+3131)를 조합형 초성(U+1100)으로 바꿔 버리므로 다시 호환 자모로 되돌린다
 *  (초성 질의 "ㅅㅁ" 가 DB 의 hangul_chosung 출력·[ㄱ-ㅎ] 판정과 같은 글자로 남게) */
export function compact(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ᄀ-ᄒ]/g, (ch) => CHOSUNG[ch.charCodeAt(0) - 0x1100])
    // 겹자모는 낱자모로 — "ㄹ"+"ㅅ"을 치면 IME 가 "ㄽ" 한 글자로 합치므로 초성 질의 "ㄹㅅ"과 같게
    .replace(/[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ]/g, (ch) => CLUSTER[ch] ?? ch);
}

const CLUSTER: Record<string, string> = {
  "ㄳ": "ㄱㅅ", "ㄵ": "ㄴㅈ", "ㄶ": "ㄴㅎ", "ㄺ": "ㄹㄱ", "ㄻ": "ㄹㅁ", "ㄼ": "ㄹㅂ",
  "ㄽ": "ㄹㅅ", "ㄾ": "ㄹㅌ", "ㄿ": "ㄹㅍ", "ㅀ": "ㄹㅎ", "ㅄ": "ㅂㅅ",
};

const JUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;
// 받침 — 겹받침은 낱자모로 풀어 둔다(닭 → ㄷㅏㄹㄱ), 질의 쪽 겹자모 풀기와 같은 규칙
const JONG = [
  "", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 한글 음절을 자모 열로 분해 (예: "리신" → "ㄹㅣㅅㅣㄴ"). 조합 중인 글자("릿"=ㄹㅣㅅ)도 앞부분이 같아져
 *  타이핑 도중에도 매칭된다. 나머지 글자는 그대로 */
export function jamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      out += CHOSUNG[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else out += ch;
  }
  return out;
}

/** 질의에 한글(음절 또는 자모)이 있는가 */
export function hasHangul(s: string): boolean {
  return /[ㄱ-ㅣ가-힣]/.test(s);
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
  if (!hasHangul(q)) return false;
  // 초성만 친 경우("ㄹㅅ") → 초성 열 비교, 그 외("릿", "리시") → 자모 열 비교
  return chosung(t).includes(q) || jamo(t).includes(jamo(q));
}
