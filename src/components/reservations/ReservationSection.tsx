'use client';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { PanelSection, type SectionDisclosure } from '@/app/campaigns/flow/panel/PanelSection';
import { changedAtLabel } from '@/lib/taskSectionView';
import type { VisitPhase } from '@/lib/reservationPolicy';
import { loadProductFeatures, productFetch, ProductClientError, useProductSave } from '@/lib/extensionProductClient';
import { createClientSheet, formatReservationName, readClientSheetInputs, splitReservationName, updateClientSheetInput, validDateTime, type ClientSheetEditFields } from '@/lib/reservationSheet';
import { applyDeadlineMode, defaultUploadDeadline, uploadWindow, ENDED_PHASES, type DeadlineMode } from '@/lib/reservationPolicy';
import { formatDateKo, isDateOnlyString } from '@/lib/campaignJudgment';
import { DateTimeBox } from '@/app/campaigns/flow/panel/DateTimeBox';
import { ScheduleEditorDialog, type ScheduleReason } from './ScheduleEditorDialog';
import { ChangeReasonDialog, DialogShell, reasonBadgeText } from './ChangeReasonDialog';
import { operatingOn, timeGuidance } from '@/lib/clinicHours';
import { locationLabel, representativeLocation, type ClinicSummary } from '@/lib/clinicLocation';
import { branchFromSheet, branchOptions, initialBranchId, isMultiBranch } from '@/lib/reservationBranch';
import { BranchSelect } from './BranchSelect';
import { useLocationHours } from './useLocationHours';
import type { ClinicDetail } from '@/lib/clinicStore';
import type { CampaignRow, CampaignTaskItem } from '@/lib/campaignStore';
import type { reservationDetail, reservationChanges } from '@/lib/reservationStore';
import type { TaskDto } from '@/lib/extensionTasks';

type Detail = Awaited<ReturnType<typeof reservationDetail>>;
type Changes = Awaited<ReturnType<typeof reservationChanges>>;
const DETAIL_TABS = [['info', '예약 정보'], ['sheet', '기재 시트'], ['source', '고객 원문']] as const;
type DetailTab = (typeof DETAIL_TABS)[number][0];
const INPUT = 'w-full rounded-md border border-x-border-strong bg-white px-2.5 py-2 text-ui outline-none focus:border-x-blue';
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="h-4 w-4 shrink-0 text-x-secondary">
    <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="h-4 w-4 shrink-0 text-x-secondary">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);
