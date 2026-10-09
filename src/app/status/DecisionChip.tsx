import { DECISION_LABEL, type Decision } from '@/lib/clientStatus';

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
