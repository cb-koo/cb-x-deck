import { formatMoney } from '@/lib/usagePricing';

export function UsageBar({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) return <p className="text-caption text-x-muted">데이터 없음</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((d) => {
        const isPeak = d.costUsd === max && max > 0.0001;
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} · ${formatMoney(d.costUsd)}`}>
            <div className={`w-full rounded-t ${isPeak ? 'bg-x-blue' : 'bg-x-blue/50'}`} style={{ height: `${Math.max((d.costUsd / max) * 100, 2)}%` }} />
            <span className={`mt-1 text-caption ${isPeak ? 'text-x-text' : 'text-x-muted'}`}>{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}
