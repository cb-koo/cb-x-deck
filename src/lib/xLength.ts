// X(트위터) 가중 글자수 — 공식 twitter-text 설정의 경량 근사(가이드용, 차단하지 않음).
// 규칙: URL은 t.co 단축으로 항상 23 / 아래 '경량 범위' 코드포인트는 1 / 나머지(CJK·이모지 등)는 2.
// 한계(스펙 명시): ZWJ 결합 이모지는 과대 계산될 수 있다 — 실제 검증은 게시 시점에 X가 한다.
const URL_RE = /https?:\/\/[^\s]+/g;
const URL_WEIGHT = 23;
// twitter-text v3 config의 weight-1 범위
const LIGHT: Array<[number, number]> = [
  [0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037],
];

export const X_MAX_WEIGHTED = 280; // 무료 계정 상한 — 일본어 환산 약 140자

export function xWeightedLength(text: string): number {
  if (!text) return 0;
  let total = 0;
  const rest = text.replace(URL_RE, () => { total += URL_WEIGHT; return ''; });
  for (const ch of rest) {
    const cp = ch.codePointAt(0) as number;
    total += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  return total;
}
