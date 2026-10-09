import { STAGE_LABEL, type Check, type Stage } from '@/lib/clientStatus';

// 구간 점검 칩 — 판정(캠페인을 어떻게 할지)과 별개로 '어디를 볼지'. 색은 구간별(캠페인 파랑 · 전환 보라 · 결과 주황).
const STYLE: Record<Stage, { bg: string; fg: string }> = {
  campaign: { bg: '#e8f5fe', fg: '#1573ad' },
  conversion: { bg: '#f1ecfd', fg: '#6b3fc8' },
  result: { bg: '#fff4e0', fg: '#a15c00' },
};

export function StageChips({ checks, max = 2 }: { checks: Check[]; max?: number }) {
  if (!checks.length) return null;
  const shown = checks.slice(0, max), more = checks.length - shown.length;
  return (
    <span className="flex shrink-0 items-center gap-1" title={checks.map((c) => `${STAGE_LABEL[c.stage]}: ${c.text}`).join('\n')}>
      {shown.map((c) => (
        <span key={c.stage + c.text} className="whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-semibold" style={{ background: STYLE[c.stage].bg, color: STYLE[c.stage].fg }}>
          {STAGE_LABEL[c.stage]} · {c.text}
        </span>
      ))}
      {more > 0 && <span className="text-[12px] text-x-muted">+{more}</span>}
    </span>
  );
}