const errorText = (e: unknown) => e instanceof Error ? e.message : '요청을 완료하지 못했어요. 입력은 유지했으니 다시 시도해 주세요.';
// 방문협찬 작업 상세의 '일정 · 예약' 상자와 '예약 변경 내역' 상자(계획서 §2 방문 작업 상세 순서: 일정·예약 → 변경 내역 → 동의서).
// 예약이 없으면 기존 방문일·게시 예정일 칸(dateEditor)을 그대로 두고 그 아래에서 예약을 추가한다 — 예약이 생기면 일정은
// 예약 저장으로만 바뀐다(서버 reservationWriteGuard). 협찬 동의서는 여기서 다루지 않는다 — 작업 패널의 AgreementField(063)가 정본이다.
// onAddReservation — 있으면 '이 작업에 예약 추가'가 이 상자 안 입력 대신 예약 창(NewReservationDialog, 카드를 열 때 뜨는 그 창)을 연다.
// historyDisclosure — '예약 변경 내역' 상자를 접었다 펴는 조종간(목업 x-extension). 없으면 예전처럼 늘 펼친다.
// onPhase — 서버가 계산한 방문 단계(예약 상세·TaskDto.visitPhase)를 패널에 올린다 — 패널이 어느 상자를 기본으로 펼칠지 이 값으로 정한다.
// 날짜 줄을 누르면 달력 창(ScheduleEditorDialog)이 뜬다 — 예약이 있으면 예약 폼·기재 시트에 함께 저장(PATCH), 없으면 작업의 방문일·게시 예정일만(onChangeDate).
// 예약이 없으면 방문 시간도 작업에 직접 저장한다 — 날짜·시간 줄 어느 쪽을 눌러도 같은 달력 창(시간은 선택)이 뜨고 onChangeVisit으로 함께 저장.
// dateEditor — 예약 기능이 꺼진 DB(설정 적용 전)에서만 쓰는 예전 일정 칸.
// onReveal — '지금 할 일'의 [동의서 확인]·[게시로 이동 ↓]·[정산으로 이동 ↓]가 그 상자를 펼치고 스크롤하게 패널에 부탁한다.
// onCancelTask — 자세히 보기 줄 오른쪽의 [진행 안 됨](게시 칸에 있던 그 버튼, 같은 작업 취소 창) — 방문협찬은 여기 하나만 둔다.
// onOverlayChange — 달력 창이 떠 있는 동안 패널의 Esc·바깥 클릭을 끄게 알린다.
// 지점(스펙 §6): 클리닉(운영시간·공휴일)은 예약이 있으면 예약의 지점, 없으면 대표 지점으로 읽는다. 수정 중에는 고른 지점으로 —
// 지점이 2곳 이상이면 수정 창에 지점 드롭다운을 두고, 바꾸면 시트 7. 지점 줄과 함께 locationId를 저장한다(1곳이면 예전 그대로).
export function ReservationSection({ task, campaign, dateEditor, onChangeDate, onChangeVisit, onChanged, onDirtyChange, onAddReservation, historyDisclosure, onPhase, onReveal, onCancelTask, onOverlayChange }: {
  task: CampaignTaskItem; campaign: CampaignRow; dateEditor: ReactNode; onChanged: () => Promise<void>; onDirtyChange: (dirty: boolean) => void;
  onChangeDate: (field: 'visitOn' | 'scheduledOn', next: string) => Promise<boolean>;
  onChangeVisit: (visitOn: string, visitTime: string | null) => Promise<boolean>;   // 예약 없는 작업의 방문일·시간을 한 번에
  onAddReservation?: () => void;
  historyDisclosure?: SectionDisclosure;
  onPhase?: (phase: VisitPhase | null) => void;
  onReveal?: (key: 'consent' | 'posting' | 'money') => void;
  onCancelTask?: () => void;
  onOverlayChange?: (open: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null), [loaded, setLoaded] = useState(false);
  const [taskInfo, setTaskInfo] = useState<TaskDto | null>(null);
  // 이 클라이언트의 지점 목록(사용 중지 포함 — 예약이 가리키는 중지 지점도 이름을 읽는다). null = 아직 못 읽음
  const [locations, setLocations] = useState<ClinicSummary[] | null>(null), [locationsTick, setLocationsTick] = useState(0);
  const [editLocationId, setEditLocationId] = useState<string | null>(null);   // 수정 창에서 고른 지점
  const [history, setHistory] = useState<Changes | null>(null), [allHistory, setAllHistory] = useState(false);
  const [sheet, setSheet] = useState(''), [source, setSource] = useState(''), [mode, setMode] = useState<DeadlineMode>('default');
  const [editing, setEditing] = useState(false), [step, setStep] = useState(1), [reason, setReason] = useState<ScheduleReason | ''>('');
  // [예약 수정]을 눌렀을 때의 사유 창(목업 '수정 사유를 선택해 주세요') — 확정된 예약은 사유를 고른 뒤에 수정 폼이 열린다
  const [reasonPicking, setReasonPicking] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  // 목업의 '자세히 보기'(예약 정보·기재 시트·고객 원문 탭)와 날짜 줄의 달력 창(어느 칸을 고치는지)
  const [detailsOpen, setDetailsOpen] = useState(false), [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [scheduleField, setScheduleField] = useState<'preferred' | 'uploadDeadline' | null>(null);
  // 예약 수정은 창(목업 Modal)으로 — 상자는 뒤에 그대로 보인다. 예약 없는 작업의 새 예약 쓰기만 상자 안 인라인(그동안 상자 내용을 숨긴다)
  const editDialogOpen = editing && !!detail, inlineEditing = editing && !detail;
  useEffect(() => { onOverlayChange?.(scheduleField !== null || reasonPicking || editDialogOpen); return () => onOverlayChange?.(false); }, [scheduleField, reasonPicking, editDialogOpen, onOverlayChange]);
  const uid = useId();
  const save = useProductSave();
  const dirty = editing && (sheet !== (detail?.sheetText ?? '') || source !== (detail?.sourceText ?? '') || mode !== (detail?.deadlineMode ?? 'default')
    || (!!detail && editLocationId !== detail.locationId));
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  // 예약 상세의 단계가 먼저, 없으면(예약 전) 작업 조회의 단계 — 둘 다 서버 visitPhase라 같은 규칙이다
  const phase = detail?.phase ?? taskInfo?.visitPhase ?? null;
  useEffect(() => { onPhase?.(phase); return () => onPhase?.(null); }, [phase, onPhase]);
  // 지점 목록 — 읽을 때마다 고른 지점의 클리닉 상세도 다시 읽게 한다(locationsTick → useLocationHours)
  const loadLocations = useCallback(async () => {
    const list = await productFetch<{ items: ClinicSummary[] }>('clinics');
    setLocations(list.items.filter((c) => c.clientId === campaign.clientId)); setLocationsTick((n) => n + 1);
  }, [campaign.clientId]);
  // 양식 출처 = 대표 지점 상세(고객 양식·시트 양식). 파싱은 이 지점 양식으로 하므로 새 예약의 templateRevisionId도 여기서 읽는다 —
  // 고른 지점이 대표 지점과 달라도 '파싱에 쓴 양식'이 기록되게(예약 창 NewReservationDialog와 같은 규칙). 운영시간은 고른 지점(useLocationHours).
  const representativeId = representativeLocation(locations ?? [])?.id ?? null;
  const [templateSource, setTemplateSource] = useState<ClinicDetail | null>(null);
  useEffect(() => {
    if (!representativeId) return;
    let alive = true;
    productFetch<ClinicDetail>(`clinics/${representativeId}`).then((value) => { if (alive) setTemplateSource(value); }).catch((e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [representativeId, locationsTick]);
  const templateClinic = templateSource?.id === representativeId ? templateSource : null;
  const load = useCallback(async () => {
    try {
      const features = await loadProductFeatures();
      setEnabled(features.reservations);
      if (!features.reservations) { setLoaded(true); return; }
      const current = await productFetch<Detail | null>(`tasks/${task.id}/reservation`);
      setDetail(current); setLoaded(true); setError('');
      setTaskInfo(await productFetch<TaskDto>(`tasks/${task.id}`));   // 미배정 작업도 할 수 있는 일(취소 등)은 서버가 정한다
      // 클리닉은 예약 상세 뒤에 읽힌다 — 읽기 전(locations null)엔 '미등록'이라고 말하지 않는다(아래 요약·예약 정보 탭)
      await loadLocations();
    } catch (e) {
      // 예약 저장 구조가 아직 없는 DB(설정 적용 전)는 오류가 아니라 '예약 기능 꺼짐'으로 본다.
      if (e instanceof ProductClientError && e.code === 'SERVER_NOT_READY') { setEnabled(false); setLoaded(true); return; }
      setLoaded(true); setError(errorText(e));
    }
  }, [task.id, loadLocations]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 작업이 바뀌거나 저장으로 버전이 오르면 예약을 다시 읽는다(읽기 결과는 비동기 콜백에서 반영)
  useEffect(() => { void load(); }, [load, task.version]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !busy) void load(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, busy]);
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    productFetch<Changes>(`reservations/${detail.id}/changes?limit=${allHistory ? 50 : 3}`).then((r) => { if (alive) setHistory(r); }).catch((e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [detail, allHistory]);
  // [예약 수정] — 사유가 필요한 예약(확정 뒤)은 사유 창을 먼저 띄우고, 고른 뒤 openEditor로 간다(목업 startEdit → 'reason' → 'edit').
  // 게시 뒤에는 '내 입력 정정'만 되므로 묻지 않고 정정으로 연다(ScheduleEditorDialog의 askReason && allowCustomerRequest와 같은 갈래).
  function startEdit() {
    if (needsReason && actions.includes('edit_reservation')) { setReasonPicking(true); return; }
    openEditor(needsReason ? 'correction' : '');
  }
  function openEditor(nextReason: ScheduleReason | '') {
    setSheet(detail?.sheetText ?? createClientSheet(task.influencerHandle ?? '', { preferred: task.visitOn ? `${task.visitOn}T` : '' }));
    setSource(detail?.sourceText ?? ''); setMode(detail?.deadlineMode ?? (task.scheduledOn ? 'manual' : 'default'));
    if (!detail && task.scheduledOn) setSheet((s) => updateClientSheetInput(s, 'uploadDeadline', task.scheduledOn!));
    setEditLocationId(detail?.locationId ?? initialBranchId(branchOptions(locations ?? [])));
    setReason(nextReason); setStep(detail ? 2 : 1); setEditing(true); setError(''); setNotice('');
  }
  // 닫기(✕·Esc·바깥·[닫기]) — 고친 게 있으면 한 번 묻는다. 저장 중에는 DialogShell이 닫기를 막는다
  // 사유 창이 위에 떠 있을 때의 Esc·바깥 클릭은 그 창 몫이다 — 두 창이 같이 닫히지 않게 여기선 무시한다
  function closeEditor() { if (reasonPicking) return; if (!dirty || window.confirm('작성 중인 예약 정보가 사라져요. 닫을까요?')) setEditing(false); }
  function resetDeadline() { const r = applyDeadlineMode(sheet, 'default'); if (r.ok) { setMode('default'); setSheet(r.value); } }
  function patch(key: keyof ClientSheetEditFields, value: string) {
    setSheet((current) => {
      const next = updateClientSheetInput(current, key, value);
      if (key === 'preferred' && mode === 'default') { const r = applyDeadlineMode(next, 'default'); return r.ok ? r.value : next; }
      return next;
    });
  }
  // 드롭다운 변경 — 시트의 7. 지점 줄도 그 지점으로 다시 써서 저장본의 시트와 지점이 어긋나지 않게 한다
  function chooseBranch(id: string) {
    const next = options.find((o) => o.id === id);
    if (!next) return;
    setEditLocationId(id); setError('');
    setSheet((current) => updateClientSheetInput(current, 'branch', next.name));
  }
  // 시트를 직접 고쳐 7. 지점이 등록된 지점 이름이 되면 드롭다운이 따라간다(스펙 §3). 다른 글자면 드롭다운은 그대로.
  function editSheet(text: string) {
    setSheet(text);
    const named = multi ? branchFromSheet(text, options) : null;
    if (named && named.id !== editLocationId) setEditLocationId(named.id);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function commit(confirm = false, copied = false) {
    const normalized = applyDeadlineMode(sheet, mode);
    if (!normalized.ok) { setError(normalized.message); return; }
    if (multi && !editLocationId) { setError('지점을 선택해 주세요.'); return; }
    // 새 예약 — 저장할 지점(고른 지점)과 양식 출처(대표 지점 상세)가 둘 다 있어야 한다. 지점 목록이 비면 클리닉 연결 문제, 상세가 아직이면 읽는 중.
    if (!detail && !editLocationId) { setError('캠페인의 클리닉을 먼저 연결해 주세요.'); return; }
    if (!detail && !templateClinic) { setError('클리닉 양식을 아직 읽는 중이에요. 잠시 뒤 다시 저장해 주세요.'); return; }
    // 지점을 바꿨을 때만 보낸다 — 같은 지점이면 사용 중지된 지점이어도 그대로 둔다(서버도 같은 규칙)
    const moved = detail && editLocationId && editLocationId !== detail.locationId ? { locationId: editLocationId } : {};
    await run(async () => {
      if (copied) {
        try { await navigator.clipboard.writeText(normalized.value); } catch { setCopyFailed(true); throw new Error('복사하지 못해 저장하지 않았어요. 기재 시트를 직접 복사한 뒤 아래 저장 버튼을 눌러 주세요.'); }
      }
      let next: Detail;
      try {
        next = detail ? await save<Detail>(`reservations/${detail.id}${confirm ? '/confirm' : ''}`,
          { sheetText: normalized.value, deadlineMode: mode, reason: reason || null, ...moved }, detail.version, confirm ? 'POST' : 'PATCH')
          : await save<Detail>('reservations', { target: { kind: 'existingTask', taskId: task.id, expectedTaskVersion: taskInfo?.version ?? task.version },
            locationId: editLocationId, sourceText: source, sheetText: normalized.value, deadlineMode: mode, templateRevisionId: templateClinic!.templates.sheet?.id ?? null });
      } catch (e) {
        // 창을 연 사이 고른 지점이 사용 중지됐으면 — 목록을 다시 읽고 다시 고르게 한다(문구는 서버 그대로). 입력은 그대로 둔다.
        if (e instanceof ProductClientError && e.code === 'LOCATION_INACTIVE') { setEditLocationId(null); void loadLocations().catch(() => {}); }
        throw e;
      }
      setDetail(next); setSheet(next.sheetText); setEditing(false); setCopyFailed(false); setNotice(confirm ? '예약을 확정했어요.' : '예약을 저장했어요. 익스텐션에서 다시 조회하면 같은 내용이 나와요.'); await onChanged();
    });
  }
  const fields = readClientSheetInputs(editing ? sheet : detail?.sheetText ?? ''), names = splitReservationName(fields.name);
  const structuredPreferred = /^(?:\d{4}-\d{2}-\d{2})?(?:[ T](?:\d{2}:\d{2})?)?$/.test(fields.preferred);
  const [preferredDate = '', preferredTime = ''] = structuredPreferred ? fields.preferred.replace(' ', 'T').split('T') : [fields.preferred, ''];
  const preferredMonth = fields.preferred.slice(0, 7);
  // 지점 — 수정 중에는 고른 지점(예약 있음: 저장된 지점 + 사용 중 지점 / 새 예약: 사용 중 지점만), 아니면 예약의 지점·대표 지점
  const options = branchOptions(locations ?? [], detail?.locationId), multi = isMultiBranch(options);
  const targetId = editing ? editLocationId : detail?.locationId ?? representativeLocation(locations ?? [])?.id ?? null;
  const targetOption = options.find((o) => o.id === targetId) ?? null;
  // 요약·예약 정보 탭은 저장된 지점(수정 창에서 고르는 중인 값이 아니라) — 없으면(새 예약) 대표 지점
  const shownLocation = locations?.find((l) => l.id === (detail?.locationId ?? targetId)) ?? null;
  const { hours, retry: retryHours } = useLocationHours(targetId, preferredMonth, locationsTick);
  const clinicLoaded = locations !== null;
  // 요약·예약 정보 탭의 클리닉 이름 — 지점이 여러 곳이면 지점명까지(1곳이면 예전처럼 클리닉 이름만)
  const clinicName = shownLocation ? (multi ? locationLabel(shownLocation) : shownLocation.name) : null;
  const actions = detail?.allowedActions ?? taskInfo?.allowedActions ?? [];
  // 수정 사유가 필요한 단계(서버 planReservationSave: 대기가 아니면 사유) — 인플루언서 요청은 edit_reservation이 허용될 때만 고를 수 있다
  const needsReason = !!detail && (detail.confirmed || actions.includes('correct_reservation'));
  // '지금 할 일'의 [방문 완료] — 취소·노쇼는 [진행 안 됨](작업 취소 창 → 서버가 예약 종료로 기록)이, 변경 한도 초과는 달력 창(stopForLimit)이 맡는다
  async function completeVisit() { await run(async () => {
    const next = await save<Detail>(`tasks/${task.id}/complete-visit`, {}, detail?.task.version ?? taskInfo?.version);
    if (next && 'sheetText' in next) setDetail(next);
    setEditing(false); setNotice('방문 완료로 기록했어요.'); await onChanged(); await load();
  }); }
  // 달력 창의 [일정 저장] — 예약이 있으면 그 칸만 바꾼 기재 시트를 저장한다(방문일을 바꾸면 기본 기한도 따라간다). 없으면 작업의 날짜만.
  // 오류 문구를 돌려주면 창이 보여 준다(창은 열린 채) — 다른 사람이 먼저 고쳐 버전이 어긋났으면(409) 최신 내용을 다시 읽어 둔다.
  // 사유: 서버(planReservationSave)는 대기 단계가 아니면 사유를 요구한다 — 확정 뒤는 물론, 확정 없이 게시된 예약(정정만 가능)도 포함(needsReason).
  async function saveSchedule(value: string, scheduleReason: ScheduleReason): Promise<string | void> {
    const field = scheduleField; if (!field) return;
    if (!detail) {
      const ok = field === 'preferred' ? await onChangeVisit(value.slice(0, 10), value.slice(11, 16) || null) : await onChangeDate('scheduledOn', value);
      if (!ok) return '일정을 저장하지 못했어요. 다시 시도해 주세요.';
      setScheduleField(null); setNotice('일정을 수정했어요.'); return;
    }
    // 업로드 기한을 '방문 후 14일'로 돌려놓으면 기본 기한으로 저장한다 — 안 그러면 '직접 설정한 기한'이 되어 방문일을 옮겨도 따라가지 않는다
    const nextMode: DeadlineMode = field === 'uploadDeadline' ? (value === defaultUploadDeadline(fields.preferred) ? 'default' : 'manual') : detail.deadlineMode;
    const normalized = applyDeadlineMode(updateClientSheetInput(detail.sheetText, field, value), nextMode);
    if (!normalized.ok) return normalized.message;
    try {
      setBusy(true); setError('');
      const next = await save<Detail>(`reservations/${detail.id}`, { sheetText: normalized.value, deadlineMode: nextMode, reason: needsReason ? scheduleReason : null }, detail.version, 'PATCH');
      setDetail(next); setScheduleField(null); setNotice('일정과 예약 폼을 함께 수정했어요.'); await onChanged();
    } catch (e) { void load(); return errorText(e); } finally { setBusy(false); }
  }
  // 달력 창의 [요청 기록·협찬 중단] — 결과를 창 안에 돌려준다(뒤에 가려진 상자의 오류 줄은 안 보인다). run()은 오류를 삼키므로 쓰지 않는다
  async function stopForLimit(): Promise<string | void> {
    if (!detail) return;
    try {
      setBusy(true); setError('');
      const next = await save<Detail>(`reservations/${detail.id}/stop-for-change-limit`, {}, detail.version);
      setDetail(next); setScheduleField(null); setReasonPicking(false); setEditing(false); setNotice('4번째 요청을 기록하고 협찬을 중단했어요.'); await onChanged(); await load();
    } catch (e) { void load(); return errorText(e); } finally { setBusy(false); }
  }
  // '지금 할 일'의 [예약 확정](목업) — 화면에 보이는 저장본 그대로 확정한다. 수정 화면의 [✓ 예약 확정](commit(true))은 고친 내용과 함께 확정하는 길로 그대로 남는다.
  async function confirmDirect() {
    if (!detail) return;
    // 희망 일시·예약자가 비어 있으면 서버가 확정을 거절한다(CONFIRM_FIELDS_MISSING) — 눌러서 실패하게 두지 않고 수정 화면으로 보낸다(목업 confirmSaved와 같은 갈래)
    if (!validDateTime(fields.preferred) || !fields.name) { startEdit(); setNotice('희망 일시와 예약자 이름을 채운 뒤 아래 [✓ 예약 확정]을 눌러 주세요.'); return; }
    await run(async () => {
      const next = await save<Detail>(`reservations/${detail.id}/confirm`, { sheetText: detail.sheetText, deadlineMode: detail.deadlineMode, reason: null }, detail.version, 'POST');
      setDetail(next); setNotice('예약을 확정했어요.'); await onChanged();
    });
  }
  // 운영시간 판정은 지금 고른 지점의 클리닉·그 달 공휴일이 다 왔을 때만 — 지점을 바꾼 직후 이전 지점 판정을 보이지 않는다(D23~D25)
  const ready = hours.status === 'ready' ? hours : null;
  const guidance = ready && fields.preferred ? timeGuidance(operatingOn(ready.clinic.settings, ready.clinic.settings.exceptions,
    ready.holidays, fields.preferred.slice(0, 10)), fields.preferred) : null;
  // 운영시간 안내 칸 — 지점 미선택(D10)·확인 중(D23)·실패(D24, 다시 시도)·판정. 1곳 클리닉은 예전처럼 판정만(확인 중 문구 없음).
  const hoursNotice = (className: string) => {
    if (!fields.preferred) return null;
    if (multi && !targetId) return <p role="status" className={className}>지점을 선택해 주세요 — 고른 지점의 운영시간으로 확인해요.</p>;
    if (hours.status === 'error') return <div role="alert" className={`${className} flex flex-wrap items-center gap-2`}>운영시간을 확인하지 못했어요 — {hours.message}<Button disabled={busy} onClick={retryHours}>다시 시도</Button></div>;
    if (hours.status === 'loading' && multi) return <p role="status" className={className}>{targetOption?.name ?? '지점'} 운영시간 확인 중…</p>;
    return guidance && <p role="status" className={className}>{guidance.text}</p>;
  };
  const branchField = (id: string) => multi && (
    <div className="grid max-w-[320px] gap-1 text-ui text-x-secondary"><label htmlFor={id}>방문 지점</label>
      <BranchSelect id={id} options={options} value={editLocationId} onChange={chooseBranch} /></div>
  );
  // 기능 확인 전(null)·꺼짐(false)에는 기존 일정 칸만 — 제목이 바뀌었다 돌아오거나 준비 오류가 잠깐 뜨지 않게 한다.
  if (enabled !== true) return <PanelSection title="일정">{dateEditor}</PanelSection>;
  const locked = !!task.cancelledAt || (phase !== null && ENDED_PHASES.includes(phase));
  const canEditReservation = !locked && (actions.includes('edit_reservation') || actions.includes('correct_reservation'));
  // [진행 안 됨] — 게시 칸에 있던 버튼을 여기로 옮겼다(방문협찬, X 표시만 뺐다). 게시 전·살아 있는 작업에만(PostedBox와 같은 조건).
  // 흐름은 원래 그대로 작업 취소 창(CancelDialog) — 예약이 연결된 작업은 서버(cancel 라우트)가 같은 입력으로 예약 종료를 기록한다.
  const showCancel = !!onCancelTask && !locked && !task.postedAt;
  // 크기는 '지금 할 일'의 [예약 확정](Button primary: px-3 py-1 text-ui font-medium)과 같게 — 테두리 1px만큼 위아래 여백을 줄여 높이를 맞춘다.
  const cancelBtn = showCancel && (
    <button type="button" onClick={onCancelTask} title={detail ? '거절·무응답 등으로 진행이 안 된 작업을 취소해요 — 예약 기록은 보존되고, 되돌릴 수는 없어요' : '거절·무응답 등으로 진행이 안 된 작업을 취소해요 — 취소해도 되돌릴 수 있어요'}
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-red-200 bg-white px-3 py-[3px] text-ui font-medium text-red-600 transition-colors hover:bg-red-50">
      진행 안 됨
    </button>
  );
  const canEditDates = !task.cancelledAt && !locked;   // 예약 없는 작업의 날짜 — 취소·종료 전에는 고칠 수 있다
  // 업로드 기한 두 번째 줄(목업) — 기본 기한이면 '방문 후 14일', 직접 정했으면 '직접 설정한 기한', 비었으면 '방문일 선택 후 설정'
  const deadlineHint = (deadline: string, isDefault: boolean) => deadline ? (isDefault ? '방문 후 14일' : '직접 설정한 기한') : '방문일 선택 후 설정';
  const dateLabel = (title: string, hint: string) => <p className="mb-1 text-ui text-x-muted">{title} <small className="text-caption">({hint})</small></p>;
  // 고칠 수 없을 때는 버튼이 아니라 글자로(거짓 어포던스 금지·키보드 사용자에게도 값이 읽히게)
  const dateRow = (icon: 'calendar' | 'clock', label: string, text: string, disabled: boolean, field: 'preferred' | 'uploadDeadline') => disabled
    ? <span className="flex h-10 w-full items-center gap-2 px-3 text-ui text-x-secondary">{icon === 'calendar' ? <CalendarIcon /> : <ClockIcon />}<span className="tabular-nums">{text}</span></span>
    : (
      <button type="button" aria-label={label} onClick={() => setScheduleField(field)}
              className="flex h-10 w-full items-center gap-2 px-3 text-left text-ui text-x-text hover:bg-x-hover">
        {icon === 'calendar' ? <CalendarIcon /> : <ClockIcon />}<span className="tabular-nums">{text}</span>
      </button>
    );
  const placeholder = (text: string, withClock = false) => <span className="flex min-h-10 w-full items-center gap-2 px-3 text-caption text-x-secondary">{withClock && <ClockIcon />}{text}</span>;
  const todo = actions.includes('confirm') ? '희망 일시를 확인하고 예약을 확정해 주세요.'
    : actions.includes('complete_visit') ? '오늘 방문 여부를 확인해 주세요.'
    : phase === 'confirmed' ? '방문 일정과 협찬 동의서를 확인해 주세요.'
    : phase === 'visited' ? '원고와 게시물을 확인해 주세요.'
    : phase === 'uploaded' ? '금액과 결제 수단을 확인하고 정산을 요청해 주세요.'
    : '지급 결과를 확인하고 완료해 주세요.';
  const visitWindow = uploadWindow(fields.preferred);
  // 달력 창의 방문 시간 안내 — 지금 보는 달의 공휴일(holidays)로 판정한다(다른 달로 넘기면 공휴일 표시만 빠질 수 있다)
  const guidanceFor = ready ? (value: string) => timeGuidance(operatingOn(ready.clinic.settings, ready.clinic.settings.exceptions, ready.holidays, value.slice(0, 10)), value)?.text ?? null : undefined;
  // 일정 상자(목업 x-extension TaskSchedule + ReservationPanel '일정') — 날짜 두 상자 → (예약 있음) 클리닉·예약자 요약, '지금 할 일', 자세히 보기·예약 수정·취소·노쇼
  // / (예약 없음) 안내 + [이 작업에 예약 추가]. 예약 수정·종료·확정의 실제 저장은 기존 그대로(아래 fieldset·end·confirm) — 겉모양만 목업을 따른다.
  return <>
  <PanelSection title="일정" aside={<span className="text-ui text-x-muted">한국 시간</span>}><div>
    {!loaded && <p className="mb-3 text-ui text-x-muted">예약을 불러오는 중…</p>}
    {notice && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-ui text-green-800">{notice}</p>}
    {error && <div role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-ui text-amber-800">{error}<Button className="ml-2" disabled={busy} onClick={() => void load()}>최신 내용 불러오기</Button></div>}
    {!inlineEditing && (
      <div className="grid grid-cols-2 gap-3">
        <div>
          {dateLabel('방문일', detail ? (detail.phase === 'waiting' ? '희망 일시' : '방문 일시') : '방문 일시')}
          {detail
            ? <DateTimeBox empty={false}
                date={dateRow('calendar', '방문일 수정', fields.preferred ? formatDateKo(fields.preferred.slice(0, 10)) || '날짜 미정' : '날짜 미정', !canEditReservation, 'preferred')}
                time={dateRow('clock', '방문 시간 수정', fields.preferred.slice(11, 16) || '시간 추가', !canEditReservation, 'preferred')} />
            : <DateTimeBox empty={false}
                date={dateRow('calendar', '방문일 수정', task.visitOn ? formatDateKo(task.visitOn) : '날짜 추가', !canEditDates, 'preferred')}
                time={dateRow('clock', '방문 시간 수정', task.visitTime ?? (canEditDates ? '시간 추가' : '시간 미정'), !canEditDates, 'preferred')} />}
        </div>
        <div>
          {dateLabel('게시 예정일', '업로드 기한')}
          {detail
            ? <DateTimeBox empty={false}
                date={dateRow('calendar', '업로드 기한 수정', fields.uploadDeadline ? formatDateKo(fields.uploadDeadline) || '날짜 추가' : '날짜 추가', !canEditReservation, 'uploadDeadline')}
                time={placeholder(deadlineHint(fields.uploadDeadline, detail.deadlineMode === 'default'))} />
            : <DateTimeBox empty={false}
                date={dateRow('calendar', '업로드 기한 수정', task.scheduledOn ? formatDateKo(task.scheduledOn) : '날짜 추가', !canEditDates, 'uploadDeadline')}
                time={placeholder(deadlineHint(task.scheduledOn ?? '', !!task.visitOn && task.scheduledOn === defaultUploadDeadline(task.visitOn)))} />}
        </div>
      </div>
    )}
    {!inlineEditing && detail && <>
      <p className="my-4 grid gap-0.5 text-[12px] text-x-secondary">
        <strong className="text-ui font-medium text-x-text">{clinicName ?? (clinicLoaded ? '클리닉 미등록' : '클리닉 확인 중…')}</strong>
        <span>{fields.name || '예약자 미입력'} · {fields.treatment || '시술 미입력'}</span>
      </p>
      {!locked && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f0f9ff] p-3">
          <div className="min-w-0 flex-1">
            <span className="text-caption font-semibold text-[#087bbf]">지금 할 일</span>
            <p className="mt-0.5 text-ui text-x-text">{todo}</p>
          </div>
          {actions.includes('confirm') && <Button variant="primary" disabled={busy} className="shrink-0" onClick={() => void confirmDirect()}>예약 확정</Button>}
          {actions.includes('complete_visit') && <Button variant="primary" disabled={busy} className="shrink-0" onClick={() => void completeVisit()}>방문 완료</Button>}
          {phase === 'confirmed' && !actions.includes('complete_visit') && !task.agreement && <Button className="shrink-0" onClick={() => onReveal?.('consent')}>동의서 확인</Button>}
          {phase === 'visited' && <Button variant="ghost" className="shrink-0" onClick={() => onReveal?.('posting')}>게시로 이동 ↓</Button>}
          {(phase === 'uploaded' || phase === 'settling') && <Button variant="ghost" className="shrink-0" onClick={() => onReveal?.('money')}>정산으로 이동 ↓</Button>}
        </div>
      )}
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-x-border pt-2.5">
        <button type="button" aria-expanded={detailsOpen} aria-controls={`${uid}-details`} onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center gap-2 py-1 text-ui text-x-secondary hover:text-x-text">
          {detailsOpen ? '접기' : '자세히 보기'} <span aria-hidden>{detailsOpen ? '⌃' : '⌄'}</span>
        </button>
        {!locked && (
          <div className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label="예약 관리">
            {canEditReservation && <Button variant="ghost" disabled={busy} onClick={startEdit}>예약 수정</Button>}
            {cancelBtn}
          </div>
        )}
      </div>
      {detailsOpen && (
        <div id={`${uid}-details`}>
          <div className="my-3 flex items-center gap-4 border-b border-x-border" role="tablist" aria-label="예약 상세 보기">
            {DETAIL_TABS.map(([id, label], i) => (
              <button key={id} id={`${uid}-tab-${id}`} type="button" role="tab" aria-selected={detailTab === id} aria-controls={`${uid}-panel-${id}`}
                      tabIndex={detailTab === id ? 0 : -1} onClick={() => setDetailTab(id)}
                      onKeyDown={(e) => {
                        const n = e.key === 'ArrowRight' ? (i + 1) % DETAIL_TABS.length : e.key === 'ArrowLeft' ? (i + DETAIL_TABS.length - 1) % DETAIL_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? DETAIL_TABS.length - 1 : -1;
                        if (n < 0) return; e.preventDefault(); setDetailTab(DETAIL_TABS[n][0]); document.getElementById(`${uid}-tab-${DETAIL_TABS[n][0]}`)?.focus();
                      }}
                      className={`-mb-px border-b-2 py-2.5 text-ui ${detailTab === id ? 'border-x-blue font-bold text-x-blue-text' : 'border-transparent text-x-secondary hover:text-x-text'}`}>
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${uid}-panel-${detailTab}`} aria-labelledby={`${uid}-tab-${detailTab}`}>
          {detailTab === 'info' && (
            <dl className="grid grid-cols-[110px_1fr] gap-x-1.5 gap-y-3 text-[12px]">
              <dt className="text-x-secondary">방문 클리닉</dt><dd>{clinicName ?? (clinicLoaded ? '미등록' : '확인 중…')}</dd>
              <dt className="text-x-secondary">예약자</dt><dd>{fields.name || '미입력'}</dd>
              <dt className="text-x-secondary">희망 시술</dt><dd>{fields.treatment || '미입력'}</dd>
              <dt className="text-x-secondary">초진/재진</dt><dd>{fields.visitType || '미입력'}</dd>
              <dt className="text-x-secondary">성별 · 생년월일</dt><dd>{fields.gender || '미입력'} · {fields.birthDate || '미입력'}</dd>
              <dt className="text-x-secondary">한국어 가능 여부</dt><dd>{fields.koreanAbility || '미입력'}</dd>
              {fields.preferred2 && <><dt className="text-x-secondary">제2희망 일시</dt><dd>{fields.preferred2.replace('T', ' ')}</dd></>}
              {phase === 'confirmed' && visitWindow && <><dt className="text-x-secondary">방문 처리</dt><dd className="text-caption text-x-secondary">{visitWindow.start} 00:00에 방문으로 자동 변경 · 한국 시간<br />희망일 당일에는 직접 방문 완료를 처리할 수도 있어요.</dd></>}
              {(phase === 'visited' || phase === 'uploaded' || phase === 'settling' || phase === 'completed') && <><dt className="text-x-secondary">방문 기록</dt><dd>방문 완료</dd></>}
            </dl>
          )}
          {detailTab === 'sheet' && (
            <div className="grid gap-2">
              <textarea readOnly value={detail.sheetText} rows={12} aria-label="저장한 기재 시트" className={`${INPUT} font-mono`} />
              <div><Button onClick={() => void run(async () => { await navigator.clipboard.writeText(detail.sheetText); setNotice('기재 시트를 복사했어요.'); })}>기재 시트 복사</Button></div>
            </div>
          )}
          {detailTab === 'source' && (
            <>
              <p className="mb-2 text-ui text-x-muted">고객이 보낸 원문이에요. 예약을 수정해도 원문은 유지해요.</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui">{detail.sourceText || '수동 작성한 예약이에요.'}</pre>
            </>
          )}
          </div>
        </div>
      )}
    </>}
    {!inlineEditing && !detail && loaded && <>
      <div className="my-3 rounded-lg border border-[#d8ebf8] bg-[#f0f8fe] px-3 py-2.5 text-[12px] text-[#245c7e]">
        예약 상세가 없는 기존 방문 작업이에요.
        {task.visitOn && <><br />기존 방문일 {formatDateKo(task.visitOn)} · {task.visitTime ?? '시간 미정'}</>}
      </div>
      {/* 게시된 작업엔 예약을 붙일 수 없다 — 꺼진 버튼을 두면 계속 누르게 된다(ISSUE-016). 버튼 대신 이유와 갈 곳을 한 줄로 */}
      {!locked && task.postedAt && (
        <p className="mt-1 text-ui text-x-secondary">게시된 작업엔 예약을 붙일 수 없어요. 이 방문으로 게시물이 하나 더 있으면 아래 같은 방문 게시물의 [게시물 하나 더]를 눌러 주세요.</p>
      )}
      {!locked && !task.postedAt && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* 예약 창(onAddReservation)은 클리닉을 스스로 확인한다 — 여기서 미리 막지 않는다. 이 상자 안에서 바로 쓰는 길(startEdit)만 클리닉이 필요하다 */}
          <Button variant={phase === 'unregistered' || phase === 'waiting' || phase === null ? 'primary' : undefined}
                  disabled={busy || !task.influencerHandle || (!onAddReservation && !templateClinic)} onClick={onAddReservation ?? startEdit}>이 작업에 예약 추가</Button>
          {phase === 'visited' && <Button variant="ghost" onClick={() => onReveal?.('posting')}>게시로 이동 ↓</Button>}
          {cancelBtn}
        </div>
      )}
      {!task.influencerHandle && !locked && <p className="mt-2 text-right text-ui text-x-muted">인플루언서를 먼저 배정해 주세요.</p>}
      {task.influencerHandle && !onAddReservation && clinicLoaded && !templateClinic && !locked && <p className="mt-2 text-right text-ui text-x-muted">캠페인의 클리닉을 먼저 연결해 주세요.</p>}
    </>}
    {/* 예약 없는 기존 작업에 이 상자 안에서 바로 예약을 쓰는 길(onAddReservation이 없을 때만) — 1 고객 양식 → 2 응답 확인·기재 시트 */}
    {inlineEditing && <fieldset disabled={busy} className="mt-3 space-y-3 rounded-lg border border-x-border bg-x-surface p-3">
      <nav className="flex gap-2 text-ui"><Button onClick={() => setStep(1)}>1 고객 양식</Button><Button onClick={() => setStep(2)}>2 응답 확인·기재 시트</Button></nav>
      {step === 1 ? <><p className="text-ui text-x-secondary">고객에게 양식을 보내고 응답을 받은 뒤 다음 단계로 진행해 주세요.</p><pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-ui">{templateClinic?.templates.form?.body.replace(/\{\{handle\}\}/g, task.influencerHandle ?? '').replace(/\{\{clinic\}\}/g, templateClinic.name) || '클리닉에 저장된 고객 양식이 없어요. 클리닉 설정에서 추가해 주세요.'}</pre><Link className="text-ui text-x-blue-text underline" href={`/clients?client=${campaign.clientId}&tab=forms`}>클리닉 양식 설정</Link><Button variant="primary" onClick={() => setStep(2)}>고객 응답 입력으로</Button></> : <>
        <label className="block text-ui">고객이 보낸 응답<textarea rows={5} value={source} onChange={(e) => setSource(e.target.value)} className={`${INPUT} mt-1`} /></label><p className="text-ui text-x-secondary">버튼을 누르면 AI가 응답에서 예약 정보를 읽어요. 사용 비용이 발생하며, 저장 전 직접 확인해야 해요.</p><Button disabled={!source.trim()} onClick={() => void run(async () => {
          const job = await save<{ result: { sheetText: string; summary: string; locationId: string | null } }>('reservation-extractions', { sourceText: source, personId: taskInfo?.personId, locationId: representativeId });
          setSheet(job.result.sheetText); setNotice(job.result.summary);
          if (multi) setEditLocationId(job.result.locationId);
        })}>응답에서 예약 정보 가져오기</Button>
        {branchField(`${uid}-branch-inline`)}
        <div className="grid grid-cols-2 gap-3"><label className="text-ui">희망 날짜<input type="date" className={`${INPUT} mt-1`} value={fields.preferred.slice(0, 10)} onChange={(e) => patch('preferred', `${e.target.value}T${fields.preferred.slice(11, 16)}`)} /></label><label className="text-ui">희망 시간<input type="time" className={`${INPUT} mt-1`} value={fields.preferred.slice(11, 16)} onChange={(e) => patch('preferred', `${fields.preferred.slice(0, 10)}T${e.target.value}`)} /></label><label className="text-ui">한글 이름<input className={`${INPUT} mt-1`} value={names.korean} onChange={(e) => patch('name', formatReservationName({ ...names, korean: e.target.value }))} /></label><label className="text-ui">로마자 이름<input className={`${INPUT} mt-1`} value={names.roman} onChange={(e) => patch('name', formatReservationName({ ...names, roman: e.target.value }))} /></label></div>
        <label className="block text-ui">희망 시술<input className={`${INPUT} mt-1`} value={fields.treatment} onChange={(e) => patch('treatment', e.target.value)} /></label>
        <label className="block text-ui">업로드 기한<input type="date" className={`${INPUT} mt-1`} value={fields.uploadDeadline} onChange={(e) => { setMode('manual'); patch('uploadDeadline', e.target.value); }} /></label><Button onClick={resetDeadline}>기본 기한으로 · 방문 후 14일</Button>
        {hoursNotice('rounded-lg bg-amber-50 p-2 text-ui text-amber-800')}
        <label className="block text-ui">최종 기재 시트<textarea rows={10} value={sheet} className={`${INPUT} mt-1 font-mono`} onChange={(e) => editSheet(e.target.value)} /></label><p className="text-ui text-x-secondary">원문과 날짜·이름·시술을 비교해 주세요. 추가 문구와 줄바꿈도 저장돼요.</p>
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!sheet.trim()} onClick={() => void commit(false, true)}>기재 시트 복사·대기 저장</Button>{copyFailed && <Button onClick={() => void commit(false)}>직접 복사했어요 · 대기 저장</Button>}<Button onClick={closeEditor}>닫기</Button></div>
      </>}
    </fieldset>}
    {/* 예약 수정 창(목업 x-extension '예약 수정' Modal, wide) — 사유 줄 → 입력란 두 열 → 운영시간 안내 → 기재 시트 전체 편집·저장본 비교 → 오류 → 바닥 [닫기] · [✓ 예약 확정] [예약 수정 저장].
        입력은 전부 기재 시트(sheet)에 바로 반영된다(patch) — 저장은 기존 commit 그대로. 닫기(✕·Esc·바깥·[닫기])는 고친 게 있으면 한 번 묻는다. */}
    {editDialogOpen && detail && (
      <DialogShell heading="예약 수정" wide busy={busy} onClose={closeEditor}>
        <fieldset disabled={busy} className="grid gap-4 px-6 py-5">
          {notice && <p role="status" className="rounded-lg bg-[#f0f9ff] px-3 py-2.5 text-ui text-[#245c7e]">{notice}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {needsReason
              ? <>
                  {reason && <span className="inline-flex w-fit rounded-md bg-[#e8f4fd] px-1.5 py-0.5 text-caption font-semibold text-[#1573ad]">{reasonBadgeText(reason, detail.customerRequestCount)}</span>}
                  {actions.includes('edit_reservation') && <Button variant="ghost" onClick={() => setReasonPicking(true)}>{reason ? '사유 바꾸기' : '수정 사유 선택'}</Button>}
                </>
              : <span className="text-ui text-x-muted">확정 전에는 바로 수정할 수 있어요.</span>}
            <span className="ml-auto text-ui text-x-muted">한국 시간 기준</span>
          </div>
          {branchField(`${uid}-branch`)}
          <div className="grid grid-cols-2 gap-3">
            <div className="text-ui text-x-secondary">희망 일시
              <div className="mt-1 grid grid-cols-[1fr_120px] gap-2">
                <input type={preferredDate && !isDateOnlyString(preferredDate) ? 'text' : 'date'} aria-label="희망 날짜" className={INPUT} value={preferredDate} onChange={(e) => patch('preferred', !e.target.value || isDateOnlyString(e.target.value) ? `${e.target.value}T${preferredTime}` : e.target.value)} />
                <input type="time" aria-label="희망 시간" className={INPUT} value={preferredTime} disabled={!structuredPreferred} onChange={(e) => patch('preferred', `${preferredDate}T${e.target.value}`)} />
              </div>
              {!structuredPreferred && <small className="mt-1 block text-caption text-x-muted">고객의 요청 문구예요. 예약 확정 전 연도·날짜·시간을 지정해 주세요.</small>}
            </div>
            <label className="block text-ui text-x-secondary">업로드 기한
              <div className="mt-1 flex items-center gap-2">
                <input type="date" className={INPUT} value={fields.uploadDeadline} onChange={(e) => { setMode('manual'); patch('uploadDeadline', e.target.value); }} />
                <Button variant="ghost" className="shrink-0" onClick={resetDeadline}>기본 기한으로</Button>
              </div>
              <small className="mt-1 block text-caption text-x-muted">{deadlineHint(fields.uploadDeadline, mode === 'default')}</small>
            </label>
            <label className="block text-ui text-x-secondary">제2희망 일시<input type={!fields.preferred2 || validDateTime(fields.preferred2) ? 'datetime-local' : 'text'} className={`${INPUT} mt-1`} value={fields.preferred2} onChange={(e) => patch('preferred2', e.target.value)} /></label>
            <div className="text-ui text-x-secondary">이름(한글/로마자)
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input aria-label="한글 이름" placeholder="한글" className={INPUT} value={names.korean} onChange={(e) => patch('name', formatReservationName({ ...names, korean: e.target.value }))} />
                <input aria-label="로마자 이름" placeholder="로마자" className={INPUT} value={names.roman} onChange={(e) => patch('name', formatReservationName({ ...names, roman: e.target.value }))} />
              </div>
            </div>
            <label className="block text-ui text-x-secondary">초진/재진<input className={`${INPUT} mt-1`} value={fields.visitType} onChange={(e) => patch('visitType', e.target.value)} /></label>
            <label className="block text-ui text-x-secondary">성별<input className={`${INPUT} mt-1`} value={fields.gender} onChange={(e) => patch('gender', e.target.value)} /></label>
            <label className="block text-ui text-x-secondary">생년월일<input type={!fields.birthDate || isDateOnlyString(fields.birthDate) ? 'date' : 'text'} className={`${INPUT} mt-1`} value={fields.birthDate} onChange={(e) => patch('birthDate', e.target.value)} /></label>
            <label className="block text-ui text-x-secondary">한국어 가능 여부<input className={`${INPUT} mt-1`} value={fields.koreanAbility} onChange={(e) => patch('koreanAbility', e.target.value)} /></label>
            <label className="col-span-2 block text-ui text-x-secondary">희망 시술<input className={`${INPUT} mt-1`} value={fields.treatment} onChange={(e) => patch('treatment', e.target.value)} /></label>
          </div>
          {hoursNotice('rounded-lg border border-[#d8ebf8] bg-[#f0f8fe] px-3 py-2.5 text-[12px] text-[#245c7e]')}
          <details>
            <summary className="cursor-pointer text-ui text-x-secondary">기재 시트 전체 편집</summary>
            <textarea rows={10} value={sheet} aria-label="수정 기재 시트" className={`${INPUT} mt-2 font-mono`} onChange={(e) => editSheet(e.target.value)} />
            <p className="mt-1 text-caption text-x-muted">위 입력란은 이 시트의 해당 줄을 고쳐요. 추가 문구와 줄바꿈도 함께 저장돼요.</p>
          </details>
          <details>
            <summary className="cursor-pointer text-ui text-x-secondary">현재 서버에 저장된 내용과 비교</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui">{detail.sheetText}</pre>
          </details>
          {error && <div role="alert" className="rounded-lg border border-[#f4d9d3] bg-[#fff5f3] px-3 py-2.5 text-[12px] text-[#a44334]">{error}</div>}
        </fieldset>
        <div className="flex items-center justify-between gap-2 border-t border-x-border px-6 py-3">
          <Button disabled={busy} onClick={closeEditor}>닫기</Button>
          <div className="flex items-center gap-2">
            {actions.includes('confirm') && <Button disabled={busy || !sheet.trim()} onClick={() => void commit(true)}>✓ 예약 확정</Button>}
            <Button variant="primary" disabled={busy || !sheet.trim() || (needsReason && !reason)} onClick={() => void commit(false)}>{busy ? '저장 중…' : '예약 수정 저장'}</Button>
          </div>
        </div>
      </DialogShell>
    )}
    {reasonPicking && (
      // 수정 폼이 이미 열려 있으면([사유 바꾸기]) 사유만 바꾼다 — 입력 중인 내용을 지우지 않는다
      <ChangeReasonDialog requestCount={detail?.customerRequestCount ?? 0}
        onChoose={(next) => { setReasonPicking(false); if (editing) setReason(next); else openEditor(next); }}
        onStopForLimit={detail && actions.includes('stop_for_change_limit') ? stopForLimit : undefined}
        onClose={() => setReasonPicking(false)} />
    )}
    {scheduleField && (
      <ScheduleEditorDialog
        title={scheduleField === 'preferred' ? '방문일 수정' : '업로드 기한 수정'}
        hasReservation={!!detail}
        initialValue={scheduleField === 'preferred' ? (detail ? fields.preferred : (task.visitOn ? (task.visitTime ? `${task.visitOn}T${task.visitTime}` : task.visitOn) : '')) : (detail ? fields.uploadDeadline : (task.scheduledOn ?? ''))}
        withTime={scheduleField === 'preferred'} timeOptional={!detail}
        minimumDate={scheduleField === 'uploadDeadline' ? (detail ? fields.preferred.slice(0, 10) : (task.visitOn ?? '')) : undefined}
        defaultDeadline={scheduleField === 'uploadDeadline' ? (detail ? defaultUploadDeadline(fields.preferred) : (task.visitOn ? defaultUploadDeadline(task.visitOn) : '')) || undefined : undefined}
        askReason={needsReason} allowCustomerRequest={actions.includes('edit_reservation')}
        requestCount={detail?.customerRequestCount ?? 0}
        guidanceFor={guidanceFor}
        onApply={saveSchedule}
        onStopForLimit={detail && actions.includes('stop_for_change_limit') ? stopForLimit : undefined}
        onClose={() => setScheduleField(null)} />
    )}
  </div></PanelSection>
  {detail && (
    // 예약 변경 내역(목업 x-extension) — 접힌 요약: 인플 요청 n/3 · 최근 변경 시각. 펼치면 [자세히 보기]가 [접기]로.
    <PanelSection id="task-history" title="예약 변경 내역" disclosure={historyDisclosure} actionLabel="자세히 보기"
                  summary={<>
                    <span>인플 요청 {detail.customerRequestCount}/3</span>
                    <span>{history?.items[0] ? `최근 변경 ${changedAtLabel(String(history.items[0].createdAt))}` : '변경 내역 없음'}</span>
                  </>}>
      <div className="space-y-2">
        <p className="text-ui text-x-muted">대기 중 수정과 내 입력 정정은 횟수에서 제외해요.</p>
        {history && !history.total && <p className="text-ui text-x-muted">아직 변경 내역이 없어요.</p>}
        {history?.items.map((item) => <div key={String(item.id)} className="rounded-lg border border-x-border p-3 text-ui"><p className="font-medium">{item.event === 'create' ? '예약 등록' : item.event === 'confirm' ? '예약 확정' : item.event === 'stop' ? '요청 기록·협찬 중단' : item.reason === 'customer_request' ? '고객 요청 변경' : item.reason === 'correction' ? '내 입력 정정' : '예약 수정 · 확정 전'} · {String(item.actorName)}</p><p className="text-x-muted">{changedAtLabel(String(item.createdAt))}</p>{(item.differences as { label: string; before: string; after: string }[]).map((d, i) => <p key={i}>{d.label}: {d.before || '미입력'} → {d.after || '미입력'}</p>)}</div>)}
        {(history?.total ?? 0) > 3 && <Button variant="ghost" onClick={() => setAllHistory((v) => !v)}>{allHistory ? '최근 3건만 보기' : `전체 ${history!.total}건 보기`}</Button>}
      </div>
    </PanelSection>
  )}
  </>;
}
