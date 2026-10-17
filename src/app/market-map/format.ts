// 클리닉 지도 — 숫자·색 표기(프로토타입 format.ts에서 옮김)
// 금액: 1억 이상 "12.3억", 미만 "4,560만"
export function won(v: number | null | undefined): string {
  if (v == null) return '–';
  if (Math.abs(v) >= 1e8) {
    const eok = v / 1e8;
    return `${eok >= 100 ? Math.round(eok).toLocaleString() : eok.toFixed(1)}억`;
  }
  return `${Math.round(v / 1e4).toLocaleString()}만`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  return v == null ? '–' : `${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined): string {
  return v == null ? '–' : v.toLocaleString();
}

export function signed(v: number | null | undefined): string {
  if (v == null) return '–';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export const monthLabel = (m: string | null) => (m ? `${Number(m.slice(5))}월` : '–');

// 외국인 비중 → 색 (파랑: 국내 중심, 회색: 혼합, 주황: 외국인 중심)
const STOPS: [number, [number, number, number]][] = [
  [0, [37, 99, 235]],
  [15, [125, 146, 196]],
  [35, [176, 168, 160]],
  [60, [240, 128, 48]],
  [100, [214, 64, 12]],
];
export function foreignColor(p: number | null): [number, number, number] {
  if (p == null) return [160, 160, 160];
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i];
    const [a, ca] = STOPS[i - 1];
    if (p <= b) {
      const t = (p - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t)) as [number, number, number];
    }
  }
  return STOPS.at(-1)![1];
}
export const FOREIGN_LEGEND = [0, 15, 35, 60, 100];

// 단색 순차 눈금(구역 색칠) — cb-x-deck 파랑 계열. 보라는 '제안서 발송' 테두리와 겹쳐서 쓰지 않는다
export function seqColor(t: number): [number, number, number, number] {
  const a = [232, 245, 253];
  const b = [21, 115, 173];
  const c = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * Math.max(0, Math.min(1, t))));
  return [c[0], c[1], c[2], 190];
}

// 영업 상태 색 · 이름
export const CRM_META = {
  client: { label: '서비스 중', short: '고객', color: [0, 160, 106] as [number, number, number], hex: '#00a06a' },
  onboarding: { label: '리포트 준비', short: '준비', color: [8, 145, 178] as [number, number, number], hex: '#0891b2' },
  lead: { label: '제안서 발송', short: '리드', color: [124, 58, 237] as [number, number, number], hex: '#7c3aed' },
} as const;

export const dateLabel = (iso: string | null | undefined) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
