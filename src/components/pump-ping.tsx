"use client";

// 백그라운드 작업 펌프 트리거 — /api/announcement 는 응답 뒤 after() 로 멈춘 대량 작업을 이어주는
// 역할을 겸한다(job-pump.ts). 공지 배너가 서버 렌더로 바뀌어 이 호출이 사라지면 안 되므로,
// 브라우저가 한가해진 뒤(유휴 콜백, 없으면 2초 뒤) 낮은 우선순위로 한 번만 핑한다.
// 렌더와 무관하니 첫 화면 지표(LCP·Speed Index)에 영향이 없다.

import { useEffect } from "react";

export function PumpPing() {
  useEffect(() => {
    const ping = () => {
      fetch("/api/announcement", { priority: "low", keepalive: true }).catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) {
      w.requestIdleCallback(ping, { timeout: 5000 });
      return;
    }
    const id = setTimeout(ping, 2000);
    return () => clearTimeout(id);
  }, []);
  return null;
}
