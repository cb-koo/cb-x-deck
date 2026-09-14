// 한국어 숫자 단위 표기(스펙 §3) — 분석 화면은 '읽기' 표면이라 X식 K/M이 아니라 천·만·억으로 읽힌다.
// 덱 카드처럼 X를 미러링하는 표면은 계속 format.ts의 formatCount(K/M)를 쓴다.

// 큰 단위부터 — 인덱스 i-1이 한 칸 위 단위다(승격 판정에 씀).
const UNITS = [
  { value: 100_000_000, suffix: '억' },
  { value: 10_000, suffix: '만' },
  { value: 1_000, suffix: '천' },
];

// 소수 1자리, .0은 생략 — 10000 → '1만'(1.0만 아님)
function withUnit(v: number, suffix: string): string {
  return `${v.toString().replace(/\.0$/, '')}${suffix}`;
}

/**
 * 0~999는 그대로(콤마 없음) · 1,000~ `6.1천` · 10,000~ `57.8만` · 1억~ `1.2억`.
 * 반올림이 다음 단위에 닿으면 그 단위로 승격한다(9,999 → '10천'이 아니라 '1만').
 * 음수·NaN 같은 표기 불가 값은 String(n) 폴백 — 화면에서 '만'이 붙은 이상한 값이 나오지 않게.
 */
export function formatKoCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 1_000) return String(n);

  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    if (n < u.value) continue;
    const rounded = Math.round((n / u.value) * 10) / 10;
    if (i > 0 && rounded * u.value >= UNITS[i - 1].value) {
      const up = UNITS[i - 1];
      return withUnit(Math.round((n / up.value) * 10) / 10, up.suffix);
    }
    return withUnit(rounded, u.suffix);
  }
  return String(n);   // 도달 불가(n >= 1000이면 위에서 반환) — 타입 좁히기용
}
