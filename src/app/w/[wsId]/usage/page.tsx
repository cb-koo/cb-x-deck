import { getSql } from '@/lib/db';
import {
  rawAggregate, dailyAggregate,
  summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd,
} from '@/lib/usageStore';
import { getProviderActuals } from '@/lib/actualCost';
import { UsageHeadline } from './UsageHeadline';
import { ActualCostPanel } from './ActualCostPanel';
import { FeatureBreakdown } from './FeatureBreakdown';
import { UsageDetailTables } from './UsageDetailTables';
import { UsageBar } from './UsageBar';

export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | 'month';
const PERIOD_LABEL: Record<Period, string> = { '7d': '최근 7일', '30d': '최근 30일', month: '이번 달' };

// 현재 기간 + 동일 길이 직전 기간(추세 비교용)
function ranges(period: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === '7d') from.setDate(from.getDate() - 7);
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else from.setDate(from.getDate() - 30);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);
  return { from, to, prevFrom, prevTo };
}

export default async function UsagePage({
  params, searchParams,
}: {
  params: Promise<{ wsId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { wsId } = await params;
  const sp = await searchParams;
  const period: Period = sp.period === '7d' || sp.period === 'month' ? sp.period : '30d';
  const { from, to, prevFrom, prevTo } = ranges(period);

  const sql = getSql();
  const rows = await rawAggregate(sql, from, to);
  const prevRows = await rawAggregate(sql, prevFrom, prevTo);
  const daily = await dailyAggregate(sql, from, to);

  const byApi = summarizeByApi(rows);
  const byFeature = summarizeByFeature(rows);
  const byDay = summarizeByDay(daily);
  const total = totalCostUsd(rows);
  const prevTotal = totalCostUsd(prevRows);
  const estimateByApi: Record<string, number> = Object.fromEntries(byApi.map((a) => [a.api, a.costUsd]));

  const actuals = await getProviderActuals(from, to);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-x-text">API 사용량·비용</h1>
          <p className="mt-1 text-caption text-x-muted">추정치(기록 × 기준 단가)와 제공사 실제 청구를 함께 보여줍니다. 실제와 다를 수 있어요.</p>
        </div>
        <nav className="flex shrink-0 gap-2">
          {(['7d', '30d', 'month'] as Period[]).map((p) => (
            <a key={p} href={`/w/${wsId}/usage?period=${p}`}
               className={`rounded-full border px-3 py-1 text-ui ${p === period ? 'border-x-blue text-x-blue' : 'border-x-border-strong text-x-secondary'}`}>
              {PERIOD_LABEL[p]}
            </a>
          ))}
        </nav>
      </header>

      <UsageHeadline total={total} prevTotal={prevTotal} periodLabel={PERIOD_LABEL[period]} />
      <ActualCostPanel actuals={actuals} estimateByApi={estimateByApi} />
      <FeatureBreakdown features={byFeature} />

      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">일별 추이</h2>
        <UsageBar data={byDay} />
      </section>

      <UsageDetailTables byApi={byApi} byFeature={byFeature} />
    </div>
  );
}
