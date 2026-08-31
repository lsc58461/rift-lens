// 한글 검색 보조 — 초성 검색("ㅎㅇㄷ" → "Hide on bush"는 아님, "ㄹㅅ" → "리 신")과
// 띄어쓰기 무시("리신" → "리 신", "hideonbush" → "Hide on bush").
// 서버·클라이언트 공용(순수 함수).

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 비교용 정규화 — NFKC·소문자·공백 제거.
 *  NFKC 는 호환 자모(ㄱ U+3131, ㄽ U+313D)를 조합형 자모로 바꿔 버리므로 자모 구간은 NFKC 를 건너뛴다.
 *  겹자모·겹모음은 낱자모로 푼다 — IME 가 "ㄹ"+"ㅅ"을 "ㄽ", "ㅗ"+"ㅏ"를 "ㅘ"로 합치므로 */
export function compact(s: string): string {
  return s
    .replace(/[^\u3131-\u318e]+/g, (seg) => seg.normalize("NFKC"))
    // \ud638\ucd9c \uc804\uc5d0 \uc774\ubbf8 NFKC \ub97c \uac70\uccd0 \uc870\ud569\ud615 \uc790\ubaa8(U+1100~)\uac00 \ub41c \uae00\uc790\ub294 \ud638\ud658 \uc790\ubaa8\ub85c \ub418\ub3cc\ub9b0\ub2e4
    .replace(/[\u1100-\u11ff]/g, (ch) => conjoiningToCompat(ch))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄㅘㅙㅚㅝㅞㅟㅢ]/g, (ch) => CLUSTER[ch] ?? ch);
}

const CLUSTER: Record<string, string> = {
  "ㄳ": "ㄱㅅ", "ㄵ": "ㄴㅈ", "ㄶ": "ㄴㅎ", "ㄺ": "ㄹㄱ", "ㄻ": "ㄹㅁ", "ㄼ": "ㄹㅂ",
  "ㄽ": "ㄹㅅ", "ㄾ": "ㄹㅌ", "ㄿ": "ㄹㅍ", "ㅀ": "ㄹㅎ", "ㅄ": "ㅂㅅ",
  "ㅘ": "ㅗㅏ", "ㅙ": "ㅗㅐ", "ㅚ": "ㅗㅣ", "ㅝ": "ㅜㅓ", "ㅞ": "ㅜㅔ", "ㅟ": "ㅜㅣ", "ㅢ": "ㅡㅣ",
};

// 조합형 자모(NFKC 결과) → 호환 자모. 초성 U+1100~1112, 중성 U+1161~1175, 종성 U+11A8~11C2
const JUNG_COMPAT = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG_COMPAT = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
function conjoiningToCompat(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x1100 && c <= 0x1112) return CHOSUNG[c - 0x1100];
  if (c >= 0x1161 && c <= 0x1175) return JUNG_COMPAT[c - 0x1161];
  if (c >= 0x11a8 && c <= 0x11c2) return JONG_COMPAT[c - 0x11a8];
  return ch;
}

// 두벌식 자판 — 영문 키 → 자모 ("fltls" → ㄹㅣㅅㅣㄴ = 리신, "ft" → ㄹㅅ)
const KEY_TO_JAMO: Record<string, string> = {
  r: "ㄱ", R: "ㄲ", s: "ㄴ", e: "ㄷ", E: "ㄸ", f: "ㄹ", a: "ㅁ", q: "ㅂ", Q: "ㅃ", t: "ㅅ", T: "ㅆ",
  d: "ㅇ", w: "ㅈ", W: "ㅉ", c: "ㅊ", z: "ㅋ", x: "ㅌ", v: "ㅍ", g: "ㅎ",
  k: "ㅏ", o: "ㅐ", i: "ㅑ", O: "ㅒ", j: "ㅓ", p: "ㅔ", u: "ㅕ", P: "ㅖ", h: "ㅗ", y: "ㅛ",
  n: "ㅜ", b: "ㅠ", m: "ㅡ", l: "ㅣ",
};

/** 영문만 친 질의를 두벌식 자모 열로 — 영문이 아니면 "" */
export function englishToJamo(q: string): string {
  const s = q.replace(/\s+/g, "");
  if (!s || !/^[a-zA-Z]+$/.test(s)) return "";
  let out = "";
  for (const ch of s) out += KEY_TO_JAMO[ch] ?? KEY_TO_JAMO[ch.toLowerCase()] ?? "";
  return out;
}

/** 자모 열이 자음만인가 (→ 초성 질의로 본다) */
export function consonantsOnly(j: string): boolean {
  return j.length > 0 && !/[ㅏ-ㅣ]/.test(j);
}

// 중성 — 겹모음은 낱모음으로 풀어 둔다(ㅘ → ㅗㅏ), 질의 쪽 풀기·영타(두 키)와 같은 규칙
const JUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ", "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ", "ㅡ", "ㅡㅣ", "ㅣ",
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
  if (hasHangul(q)) {
    // 초성만 친 경우("ㄹㅅ") → 초성 열 비교, 그 외("릿", "리시") → 자모 열 비교
    return chosung(t).includes(q) || jamo(t).includes(jamo(q));
  }
  // 영타("fltls" = 리신, "ft" = ㄹㅅ) — 한글 이름을 영문 자판 그대로 친 경우
  const ej = englishToJamo(query);
  if (!ej) return false;
  return consonantsOnly(ej) ? chosung(t).includes(ej) : jamo(t).includes(ej);
}
