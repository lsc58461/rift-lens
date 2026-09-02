"use client";

// 홈 배경 — 커서에 반응하는 별자리 캔버스.
// · 점(파티클)들이 천천히 떠다니고, 서로 가까우면 실선으로 이어진다(별자리)
// · 커서 근처의 점은 커서 쪽으로 살짝 끌리고 밝아지며 커서와도 선으로 이어진다
// · 커서를 따라오는 은은한 방사형 글로우 + 아주 옅은 그리드
// 성능: 점 ~110개, rAF 1루프, DPR 2 상한, 탭이 숨겨지면 정지, reduced-motion이면 정지 프레임.
// 저사양 기기는 경량 모드 — 라이트하우스 4x CPU 실측에서 이 루프가 측정 15초 중 6.3초를 먹었다(2026-09-03):
// DPR 1, 30fps, 점 글로우(shadowBlur — 캔버스에서 가장 비싼 연산) 생략. 화면 폭이 아니라 실측으로 정한다:
// 처음엔 원래 모드로 그리면서 첫 12프레임의 그리기 시간·프레임 간격을 재고, 느리면 그때 경량으로 전환한다
// (데이터 절약 모드·저메모리 기기는 바로 경량). 루프 시작은 첫 화면이 그려진 뒤 유휴 시점으로 미루되,
// 빈 배경이 보이지 않게 첫 프레임 한 장은 바로 그린다.
import { useEffect, useRef } from "react";

const DOT_COUNT_DESKTOP = 110;
const DOT_COUNT_MOBILE = 55;
const LINK_DIST = 130; // 점끼리 이어지는 거리
const CURSOR_DIST = 220; // 커서 영향 반경
const SPEED = 0.18;
// 경량 전환 기준 — 그리기 중앙값 7ms(60fps 예산 16.7ms 의 40%) 초과 또는 프레임 간격 중앙값 26ms(≈40fps 미만)
const LITE_DRAW_MS = 7;
const LITE_GAP_MS = 26;
const PROBE_FRAMES = 12;
const WARMUP_FRAMES = 3;

function initialLite(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return true;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return true;
  return false;
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] ?? 0;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: 0 | 1; // 0 = 파랑, 1 = 앰버(소수)
  tw: number; // 반짝임 위상
}

