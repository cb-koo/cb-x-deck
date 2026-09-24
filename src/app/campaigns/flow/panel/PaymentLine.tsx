import type { PaymentView } from '@/lib/paymentView';
import { resolvePaymentChoice, choiceToStored, canChoosePayment } from '@/lib/paymentChoice';

// '결제 수단' 한 줄(설계 §8-1~3·§10) — 평소엔 수단 + 수수료 칩만. 막힘·주의만 짧게. CB 부담은 비용이 늘어나는 쪽이라 주황.
// 수단 2개 이상이면 드롭다운(이 작업만, 맨 아래 '+ 새 결제 수단 등록'), 1개면 글자 + 오른쪽 '다른 수단 등록', 없으면 '결제 수단 없음' + [+ 등록].
// 이 작업의 수단은 resolvePaymentChoice(= 정산 후보와 같은 taskPaymentMethod) 하나로 정한다 — 조회가 판정한 view.label이 아니라
// 지금 들고 있는 chosenId로 다시 고른다(고른 직후 캐시된 옛 보기여도 고른 수단이 보인다, 새 작업은 서버가 선택을 모른다).
// 고를 수 있는지는 canChoosePayment 하나 — 소제목 옆 '· 이 작업에만 적용'(TaskPanel)과 같은 판정이다.
const NEW = '__new__';

export function PaymentLine({ view, loading, failed, chosenId = null, onChoose, onRegister }: {
  view: PaymentView | null; loading: boolean; failed: boolean;
  chosenId?: string | null;                        // 작업이 고른 수단(null = 기본)
  onChoose?: (stored: string | null) => void;      // 저장할 값(기본을 고르면 null). 없으면 고를 수 없는 자리
  onRegister?: () => void;                         // 새 수단 등록 창 열기(§8-3). 없으면 등록 입구를 그리지 않는다
}) {
  if (loading) return <p className="text-content text-x-muted">불러오는 중…</p>;
  if (failed || !view) return <p className="text-content text-x-muted">결제 수단을 불러오지 못했어요</p>;
  const chipCls = (cb: boolean) => `whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui ${cb ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-x-border bg-x-surface text-x-secondary'}`;
  switch (view.state) {
    case 'notInRoster': return <p className="text-content text-x-muted">명부에 등록하면 보여요</p>;
    case 'none':
      return (
        <div className="flex items-center gap-3">
          <p className="text-content text-amber-700">결제 수단 없음</p>
          {onRegister && (
            <button type="button" onClick={onRegister}
                    className="rounded-lg border border-x-border-strong px-3 py-1.5 text-ui font-semibold hover:bg-x-hover">+ 등록</button>
          )}
        </div>
      );
    case 'requested':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {/* 정산 프로덕트가 지급 완료를 보낸 건(단계 완료)은 '요청됨'이 아니라 '지급 완료' — 취소할 요청도 더는 없다 */}
          {view.paid
            ? <span title="이 수단으로 지급이 끝났어요" aria-label="이 수단으로 지급이 끝났어요" className="cursor-help text-ui text-x-secondary">🔒 지급 완료 ⓘ</span>
            : <span title="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" aria-label="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" className="cursor-help text-ui text-x-secondary">🔒 정산 요청됨 ⓘ</span>}
          <span className="min-w-0 truncate text-content" title={view.label}>{view.label}</span>
          <span className={chipCls(view.fee.cb)}>{view.fee.text}</span>
        </div>
      );
    case 'ok': {
      const { choice, fallback } = resolvePaymentChoice(view.choices, chosenId);
      const shown = choice ?? { id: '', label: view.label, fee: view.fee, isDefault: true };
      // 고른 수단이 프로필에서 지워짐 → 기본으로 정산된다(§8-2). 짧게 + ⓘ(§10)
      const fb = fallback && (
        <span title="고른 수단이 삭제돼 기본 수단으로 정산돼요" aria-label="고른 수단이 삭제돼 기본 수단으로 정산돼요"
              className="cursor-help text-ui text-amber-700">기본 수단으로 바뀜 ⓘ</span>
      );
      if (canChoosePayment(view) && onChoose) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            {/* 제어 컴포넌트라 '+ 새 결제 수단 등록'을 골라도 값은 지금 수단에 남는다 — 등록 창만 연다 */}
            <select value={shown.id} aria-label="이 작업의 결제 수단"
                    onChange={(e) => {
                      if (e.target.value === NEW) { onRegister?.(); return; }
                      onChoose(choiceToStored(view.choices, e.target.value));
                    }}
                    className="h-10 min-w-0 flex-1 rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue">
              {view.choices.map((c) => (
                <option key={c.id} value={c.id}>{`${c.label}${c.isDefault ? ' · 기본' : ''} · ${c.fee.text}`}</option>
              ))}
              {onRegister && <option value={NEW}>+ 새 결제 수단 등록</option>}
            </select>
            <span className={chipCls(shown.fee.cb)}>{shown.fee.text}</span>
            {fb}
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-content" title={shown.label}>{shown.label}</span>
          <span className={chipCls(shown.fee.cb)}>{shown.fee.text}</span>
          {fb}
          {/* 패널의 다른 보조 동작([바꾸기]·[해제])과 같은 모양 — 회색 글자, 줄 오른쪽 끝(koo 09-25) */}
          {onRegister && <button type="button" onClick={onRegister} className="ml-auto shrink-0 text-ui text-x-secondary hover:underline">다른 수단 등록</button>}
        </div>
      );
    }
  }
}
