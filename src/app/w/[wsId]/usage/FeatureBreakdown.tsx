import { formatMoney } from '@/lib/usagePricing';

export function FeatureBreakdown({ features }: { features: Array<{ feature: string; calls: number; costUsd: number }> }) {
  const total = features.reduce((s, f) => s + f.costUsd, 0);
  return (
    <section className="rounded-lg border border-x-border bg-x-surface p-5">
      <h2 className="mb-1 text-base font-bold text-x-text">어디에 쓰였나</h2>
      <p className="mb-4 text-caption text-x-muted">기능별 추정비용 비중입니다.</p>
      {features.length === 0 ? (
        <p className="text-caption text-x-muted">이 기간에 기록된 호출이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {features.map((f) => {
            const pct = total ? Math.round((f.costUsd / total) * 100) : 0;
            return (
              <div key={f.feature} className="flex items-center gap-3 text-ui">
                <span className="w-32 shrink-0 text-x-text">{f.feature}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-x-text/10">
                  <span className="block h-full rounded-full bg-x-blue/70" style={{ width: `${Math.max(pct, 2)}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-x-muted">{pct}%</span>
                <span className="w-16 shrink-0 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
