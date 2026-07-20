import { getSql } from '@/lib/db';
import {
  rawAggregate, dailyAggregate,
  summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd,
} from '@/lib/usageStore';
import { formatMoney } from '@/lib/usagePricing';
import { UsageBar } from './UsageBar';

export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | 'month';

function range(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === '7d') from.setDate(from.getDate() - 7);
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else from.setDate(from.getDate() - 30);
  return { from, to };
}

const PERIOD_LABEL: Record<Period, string> = { '7d': '최근 7일', '30d': '최근 30일', month: '이번 달' };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: Period = sp.period === '7d' || sp.period === 'month' ? sp.period : '30d';
  const { from, to } = range(period);

  const sql = getSql();
  const rows = await rawAggregate(sql, from, to);
  const daily = await dailyAggregate(sql, from, to);

  const byApi = summarizeByApi(rows);
  const byFeature = summarizeByFeature(rows);
  const byDay = summarizeByDay(daily);
  const total = totalCostUsd(rows);
  const featTotal = byFeature.reduce((s, f) => s + f.costUsd, 0);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <header className="mb-6">
        <h1 className="text-lg font-bold text-x-text">API 사용량·비용</h1>
        <p className="mt-1 text-caption text-x-muted">
          외부 API 호출 기록을 집계한 <b>추정치</b>입니다. 기준 단가(2026-07-20 확인)로 환산했으며 실제 청구와 다를 수 있습니다.
        </p>
        <nav className="mt-3 flex gap-2">
          {(['7d', '30d', 'month'] as Period[]).map((p) => (
            <a key={p} href={`/usage?period=${p}`}
               className={`rounded-full border px-3 py-1 text-ui ${p === period ? 'border-x-blue text-x-blue' : 'border-x-border-strong text-x-secondary'}`}>
              {PERIOD_LABEL[p]}
            </a>
          ))}
        </nav>
      </header>

      {/* 요약 카드 */}
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-x-border bg-x-surface p-4">
          <p className="text-caption text-x-muted">{PERIOD_LABEL[period]} 총 추정비용</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-x-text">{formatMoney(total)}</p>
        </div>
        {byApi.map((a) => (
          <div key={a.api} className="rounded-lg border border-x-border bg-x-surface p-4">
            <p className="text-caption text-x-muted">{a.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-x-text">{formatMoney(a.costUsd)}</p>
            <p className="text-caption text-x-muted">{a.calls.toLocaleString()}회 호출</p>
          </div>
        ))}
      </section>

      {/* 일별 추이 */}
      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">일별 추이</h2>
        <UsageBar data={byDay} />
      </section>

      {/* 기능별 표 */}
      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">기능별</h2>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">기능</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">추정비용</th>
              <th className="py-1 text-right font-normal">비중</th>
            </tr>
          </thead>
          <tbody>
            {byFeature.map((f) => (
              <tr key={f.feature} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{f.feature}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{f.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">{featTotal ? Math.round((f.costUsd / featTotal) * 100) : 0}%</td>
              </tr>
            ))}
            {byFeature.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-x-muted">이 기간에 기록된 호출이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* API별 표 */}
      <section>
        <h2 className="mb-2 text-ui font-bold text-x-text">API별</h2>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">API</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">토큰(입력/출력)</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byApi.map((a) => (
              <tr key={a.api} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{a.label}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{a.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">
                  {a.api === 'anthropic' ? `${a.inputTokens.toLocaleString()} / ${a.outputTokens.toLocaleString()}` : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
