'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow, RevisionEdits } from '@/lib/settlementStore';
import type { ReadinessIssue } from '@/lib/settlementCalc';
import { formatMoney } from '@/lib/influencerPricing';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { describeSnapshot, toMethodSnapshot, referenceRequiredFor } from '@/lib/settlementCalc';
import { visibleCategories } from '@/lib/settlementSettings';
import { fetchRevisionPreview, fetchSettlementSettings, reviseRequestApi } from '@/lib/settlementApi';
import { EXTERNAL_STATUS_LABEL, needsPartnerConfirm } from '@/lib/settlementDisplay';
import type { SettlementSettings } from '@/lib/settlementSettings';

// 제자리 수정 창(스펙 2026-09-07 §6) — "지금 값 → 고쳤을 때 값"을 나란히 보여주고, 분류·마감·참고 링크는 여기서 바로 고친다.
// 미리보기와 실제 반영은 서버의 같은 계산(resolveRevision)을 타므로 창에서 본 값이 그대로 반영된다.
const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui';

type PreviewData =
  | { state: 'ok'; after: { gross: number; net: number; fee: number; currency: 'KRW' | 'JPY'; grossKrw: number; method: string; issues: ReadinessIssue[] } }
  | { state: 'blocked'; error: string; issues: ReadinessIssue[] }
  | { state: 'error'; error: string };
type Preview = PreviewData | { state: 'loading' };
const editsKey = (e: RevisionEdits) => JSON.stringify(e);

