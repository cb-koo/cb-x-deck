import type { PaymentView } from '@/lib/paymentView';

// '결제 수단' 한 줄(설계 §8-1·§10) — 평소엔 수단 + 수수료 칩만. 막힘·주의만 짧게. CB 부담은 비용이 늘어나는 쪽이라 주황.
export function PaymentLine({ view, loading, failed }: { view: PaymentView | null; loading: boolean; failed: boolean }) {
  if (loading) return <p className="text-content text-x-muted">불러오는 중…</p>;
  if (failed || !view) return <p className="text-content text-x-muted">결제 수단을 불러오지 못했어요</p>;
  switch (view.state) {
    case 'notInRoster': return <p className="text-content text-x-muted">명부에 등록하면 보여요</p>;
    case 'none': return <p className="text-content text-amber-700">결제 수단 없음</p>;
    case 'ok':
    case 'requested':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {/* 정산 프로덕트가 지급 완료를 보낸 건(단계 완료)은 '요청됨'이 아니라 '지급 완료' — 취소할 요청도 더는 없다 */}
          {view.state === 'requested' && (view.paid
            ? <span title="이 수단으로 지급이 끝났어요" aria-label="이 수단으로 지급이 끝났어요" className="cursor-help text-ui text-x-secondary">🔒 지급 완료 ⓘ</span>
            : <span title="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" aria-label="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" className="cursor-help text-ui text-x-secondary">🔒 정산 요청됨 ⓘ</span>)}
          <span className="min-w-0 truncate text-content" title={view.label}>{view.label}</span>
          <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui ${view.fee.cb ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-x-border bg-x-surface text-x-secondary'}`}>
            {view.fee.text}
          </span>
        </div>
      );
  }
}
