// 차트 키트 디자인 토큰 (2026-10-09) — 레퍼런스(Fikri Studio 분석 대시보드) 시각 규칙 + Material Design 데이터 시각화 원칙을
// 우리 앱(X 팔레트, globals.css)에 옮긴 값. 차트는 이 값만 쓴다 — 개별 차트에서 색·크기를 새로 만들지 않는다.
// 원칙: 주색 하나(x-blue) + 중립색, 비교 기간은 같은 색의 연한 점선, 증감은 화살표+색, 격자는 연한 점선 몇 줄만,
// 세로축 값은 오른쪽, 범례는 차트 아래, 선은 직선으로 잇는다(하루 단위 정수를 곡선으로 이으면 연속값처럼 보임).

export const C = {
  text: '#0f1419',
  secondary: '#536471',
  muted: '#6c7781',
  grid: '#e3e8eb',        // 점선 격자
  axis: '#cfd9de',        // 바닥선·눈금
  separator: '#eef1f3',   // 주 구분 세로선
  card: '#f7f9f9',        // 카드 바탕(x-surface)
  primary: '#1d9bf0',     // 주색(x-blue) — 이번 기간·강조
  primaryDeep: '#1573ad', // 진한 주색(x-blue-text) — 글자·작은 점
  primarySoft: '#8ecdf8', // 비교 기간 점선
  neutralBar: '#c9d3d9',  // 강조 아닌 막대
  band: '#e2e9ed',        // 평소 범위 띠 — 카드 바탕(#f7f9f9) 위에서 보이도록(10-09 검토: 너무 연함)
  up: '#15803d',          // 좋아짐(화살표와 함께만)
  down: '#dc2626',        // 나빠짐(화살표와 함께만)
} as const;

// 코호트 칸 — 같은 파랑의 명도 단계(낮음 → 높음). 색만으로 읽히지 않게 칸 안에 값을 같이 적는다.
export const HEAT = ['#eef7fd', '#cfe9fb', '#a3d5f7', '#64b7ef', '#2b8fd8', '#1667a6'] as const;

export const T = {
  cardTitle: 16,   // 카드 제목
  value: 28,       // 큰 숫자
  delta: 20,       // 증감
  subtitle: 13,    // 차트 소제목(점선 밑줄 = 뜻 풀이 있음)
  axis: 12,        // 축·범례
  label: 12,       // 직접 라벨·주석
} as const;

export const S = {
  cardRadius: 12,
  cardPadX: 24,
  cardPadY: 20,
  barRadius: 3,
  gridDash: '4 4',
  compareDash: '4 3',
  lineWidth: 2,
  compareWidth: 1.5,
} as const;

export const NUM = new Intl.NumberFormat('ko-KR');
export function compact(n: number): string {
  if (n >= 10000) return `${NUM.format(Math.round(n / 1000) / 10)}만`;
  return NUM.format(n);
}
