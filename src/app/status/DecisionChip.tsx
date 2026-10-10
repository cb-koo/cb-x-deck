import { DECISION_LABEL, DIRECTION_LABEL, type Decision, type Direction } from '@/lib/clientStatus';

// 판정 칩 — 색은 행동의 무게 순(조정 검토 빨강 > 관찰 주황 > 보류 회색 > 유지 초록). 차트 키트 VerdictChip과 같은 모양.
const STYLE: Record<Decision, { bg: string; fg: string }> = {
  adjust: { bg: '#fdecec', fg: '#b42318' },
  watch: { bg: '#fff4e0', fg: '#a15c00' },
  hold: { bg: '#eef1f3', fg: '#536471' },
  keep: { bg: '#e7f6ec', fg: '#15803d' },
};

export function DecisionChip({ decision, draft }: { decision: Decision; draft?: boolean }) {
  const s = STYLE[decision];
  return (
    <span title={draft ? '규칙 제안 — 아직 확정 전이에요' : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
        background: draft ? '#fff' : s.bg, color: s.fg, border: `1px ${draft ? 'dashed' : 'solid'} ${draft ? s.fg : s.bg}` }}>
      {DECISION_LABEL[decision]}{draft ? ' (제안)' : ''}
    </span>
  );
}

// 월 방향 칩 — 확대(파랑) · 유지(초록) · 축소(주황) · 전환(보라)
const DIR_STYLE: Record<Direction, { bg: string; fg: string }> = {
  expand: { bg: '#e8f5fe', fg: '#1573ad' },
  keep: { bg: '#e7f6ec', fg: '#15803d' },
  shrink: { bg: '#fff4e0', fg: '#a15c00' },
  pivot: { bg: '#f1ecfd', fg: '#6b3fc8' },
};
export function DirectionChip({ direction }: { direction: Direction }) {
  const s = DIR_STYLE[direction];
  return <span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>{DIRECTION_LABEL[direction]}</span>;
}