export function InteractiveBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dark = document.documentElement.classList.contains("dark");
    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.classList.contains("dark");
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let w = 0;
    let h = 0;
    let dpr = 1;
    let lite = initialLite();
    let probed = lite; // 이미 경량이면 잴 필요 없음
    const drawSamples: number[] = [];
    const gapSamples: number[] = [];
    let lastFrame = 0;
    let dots: Dot[] = [];
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
    let raf = 0;
    let running = true;

    const palette = () =>
      dark
        ? { blue: "96,165,250", amber: "251,191,36", line: "148,163,184", alpha: 1 }
        : { blue: "37,99,235", amber: "217,119,6", line: "71,85,105", alpha: 0.55 };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = lite ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      canvas.dataset.mode = lite ? "lite" : "full"; // 확인용: document.querySelector("canvas").dataset.mode
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = w < 640 ? DOT_COUNT_MOBILE : DOT_COUNT_DESKTOP;
      if (dots.length !== n) {
        dots = Array.from({ length: n }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          r: 1.3 + Math.random() * 1.9,
          hue: Math.random() < 0.18 ? 1 : 0,
          tw: Math.random() * Math.PI * 2,
        }));
      }
    };

    const draw = (t: number) => {
      const p = palette();
      ctx.clearRect(0, 0, w, h);

      // 커서 글로우(부드럽게 따라옴)
      mouse.x += (mouse.tx - mouse.x) * 0.12;
      mouse.y += (mouse.ty - mouse.y) * 0.12;
      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 320);
        g.addColorStop(0, `rgba(${p.blue},${dark ? 0.16 : 0.1})`);
        g.addColorStop(0.5, `rgba(${p.blue},${dark ? 0.05 : 0.03})`);
        g.addColorStop(1, `rgba(${p.blue},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - 320, mouse.y - 320, 640, 640);
      }

      // 옅은 그리드
      ctx.strokeStyle = `rgba(${p.line},${dark ? 0.045 : 0.06})`;
      ctx.lineWidth = 1;
      const step = 64;
      ctx.beginPath();
      for (let x = (w / 2) % step; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // 점 이동 + 커서 인력
      for (const d of dots) {
        if (!reduced) {
          d.x += d.vx;
          d.y += d.vy;
          if (mouse.active) {
            const dx = mouse.x - d.x;
            const dy = mouse.y - d.y;
            const dist = Math.hypot(dx, dy);
            if (dist < CURSOR_DIST && dist > 1) {
              const f = ((CURSOR_DIST - dist) / CURSOR_DIST) * 0.012;
              d.x += dx * f;
              d.y += dy * f;
            }
          }
          if (d.x < -20) d.x = w + 20;
          else if (d.x > w + 20) d.x = -20;
          if (d.y < -20) d.y = h + 20;
          else if (d.y > h + 20) d.y = -20;
        }
      }

      // 점끼리 연결선
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > LINK_DIST || Math.abs(dy) > LINK_DIST) continue;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DIST) continue;
          const alpha = (1 - dist / LINK_DIST) * (dark ? 0.3 : 0.2) * p.alpha;
          ctx.strokeStyle = `rgba(${p.line},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // 커서와 연결 + 점
      for (const d of dots) {
        let near = 0;
        if (mouse.active) {
          const dist = Math.hypot(mouse.x - d.x, mouse.y - d.y);
          if (dist < CURSOR_DIST) {
            near = 1 - dist / CURSOR_DIST;
            ctx.strokeStyle = `rgba(${d.hue ? p.amber : p.blue},${near * (dark ? 0.35 : 0.28)})`;
            ctx.beginPath();
            ctx.moveTo(mouse.x, mouse.y);
            ctx.lineTo(d.x, d.y);
            ctx.stroke();
          }
        }
        const twinkle = reduced ? 0.85 : 0.7 + 0.3 * Math.sin(t / 900 + d.tw);
        const base = dark ? 0.85 : 0.75;
        const alpha = Math.min(1, (base * twinkle + near * 0.6) * p.alpha);
        const color = d.hue ? p.amber : p.blue;
        const r = d.r + near * 1.8;
        // 커서와 무관하게 항상 은은한 글로우, 커서 근처에선 더 크게 (경량 모드는 비용 때문에 생략)
        if (!lite) {
          ctx.shadowColor = `rgba(${color},${dark ? 0.9 : 0.5})`;
          ctx.shadowBlur = 6 + near * 12;
        }
        ctx.fillStyle = `rgba(${color},${alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const loop = (t: number) => {
      if (!running) return;
      // 경량 모드는 30fps 로 — 점이 천천히 떠다니는 배경이라 차이가 안 보인다
      if (!lite || t - lastFrame >= 32) {
        if (!probed) {
          const t0 = performance.now();
          draw(t);
          if (lastFrame > 0) {
            drawSamples.push(performance.now() - t0);
            gapSamples.push(t - lastFrame);
          }
          // 워밍업 프레임은 버리고, 표본이 차면 한 번만 판정 (판정 후엔 계측 안 함)
          if (drawSamples.length >= WARMUP_FRAMES + PROBE_FRAMES) {
            probed = true;
            const d = median(drawSamples.slice(WARMUP_FRAMES));
            const g = median(gapSamples.slice(WARMUP_FRAMES));
            if (d > LITE_DRAW_MS || g > LITE_GAP_MS) {
              lite = true;
              resize(); // DPR 1 로 다시 잡는다
            }
          }
        } else {
          draw(t);
        }
        lastFrame = t;
      }
      if (!reduced) raf = requestAnimationFrame(loop);
    };

    // 터치 기기에선 커서 인터랙션을 끈다 — 손가락이 화면을 가려 의미가 없고,
    // 스크롤 중 점이 손가락 쪽으로 튀어 보인다. 점은 그냥 떠다니기만 한다.
    const noHover = window.matchMedia("(hover: none)").matches;
    const onMove = (e: PointerEvent) => {
      if (noHover || e.pointerType === "touch") return;
      mouse.tx = e.clientX;
      mouse.ty = e.clientY;
      if (!mouse.active) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
      }
      if (reduced) draw(performance.now());
    };
    const onLeave = () => {
      mouse.active = false;
      mouse.tx = -9999;
      mouse.ty = -9999;
      if (reduced) draw(performance.now());
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };

    resize();
    draw(performance.now()); // 첫 프레임은 즉시 — 빈 배경이 보이지 않게
    // 움직임은 첫 화면·하이드레이션이 끝난 뒤에 시작 (첫 페인트·LCP 와 CPU 를 다투지 않게)
    const startLoop = () => {
      if (running && !raf) raf = requestAnimationFrame(loop);
    };
    let idleId = 0;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    const w2 = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (!reduced) {
      if (w2.requestIdleCallback) idleId = w2.requestIdleCallback(startLoop, { timeout: 1500 });
      else startTimer = setTimeout(startLoop, 600);
    }
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      if (idleId && w2.cancelIdleCallback) w2.cancelIdleCallback(idleId);
      if (startTimer) clearTimeout(startTimer);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
