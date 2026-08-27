'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { CURRENCY_LABEL, type Currency } from '@/lib/influencerPricing';
import {
  PAYMENT_TYPES, PAYMENT_TYPE_LABEL, describeMethod, formatFee, parsePaymentMethodInput,
  type PaymentMethod, type PaymentMethodType,
} from '@/lib/influencerPayment';
import { PANEL, PANEL_TITLE, errOf, useErrorReport } from './profileShared';
import type { InfluencerLogRow } from '@/lib/influencerStore';

// 통화 기호 — 목록 카드는 좁아서 '원/엔'(CURRENCY_LABEL)보다 기호가 읽기 쉽다. 폼 select는
// PricingSection과 같이 '기호 + 말'을 둘 다 보여준다(처음 보는 사람 기준).
const CURRENCY_SYMBOL: Record<Currency, string> = { KRW: '₩', JPY: '¥' };
const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];

// 수취인 칸의 이름은 유형에 따라 바뀐다 — 계좌이체에서 '수취인명'은 정산 담당이 쓰는 말이 아니다.
const holderLabel = (t: PaymentMethodType) => (t === 'bank' ? '예금주' : '수취인명');

// 카드 셋째 줄에 놓는 "그대로 붙여 쓰는 값" — 복사 버튼이 집어가는 값이기도 하다.
function identifyingValue(m: PaymentMethod): { field: string; value: string } | null {
  if (m.type === 'paypal') {
    // 이메일이 있으면 이메일, 없으면 PayPal.me 아이디 — 둘 중 정산 담당이 붙여 쓰는 값 하나
    if (m.email) return { field: '이메일', value: m.email };
    return m.paypalId ? { field: 'PayPal.me 아이디', value: `paypal.me/${m.paypalId}` } : null;
  }
  if (m.type === 'paypay') return m.identifier ? { field: '수취 식별 정보', value: m.identifier } : null;
  return m.account ? { field: '계좌번호', value: m.account } : null;
}

type FeeMode = 'none' | 'grossUp' | 'fixed';
const FEE_MODE_LABEL: Record<FeeMode, string> = {
  none: '없음',
  grossUp: '실수령 보장 — 수수료를 우리가 부담',
  fixed: '고정 금액 추가',
};

interface Draft {
  type: PaymentMethodType; holder: string; currency: Currency;
  email: string; paypalId: string; identifier: string;
  bank: string; branch: string; account: string;
  feeMode: FeeMode; feePercent: string; feeAmount: string;
  memo: string; makeDefault: boolean;
}

function draftOf(m: PaymentMethod | null): Draft {
  return {
    // 새 수단의 기본값: 유형은 목록 첫 번째, 통화는 ¥ — 이 통화는 '인플이 받는 돈의 통화(지급 통화)'라
    // 단가(₩ 기본, 캠페인 관리 기준)와 다른 질문이다. 실데이터 91건 중 84건이 엔화(koo 결정 08-27).
    type: m?.type ?? PAYMENT_TYPES[0],
    holder: m?.holder ?? '',
    currency: m?.currency ?? 'JPY',
    email: m?.email ?? '',
    paypalId: m?.paypalId ?? '',
    identifier: m?.identifier ?? '',
    bank: m?.bank ?? '',
    branch: m?.branch ?? '',
    account: m?.account ?? '',
    feeMode: m?.fee?.mode ?? 'none',
    feePercent: m?.fee?.mode === 'grossUp' ? String(m.fee.percent) : '5',
    feeAmount: m?.fee?.mode === 'fixed' ? String(m.fee.amount) : '',
    memo: m?.memo ?? '',
    makeDefault: false,
  };
}

// 빈 칸은 0이 아니라 "안 적음" — Number('')=0이면 수수료 금액을 비워도 0원으로 통과해 버린다.
function numOf(s: string): number {
  const t = s.replace(/[,\s]/g, '');
  return t === '' ? NaN : Number(t);
}

