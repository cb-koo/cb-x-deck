'use client';
import { useCallback, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { errOf } from '@/lib/responseError';
import { Button } from '@/components/ui';
import { CURRENCY_LABEL, CURRENCY_SYMBOL, type Currency } from '@/lib/influencerPricing';
import { PAYMENT_TYPES, PAYMENT_TYPE_LABEL, type PaymentMethod, type PaymentMethodType } from '@/lib/influencerPayment';
import { FEE_MODE_LABEL, holderLabel, type FeeMode, type MethodDraft } from '@/lib/paymentMethodDraft';
import type { InfluencerLogRow } from '@/lib/influencerStore';
import { PaymentQrField } from '@/components/PaymentQrField';

// 결제 수단 입력 폼 — 인플 프로필(PaymentSection)과 작업 패널 등록 창(PaymentMethodDialog)이 같은 것을 쓴다(설계 §8-3).
// 폼 모양·문구는 프로필에 있던 그대로다(이동만). 저장은 기존 /api/influencers/[id]/payment-methods 하나.

const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];
const FIELD = 'w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue';
const FIELD_LABEL = 'block text-caption text-x-secondary';

export type PaymentSendResult =
  | { ok: true; paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] }
  | { ok: false; error: string | null };   // null = 이미 보내는 중이라 이번 요청은 무시했다(오류 칸을 바꾸지 않는다)

