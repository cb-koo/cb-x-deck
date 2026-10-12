'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { productFetch, useProductSave } from '@/lib/extensionProductClient';
import { createClientSheet, readClientSheetInputs, updateClientSheetInput } from '@/lib/reservationSheet';
import { applyDeadlineMode, type DeadlineMode } from '@/lib/reservationPolicy';
import type { ClinicDetail } from '@/lib/clinicStore';
import type { CampaignRow } from '@/lib/campaignStore';

// 방문 예약 창 — 목업(x-extension Registration)과 같은 두 단계 창이다. 두 곳에서 연다:
//  · 새 방문협찬 작업 폼의 [예약폼 작성] — '방문 예약 등록', 1단계부터. 1단계의 [닫기]는 작업을 '대기'로 만들고 닫는다
//    (양식만 보내 두고 응답을 기다리는 흐름 — 응답이 오면 표에서 그 카드를 눌러 2단계부터 잇는다).
//  · 예약이 없는 방문 작업 카드(existing) — '기존 방문 작업에 예약 추가', 2단계부터.
// 1 고객 양식: 클리닉의 일본어 예약 양식을 복사해 X에서 직접 보낸다(이 화면은 DM을 보내지 않는다).
// 2 예약 파싱: 고객 응답을 붙여 넣고 [예약 정보 파싱](AI) 또는 [수동 작성]으로 기재 시트를 만든 뒤 [파싱 결과 복사하기].
// 작업은 마지막 [파싱 결과 복사하기]에서야 만든다 — 폼의 예산·결제 수단·메모를 그대로 실은 작업을 먼저 만들고(createTask),
// 그 작업에 예약을 연결한다. 예약 저장만 실패하면 만든 작업을 기억해 두고 다시 누를 때 예약만 저장한다(작업이 두 번 생기지 않게).
// 창을 닫을 때 작업이 이미 만들어졌으면 그 작업을 연다(onDone) — 새 작업 폼이 그대로 남으면 [만들기]로 같은 작업이 또 생긴다.
type Detail = { id: string };
type Created = { id: string; version: number };
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const LABEL = 'text-ui text-x-secondary';
const CONTROL = 'w-full min-w-0 rounded-md border border-x-border-strong bg-white px-2.5 py-2 text-ui outline-none focus:border-x-blue disabled:bg-x-hover disabled:text-x-muted';
const NOTICE = 'rounded-md border border-sky-100 bg-sky-50 px-3 py-2.5 text-ui text-sky-800';
const DANGER = 'rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-ui text-red-700';
const errorText = (e: unknown) => e instanceof Error ? e.message : '요청을 완료하지 못했어요. 입력은 유지했으니 다시 시도해 주세요.';

// 업로드 기한을 사람이 시트에서 직접 바꿨으면 그 날짜를 지킨다(manual) — 아니면 방문 후 기본 기한(default)으로 맞춘다.
function deadlineModeOf(sheet: string): DeadlineMode {
  const current = readClientSheetInputs(sheet).uploadDeadline;
  const byDefault = applyDeadlineMode(sheet, 'default');
  if (!current || !byDefault.ok) return 'default';
  return readClientSheetInputs(byDefault.value).uploadDeadline === current ? 'default' : 'manual';
}

