"use client";

// 소환사 자동완성 후보 조회 — 인풋형(SummonerAutocomplete)과 스포트라이트형(SearchPalette)이 함께 쓴다.
// 빈 문자열로 부르면 최근 검색된 소환사가 돌아온다(suggest 라우트 동작).
import { useCallback, useEffect, useRef, useState } from "react";

export interface Suggestion {
  name: string;
  tag: string;
  label: string | null;
  tier: string | null;
}

const DEBOUNCE_MS = 200;

export function useSuggestions() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 늦게 도착한 옛 응답이 새 결과를 덮지 않게 — 요청마다 번호를 매겨 마지막 것만 반영한다
  const seqRef = useRef(0);

  const fetchSuggest = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const seq = ++seqRef.current;
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/summoners/suggest?region=kr&q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data: { items: Suggestion[] } = await res.json();
        if (seq === seqRef.current) setItems(data.items);
      } catch {
        // 자동완성 실패는 조용히 무시
      }
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { items, fetchSuggest, setItems };
}
