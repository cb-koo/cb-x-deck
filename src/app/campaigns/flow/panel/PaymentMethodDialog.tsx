'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MethodForm, usePaymentMethodSend } from '@/components/PaymentMethodForm';
import { methodDraftOf, newMethodIdOf, parseMethodDraft, type MethodDraft } from '@/lib/paymentMethodDraft';
import type { PaymentMethod } from '@/lib/influencerPayment';

// 작업 패널에서 결제 수단 새로 등록(설계 §8-3) — 인플 프로필의 폼(MethodForm)을 그대로 띄운다(폼을 새로 짓지 않는다).
// 저장은 기존 POST /api/influencers/[id]/payment-methods — 결과는 프로필에도 그대로 남는다(같은 데이터).
// 첫 수단이면 자동 기본(기존 규칙). 새 id는 응답 배열을 등록 전 id와 비교해 찾아 부모에 넘긴다.
// 이 창이 떠 있는 동안 패널의 Esc·바깥 클릭은 TaskPanel이 끈다(overlayOpen 관례, payDialog).
// body로 포털한다 — 패널(aside, fixed z-40)이 쌓임 맥락이라 안에 그리면 z-50이 페이지 기준으로 z-40에 묶이고,
// role="dialog"가 패널의 role="dialog" 안에 겹친다. FlowDetail의 다른 창(교체·취소·한 번에 만들기)과 같은 층에 뜬다.
// 창은 payDialog가 켜진 뒤에만 마운트되므로(클라이언트에서만) document가 늘 있다.
export function PaymentMethodDialog({ influencerId, handle, isFirst, beforeIds, onClose, onSaved }: {
  influencerId: string; handle: string; isFirst: boolean; beforeIds: string[];
  onClose: () => void;
  onSaved: (list: PaymentMethod[], newId: string | null) => void;
}) {
  const [draft, setDraft] = useState<MethodDraft>(() => ({ ...methodDraftOf(null), makeDefault: isFirst }));
  const [err, setErr] = useState<string | null>(null);
  const { busy, send } = usePaymentMethodSend(influencerId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    // 클라이언트 검증도 서버와 같은 함수 — 문구가 갈리지 않는다
    const parsed = parseMethodDraft(draft);
    if (typeof parsed === 'string') { setErr(parsed); return; }
    const r = await send('POST', { input: parsed, makeDefault: isFirst || draft.makeDefault });
    if (!r.ok) { if (r.error !== null) setErr(r.error); return; }
    onSaved(r.paymentMethods, newMethodIdOf(beforeIds, r.paymentMethods));
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="결제 수단 등록" className="w-full max-w-[560px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">@{handle} 결제 수단 등록</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        {/* 행동 전 기대(UX 원칙 2) — 여기서 등록한 수단이 어디에 남는지 한 줄 */}
        <p className="mt-1 text-ui text-x-secondary">인플 프로필에도 그대로 저장돼요</p>
        <div className="mt-3">
          <MethodForm draft={draft} setDraft={setDraft} isFirst={isFirst} showDefaultCheck
                      busy={busy} error={err} influencerId={influencerId}
                      onSubmit={() => void submit()} onCancel={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
