import { useEffect, useRef } from "react";

type Intensity = "calm" | "active";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  baseAlpha: number;
  twinklePhase: number;
}

const PARTICLE_COUNT_BY_DPR = 120;
const LINK_DISTANCE = 130;

export function CreateWorldBackground({ intensity = "calm" }: { intensity?: Intensity }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intensityRef = useRef<Intensity>(intensity);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let rafId = 0;
    let startTime = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const seed = () => {
      const count = PARTICLE_COUNT_BY_DPR;
      particles = new Array(count).fill(0).map(() => makeParticle());
    };

    const makeParticle = (): Particle => {
      const radius = randRange(0.6, 2.4);
      const speed = randRange(0.04, 0.18);
      const angle = Math.random() * Math.PI * 2;
      const palette = [200, 215, 260, 285, 32];
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        hue: palette[Math.floor(Math.random() * palette.length)],
        baseAlpha: randRange(0.35, 0.85),
        twinklePhase: Math.random() * Math.PI * 2,
      };
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      const isActive = intensityRef.current === "active";
      const speedMul = isActive ? 2.4 : 1;
      const glowMul = isActive ? 1.7 : 1;

      // Background gradient
      const gradient = ctx.createRadialGradient(
        width / 2,
        height * 0.55,
        Math.min(width, height) * 0.05,
        width / 2,
        height * 0.55,
        Math.max(width, height) * 0.85,
      );
      gradient.addColorStop(0, "rgba(34, 26, 76, 1)");
      gradient.addColorStop(0.45, "rgba(14, 16, 42, 1)");
      gradient.addColorStop(1, "rgba(4, 6, 18, 1)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Subtle aurora ribbons
      const ribbonCount = isActive ? 3 : 2;
      for (let i = 0; i < ribbonCount; i++) {
        const yCenter = height * (0.25 + i * 0.22) + Math.sin(elapsed * 0.3 + i) * 30;
        const ribbonHeight = height * (isActive ? 0.36 : 0.28);
        const grad = ctx.createLinearGradient(0, yCenter - ribbonHeight / 2, 0, yCenter + ribbonHeight / 2);
        const hueA = (210 + i * 40 + (isActive ? 20 : 0)) % 360;
        const hueB = (290 + i * 30) % 360;
        grad.addColorStop(0, `hsla(${hueA}, 80%, 60%, 0)`);
        grad.addColorStop(0.5, `hsla(${hueA}, 80%, 60%, ${0.07 * glowMul})`);
        grad.addColorStop(1, `hsla(${hueB}, 80%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, yCenter - ribbonHeight / 2, width, ribbonHeight);
      }

      // Update and draw particles
      ctx.lineCap = "round";
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * speedMul;
        p.y += p.vy * speedMul;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        const twinkle = 0.65 + 0.35 * Math.sin(elapsed * 1.6 + p.twinklePhase);
        const alpha = p.baseAlpha * twinkle;
        const r = p.radius * (isActive ? 1.15 : 1);

        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 90%, 75%, ${alpha})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 65%, ${0.6 * glowMul})`;
        ctx.shadowBlur = 12 * glowMul;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Draw links between nearby particles
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > LINK_DISTANCE * LINK_DISTANCE) continue;
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / LINK_DISTANCE;
          const alpha = t * (isActive ? 0.32 : 0.18);
          ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 85%, 70%, ${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
