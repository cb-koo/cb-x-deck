'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PaymentView } from '@/lib/paymentView';
import type { PaymentChoice } from '@/lib/paymentChoice';
import { resolvePaymentChoice, choiceToStored, canChoosePayment } from '@/lib/paymentChoice';

// '결제 수단' 한 줄(설계 §8-1~3·§10) — 평소엔 수단 + 수수료 칩만. 막힘·주의만 짧게. 우리가 수수료를 내는 쪽은 비용이 늘어나 주황.
// 수단이 몇 개든 같은 한 줄(koo 09-25): [수단 이름 · 수수료 칩 · 오른쪽 보조 버튼]. 버튼만 다르다 — 2개 이상이면 [바꾸기]
// (펼치면 목록, 맨 아래 '+ 새 결제 수단 등록'), 1개면 [다른 수단 등록], 없으면 '결제 수단 없음' + [+ 등록].
// 이름은 자르지 않는다 — 길면 줄바꿈되고 칩·버튼은 오른쪽에 붙어 있다.
// 이 작업의 수단은 resolvePaymentChoice(= 정산 후보와 같은 taskPaymentMethod) 하나로 정한다 — 조회가 판정한 view.label이 아니라
// 지금 들고 있는 chosenId로 다시 고른다(고른 직후 캐시된 옛 보기여도 고른 수단이 보인다, 새 작업은 서버가 선택을 모른다).
// 고를 수 있는지는 canChoosePayment 하나 — 소제목 옆 '· 이 작업에만 적용'(TaskPanel)과 같은 판정이다.
const chipCls = (cb: boolean) => `shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui ${cb ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-x-border bg-x-surface text-x-secondary'}`;
const actCls = 'shrink-0 whitespace-nowrap text-ui text-x-secondary hover:underline';

function Line({ label, chip, children }: { label: string; chip: { text: string; cb: boolean }; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="min-w-0 flex-1 break-all text-content leading-snug">{label}</span>
      <span className={chipCls(chip.cb)}>{chip.text}</span>
      {children}
    </div>
  );
}

export function PaymentLine({ view, loading, failed, chosenId = null, onChoose, onRegister }: {
  view: PaymentView | null; loading: boolean; failed: boolean;
  chosenId?: string | null;                        // 작업이 고른 수단(null = 기본)
  onChoose?: (stored: string | null) => void;      // 저장할 값(기본을 고르면 null). 없으면 고를 수 없는 자리
  onRegister?: () => void;                         // 새 수단 등록 창 열기(§8-3). 없으면 등록 입구를 그리지 않는다
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 목록 밖을 누르면 닫는다 — 패널 안쪽이라 패널은 안 닫힌다. setState는 이벤트 핸들러 안에서만.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (loading) return <p className="text-content text-x-muted">불러오는 중…</p>;
  if (failed || !view) return <p className="text-content text-x-muted">결제 수단을 불러오지 못했어요</p>;
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
        <div className="space-y-1">
          {/* 정산 프로덕트가 지급 완료를 보낸 건(단계 완료)은 '요청됨'이 아니라 '지급 완료' — 취소할 요청도 더는 없다 */}
          {view.paid
            ? <span title="이 수단으로 지급이 끝났어요" aria-label="이 수단으로 지급이 끝났어요" className="cursor-help text-ui text-x-secondary">🔒 지급 완료 ⓘ</span>
            : <span title="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" aria-label="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" className="cursor-help text-ui text-x-secondary">🔒 정산 요청됨 ⓘ</span>}
          <Line label={view.label} chip={view.fee} />
        </div>
      );
    case 'ok': {
      const { choice, fallback } = resolvePaymentChoice(view.choices, chosenId);
      const shown = choice ?? { id: '', label: view.label, fee: view.fee, isDefault: true };
      // 고른 수단이 프로필에서 지워짐 → 기본으로 정산된다(§8-2). 짧게 + ⓘ(§10)
      const fb = fallback && (
        <p title="고른 수단이 삭제돼 기본 수단으로 정산돼요" aria-label="고른 수단이 삭제돼 기본 수단으로 정산돼요"
           className="mt-1 cursor-help text-ui text-amber-700">기본 수단으로 바뀜 ⓘ</p>
      );
      if (canChoosePayment(view) && onChoose) {
        const pick = (c: PaymentChoice) => {
          setOpen(false);
          if (c.id !== shown.id) onChoose(choiceToStored(view.choices, c.id));
        };
        return (
          <div ref={boxRef}>
            <Line label={shown.label} chip={shown.fee}>
              <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((v) => !v)} className={actCls}>
                {open ? '닫기' : '바꾸기'}
              </button>
            </Line>
            {fb}
            {open && (
              <div className="mt-2 overflow-hidden rounded-lg border border-x-border-strong bg-white shadow-md"
                   onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
                <ul role="listbox" aria-label="이 작업의 결제 수단">
                  {view.choices.map((c) => {
                    const on = c.id === shown.id;
                    return (
                      <li key={c.id} role="option" aria-selected={on}>
                        <button type="button" onClick={() => pick(c)}
                                className={`flex min-h-11 w-full items-start gap-2.5 border-b border-x-border px-3 py-2.5 text-left hover:bg-x-hover ${on ? 'bg-[#f0f8fe]' : ''}`}>
                          <span aria-hidden className="w-4 shrink-0 font-bold text-x-blue-text">{on ? '✓' : ''}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-all text-content leading-snug">
                              {c.label}
                              {c.isDefault && <span className="ml-1.5 rounded bg-x-hover px-1.5 py-px align-[1px] text-ui text-x-secondary">기본</span>}
                            </span>
                            <span className={`mt-0.5 block text-ui ${c.fee.cb ? 'text-amber-700' : 'text-x-secondary'}`}>{c.fee.text}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {onRegister && (
                  <button type="button" onClick={() => { setOpen(false); onRegister(); }}
                          className="w-full px-3 py-2.5 text-left text-ui font-semibold text-x-blue-text hover:bg-x-hover">+ 새 결제 수단 등록</button>
                )}
              </div>
            )}
          </div>
        );
      }
      return (
        <div>
          {/* 패널의 다른 보조 동작([바꾸기]·[해제])과 같은 모양 — 회색 글자, 줄 오른쪽 끝(koo 09-25) */}
          <Line label={shown.label} chip={shown.fee}>
            {onRegister && <button type="button" onClick={onRegister} className={actCls}>다른 수단 등록</button>}
          </Line>
          {fb}
        </div>
      );
    }
  }
}
