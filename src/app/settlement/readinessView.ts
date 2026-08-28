import type { ReadinessLevel } from '@/lib/settlementCalc';
// 색은 신호등 3색만 — 라벨-값 일치(UX 원칙 4): 값은 서버가 계산한 readiness에서만 파생
export const READINESS_STYLE: Record<ReadinessLevel, { dot: string; text: string; label: string }> = {
  ready:   { dot: 'bg-emerald-500', text: 'text-emerald-700', label: '보낼 수 있음' },
  warn:    { dot: 'bg-amber-500',   text: 'text-amber-700',   label: '확인 필요' },
  blocked: { dot: 'bg-red-500',     text: 'text-red-700',     label: '못 보냄' },
};
// 순수 계산은 settlementCalc.ts에 있다(assessReadiness와 나란히 — 스토어 테스트도 같은 곳에서 검증)
export { effectiveReadiness, effectiveIssues } from '@/lib/settlementCalc';
