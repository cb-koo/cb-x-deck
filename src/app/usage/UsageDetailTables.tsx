import { formatMoney } from '@/lib/usagePricing';

type ApiRow = { api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number };

// 기능별 분해는 상단 "어디에 쓰였나"와 동일 데이터라 여기선 API별만 둔다(중복 제거).
export function UsageDetailTables({ byApi }: { byApi: ApiRow[] }) {
  return (
    <details className="rounded-lg border border-x-border bg-x-surface">
      <summary className="cursor-pointer px-5 py-3 text-ui font-medium text-x-secondary">상세 표 (API별)</summary>
      <div className="px-5 pb-5 pt-1">
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-2 font-normal">API</th>
              <th className="py-2 text-right font-normal">호출수</th>
              <th className="py-2 text-right font-normal">토큰(입/출)</th>
              <th className="py-2 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byApi.map((a) => (
              <tr key={a.api} className="border-b border-x-border">
                <td className="py-2.5 text-x-text">{a.label}</td>
                <td className="py-2.5 text-right tabular-nums text-x-secondary">{a.calls.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums text-x-muted">{a.api === 'anthropic' ? `${a.inputTokens.toLocaleString()} / ${a.outputTokens.toLocaleString()}` : '—'}</td>
                <td className="py-2.5 text-right tabular-nums text-x-text">{formatMoney(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
