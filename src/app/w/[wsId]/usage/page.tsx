import { getSql } from '@/lib/db';
import {
  rawAggregate, dailyAggregate,
  summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd,
} from '@/lib/usageStore';
import { getProviderActuals } from '@/lib/actualCost';
import { kstMonthStart, kstDaysAgoStart } from '@/lib/datetime';
import { UsageHeadline } from './UsageHeadline';
import { ActualCostPanel } from './ActualCostPanel';
import { FeatureBreakdown } from './FeatureBreakdown';
import { UsageDetailTables } from './UsageDetailTables';
import { UsageBar } from './UsageBar';

export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | 'month';
const PERIOD_LABEL: Record<Period, string> = { '7d': '최근 7일', '30d': '최근 30일', month: '이번 달' };

// 현재 기간 + 동일 길이 직전 기간(추세 비교용)
// 경계는 한국 자정이다 — 막대 라벨이 KST 버킷(usageStore.dailyAggregate)이라 경계도 같아야
// 첫 막대가 부분 집계가 되지 않는다. (마지막 막대는 to=지금이라 오늘이 끝나기 전엔 항상
// 부분 집계다 — 경계를 맞춰도 없어지지 않는다.) 서버 로컬(Vercel=UTC)로 만들면 매월 1일
// 오전 9시간이 빠지고, 한국 1일 새벽에는 전달을 보여준다.
function ranges(period: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const to = new Date();
  // "최근 7일" = 오늘 포함 한국 달력일 7일. kstDaysAgoStart(n)은 'n일 전 자정'이라 버킷 수는
  // 오늘(1) + n일 전(n) = n+1개 — 7개를 원하면 n=6 (30일도 같은 이유로 29).
  const from = period === 'month' ? kstMonthStart()
    : period === '7d' ? kstDaysAgoStart(6)
    : kstDaysAgoStart(29);
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
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-x-text">API 사용량·비용</h1>
          <p className="mt-1 text-caption text-x-muted">추정치(기록 × 기준 단가)와 제공사 실제 청구를 함께 보여줍니다. 실제와 다를 수 있어요.</p>
        </div>
        <nav className="flex shrink-0 gap-2">
          {(['7d', '30d', 'month'] as Period[]).map((p) => (
            <a key={p} href={`/w/${wsId}/usage?period=${p}`}
               aria-current={p === period ? 'page' : undefined}
               className={`rounded-full border px-3 py-1 text-ui ${p === period ? 'border-x-blue font-medium text-x-blue-text' : 'border-x-border-strong text-x-secondary'}`}>
              {PERIOD_LABEL[p]}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-10">
        <UsageHeadline total={total} prevTotal={prevTotal} periodLabel={PERIOD_LABEL[period]} />
        <ActualCostPanel actuals={actuals} estimateByApi={estimateByApi} />
        <FeatureBreakdown features={byFeature} />

        <section className="rounded-lg border border-x-border bg-x-surface p-5">
          <h2 className="mb-1 text-base font-bold text-x-text">일별 추이</h2>
          <p className="mb-4 text-caption text-x-muted">막대에 마우스를 올리면 날짜·비용을 볼 수 있어요. 가장 큰 날은 진하게 표시됩니다.</p>
          <UsageBar data={byDay} />
        </section>

        <UsageDetailTables byApi={byApi} />
      </div>
    </div>
  );
}
