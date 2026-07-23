import { formatMoney } from '@/lib/usagePricing';

type ApiRow = { api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number };
type FeatRow = { feature: string; calls: number; costUsd: number };

export function UsageDetailTables({ byApi, byFeature }: { byApi: ApiRow[]; byFeature: FeatRow[] }) {
  return (
    <details className="mb-8 rounded-lg border border-x-border">
      <summary className="cursor-pointer px-4 py-2 text-ui text-x-secondary">상세 표 (API별 · 기능별)</summary>
      <div className="px-4 pb-4">
        <h3 className="mb-1 mt-2 text-caption text-x-muted">API별</h3>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">API</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">토큰(입/출)</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byApi.map((a) => (
              <tr key={a.api} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{a.label}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{a.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">{a.api === 'anthropic' ? `${a.inputTokens.toLocaleString()} / ${a.outputTokens.toLocaleString()}` : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mb-1 mt-4 text-caption text-x-muted">기능별</h3>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">기능</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byFeature.map((f) => (
              <tr key={f.feature} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{f.feature}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{f.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