export function NewReservationDialog({ campaign, handle, personId, personName, existing = null, createTask, onDone, onClose }: {
  campaign: CampaignRow; handle: string;
  personId: string | null;          // 명부 id — 없으면 명부 밖 핸들이라 예약을 연결할 수 없다(서버 PERSON_REQUIRED)
  personName: string | null;
  existing?: { label: string } | null;         // 이미 있는 작업에 붙일 때 — 연결할 작업 칸에 보일 글자. 2단계부터 연다
  createTask: () => Promise<Created | null>;   // 새 작업: 폼 값으로 만든다 / 기존 작업: 그 작업 id·버전 — 실패 문구는 부르는 쪽이 띄운다
  onDone: (taskId: string, reserved: boolean) => void;   // reserved — 예약까지 저장했는지(false = 1단계 [닫기]로 작업만 '대기'로 만듦)
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(existing ? 2 : 1);
  const [clinic, setClinic] = useState<ClinicDetail | null>(null), [clinicErr, setClinicErr] = useState('');
  const [source, setSource] = useState(''), [sheet, setSheet] = useState('');
  const [busy, setBusy] = useState(false), [parsing, setParsing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [copyFailed, setCopyFailed] = useState(false), [formCopied, setFormCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [created, setCreated] = useState<Created | null>(null);
  const save = useProductSave();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await productFetch<{ items: { id: string; clientId: string }[] }>('clinics');
        const location = list.items.find((c) => c.clientId === campaign.clientId);
        if (!location) throw new Error('이 캠페인의 클리닉 정보를 찾을 수 없어요. 클라이언트 설정을 확인해 주세요.');
        const detail = await productFetch<ClinicDetail>(`clinics/${location.id}`);
        if (alive) setClinic(detail);
      } catch (e) { if (alive) setClinicErr(errorText(e)); }
    })();
    return () => { alive = false; };
  }, [campaign.clientId]);

  function requestClose() {
    if (busy) return;
    if (created && !existing) { onDone(created.id, false); return; }
    if ((source.trim() || sheet.trim()) && !window.confirm('작성 중인 예약 정보가 사라져요. 닫을까요?')) return;
    onClose();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const values: Record<string, string> = { handle, clinic: clinic?.name ?? '', branch: '본점', naver: clinic?.settings.naver ?? '', google: clinic?.settings.google ?? '' };
  const fill = (body: string) => body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
  const customerForm = clinic?.templates.form?.body ? fill(clinic.templates.form.body) : '';
  const clinicLabel = clinic ? `${clinic.name} · 본점` : clinicErr ? '확인 필요' : '불러오는 중…';
  const blocked = !personId ? '명부에 등록된 인플루언서만 예약할 수 있어요. 인플루언서 칸에서 명부에 등록한 뒤 다시 열어 주세요.' : clinicErr;

  // 수동 작성 — 클리닉 기재 시트 양식(없으면 기본 시트)을 빈 값으로 채워 둔다. 계정 줄은 이 인플루언서로 고정한다.
  function blankSheet() {
    const body = clinic?.templates.sheet?.body;
    return body ? updateClientSheetInput(fill(body), 'handle', handle) : createClientSheet(handle);
  }
  async function parse() {
    if (busy || !personId || !clinic) return;
    if (!source.trim()) { setError('고객 응답을 붙여 넣어 주세요.'); return; }
    if (sheet.trim() && !window.confirm('작성한 기재 시트를 새 파싱 결과로 바꿀까요?')) return;
    setBusy(true); setParsing(true); setError(''); setNotice('');
    try {
      const job = await save<{ result: { sheetText: string; summary: string } }>('reservation-extractions', { sourceText: source, personId, locationId: clinic.id });
      setSheet(job.result.sheetText); setNotice(job.result.summary);
    } catch (e) {
      setError(`${errorText(e)} 원문은 보존했어요. 수동 작성으로 계속해 주세요.`);
    } finally { setBusy(false); setParsing(false); }
  }
  async function commit() {
    if (!clinic || !personId) return;
    const mode = deadlineModeOf(sheet), normalized = applyDeadlineMode(sheet, mode);
    if (!normalized.ok) { setError(normalized.message); return; }
    setBusy(true); setError('');
    try {
      let task = created;
      if (!task) {
        task = await createTask();
        if (!task) { setError(existing ? '작업 정보를 불러오지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.' : '작업을 만들지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.'); return; }
        setCreated(task);
      }
      try {
        await save<Detail>('reservations', { target: { kind: 'existingTask', taskId: task.id, expectedTaskVersion: task.version },
          locationId: clinic.id, sourceText: source, sheetText: normalized.value, deadlineMode: mode, templateRevisionId: clinic.templates.sheet?.id ?? null });
      } catch (e) {
        setError(existing ? `예약 저장에 실패했어요 — ${errorText(e)} 입력은 그대로 두었으니 다시 눌러 주세요.`
          : `작업은 만들었고 예약 저장에 실패했어요 — ${errorText(e)} 다시 누르면 예약만 저장해요.`);
        return;
      }
      onDone(task.id, true);
    } finally { setBusy(false); }
  }
  // 1단계 [닫기] — 새 작업이면 작업을 지금 만들어 '대기'로 둔다(예약은 응답을 받은 뒤 카드에서). 기존 작업이면 그냥 닫는다.
  async function closeAsWaiting() {
    if (busy) return;
    if (existing) { onClose(); return; }
    setBusy(true); setError('');
    try {
      const task = created ?? await createTask();
      if (!task) { setError('작업을 만들지 못했어요. 다시 시도해 주세요.'); return; }
      onDone(task.id, false);
    } finally { setBusy(false); }
  }
  // 목업과 같은 순서 — 먼저 복사하고, 복사가 되면 저장한다. 복사가 막히면 저장하지 않고 직접 복사할 길을 준다.
  async function copyAndSave() {
    if (busy || !sheet.trim()) return;
    const mode = deadlineModeOf(sheet), normalized = applyDeadlineMode(sheet, mode);
    if (!normalized.ok) { setError(normalized.message); return; }
    setSheet(normalized.value);
    try { await navigator.clipboard.writeText(normalized.value); }
    catch {
      setCopyFailed(true);
      setError('복사하지 못해 저장하지 않았어요. 기재 시트를 직접 선택해 복사한 뒤 아래 버튼을 눌러 주세요.');
      return;
    }
    await commit();
  }
  async function copyForm() {
    try { await navigator.clipboard.writeText(customerForm); setFormCopied('done'); }
    catch { setFormCopied('failed'); }
  }

  const stepLabel = (n: 1 | 2, text: string) => (
    <span className={step === n ? 'font-semibold text-x-blue-text' : 'text-x-muted'}>{n} {text}</span>
  );
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
         onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
         onClick={(e) => { const both = downOnBackdrop.current && e.target === e.currentTarget; downOnBackdrop.current = false; if (both) requestClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={existing ? '기존 방문 작업에 예약 추가' : '방문 예약 등록'}
           className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] border border-x-border bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-x-border px-[22px] py-[17px]">
          <h2 className="text-[18px] font-bold">{existing ? '기존 방문 작업에 예약 추가' : '방문 예약 등록'}</h2>
          <button type="button" onClick={requestClose} disabled={busy} aria-label="닫기" className="rounded-full p-1.5 text-x-secondary hover:bg-x-hover">✕</button>
        </header>
        <div className="flex gap-[15px] border-b border-x-border px-[22px] py-3.5 text-content">
          {stepLabel(1, '고객 양식')}<span className="text-x-muted">→</span>{stepLabel(2, '예약 파싱')}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-[22px]">
          {step === 1 ? (
            <>
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <label className={FIELD}><span className={LABEL}>캠페인</span>
                  <select disabled className={CONTROL}><option>{campaign.name}</option></select></label>
                <label className={FIELD}><span className={LABEL}>인플루언서</span>
                  <select disabled className={CONTROL}><option>{personName ? `${personName} · @${handle}` : `@${handle}`}</option></select></label>
                <label className={FIELD}><span className={LABEL}>연결할 작업</span>
                  <select disabled className={CONTROL}><option>{existing ? existing.label : '새 작업과 함께 등록'}</option></select></label>
                <div className={FIELD}><span className={LABEL}>방문 클리닉</span><span className="py-2 text-content">{clinicLabel}</span></div>
              </div>
              {blocked && <p role="alert" className={DANGER}>{blocked}</p>}
              {!blocked && clinic && (customerForm ? (
                <>
                  <label className={FIELD}><span className={LABEL}>고객에게 보낼 일본어 예약 양식</span>
                    <textarea readOnly rows={10} value={customerForm} className={`${CONTROL} resize-y bg-x-surface leading-relaxed`} /></label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void copyForm()} className="h-9 px-4 text-content">{formCopied === 'done' ? '복사했어요' : '예약 양식 복사'}</Button>
                    <a href="https://x.com/messages" target="_blank" rel="noreferrer" className="text-ui text-x-blue-text underline underline-offset-[3px]">X에서 안내하기 ↗</a>
                  </div>
                  {formCopied === 'failed' && <p role="alert" className="text-ui text-red-600">복사하지 못했어요. 양식을 직접 선택해 복사해 주세요.</p>}
                  <p className="text-ui text-x-secondary">양식을 복사해 X에서 직접 보내 주세요. 이 화면에서 DM을 전송하지 않아요.</p>
                  {/* 행동 전 기대(UX 원칙 2) — 오른쪽 아래 [닫기]는 ✕와 달리 작업을 만든다 */}
                  {!existing && <p className="text-ui text-x-muted">응답을 아직 못 받았다면 [닫기]를 눌러요 — 작업이 &apos;대기&apos;로 만들어지고, 응답이 오면 표에서 그 카드를 눌러 예약 파싱부터 이어서 해요.</p>}
                </>
              ) : (
                <p className={NOTICE}>클리닉에 저장된 고객 예약 양식이 없어요.{' '}
                  <Link href={`/clients?client=${campaign.clientId}&tab=forms`} className="underline">클리닉 양식 설정</Link>에서 추가하거나, 받은 응답이 있으면 다음 단계로 진행해 주세요.</p>
              ))}
            </>
          ) : (
            <>
              <p className="text-ui text-x-secondary">{campaign.name} · @{handle} · {clinicLabel}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void parse()} disabled={busy || !source.trim()} className="h-9 px-4 text-content">{parsing ? '파싱 중…' : '예약 정보 파싱'}</Button>
                <Button variant="ghost" disabled={busy} className="h-9 px-3 text-content"
                        onClick={() => { if (!sheet) setSheet(blankSheet()); setNotice('원문을 보며 기재 시트를 직접 작성해 주세요.'); setError(''); }}>수동 작성</Button>
              </div>
              {/* 행동 전 기대(UX 원칙 2·6) — 파싱은 AI 호출이라 비용이 들고, 결과는 저장 전에 사람이 확인한다 */}
              <p className="text-ui text-x-muted">[예약 정보 파싱]은 AI가 응답에서 날짜·이름·시술을 읽어 기재 시트를 채워요. 사용 비용이 발생하고, 저장 전에 직접 확인해야 해요.</p>
              <div className="grid grid-cols-2 gap-5">
                <label className={FIELD}><span className={LABEL}>고객 응답 원문</span>
                  <textarea rows={15} value={source} onChange={(e) => setSource(e.target.value)} placeholder="고객 응답을 붙여 넣어 주세요."
                            className={`${CONTROL} resize-y leading-relaxed`} /></label>
                <label className={FIELD}><span className={LABEL}>편집 가능한 기재 시트</span>
                  <textarea rows={15} value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="파싱 후 직접 수정하거나 수동 작성해 주세요."
                            className={`${CONTROL} resize-y font-mono leading-relaxed`} />
                  <small className="text-[11px] text-x-muted">추가 문구와 줄바꿈까지 그대로 복사·저장해요. 업로드 기한은 방문 후 14일로 채워지고, 직접 고치면 그 날짜를 지켜요.</small></label>
              </div>
              {notice && !error && <p role="status" className={NOTICE}>{notice}</p>}
              {error && <p role="alert" className={DANGER}>{error}</p>}
              {copyFailed && <Button onClick={() => void commit()} disabled={busy} className="h-9 px-4 text-content">직접 복사했어요 · 대기 저장</Button>}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2.5 border-t border-x-border px-[22px] py-3.5">
          {step === 2 ? <Button onClick={() => setStep(1)} disabled={busy} className="h-9 px-4 text-content">고객 양식으로</Button> : <span />}
          {step === 1 ? (
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => setStep(2)} disabled={busy || !!blocked || !clinic} className="h-9 px-4 text-content">예약 파싱으로</Button>
              <Button onClick={() => void closeAsWaiting()} disabled={busy || (!existing && !!blocked)} className="h-9 px-4 text-content">{busy ? '만드는 중…' : '닫기'}</Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void copyAndSave()} disabled={busy || !sheet.trim()} className="h-9 px-4 text-content">
              {busy ? '저장 중…' : created ? '예약 다시 저장' : '파싱 결과 복사하기'}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
