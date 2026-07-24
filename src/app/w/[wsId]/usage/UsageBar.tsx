import { formatMoney } from '@/lib/usagePricing';

export function UsageBar({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) return <p className="text-caption text-x-muted">이 기간엔 기록이 없어요</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  return (
    <div className="flex gap-1" style={{ height: 140 }}>
      {data.map((d) => {
        const isPeak = d.costUsd === max && max > 0.0001;
        const h = Math.max((d.costUsd / max) * 100, 2);
        return (
          <div key={d.day} aria-label={`${d.day} ${formatMoney(d.costUsd)}`}
               className="group relative flex h-full flex-1 flex-col items-center">
            {/* hover 툴팁 (CSS만, 클라이언트 JS 불필요) */}
            <div className="pointer-events-none absolute top-0 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-x-text px-2 py-1 text-caption text-x-surface opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {d.day} · {formatMoney(d.costUsd)}
            </div>
            <div className="flex w-full flex-1 items-end">
              <div
                className={`w-full rounded-t transition-colors ${isPeak ? 'bg-x-blue' : 'bg-x-blue/50 group-hover:bg-x-blue/80'}`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`mt-1 shrink-0 text-caption ${isPeak ? 'text-x-text' : 'text-x-muted'}`}>{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}
