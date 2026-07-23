import { formatMoney } from '@/lib/usagePricing';
import type { ProviderActual } from '@/lib/actualCost';

const API_LABEL: Record<string, string> = { getxapi: 'getxapi (X 데이터)', exa: 'Exa (웹 검색)', anthropic: 'Anthropic (AI)' };

function matchNote(actual: number, estimate: number): string {
  if (estimate === 0) return '추정 대비 판단 보류';
  const ratio = actual / estimate;
  if (ratio >= 0.8 && ratio <= 1.25) return '추정과 거의 일치 — 믿어도 돼요';
  return ratio > 1.25 ? '실제가 추정보다 큼 — 단가 점검 필요' : '실제가 추정보다 작음';
}

export function ActualCostPanel({ actuals, estimateByApi }: { actuals: ProviderActual[]; estimateByApi: Record<string, number> }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-bold text-x-text">실제 청구 대조</h2>
      <p className="mb-4 text-caption text-x-muted">우리 추정과 제공사 실제 청구를 대조합니다.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {actuals.map((a) => {
          const est = estimateByApi[a.api] ?? 0;
          return (
            <div key={a.api} className="rounded-lg border border-x-border bg-x-surface p-4">
              <p className="text-caption text-x-muted">{API_LABEL[a.api] ?? a.api}</p>
              {a.note && a.actualUsd === null ? (
                <>
                  <p className="mt-1 text-ui text-x-secondary">추정 {formatMoney(est)}</p>
                  <p className="mt-1 text-caption text-x-muted">{a.note}</p>
                </>
              ) : a.kind === 'period' ? (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums text-x-text">실제 {formatMoney(a.actualUsd ?? 0)}</p>
                  <p className="text-caption text-x-muted">추정 {formatMoney(est)} · {matchNote(a.actualUsd ?? 0, est)}</p>
                  {a.budgetUsd != null && (
                    <p className={`mt-1 text-caption ${a.overBudget ? 'text-red-500' : 'text-x-muted'}`}>
                      예산 {formatMoney(a.budgetUsd)} {a.overBudget ? '· 초과!' : '· 여유'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums text-x-text">누적 사용 {formatMoney(a.actualUsd ?? 0)}</p>
                  {a.balanceUsd != null && (
                    <p className={`text-caption ${a.balanceUsd < 5 ? 'text-red-500' : 'text-x-muted'}`}>
                      잔액 {formatMoney(a.balanceUsd)}{a.balanceUsd < 5 ? ' · 충전 필요' : ''}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-caption text-x-muted">getxapi는 계정 누적치, Exa는 선택 기간 실제 청구입니다. Anthropic 실청구는 콘솔에서 확인하세요.</p>
    </section>
  );
}
