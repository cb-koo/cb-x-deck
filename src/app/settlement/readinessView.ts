import type { ReadinessLevel, SettlementCandidate } from '@/lib/settlementCalc';
// 색은 신호등 3색만 — 라벨-값 일치(UX 원칙 4): 값은 서버가 계산한 readiness에서만 파생
export const READINESS_STYLE: Record<ReadinessLevel, { dot: string; text: string; label: string }> = {
  ready:   { dot: 'bg-emerald-500', text: 'text-emerald-700', label: '보낼 수 있음' },
  warn:    { dot: 'bg-amber-500',   text: 'text-amber-700',   label: '확인 필요' },
  blocked: { dot: 'bg-red-500',     text: 'text-red-700',     label: '못 보냄' },
};
// 행의 실제 신호등 — 서버 값에 "사람이 분류를 골랐는지"만 얹는다(분류 빈칸은 🔴, 골랐으면 그 이유가 빠진다)
export function effectiveReadiness(c: SettlementCandidate, e: { category: string | null } | undefined): ReadinessLevel {
  const issues = c.issues.filter((i) => !(i.code === 'no-category' && e?.category));
  if (issues.some((i) => i.level === 'blocked')) return 'blocked';
  return issues.length ? 'warn' : 'ready';
}
