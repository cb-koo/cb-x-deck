import { formatMoney } from '@/lib/usagePricing';

export function UsageBar({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) return <p className="text-caption text-x-muted">데이터 없음</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} · ${formatMoney(d.costUsd)}`}>
          <div className="w-full rounded-t bg-x-blue/70" style={{ height: `${Math.max((d.costUsd / max) * 100, 2)}%` }} />
          <span className="mt-1 text-caption text-x-muted">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