export function ReviseDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: (row: PaymentRequestRow) => void; onClose: () => void }) {
  const [edits, setEdits] = useState<RevisionEdits>({ category: target.category, deadlineOn: target.deadlineOn, referenceUrl: target.referenceUrl });
  const [reason, setReason] = useState('');
  // 미리보기는 "어느 편집값에 대한 결과인지"(key)를 함께 들고 있다 — 편집값이 바뀌면 key가 달라져 자동으로 '계산 중'이 된다.
  // (이펙트 안에서 setState를 동기로 부르지 않기 위한 파생 상태 — react-hooks/set-state-in-effect)
  const [previewResult, setPreviewResult] = useState<{ key: string; data: PreviewData } | null>(null);
  const preview: Preview = previewResult && previewResult.key === editsKey(edits) ? previewResult.data : { state: 'loading' };
  const [settings, setSettings] = useState<SettlementSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 09-07 그쪽과 합의: 그쪽이 처리한 건(상태를 보내온 요청)은 송금 중일 수 있어, 슬랙으로 담당자 확인 후에만 반영한다. 체크 없이는 버튼이 살지 않는다.
  const confirmNeeded = needsPartnerConfirm(target);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => { void fetchSettlementSettings().then((r) => { if (r.ok) setSettings(r.data.settings); }); }, []);

  // 편집값이 바뀌면 미리보기를 다시 받는다 — 빠른 연타는 마지막 응답만 반영(순서 뒤바뀜 방지)
  const load = useCallback(async (e: RevisionEdits, alive: { on: boolean }) => {
    const key = editsKey(e);
    const r = await fetchRevisionPreview(target.id, e);
    if (!alive.on) return;
    if (!r.ok) { setPreviewResult({ key, data: { state: 'error', error: r.error } }); return; }
    const p = r.data;
    if (!p.ok) { setPreviewResult({ key, data: { state: 'blocked', error: p.error, issues: p.issues ?? [] } }); return; }
    const m = p.after.candidate.money!; const pm = p.after.candidate.method!;
    setPreviewResult({ key, data: { state: 'ok', after: { gross: m.amountGross, net: m.amountNet, fee: m.feeAmount, currency: m.payoutCurrency, grossKrw: m.payoutCurrency === 'KRW' ? m.amountGross : m.amountGross * m.rateKrwPerJpy, method: describeSnapshot(toMethodSnapshot(pm)), issues: p.after.issues } } });
  }, [target.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- setState는 fetch 응답 뒤 비동기 콜백에서만(RequestList·CampaignDetail 관례). 동기 setState 없음 — 로딩 표시는 key 파생값
  useEffect(() => { const alive = { on: true }; void load(edits, alive); return () => { alive.on = false; }; }, [edits, load]);

  async function go() {
    const rs = reason.trim();
    if (!rs) { setErr('수정 사유를 적어 주세요'); return; }
    if (rs.length > 200) { setErr('사유는 200자까지예요'); return; }
    setBusy(true); setErr('');
    const r = await reviseRequestApi(target.id, { expectedRevision: target.revision, reason: rs, edits, partnerConfirmed: confirmed });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone(r.data);
  }

  const cats = settings ? visibleCategories(settings) : [];
  const beforeMethod = describeSnapshot(target.paymentMethod);
  const changed = (a: string | number, b: string | number) => a !== b ? 'font-semibold text-x-text' : 'text-x-secondary';
  const canApply = preview.state === 'ok' && (!confirmNeeded || confirmed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="고친 값으로 다시 반영" className="w-full max-w-[640px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">고친 값으로 다시 반영할까요?</h2>
        <p className="mt-1 text-ui text-x-secondary">@{target.influencerHandle} · {target.clientName} · {target.campaignName}</p>
        <p className="mt-2 text-ui text-x-muted">프로필·캠페인에서 고친 값을 이 요청에 반영해요. 요청 번호와 정산 쪽 건 번호는 그대로이고, 정산 쪽에는 같은 건의 수정으로 전달돼 처음부터 다시 검토해요.</p>

        {/* 지금 값 → 고쳤을 때 값 */}
        <div className="mt-4 grid grid-cols-[88px_1fr_1fr] gap-x-4 gap-y-1.5 text-ui">
          <div className="text-x-muted" /><div className="text-x-muted">지금 ({target.revision + 1}판)</div><div className="text-x-muted">고치면 ({target.revision + 2}판)</div>
          <Row k="송금액" before={formatMoney(target.amountGross, target.payoutCurrency)} after={preview.state === 'ok' ? formatMoney(preview.after.gross, preview.after.currency) : null} cls={changed} />
          <Row k="수수료" before={target.feeAmount > 0 ? formatMoney(target.feeAmount, target.payoutCurrency) : '없음'} after={preview.state === 'ok' ? (preview.after.fee > 0 ? formatMoney(preview.after.fee, preview.after.currency) : '없음') : null} cls={changed} />
          <Row k="실지출(원)" before={formatMoney(target.grossKrw, 'KRW')} after={preview.state === 'ok' ? formatMoney(preview.after.grossKrw, 'KRW') : null} cls={changed} />
          <Row k="결제 수단" before={beforeMethod} after={preview.state === 'ok' ? preview.after.method : null} cls={changed} />
        </div>

        {/* 창 안에서 고치는 값 — 검토 대기 행과 같은 컨트롤·같은 🔴 표시 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui">
          <label className="flex items-center gap-1.5 text-x-secondary">분류
            <select className={`${FIELD} ${!edits.category ? 'border-red-400' : ''}`} value={edits.category} onChange={(e) => setEdits({ ...edits, category: e.target.value })}>
              {!cats.some((k) => k.sendAs === edits.category) && <option value={edits.category}>{edits.category}</option>}
              {cats.map((k) => <option key={k.id} value={k.sendAs}>{k.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-x-secondary">마감
            <input type="date" className={FIELD} value={edits.deadlineOn} onChange={(e) => setEdits({ ...edits, deadlineOn: e.target.value })} />
          </label>
          <label className="flex items-center gap-1.5 text-x-secondary min-w-0">참고
            <input type="url" className={`${FIELD} w-[260px] ${referenceRequiredFor(target.taskType) && !edits.referenceUrl ? 'border-red-400' : ''}`}
                   placeholder={referenceRequiredFor(target.taskType) ? '인플루언서 게시물 링크(필수)' : '게시물 링크(선택)'}
                   value={edits.referenceUrl ?? ''} onChange={(e) => setEdits({ ...edits, referenceUrl: e.target.value || null })} />
          </label>
        </div>

        {preview.state === 'loading' && <p className="mt-3 text-ui text-x-muted">다시 계산하는 중…</p>}
        {preview.state === 'blocked' && <p role="alert" className="mt-3 text-ui text-red-700">{preview.error}</p>}
        {preview.state === 'error' && <p role="alert" className="mt-3 text-ui text-red-700">{preview.error}</p>}
        {preview.state === 'ok' && preview.after.issues.length > 0 && (
          <p className="mt-3 text-ui text-amber-700">{preview.after.issues.map((i) => i.text).join(' · ')}</p>
        )}

        {/* 정산 쪽이 이 건의 수취 정보를 고친 뒤(056·057)라면, 이제 인플루언서 명부에도 같은 값이 반영돼 있다 — 다시 반영해도 고친 값이 유지된다(옛날처럼 되돌아가지 않는다). */}
        {target.paymentMethodCorrection && (
          <div className="mt-4 rounded-lg bg-x-surface p-3 text-ui text-x-secondary">
            <p>정산 쪽이 이 요청의 수취 정보를 고쳤어요({target.paymentMethodCorrection.byName}{target.paymentMethodCorrection.reason ? <> — {target.paymentMethodCorrection.reason}</> : null}). 인플루언서 명부에도 같은 값이 반영돼 있어, <b>다시 반영해도 고친 값이 그대로 유지돼요.</b></p>
          </div>
        )}
        {confirmNeeded && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-ui text-amber-800">
            <p>정산 쪽이 이미 처리한 요청이에요(지금 {target.externalStatus ? EXTERNAL_STATUS_LABEL[target.externalStatus] : ''}). 송금이 진행 중일 수 있으니 <b>슬랙으로 정산 담당자에게 먼저 확인</b>하고 반영해 주세요.</p>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              정산 담당자에게 확인했어요 — 고쳐도 된다고 했어요
            </label>
          </div>
        )}
        <label className="mt-4 block text-ui text-x-secondary">사유 <span className="text-red-600">필수</span>
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-ui" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="예: 수수료 CB 부담 5%로 재설정" />
        </label>
        <p className="mt-2 text-ui text-x-muted">고치기 전 내용은 이 요청의 개정 이력에 남아요. 지급 완료된 요청은 고칠 수 없어요.</p>
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>닫기</Button>
          <Button variant="primary" onClick={go} disabled={busy || !canApply}>{busy ? '반영하는 중…' : `${target.revision + 2}판으로 반영`}</Button>
        </div>
        <span className="sr-only">{PAYMENT_TYPE_LABEL[target.paymentMethod.type]}</span>
      </div>
    </div>
  );
}
function Row({ k, before, after, cls }: { k: string; before: string; after: string | null; cls: (a: string, b: string) => string }) {
  return (<>
    <div className="text-x-secondary">{k}</div>
    <div className="text-x-secondary">{before}</div>
    <div className={after === null ? 'text-x-muted' : cls(before, after)}>{after ?? '…'}</div>
  </>);
}
