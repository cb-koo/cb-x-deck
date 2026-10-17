'use client';
// 클리닉 지도 — 매출 × 외국인 비중 2×2(캔버스). 프로토타입에서 옮겼다. 칸 이름은 판단 말로(UX 원칙 3).
import { useEffect, useRef, useState } from 'react';
import type { Clinic } from './types';
import { foreignColor } from './format';
import { FOREIGN_LOW_PCT } from '@/lib/marketClinic';

interface Props {
  clinics: Clinic[];
  selected: Clinic | null;
  salesSplit: number; // 매출 상위 20% 경계값
  onSelect: (c: Clinic) => void;
}

const FOREIGN_SPLIT = FOREIGN_LOW_PCT;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

// x: 매출(로그), y: 외국인 비중 — 2×2 세그먼트
export default function Quadrant({ clinics, selected, salesSplit, onSelect }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pts = clinics.filter((c) => c.sales && c.foreignPct != null);
  const xMin = Math.log10(3e6), xMax = Math.log10(5e10);
  const geom = useRef({ w: 0, h: 0 });
  // 패널 크기가 바뀌면 다시 그림
  const [size, setSize] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(canvas.current!);
    return () => ro.disconnect();
  }, []);

  const sx = (v: number) => PAD.l + ((Math.log10(Math.max(v, 3e6)) - xMin) / (xMax - xMin)) * (geom.current.w - PAD.l - PAD.r);
  const sy = (v: number) => geom.current.h - PAD.b - (v / 100) * (geom.current.h - PAD.t - PAD.b);

  useEffect(() => {
    const el = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = el.getBoundingClientRect();
    geom.current = { w: width, h: height };
    el.width = width * dpr;
    el.height = height * dpr;
    const g = el.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    const ink = '#6c7781', line = '#cfd9de'; // x-muted · x-border-strong

    // 사분면 배경
    const xs = sx(salesSplit), ys = sy(FOREIGN_SPLIT);
    g.fillStyle = 'rgba(37,99,235,0.06)';
    g.fillRect(xs, ys, width - PAD.r - xs, height - PAD.b - ys);
    g.strokeStyle = line;
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(xs, PAD.t); g.lineTo(xs, height - PAD.b); g.moveTo(PAD.l, ys); g.lineTo(width - PAD.r, ys); g.stroke();
    g.setLineDash([]);

    g.fillStyle = ink;
    g.font = '11px Pretendard Variable, sans-serif';
    for (const [v, t] of [[1e7, '1천만'], [1e8, '1억'], [1e9, '10억'], [1e10, '100억']] as const) {
      g.fillText(t, sx(v) - 10, height - 8);
    }
    for (const v of [0, 50, 100]) g.fillText(`${v}%`, 8, sy(v) + 4);

    for (const c of pts) {
      const [r, gg, b] = foreignColor(c.foreignPct);
      g.fillStyle = `rgba(${r},${gg},${b},${c.exact ? 0.55 : 0.28})`;
      g.beginPath(); g.arc(sx(c.sales!), sy(c.foreignPct!), 2.2, 0, Math.PI * 2); g.fill();
    }
    // 사분면 라벨은 점 위에 배경과 함께
    g.font = '600 12px Pretendard Variable, sans-serif';
    const tag = (t: string, x: number, y: number, color: string) => {
      const w = g.measureText(t).width + 10;
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.fillRect(x, y - 12, w, 17);
      g.fillStyle = color;
      g.fillText(t, x + 5, y);
    };
    tag('해외 확장 제안', xs + 6, ys + 18, '#1573ad');
    tag('이미 외국인 많음', xs + 6, PAD.t + 14, '#c2410c');
    tag('작은 외국인 병원', PAD.l + 6, PAD.t + 14, ink);
    tag('작은 국내 병원', PAD.l + 6, ys + 18, ink);
    if (selected?.sales && selected.foreignPct != null) {
      g.strokeStyle = '#0f1419'; g.lineWidth = 2;
      g.beginPath(); g.arc(sx(selected.sales), sy(selected.foreignPct), 6, 0, Math.PI * 2); g.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, selected, salesSplit, size]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: Clinic | null = null, bd = 64;
    for (const c of pts) {
      const d = (sx(c.sales!) - x) ** 2 + (sy(c.foreignPct!) - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) onSelect(best);
  };

  return (
    <canvas ref={canvas} onClick={onClick} className="block size-full cursor-crosshair" />
  );
}