// 저장 요청 — 응답은 언제나 배열 전체 스냅샷(서버가 행 잠금으로 직렬화한다)이라 호출부는 그대로 교체한다.
// busy는 state(화면용)와 ref(연타 차단용)를 같이 둔다 — state만 보면 같은 틱의 두 번째 클릭이 옛 값을 본다.
export function usePaymentMethodSend(influencerId: string) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const send = useCallback(async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<PaymentSendResult> => {
    if (inFlight.current) return { ok: false, error: null };
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/influencers/${influencerId}/payment-methods`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, error: await errOf(r) };
      const b = (await r.json()) as { paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] };
      return { ok: true, paymentMethods: b.paymentMethods, logs: b.logs };
    } catch {
      return { ok: false, error: '결제 수단을 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [influencerId]);
  return { busy, send };
}

export function MethodForm({ draft, setDraft, isFirst, showDefaultCheck, busy, error, influencerId, onSubmit, onCancel }: {
  draft: MethodDraft; setDraft: (fn: (d: MethodDraft) => MethodDraft) => void;
  isFirst: boolean;            // 명부에 수단이 하나도 없는 상태 — 첫 수단은 무조건 기본이 된다
  showDefaultCheck: boolean;   // 추가 폼에만. 수정은 기본 지정을 카드의 '기본으로'가 맡는다
  busy: boolean; error: string | null;
  influencerId: string;        // paypay QR 업로드 경로에 쓴다
  onSubmit: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const set = <K extends keyof MethodDraft>(k: K, v: MethodDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  // PayPay는 통화를 고를 수 없다 — 화면 값도 서버 규칙(항상 JPY)에서 파생시켜 라벨과 값을 일치시킨다.
  const currency: Currency = draft.type === 'paypay' ? 'JPY' : draft.currency;

  // 2열 격자 한 벌로 — 칸마다 폭이 달라 들쭉날쭉하던 배열(피드백)을 같은 폭의 칸으로 맞춘다.
  // 폼 전체는 max-w-2xl: 넓은 화면에서 입력칸이 화면 끝까지 늘어나면 라벨과 값이 멀어져 읽기 어렵다.
  const CELL = 'min-w-0';
  const SPAN2 = 'min-w-0 sm:col-span-2';
  return (
    <div className="rounded-lg border border-x-border-strong bg-white px-4 py-3">
      {error && <p role="alert" className="mb-2 text-ui text-red-600">{error}</p>}

      <div className="grid max-w-2xl grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className={CELL}>
          <label className={FIELD_LABEL} htmlFor={`${uid}-type`}>결제 수단</label>
          <select id={`${uid}-type`} value={draft.type} disabled={busy}
                  onChange={(e) => set('type', e.target.value as PaymentMethodType)}
                  className={`${FIELD} bg-white`}>
            {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className={CELL}>
          <label className={FIELD_LABEL} htmlFor={`${uid}-currency`}>지급 통화</label>
          <select id={`${uid}-currency`} value={currency} disabled={busy || draft.type === 'paypay'}
                  onChange={(e) => set('currency', e.target.value as Currency)}
                  className={`${FIELD} bg-white disabled:bg-x-surface disabled:text-x-secondary`}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{`${CURRENCY_SYMBOL[c]} ${c === 'JPY' ? '엔화' : '원화'}`}</option>
            ))}
          </select>
          {/* 단가·캠페인은 원화 기준인데 여기만 ¥가 기본이라 "왜 다르지?"가 된다 — 환산 규칙까지 한 줄로(UX 원칙 2·5) */}
          <p className="mt-0.5 text-caption text-x-muted">
            {draft.type === 'paypay' ? 'PayPay는 엔화로만 보내요' : '인플이 받는 통화예요. 캠페인 비용은 원화로 관리하고, 정산 때 10원 = 1엔으로 환산해요.'}
          </p>
        </div>

        <div className={SPAN2}>
          <label className={FIELD_LABEL} htmlFor={`${uid}-holder`}>{holderLabel(draft.type)}</label>
          <input id={`${uid}-holder`} value={draft.holder} disabled={busy}
                 onChange={(e) => set('holder', e.target.value)} className={FIELD} />
        </div>

        {draft.type === 'paypal' && (
          <>
            <div className={CELL}>
              <label className={FIELD_LABEL} htmlFor={`${uid}-email`}>이메일</label>
              <input id={`${uid}-email`} value={draft.email} disabled={busy} inputMode="email"
                     onChange={(e) => set('email', e.target.value)} className={FIELD} />
            </div>
            <div className={CELL}>
              <label className={FIELD_LABEL} htmlFor={`${uid}-paypalId`}>PayPal.me 아이디</label>
              <input id={`${uid}-paypalId`} value={draft.paypalId} disabled={busy} placeholder="paypal.me/ 뒤의 아이디"
                     onChange={(e) => set('paypalId', e.target.value)} className={FIELD} />
              <p className="mt-0.5 text-caption text-x-muted">이메일과 아이디 중 하나만 있어도 보낼 수 있어요.</p>
            </div>
          </>
        )}

        {draft.type === 'paypay' && (
          <div className={SPAN2}>
            <p className={FIELD_LABEL}>받을 정보 <span className="text-x-muted font-normal">(둘 중 하나만 있어도 돼요)</span></p>
            <div className="mt-1 space-y-3 rounded-lg border border-x-border p-3">
              <div>
                <label className={FIELD_LABEL} htmlFor={`${uid}-identifier`}>수취 식별 정보</label>
                <input id={`${uid}-identifier`} value={draft.identifier} disabled={busy}
                       onChange={(e) => set('identifier', e.target.value)} className={FIELD} />
              </div>
              <div>
                <p className={FIELD_LABEL}>QR 이미지</p>
                <PaymentQrField influencerId={influencerId} value={draft.qr} disabled={busy}
                                onChange={(path) => set('qr', path)} />
              </div>
            </div>
            <p className="mt-0.5 text-caption text-x-muted">
              아직 못 받았으면 비워두셔도 돼요 — 정산 쪽에서 확인되면 그때 채우면 됩니다.
            </p>
          </div>
        )}

        {draft.type === 'bank' && (
          <>
            <div className={CELL}>
              <label className={FIELD_LABEL} htmlFor={`${uid}-bank`}>은행</label>
              <input id={`${uid}-bank`} value={draft.bank} disabled={busy}
                     onChange={(e) => set('bank', e.target.value)} className={FIELD} />
            </div>
            <div className={CELL}>
              <label className={FIELD_LABEL} htmlFor={`${uid}-branch`}>지점 (선택)</label>
              <input id={`${uid}-branch`} value={draft.branch} disabled={busy}
                     onChange={(e) => set('branch', e.target.value)} className={FIELD} />
            </div>
            <div className={SPAN2}>
              <label className={FIELD_LABEL} htmlFor={`${uid}-account`}>계좌번호</label>
              <input id={`${uid}-account`} value={draft.account} disabled={busy}
                     onChange={(e) => set('account', e.target.value)} className={FIELD} />
            </div>
          </>
        )}

        <div className={CELL}>
          <label className={FIELD_LABEL} htmlFor={`${uid}-fee`}>송금 수수료</label>
          <select id={`${uid}-fee`} value={draft.feeMode} disabled={busy}
                  onChange={(e) => set('feeMode', e.target.value as FeeMode)}
                  className={`${FIELD} bg-white`}>
            {(Object.keys(FEE_MODE_LABEL) as FeeMode[]).map((k) => (
              <option key={k} value={k}>{FEE_MODE_LABEL[k]}</option>
            ))}
          </select>
        </div>
        {/* 수수료 값 칸은 처리 방식이 있을 때만 — 없을 때는 옆 칸을 비워 격자 리듬을 지킨다 */}
        {draft.feeMode === 'grossUp' && (
          <div className={CELL}>
            <label className={FIELD_LABEL} htmlFor={`${uid}-percent`}>비율 (%)</label>
            <input id={`${uid}-percent`} value={draft.feePercent} disabled={busy} inputMode="decimal"
                   onChange={(e) => set('feePercent', e.target.value)} className={`${FIELD} text-right`} />
          </div>
        )}
        {draft.feeMode === 'fixed' && (
          <div className={CELL}>
            <label className={FIELD_LABEL} htmlFor={`${uid}-amount`}>고정액 ({CURRENCY_LABEL[currency]})</label>
            <input id={`${uid}-amount`} value={draft.feeAmount} disabled={busy} inputMode="numeric"
                   onChange={(e) => set('feeAmount', e.target.value)} className={`${FIELD} text-right`} />
          </div>
        )}
        {draft.feeMode === 'none' && <div className="hidden sm:block" aria-hidden />}

        <div className={SPAN2}>
          <label className={FIELD_LABEL} htmlFor={`${uid}-memo`}>메모 (선택)</label>
          <input id={`${uid}-memo`} value={draft.memo} disabled={busy} maxLength={200}
                 placeholder="예: 월말 정산 희망"
                 onChange={(e) => set('memo', e.target.value)} className={FIELD} />
        </div>
      </div>

      {showDefaultCheck && (
        <label className="mt-3 flex items-center gap-2 text-ui text-x-secondary">
          <input type="checkbox" checked={isFirst || draft.makeDefault} disabled={busy || isFirst}
                 onChange={(e) => set('makeDefault', e.target.checked)} />
          기본 수단으로
          {isFirst && <span className="text-caption text-x-muted">첫 수단은 기본이 돼요</span>}
        </label>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <Button variant="primary" onClick={onSubmit} disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>
        <Button variant="subtle" onClick={onCancel} disabled={busy}>취소</Button>
      </div>
    </div>
  );
}