// 폼 값 → 라우트에 보낼 입력. 유형에 맞지 않는 칸도 그대로 실어 보내고, 버리는 일은 lib의
// parsePaymentMethodInput이 한다 — 클라이언트와 서버가 같은 한 벌 규칙을 쓴다(문구도 같아진다).
function inputOf(d: Draft): unknown {
  const fee = d.feeMode === 'grossUp' ? { mode: 'grossUp', percent: numOf(d.feePercent) }
    : d.feeMode === 'fixed' ? { mode: 'fixed', amount: numOf(d.feeAmount) }
      : undefined;
  return {
    type: d.type, holder: d.holder, currency: d.currency,
    email: d.email, paypalId: d.paypalId, identifier: d.identifier,
    bank: d.bank, branch: d.branch, account: d.account,
    fee, memo: d.memo,
  };
}

const FIELD = 'w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue';
const FIELD_LABEL = 'block text-caption text-x-secondary';

export function PaymentSection({ id, methods, onSaved, onErrorChange }: {
  id: string;
  methods: PaymentMethod[];
  onSaved: (paymentMethods: PaymentMethod[], newLogs: InfluencerLogRow[]) => void;
  onErrorChange?: (v: boolean) => void;   // 이 탭이 숨어 있을 때 저장 실패를 탭 라벨이 대신 알린다
}) {
  // 폼은 한 번에 하나 — 'add' 또는 수정 중인 수단 id. 카드 자리에서 펼쳐진다.
  const [editing, setEditing] = useState<'add' | { id: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(null));
  // 오류 슬롯 2개 — 폼 안(검증·저장 실패)과 목록 동작(기본으로·삭제)을 섞으면 어느 것이 실패했는지 흐려진다.
  const [formErr, setFormErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  useErrorReport(formErr !== null || listErr !== null, onErrorChange);

  const isFirst = methods.length === 0;

  async function send(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    setErr: (v: string | null) => void,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/influencers/${id}/payment-methods`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      const b = (await r.json()) as { paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] };
      // 응답은 배열 전체 스냅샷이라 그대로 교체한다(스펙 §2) — 서버가 행 잠금으로 직렬화하므로 병합이 필요 없다.
      setErr(null);
      setFormErr(null);
      setListErr(null);
      onSaved(b.paymentMethods, b.logs);
      return true;
    } catch {
      setErr('결제 수단을 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    setDraft({ ...draftOf(null), makeDefault: methods.length === 0 });
    setFormErr(null);
    setConfirmId(null);
    setEditing('add');
  }

  function openEdit(m: PaymentMethod) {
    setDraft(draftOf(m));
    setFormErr(null);
    setConfirmId(null);
    setEditing({ id: m.id });
  }

  async function submit(target: 'add' | { id: string }) {
    // 클라이언트 검증도 서버와 같은 함수로 — 문구가 갈리지 않는다(스펙 §3 "클라이언트 먼저, 서버 동일 규칙").
    const parsed = parsePaymentMethodInput(inputOf(draft));
    if (typeof parsed === 'string') { setFormErr(parsed); return; }
    const ok = target === 'add'
      ? await send('POST', { input: parsed, makeDefault: isFirst || draft.makeDefault }, setFormErr)
      : await send('PATCH', { id: target.id, input: parsed }, setFormErr);
    if (ok) setEditing(null);
  }

  function copy(m: PaymentMethod, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedId(m.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => { /* 클립보드 거부 — 값이 화면에 그대로 있으니 손으로 복사할 수 있다 */ });
  }

  return (
    <section className={PANEL}>
      <h2 className={PANEL_TITLE}>정산 결제 수단</h2>
      <p className="mt-0.5 text-caption leading-relaxed text-x-muted">
        협업 비용을 보낼 곳이에요. 기본 수단으로 결제 요청이 만들어지고, 바꾸면 계정 정보 탭 기록에 남아요.
      </p>
      {listErr && <p role="alert" className="mt-2 text-ui text-red-600">{listErr}</p>}

      {methods.length === 0 && editing !== 'add' && (
        <div className="mt-3 rounded-xl bg-x-surface px-4 py-5 text-center">
          <p className="text-ui text-x-secondary">등록된 결제 수단이 없어요 — 추가하면 정산 요청에 자동으로 들어가요</p>
          <Button variant="subtle" className="mt-2 bg-white" onClick={openAdd}>+ 결제 수단 추가</Button>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {methods.map((m) => (
          <li key={m.id}>
            {typeof editing === 'object' && editing?.id === m.id ? (
              <MethodForm draft={draft} setDraft={setDraft} isFirst={false} showDefaultCheck={false}
                          busy={busy} error={formErr}
                          onSubmit={() => submit({ id: m.id })} onCancel={() => { setEditing(null); setFormErr(null); }} />
            ) : (
              <MethodCard m={m} busy={busy} copied={copiedId === m.id} confirming={confirmId === m.id}
                          fallbackLabel={m.isDefault ? (() => { const next = methods.find((o) => o.id !== m.id); return next ? describeMethod(next) : null; })() : null}
                          onCopy={(v) => copy(m, v)}
                          onSetDefault={() => send('PATCH', { id: m.id, setDefault: true }, setListErr)}
                          onEdit={() => openEdit(m)}
                          onAskDelete={() => { setListErr(null); setConfirmId(m.id); }}
                          onCancelDelete={() => setConfirmId(null)}
                          onDelete={async () => { if (await send('DELETE', { id: m.id }, setListErr)) setConfirmId(null); }} />
            )}
          </li>
        ))}
        {editing === 'add' && (
          <li>
            <MethodForm draft={draft} setDraft={setDraft} isFirst={isFirst} showDefaultCheck
                        busy={busy} error={formErr}
                        onSubmit={() => submit('add')} onCancel={() => { setEditing(null); setFormErr(null); }} />
          </li>
        )}
      </ul>

      {/* 폼이 열려 있는 동안엔 추가 버튼을 두지 않는다 — 눌러도 지금 쓰던 폼이 사라질 뿐이다(거짓 어포던스 회피) */}
      {methods.length > 0 && editing === null && (
        <Button variant="subtle" className="mt-2" onClick={openAdd}>+ 결제 수단 추가</Button>
      )}
    </section>
  );
}

function MethodCard({ m, busy, copied, confirming, fallbackLabel, onCopy, onSetDefault, onEdit, onAskDelete, onCancelDelete, onDelete }: {
  m: PaymentMethod; busy: boolean; copied: boolean; confirming: boolean;
  fallbackLabel: string | null;   // 이 수단이 기본이고 뒤를 이을 수단이 있으면 그 이름 — 확인 단계 안내에 쓴다
  onCopy: (value: string) => void;
  onSetDefault: () => void; onEdit: () => void;
  onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void;
}) {
  const label = describeMethod(m);
  const ident = identifyingValue(m);
  const fee = formatFee(m.fee, m.currency);
  const bankLine = [m.bank, m.branch, m.account].filter(Boolean).join(' / ');

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ui font-medium">{PAYMENT_TYPE_LABEL[m.type]}</span>
        {/* 배지는 서버 isDefault에서만 나온다 — 기본 카드에는 '기본으로' 버튼을 두지 않는다(누를 데가 없는 버튼 회피) */}
        {m.isDefault && <span className="rounded-full bg-x-blue px-2 py-0.5 text-caption font-medium text-white">기본</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!m.isDefault && (
            <button onClick={onSetDefault} disabled={busy} aria-label={`${label} 기본으로 지정`}
                    className="rounded px-1.5 py-1 text-caption text-x-secondary hover:bg-white disabled:opacity-50">기본으로</button>
          )}
          <button onClick={onEdit} disabled={busy} aria-label={`${label} 수정`}
                  className="rounded px-1.5 py-1 text-caption text-x-secondary hover:bg-white disabled:opacity-50">수정</button>
          {!confirming && (
            <button onClick={onAskDelete} disabled={busy} aria-label={`${label} 삭제`}
                    className="rounded px-1.5 py-1 text-caption text-x-secondary hover:bg-white disabled:opacity-50">삭제</button>
          )}
        </span>
      </div>

      <p className="mt-1 text-ui text-x-secondary">
        {holderLabel(m.type)} <span className="text-x-text">{m.holder}</span>
        <span className="text-x-muted"> · {CURRENCY_SYMBOL[m.currency]}</span>
      </p>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {m.type === 'bank' && <span className="text-ui">{bankLine}</span>}
        {m.type !== 'bank' && ident && <span className="min-w-0 break-all text-ui">{ident.value}</span>}
        {m.type === 'paypay' && !ident && (
          <span className="text-ui text-x-muted">수취 정보 미입력 — PayPay 식별자는 정산 쪽 확인 후 적어 두세요</span>
        )}
        {ident && (
          <button onClick={() => onCopy(ident.value)} aria-label={`${ident.field} ${ident.value} 복사`}
                  className="shrink-0 rounded border border-x-border-strong bg-white px-1.5 py-0.5 text-caption text-x-secondary hover:bg-x-hover">
            {copied ? '복사됨' : '복사'}
          </button>
        )}
      </div>

      {(fee || m.memo) && (
        <p className="mt-0.5 text-caption text-x-secondary">
          {[fee, m.memo].filter(Boolean).join(' · ')}
        </p>
      )}

      {confirming && (
        <div className="mt-2 rounded-lg bg-white px-2.5 py-2">
          <p className="text-ui text-x-secondary">
            {`${label} — 지울까요?`}
            {fallbackLabel && <span className="text-x-muted">{` 기본 수단이라 지우면 다음 수단(${fallbackLabel})이 기본이 돼요.`}</span>}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button onClick={onDelete} disabled={busy} aria-label={`${label} 정말 삭제`}
                    className="rounded-full bg-red-600 px-3 py-1 text-ui font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? '삭제 중…' : '정말 삭제'}
            </button>
            <Button variant="subtle" onClick={onCancelDelete} disabled={busy}>취소</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MethodForm({ draft, setDraft, isFirst, showDefaultCheck, busy, error, onSubmit, onCancel }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void;
  isFirst: boolean;            // 명부에 수단이 하나도 없는 상태 — 첫 수단은 무조건 기본이 된다
  showDefaultCheck: boolean;   // 추가 폼에만. 수정은 기본 지정을 카드의 '기본으로'가 맡는다
  busy: boolean; error: string | null;
  onSubmit: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
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
            <label className={FIELD_LABEL} htmlFor={`${uid}-identifier`}>수취 식별 정보 (선택)</label>
            <input id={`${uid}-identifier`} value={draft.identifier} disabled={busy}
                   onChange={(e) => set('identifier', e.target.value)} className={FIELD} />
            <p className="mt-0.5 text-caption text-x-muted">
              PayPay는 아직 무엇으로 받는지 확정되지 않았어요 — 정산 쪽에서 확인되면 그대로 적어 두세요.
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
          <label className={FIELD_LABEL} htmlFor={`${uid}-fee`}>송금 수수료 처리</label>
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
            <label className={FIELD_LABEL} htmlFor={`${uid}-percent`}>수수료 비율 (%)</label>
            <input id={`${uid}-percent`} value={draft.feePercent} disabled={busy} inputMode="decimal"
                   onChange={(e) => set('feePercent', e.target.value)} className={`${FIELD} text-right`} />
          </div>
        )}
        {draft.feeMode === 'fixed' && (
          <div className={CELL}>
            <label className={FIELD_LABEL} htmlFor={`${uid}-amount`}>추가 금액 ({CURRENCY_LABEL[currency]})</label>
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
