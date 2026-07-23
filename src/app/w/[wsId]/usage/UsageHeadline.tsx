import { formatMoney } from '@/lib/usagePricing';
import { trend } from '@/lib/usageTrend';

export function UsageHeadline({ total, prevTotal, periodLabel }: { total: number; prevTotal: number; periodLabel: string }) {
  const t = trend(total, prevTotal);
  const arrow = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '■';
  const color = t.direction === 'up' ? 'text-red-500' : t.direction === 'down' ? 'text-green-600' : 'text-x-muted';
  const changeText = t.pct === null
    ? '이전 기간엔 기록이 없어 비교할 수 없어요'
    : t.direction === 'flat'
      ? '지난 기간과 비슷해요'
      : `지난 기간보다 ${Math.abs(t.pct)}% ${t.direction === 'up' ? '늘었어요' : '줄었어요'}`;
  return (
    <section className="mb-8 rounded-lg border border-x-border bg-x-surface p-6">
      <p className="text-caption text-x-muted">{periodLabel} 총 추정비용</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-x-text">{formatMoney(total)}</p>
      <p className={`mt-1 text-ui ${color}`}>
        {t.pct !== null && <span className="tabular-nums">{arrow} {Math.abs(t.pct)}% </span>}
        <span className="text-x-secondary">{changeText}</span>
      </p>
    </section>
  );
}
