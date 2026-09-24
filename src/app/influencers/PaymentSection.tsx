'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { CURRENCY_SYMBOL } from '@/lib/influencerPricing';
import { PAYMENT_TYPE_LABEL, describeMethod, formatFee, type PaymentMethod } from '@/lib/influencerPayment';
import { holderLabel, methodDraftOf, parseMethodDraft, type MethodDraft } from '@/lib/paymentMethodDraft';
import { MethodForm, usePaymentMethodSend } from '@/components/PaymentMethodForm';
import { signPaymentQrUrl } from '@/lib/paymentQr';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PANEL, PANEL_TITLE, useErrorReport } from './profileShared';
import type { InfluencerLogRow } from '@/lib/influencerStore';

export function PaymentSection({ id, methods, onSaved, onErrorChange }: {
  id: string;
  methods: PaymentMethod[];
  onSaved: (paymentMethods: PaymentMethod[], newLogs: InfluencerLogRow[]) => void;
  onErrorChange?: (v: boolean) => void;   // 이 탭이 숨어 있을 때 저장 실패를 탭 라벨이 대신 알린다
}) {
  // 폼은 한 번에 하나 — 'add' 또는 수정 중인 수단 id. 카드 자리에서 펼쳐진다.
  const [editing, setEditing] = useState<'add' | { id: string } | null>(null);
  const [draft, setDraft] = useState<MethodDraft>(() => methodDraftOf(null));
  // 오류 슬롯 2개 — 폼 안(검증·저장 실패)과 목록 동작(기본으로·삭제)을 섞으면 어느 것이 실패했는지 흐려진다.
  const [formErr, setFormErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const { busy, send: sendRaw } = usePaymentMethodSend(id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);   // `${수단 id}:${필드}` — 한 카드에 복사 값이 둘일 수 있다
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  useErrorReport(formErr !== null || listErr !== null, onErrorChange);

  const isFirst = methods.length === 0;

  // 저장 요청 자체는 공용 훅(usePaymentMethodSend)이 한다 — 여기는 오류 칸 두 개(폼·목록)에 결과를 나눠 담는다.
  // 응답은 배열 전체 스냅샷이라 그대로 교체한다(스펙 §2) — 서버가 행 잠금으로 직렬화하므로 병합이 필요 없다.
  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, setErr: (v: string | null) => void): Promise<boolean> {
    const r = await sendRaw(method, body);
    if (!r.ok) { if (r.error !== null) setErr(r.error); return false; }
    setErr(null); setFormErr(null); setListErr(null);
    onSaved(r.paymentMethods, r.logs);
    return true;
  }

  function openAdd() {
    setDraft({ ...methodDraftOf(null), makeDefault: methods.length === 0 });
    setFormErr(null);
    setConfirmId(null);
    setEditing('add');
  }

  function openEdit(m: PaymentMethod) {
    setDraft(methodDraftOf(m));
    setFormErr(null);
    setConfirmId(null);
    setEditing({ id: m.id });
  }

  async function submit(target: 'add' | { id: string }) {
    // 클라이언트 검증도 서버와 같은 함수로 — 문구가 갈리지 않는다(스펙 §3 "클라이언트 먼저, 서버 동일 규칙").
    const parsed = parseMethodDraft(draft);
    if (typeof parsed === 'string') { setFormErr(parsed); return; }
    const ok = target === 'add'
      ? await send('POST', { input: parsed, makeDefault: isFirst || draft.makeDefault }, setFormErr)
      : await send('PATCH', { id: target.id, input: parsed }, setFormErr);
    if (ok) setEditing(null);
  }

  function copy(m: PaymentMethod, field: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(`${m.id}:${field}`);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 1500);
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
                          busy={busy} error={formErr} influencerId={id}
                          onSubmit={() => submit({ id: m.id })} onCancel={() => { setEditing(null); setFormErr(null); }} />
            ) : (
              <MethodCard m={m} busy={busy} copiedKey={copiedKey} confirming={confirmId === m.id}
                          fallbackLabel={m.isDefault ? (() => { const next = methods.find((o) => o.id !== m.id); return next ? describeMethod(next) : null; })() : null}
                          onCopy={(field, v) => copy(m, field, v)}
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
                        busy={busy} error={formErr} influencerId={id}
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

// 카드는 폼과 같은 라벨의 "항목: 값" 목록 — 저장 전(폼)과 저장 후(카드)가 같은 이름으로 읽혀야 한다(피드백:
// 값만 나열하면 무엇이 무엇인지 안 보인다). 복사는 정산 양식에 그대로 붙이는 값(이메일·아이디·계좌번호)에만.
function MethodCard({ m, busy, copiedKey, confirming, fallbackLabel, onCopy, onSetDefault, onEdit, onAskDelete, onCancelDelete, onDelete }: {
  m: PaymentMethod; busy: boolean; copiedKey: string | null; confirming: boolean;
  fallbackLabel: string | null;   // 이 수단이 기본이고 뒤를 이을 수단이 있으면 그 이름 — 확인 단계 안내에 쓴다
  onCopy: (field: string, value: string) => void;
  onSetDefault: () => void; onEdit: () => void;
  onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void;
}) {
  const label = describeMethod(m);
  const fee = formatFee(m.fee, m.currency);

  type Row = { key: string; label: string; value: ReactNode; copy?: string; muted?: boolean; qrPath?: string };
  const rows: Row[] = [{ key: 'holder', label: holderLabel(m.type), value: m.holder }];
  rows.push({ key: 'currency', label: '지급 통화', value: `${CURRENCY_SYMBOL[m.currency]} ${m.currency === 'JPY' ? '엔화' : '원화'}` });
  if (m.type === 'paypal') {
    if (m.email) rows.push({ key: 'email', label: '이메일', value: m.email, copy: m.email });
    if (m.paypalId) rows.push({ key: 'paypalId', label: 'PayPal.me', value: `paypal.me/${m.paypalId}`, copy: m.paypalId });
  } else if (m.type === 'paypay') {
    rows.push(m.identifier
      ? { key: 'identifier', label: '수취 식별 정보', value: m.identifier, copy: m.identifier }
      : { key: 'identifier', label: '수취 식별 정보', value: '미입력 — 정산 쪽에서 확인되면 적어 두세요', muted: true });
    // QR은 있을 때만 행을 만든다 — 둘 다 선택이라 둘 다 "미입력"이 뜨면 잔소리가 된다(스펙 §2)
    if (m.qr) rows.push({ key: 'qr', label: 'QR 이미지', value: null, qrPath: m.qr });
  } else {
    rows.push({ key: 'bank', label: '은행', value: [m.bank, m.branch].filter(Boolean).join(' · ') });
    if (m.account) rows.push({ key: 'account', label: '계좌번호', value: m.account, copy: m.account });
  }
  // 수수료는 '인플 부담'도 적는다 — 비어 있으면 "안 정했나?"로 읽힌다(라벨-값 일치)
  rows.push({ key: 'fee', label: '송금 수수료', value: fee ? fee.replace(/^송금 수수료 /, '') : '인플 부담' });
  if (m.memo) rows.push({ key: 'memo', label: '메모', value: m.memo });

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ui font-semibold">{PAYMENT_TYPE_LABEL[m.type]}</span>
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

      {/* 라벨 열은 폼 라벨과 같은 회색·같은 순서. 값 열은 본문색 — 훑을 때 값만 튀어 보이게 */}
      <dl className="mt-2 grid max-w-2xl grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui">
        {rows.map((r) => (
          <Fragment key={r.key}>
            <dt className="whitespace-nowrap text-x-muted">{r.label}</dt>
            <dd className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${r.muted ? 'text-x-muted' : ''}`}>
              {r.qrPath ? <QrPreviewCell key={r.qrPath} path={r.qrPath} /> : <span className="min-w-0 break-all">{r.value}</span>}
              {r.copy && (
                <button onClick={() => onCopy(r.key, r.copy!)} aria-label={`${r.label} ${r.copy} 복사`}
                        className="shrink-0 rounded border border-x-border-strong bg-white px-1.5 py-0.5 text-caption text-x-secondary hover:bg-x-hover">
                  {copiedKey === `${m.id}:${r.key}` ? '복사됨' : '복사'}
                </button>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>

      {confirming && (
        <div className="mt-3 rounded-lg bg-white px-2.5 py-2">
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

// 카드 목록(표시 전용)에서 QR 행 하나를 그린다. 편집 폼(PaymentQrField)과 달리 부모가 값을
// 바꿀 일이 없어 훨씬 단순하다 — 마운트 시 한 번 서명해 작은 미리보기를 보여주고 눌러서 확대만 한다.
// 호출부가 key={path}로 그려 path가 바뀌면 새로 마운트된다 — 그래서 이펙트 안에서 이전 값을
// 지우는 setState가 필요 없다(react-hooks/set-state-in-effect 회피와도 맞아떨어진다).
function QrPreviewCell({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signPaymentQrUrl(path)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) return <span className="text-x-muted">미리보기를 불러오지 못했어요</span>;
  if (!url) return <span className="text-x-muted">불러오는 중…</span>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="QR 이미지" onClick={() => setZoom(true)}
           className="h-[72px] w-[72px] cursor-zoom-in rounded-md border border-x-border bg-white object-contain" />
      {zoom && <ImageLightbox urls={[url]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </>
  );
}
