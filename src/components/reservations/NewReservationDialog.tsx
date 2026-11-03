'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { productFetch, ProductClientError, useProductSave } from '@/lib/extensionProductClient';
import { createClientSheet, readClientSheetInputs, updateClientSheetInput, validDateTime, type SheetInputKey } from '@/lib/reservationSheet';
import { applyDeadlineMode, type DeadlineMode } from '@/lib/reservationPolicy';
import type { ClinicDetail } from '@/lib/clinicStore';
import { representativeLocation, type ClinicSummary } from '@/lib/clinicLocation';
import { operatingOn, timeGuidance } from '@/lib/clinicHours';
import { branchContext, branchFromSheet, branchOptions, initialBranchId, isMultiBranch } from '@/lib/reservationBranch';
import { ParsedFields, type FieldWarning } from './ParsedFields';
import { useLocationHours } from './useLocationHours';
import type { CampaignRow } from '@/lib/campaignStore';

// 방문 예약 창 — 목업(x-extension Registration)과 같은 두 단계 창이다. 두 곳에서 연다:
//  · 새 방문협찬 작업 폼의 [예약폼 작성] — '방문 예약 등록', 1단계부터. 1단계의 [닫기]는 작업을 '대기'로 만들고 닫는다
//    (양식만 보내 두고 응답을 기다리는 흐름 — 응답이 오면 표에서 그 카드를 눌러 2단계부터 잇는다).
//  · 예약이 없는 방문 작업 카드(existing) — '기존 방문 작업에 예약 추가', 2단계부터.
// 1 고객 양식: 클리닉의 일본어 예약 양식을 복사해 X에서 직접 보낸다(이 화면은 DM을 보내지 않는다).
// 2 예약 파싱: 세 열 — 고객 응답 원문 | 파싱 결과(항목별, 수정 가능) | 기재 시트. 바닥의 [예약 정보 파싱](AI) 또는 [수동 작성]으로
//   기재 시트를 만들고, 파싱 결과 칸을 고치면 시트의 그 줄이 바뀐다. 운영시간 밖 희망 일시·없는 지점은 경고로 보인다. 끝으로 [파싱 결과 복사하기].
// 지점(스펙 §3·§6): 지점은 인플루언서가 양식에 적어 고른다 — 1단계에서 담당자가 고르지 않는다(양식 {{branch}}에는 지점 목록이 들어간다).
// 파싱이 답변의 지점을 맞추면 파싱 결과에 그 지점이 보이고, 못 맞추면 경고와 함께 직접 고른다(사용 중 지점 2곳 이상일 때만 — 1곳이면 예전 그대로 '· 본점').
// 양식·파싱은 대표 지점(양식 출처) 것으로, 저장은 고른 지점으로 한다.
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
  // clinic — 대표 지점의 상세(양식 출처). locations — 이 클라이언트의 지점 목록, locationId — 고른 지점(저장할 지점)
  const [clinic, setClinic] = useState<ClinicDetail | null>(null), [clinicErr, setClinicErr] = useState('');
  const [locations, setLocations] = useState<ClinicSummary[]>([]), [locationId, setLocationId] = useState<string | null>(null);
  const [parsedBranch, setParsedBranch] = useState<string | null>(null);   // 파싱 전 null, 뒤에는 시트 7. 지점 값(안내 문구용)
  const [source, setSource] = useState(''), [sheet, setSheet] = useState('');
  const [busy, setBusy] = useState(false), [parsing, setParsing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [copyFailed, setCopyFailed] = useState(false), [formCopied, setFormCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [created, setCreated] = useState<Created | null>(null);
  const save = useProductSave();
  const downOnBackdrop = useRef(false);
  const branchId = useId();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await productFetch<{ items: ClinicSummary[] }>('clinics');
        const mine = list.items.filter((c) => c.clientId === campaign.clientId), location = representativeLocation(mine);
        if (!location) throw new Error('이 캠페인의 클리닉 정보를 찾을 수 없어요. 클라이언트 설정을 확인해 주세요.');
        const detail = await productFetch<ClinicDetail>(`clinics/${location.id}`);
        if (alive) { setLocations(mine); setLocationId(initialBranchId(branchOptions(mine))); setClinic(detail); }
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

  const options = branchOptions(locations), multi = isMultiBranch(options);
  const selected = options.find((o) => o.id === locationId) ?? null;
  // 저장할 지점 — 여러 곳이면 고른 지점만, 1곳이면 그 지점
  const target = multi ? selected : options[0] ?? null;
  const values: Record<string, string> = { handle, clinic: clinic?.name ?? '', branch: branchContext(options, selected), naver: clinic?.settings.naver ?? '', google: clinic?.settings.google ?? '' };
  const fill = (body: string, extra: Record<string, string> = {}) => body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => extra[key] ?? values[key] ?? '');
  // 고객 양식의 {{branch}} — 여러 곳이면 고를 수 있게 지점 목록('명동점 / 신사점'), 1곳이면 예전처럼 '본점'
  const customerForm = clinic?.templates.form?.body
    ? fill(clinic.templates.form.body, multi ? { branch: options.filter((o) => o.active).map((o) => o.name).join(' / ') } : {}) : '';
  const clinicLabel = clinic ? `${clinic.name} · ${multi ? selected?.name ?? '지점은 파싱 후 표시' : '본점'}` : clinicErr ? '확인 필요' : '불러오는 중…';
  // 파싱 결과의 경고 — 지점(고객이 적은 지점이 없거나 비었음)·희망 일시(고른 지점 운영시간 밖). 시트가 있을 때만.
  const fields = readClientSheetInputs(sheet), preferredAt = validDateTime(fields.preferred);
  const { hours, retry: retryHours } = useLocationHours(sheet.trim() ? target?.id ?? null : null, preferredAt.slice(0, 7), 0);
  const ready = hours.status === 'ready' ? hours : null;
  const guidance = ready && preferredAt ? timeGuidance(operatingOn(ready.clinic.settings, ready.clinic.settings.exceptions, ready.holidays, preferredAt.slice(0, 10)), preferredAt) : null;
  const branchWarn = !multi || !sheet.trim() || selected ? null
    : parsedBranch ? `고객이 적은 "${parsedBranch}"은(는) 등록된 지점이 아니에요 · 직접 골라 주세요`
    : parsedBranch === '' ? '고객 답변에 지점이 없어요 · 고객에게 확인하고 직접 골라 주세요' : '방문 지점을 골라 주세요';
  const warnings: FieldWarning[] = [
    ...(branchWarn ? [{ field: 'branch' as const, text: branchWarn }] : []),
    ...(guidance?.tone === 'warn' ? [{ field: 'preferred' as const, text: guidance.text }] : []),
  ];
  const branchHintText = multi && selected && parsedBranch !== null ? { warn: false, text: parsedBranch ? `고객 답변 "${parsedBranch}" → ${selected.name}` : `고객 답변으로 ${selected.name}` }
    : branchWarn ? { warn: true, text: branchWarn } : null;
  const hoursStatus = !preferredAt || !sheet.trim() ? null
    : multi && !target ? <small className="text-caption text-x-muted">지점을 고르면 그 지점 운영시간으로 확인해요.</small>
    : hours.status === 'loading' ? <small className="text-caption text-x-muted">운영시간 확인 중…</small>
    : hours.status === 'error' ? <small role="alert" className="text-caption text-amber-700">운영시간을 확인하지 못했어요 — {hours.message} <button type="button" className="underline" onClick={retryHours}>다시 시도</button></small>
    : guidance?.tone === 'ok' ? <small className="text-caption text-green-700">{guidance.text}</small> : null;
  const blocked = !personId ? '명부에 등록된 인플루언서만 예약할 수 있어요. 인플루언서 칸에서 명부에 등록한 뒤 다시 열어 주세요.' : clinicErr;

  // 수동 작성 — 클리닉 기재 시트 양식(없으면 기본 시트)을 빈 값으로 채워 둔다. 계정 줄은 이 인플루언서로 고정한다.
  function blankSheet() {
    const body = clinic?.templates.sheet?.body;
    const blank = body ? updateClientSheetInput(fill(body), 'handle', handle) : createClientSheet(handle);
    // {{branch}} 없이 '7. 지점:' 줄만 있는 양식도 고른 지점이 들어가게
    return multi && selected ? updateClientSheetInput(blank, 'branch', selected.name) : blank;
  }
  // 드롭다운 변경 — 시트의 7. 지점 줄도 그 지점으로 다시 쓴다(스펙 §3 '지점 값의 출처')
  function chooseBranch(id: string) {
    const next = options.find((o) => o.id === id);
    if (!next) return;
    setLocationId(id); setParsedBranch(null); setError('');
    setSheet((s) => s ? updateClientSheetInput(s, 'branch', next.name) : s);
  }
  // 파싱 결과 칸 수정 — 시트의 그 줄만 바꾼다(기재 시트가 따라 바뀐다)
  function patch(key: SheetInputKey, value: string) { setSheet((s) => updateClientSheetInput(s, key, value)); }
  // 시트를 직접 고쳐 7. 지점이 등록된 지점 이름이 되면 드롭다운이 따라간다. 다른 글자면 드롭다운은 그대로.
  function editSheet(text: string) {
    setSheet(text);
    const named = multi ? branchFromSheet(text, options) : null;
    if (named && named.id !== locationId) { setLocationId(named.id); setParsedBranch(null); }
  }
  async function reloadLocations() {
    try {
      const list = await productFetch<{ items: ClinicSummary[] }>('clinics');
      setLocations(list.items.filter((c) => c.clientId === campaign.clientId));
    } catch { /* 목록을 못 읽어도 고른 값은 이미 비웠다 — 다시 저장하면 서버가 다시 검사한다 */ }
  }
  async function parse() {
    if (busy || !personId || !clinic) return;
    if (!source.trim()) { setError('고객 응답을 붙여 넣어 주세요.'); return; }
    if (sheet.trim() && !window.confirm('작성한 기재 시트를 새 파싱 결과로 바꿀까요?')) return;
    setBusy(true); setParsing(true); setError(''); setNotice('');
    try {
      // 파싱은 대표 지점 양식으로(clinic) — 결과의 locationId는 답변과 맞는 지점(없으면 null)
      const job = await save<{ result: { sheetText: string; summary: string; locationId: string | null } }>('reservation-extractions', { sourceText: source, personId, locationId: clinic.id });
      setSheet(job.result.sheetText); setNotice(job.result.summary);
      if (multi) { setLocationId(job.result.locationId); setParsedBranch(readClientSheetInputs(job.result.sheetText).branch.trim()); }
    } catch (e) {
      setError(`${errorText(e)} 원문은 보존했어요. 수동 작성으로 계속해 주세요.`);
    } finally { setBusy(false); setParsing(false); }
  }
  async function commit() {
    if (!clinic || !personId) return;
    if (!target) { setError('지점을 선택해 주세요.'); return; }
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
          locationId: target.id, sourceText: source, sheetText: normalized.value, deadlineMode: mode, templateRevisionId: clinic.templates.sheet?.id ?? null });
      } catch (e) {
        // 창을 연 사이 그 지점이 사용 중지됐으면 — 목록을 다시 읽고 다시 고르게 한다. 입력은 그대로 둔다.
        if (e instanceof ProductClientError && e.code === 'LOCATION_INACTIVE') { setLocationId(null); setParsedBranch(null); void reloadLocations(); }
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
    if (!target) { setError('지점을 선택해 주세요.'); return; }   // 복사 전에 막는다 — 반만 일어나지 않게
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
           className={`flex max-h-[90vh] w-full ${step === 2 ? 'max-w-[1280px]' : 'max-w-[900px]'} flex-col overflow-hidden rounded-[14px] border border-x-border bg-white shadow-2xl`}>
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
                <div className={FIELD}><span className={LABEL}>방문 클리닉</span>
                  <span className="py-2 text-content">{multi && clinic ? clinic.name : clinicLabel}</span>
                  {/* 행동 전 기대(UX 원칙 2) — 지점은 여기서 고르지 않는다 */}
                  {multi && clinic && <small className="text-caption text-x-muted">지점은 인플루언서가 양식에서 골라요. 응답을 파싱하면 고른 지점이 보여요.</small>}</div>
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
              <div className="grid h-[min(560px,58vh)] grid-cols-3 gap-5">
                <label className={`${FIELD} min-h-0`}><span className={LABEL}>고객 응답 원문</span>
                  <textarea value={source} onChange={(e) => setSource(e.target.value)} placeholder="고객 응답을 붙여 넣어 주세요."
                            className={`${CONTROL} min-h-0 flex-1 resize-none leading-relaxed`} /></label>
                <section aria-labelledby={`${branchId}-parsed`} className={`${FIELD} min-h-0`}>
                  <div className="flex items-center justify-between gap-2">
                    <span id={`${branchId}-parsed`} className={LABEL}>파싱 결과 (수정 가능)</span>
                    {warnings.length > 0 && <span className="text-caption font-semibold text-amber-700">⚠ 경고 {warnings.length}건</span>}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-x-border p-3">
                    {sheet.trim() ? <>
                      {warnings.length > 0 && (
                        <ul className="mb-3 grid gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-ui text-amber-800">
                          {/* 요약만 — 판단과 다음 행동은 그 칸 아래에 있다 */}
                          {warnings.map((w) => <li key={w.field}>⚠ {w.field === 'branch' ? '방문 지점을 확인해 주세요' : '희망 일시를 확인해 주세요 (운영시간)'}</li>)}
                        </ul>
                      )}
                      <ParsedFields sheet={sheet} onPatch={patch} warnings={warnings} hoursStatus={hoursStatus}
                        branch={multi ? { id: `${branchId}-2`, options, value: locationId, hint: branchHintText, onChange: chooseBranch } : null} />
                    </> : <p className="text-ui text-x-muted">원문을 붙여 넣고 아래 [예약 정보 파싱]을 누르면 항목별로 보여요. 직접 쓰려면 [수동 작성]을 눌러요.</p>}
                  </div>
                  <small className="text-[11px] text-x-muted">여기서 고치면 오른쪽 기재 시트도 같이 바뀌어요.</small>
                </section>
                <label className={`${FIELD} min-h-0`}><span className={LABEL}>기재 시트</span>
                  <textarea value={sheet} onChange={(e) => editSheet(e.target.value)} placeholder="파싱 후 직접 수정하거나 수동 작성해 주세요."
                            className={`${CONTROL} min-h-0 flex-1 resize-none font-mono leading-relaxed`} />
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
            <div className="flex items-center gap-2">
              {/* 행동 전 기대(UX 원칙 2·6) — 파싱은 AI 호출이라 비용이 들고, 결과는 저장 전에 사람이 확인한다 */}
              <small className="mr-1 max-w-[300px] text-right text-caption text-x-muted">[예약 정보 파싱]은 AI가 응답을 읽어 채워요 · 사용 비용이 들고, 저장 전에 직접 확인해 주세요.</small>
              <Button variant="ghost" disabled={busy} className="h-9 px-3 text-content"
                      onClick={() => { if (!sheet) setSheet(blankSheet()); setNotice('원문을 보며 기재 시트를 직접 작성해 주세요.'); setError(''); }}>수동 작성</Button>
              {/* 원문이 들어오면 지금 누를 버튼으로 칠한다 — 기재 시트가 생기면 강조는 [파싱 결과 복사하기]로 넘어간다 */}
              <Button variant={source.trim() && !sheet.trim() ? 'primary' : undefined} onClick={() => void parse()} disabled={busy || !source.trim()} className="h-9 px-4 text-content">{parsing ? '파싱 중…' : '예약 정보 파싱'}</Button>
              <Button variant="primary" onClick={() => void copyAndSave()} disabled={busy || !sheet.trim()} className="h-9 px-4 text-content">
                {busy && !parsing ? '저장 중…' : created ? '예약 다시 저장' : '파싱 결과 복사하기'}
              </Button>
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
