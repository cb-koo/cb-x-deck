// X(트위터)식 숫자 축약: 1만 미만 콤마, 1만~ K, 100만~ M. 값이 100 이상이면 소수점 생략.
export function formatCount(n: number | null): string {
  if (n === null || n === undefined) return '–';
  if (n < 10000) return n.toLocaleString('en-US');
  const unit = n >= 1000000 ? 'M' : 'K';
  const v = n / (unit === 'M' ? 1000000 : 1000);
  const s = v >= 100 ? Math.floor(v).toLocaleString('en-US') : (Math.floor(v * 10) / 10).toString().replace(/\.0$/, '');
  return `${s}${unit}`;
}

// 축약 없이 콤마만 넣은 원본 숫자. 표 보기가 쓴다 — 표는 숫자를 나란히 놓고 비교하는 화면이라
// 23.7M처럼 줄이면 자리수를 눈으로 못 맞춘다. 카드뷰는 X와 같아 보이는 것이 목적이므로
// formatCount(X식 축약)를 계속 쓴다 (2026-07-31 사용자 결정).
export function formatFull(n: number | null): string {
  if (n === null || n === undefined) return '–';
  return n.toLocaleString('en-US');
}

export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `'${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}
