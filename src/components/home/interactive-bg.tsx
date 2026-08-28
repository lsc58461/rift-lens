"use client";

// 홈 배경 — 커서에 반응하는 별자리 캔버스.
// · 점(파티클)들이 천천히 떠다니고, 서로 가까우면 실선으로 이어진다(별자리)
// · 커서 근처의 점은 커서 쪽으로 살짝 끌리고 밝아지며 커서와도 선으로 이어진다
// · 커서를 따라오는 은은한 방사형 글로우 + 아주 옅은 그리드
// 성능: 점 ~110개, rAF 1루프, DPR 2 상한, 탭이 숨겨지면 정지, reduced-motion이면 정지 프레임.
import { useEffect, useRef } from "react";

const DOT_COUNT_DESKTOP = 110;
const DOT_COUNT_MOBILE = 55;
const LINK_DIST = 130; // 점끼리 이어지는 거리
const CURSOR_DIST = 220; // 커서 영향 반경
const SPEED = 0.18;

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
    let dots: Dot[] = [];
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
    let raf = 0;
    let running = true;

    const palette = () =>
      dark
        ? { blue: "96,165,250", amber: "251,191,36", line: "148,163,184", alpha: 1 }
        : { blue: "37,99,235", amber: "217,119,6", line: "71,85,105", alpha: 0.55 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
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
          r: 0.9 + Math.random() * 1.6,
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
          const alpha = (1 - dist / LINK_DIST) * (dark ? 0.22 : 0.16) * p.alpha;
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
        const twinkle = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(t / 900 + d.tw);
        const base = dark ? 0.55 : 0.5;
        const alpha = Math.min(1, (base * twinkle + near * 0.6) * p.alpha);
        const color = d.hue ? p.amber : p.blue;
        const r = d.r + near * 1.8;
        if (near > 0.2 || d.hue) {
          ctx.shadowColor = `rgba(${color},${dark ? 0.9 : 0.5})`;
          ctx.shadowBlur = 8 + near * 10;
        } else {
          ctx.shadowBlur = 0;
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
      draw(t);
      if (!reduced) raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
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
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
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
