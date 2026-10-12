'use client';
import { useEffect, useRef, useState } from 'react';
import { FLOW_STAGES, FLOW_STAGE_LABEL } from '@/lib/campaignJudgment';
import type {
  AvailableDraft,
  Branch,
  DemoTask,
  Person,
  Reason,
  ReservationEndKind,
  SaveMode,
  TaskDraftContent,
} from '../model';
import { TYPE_LABEL, VISIT_STAGES } from '../model';
import { campaigns, clients } from '../data';
import { locationLabel } from '../clinic-policy';
import {
  commonFlow,
  changedAt,
  canCompleteVisit,
  canEndReservation,
  completed,
  dateTime,
  endReservation,
  reservationActions,
  requestCount,
  saveReservation,
  stage,
  stopForLimit,
  timeGuidance,
  uploadWindow,
  updateReservationInput,
} from '../policy';
import {
  readClientSheet,
  readClientSheetInputs,
  updateClientSheetInput,
  type ClientSheetEditFields,
} from '../sheet';
import { Badge, Button, CopyButton, Field, Modal, Notice, Section } from './shared';
import { TaskMoney } from './TaskMoney';
import { ReservationNameFields } from './ReservationNameFields';
import { TaskSchedule } from './TaskSchedule';
import { ScheduleEditor } from './ScheduleEditor';
import { TaskDraft } from './TaskDraft';
import { TaskPosting } from './TaskPosting';
import { taskSectionOpen, type TaskSectionKey, type TaskSectionPrefs } from '../task-presentation';
import { TrashIcon } from '@/components/XIcons';
const EDIT_FIELDS: [keyof ClientSheetEditFields, string, string?][] = [
  ['preferred', '희망 일시', 'datetime-local'],
  ['uploadDeadline', '업로드 기한', 'date'],
  ['preferred2', '제2희망 일시', 'datetime-local'],
  ['name', '이름(한글/로마자)'],
  ['visitType', '초진/재진'],
  ['gender', '성별'],
  ['birthDate', '생년월일', 'date'],
  ['koreanAbility', '한국어 가능 여부'],
  ['treatment', '희망 시술 내용'],
  ['handle', 'X 계정'],
  ['profileUrl', '프로필 링크'],
];
export function ReservationPanel({
  task,
  now,
  person,
  branches,
  draft,
  onDraft,
  onChange,
  onClose,
  onRegister,
  onDelete,
  notify,
  trackUrl,
  navigation,
  availableDrafts,
  onContentDraft,
  sectionPrefs,
  onSectionChange,
}: {
  task: DemoTask;
  now: number | null;
  person: Person;
  branches: Branch[];
  draft?: string;
  onDraft: (value?: string) => void;
  onChange: (task: DemoTask) => void;
  onClose: () => void;
  onRegister: () => void;
  onDelete: () => void;
  notify: (s: string) => void;
  trackUrl: (url: string) => void;
  navigation: { index: number; total: number; previous: () => void; next: () => void };
  availableDrafts: AvailableDraft[];
  onContentDraft: (content?: TaskDraftContent, pickedId?: string) => void;
  sectionPrefs: TaskSectionPrefs;
  onSectionChange: (key: TaskSectionKey, open: boolean) => void;
}) {
  const consentInput = useRef<HTMLInputElement>(null);
  const [scheduleField, setScheduleField] = useState<'preferred' | 'uploadDeadline' | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'sheet' | 'source'>('info');
  const [view, setView] = useState<'reason' | 'edit' | 'schedule' | 'limit' | 'end' | 'failure' | null>(null);
  const [reason, setReason] = useState<Reason>('correction');
  const historyOpen = taskSectionOpen(task, 'history', sectionPrefs);
  const [allHistory, setAllHistory] = useState(false),
    [error, setError] = useState(''),
    [fileError, setFileError] = useState('');
  const [saveMode, setSaveMode] = useState<SaveMode>('success');
  const [conflict, setConflict] = useState<DemoTask | null>(null);
  const [endKind, setEndKind] = useState<ReservationEndKind>('취소'),
    [endReason, setEndReason] = useState('');
  const [endError, setEndError] = useState('');
  const [endReturn, setEndReturn] = useState<'edit' | null>(null);
  const [detailError, setDetailError] = useState('');
  const r = task.reservation,
    fields = r ? readClientSheetInputs(r.sheet) : null;
  const sheet = draft ?? r?.sheet ?? '',
    inputs = readClientSheetInputs(sheet);
  const window = uploadWindow(r ? readClientSheet(r.sheet).preferred : '');
  const branch = branches.find((b) => b.id === r?.branchId);
  const locked = !!task.end || completed(task),
    count = requestCount(task);
  const actions = reservationActions(task, now);
  const currentStage = stage(task);
  const disclosure = (key: TaskSectionKey) => ({
    open: taskSectionOpen(task, key, sectionPrefs),
    onToggle: () => onSectionChange(key, !taskSectionOpen(task, key, sectionPrefs)),
  });
  function reveal(key: TaskSectionKey) {
    onSectionChange(key, true);
    requestAnimationFrame(() => {
      const section = document.getElementById(`task-${key}`);
      section?.scrollIntoView({ block: 'nearest' });
      const control = section?.querySelector<HTMLElement>(
        '.mock-section-content input:not([hidden]):not([type="file"]), .mock-section-content button:not([disabled])',
      );
      control?.focus({ preventScroll: true });
    });
  }
  function replacePerson() {
    notify('목업: 인플루언서 교체 창은 실제 화면과 같아요. 예약·변경 내역은 새 인플루언서로 넘어가지 않아요.');
  }
  const prePost = !task.end && !task.posted;
  // 실제 작업 패널의 ··· 메뉴(FlowRowMenu)와 같은 항목·순서
  const menu: MenuItem[] = [
    ...(prePost
      ? [
          { label: '게시 확인', onSelect: () => reveal('posting') },
          { label: '예정일 바꾸기', onSelect: () => startSchedule('uploadDeadline') },
        ]
      : []),
    ...(task.type === 'rt' || task.end
      ? []
      : [{ label: task.draft ? '원고 열기' : '원고 쓰기', onSelect: () => reveal('draft') }]),
    ...(prePost
      ? [
          'divider' as const,
          { label: '인플루언서 교체', onSelect: replacePerson },
          {
            label: '작업 취소',
            danger: true,
            disabled: !(actions.cancel || actions.noShow),
            onSelect: () => {
              setEndReturn(null);
              setView('failure');
            },
          },
        ]
      : []),
    'divider',
    { label: '삭제', danger: true, onSelect: onDelete },
  ];
  const endAllowed = canEndReservation(task, endKind, now);
  const history = (r?.history ?? [])
    .map((h, i, arr) => ({
      ...h,
      ordinal: arr.slice(0, i + 1).filter((c) => c.reason === 'customer_request').length,
    }))
    .reverse();
  function startEdit() {
    setScheduleField(null);
    setReason(r?.phase === 'waiting' ? 'waiting_edit' : 'correction');
    setView(r?.phase === 'waiting' ? 'edit' : 'reason');
    setError('');
    setDetailError('');
    setConflict(null);
  }
  function startSchedule(field: 'preferred' | 'uploadDeadline') {
    if (locked) return;
    setScheduleField(field);
    setReason(r?.phase === 'confirmed' ? 'correction' : 'waiting_edit');
    setView(r?.phase === 'confirmed' ? 'reason' : 'schedule');
  }
  function closeEditor() {
    setScheduleField(null);
    setView(null);
  }
  function confirmSaved() {
    if (!r || r.phase !== 'waiting' || locked) return;
    // Review a preserved draft before confirmation instead of silently committing it.
    if (draft !== undefined) {
      startEdit();
      return;
    }
    try {
      onChange(saveReservation(task, r.sheet, 'correction', true));
      setDetailError('');
      notify('예약을 확정했어요.');
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '예약 정보를 확인해 주세요.');
    }
  }
  function startEnd(kind: ReservationEndKind, returnTo: 'edit' | null = null) {
    if (!canEndReservation(task, kind, Date.now())) {
      notify('예약 상태가 바뀌었어요. 현재 상태에 맞는 처리를 선택해 주세요.');
      return;
    }
    setEndKind(kind);
    setEndReason('');
    setEndError('');
    setEndReturn(returnTo);
    setView('end');
  }
  function choose(next: Reason) {
    setReason(next);
    setView(next === 'customer_request' && count >= 3 ? 'limit' : scheduleField ? 'schedule' : 'edit');
  }
  function save(confirm: boolean) {
    try {
      const next = saveReservation(task, sheet, reason, confirm);
      if (saveMode === 'failure') {
        setError('저장하지 못했어요. 입력은 보존했어요. 다시 시도해 주세요.');
        setSaveMode('success');
        return;
      }
      if (saveMode === 'conflict' && r) {
        const latest = saveReservation(
          task,
          updateClientSheetInput(r.sheet, 'treatment', '리쥬란 · 다른 담당자가 수정'),
          'correction',
        );
        onDraft(sheet);
        setConflict(latest);
        setError('다른 담당자가 먼저 수정했어요. 최신 저장본과 내 입력을 확인해 주세요.');
        return;
      }
      onChange(next);
      onDraft(undefined);
      setView(null);
      setError('');
      notify(confirm ? '예약을 확정했어요.' : '예약 수정을 완료했어요.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '입력을 확인해 주세요.');
    }
  }
  function saveSchedule(value: string, editReason: Reason) {
    if (!scheduleField || locked) return '종료된 일정은 수정할 수 없어요.';
    try {
      if (r) {
        const next = saveReservation(task, updateReservationInput(r.sheet, scheduleField, value), editReason);
        onChange(next);
        if (draft !== undefined) onDraft(updateReservationInput(draft, scheduleField, value));
      } else {
        onChange(
          scheduleField === 'preferred' ? { ...task, visitOn: value } : { ...task, scheduledOn: value },
        );
      }
      closeEditor();
      notify(r ? '일정과 예약 폼을 함께 수정했어요.' : '일정을 수정했어요.');
    } catch (e) {
      return e instanceof Error ? e.message : '일정을 확인해 주세요.';
    }
  }
  async function attach(file?: File) {
    if (!file || !r) return;
    const header = await file.slice(0, 5).text();
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== 'application/pdf') ||
      header !== '%PDF-' ||
      file.size > 10 * 1024 * 1024
    ) {
      setFileError('10 MB 이하의 PDF 파일을 선택해 주세요. 기존 첨부는 유지했어요.');
      return;
    }
    const url = URL.createObjectURL(file);
    trackUrl(url);
    if (r.consent) URL.revokeObjectURL(r.consent.url);
    onChange({
      ...task,
      reservation: {
        ...r,
        consent: { name: file.name, size: file.size, url, uploadedAt: new Date().toISOString() },
      },
    });
    setFileError('');
    notify('동의서를 현재 세션에 첨부했어요.');
  }
  return (
    <aside
      className={`mock-task-panel ${task.type === 'visit' ? 'mock-visit-panel' : ''}`}
      aria-label="작업 상세"
    >
      <header className="mock-detail-header mock-task-header">
        <h2 title={campaigns.find((c) => c.id === task.campaignId)?.name}>@{person.handle}</h2>
        <div className="mock-task-header-tools">
          <TaskMenu items={menu} />
          <button type="button" className="mock-task-header-icon" onClick={onClose} aria-label="작업 상세 닫기">
            ✕
          </button>
        </div>
      </header>
      <div className="mock-detail-body">
        <section className="mock-section mock-task-stage-card" aria-label="단계와 유형">
          <div className="mock-task-stage-row">
            <b>단계</b>
            <div className="mock-task-stages" aria-label="작업 단계">
              {(task.type === 'visit'
                ? [...VISIT_STAGES, ...(task.end ? [task.end.kind] : [])].map((label) => ({
                    id: label,
                    label,
                  }))
                : FLOW_STAGES.filter((s) => s !== 'canc' || task.end).map((s) => ({
                    id: s,
                    label: FLOW_STAGE_LABEL[s],
                  }))
              ).map(({ id, label }) => {
                const current = (task.type === 'visit' ? stage(task) : commonFlow(task)) === id;
                return (
                  <span
                    key={id}
                    aria-current={current ? 'step' : undefined}
                    className={current ? `current ${task.end ? 'ended' : ''}` : ''}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="mock-task-stage-row">
            <b>유형</b>
            <span className={`mock-task-type ${task.type}`}>{TYPE_LABEL[task.type]}</span>
          </div>
        </section>
        <Section title="인플루언서">
          <div className="mock-task-influencer">
            <span className="mock-person-avatar" aria-hidden>
              {person.name[0]}
            </span>
            <div>
              <strong>{person.name}</strong>
              <p className="mock-muted">@{person.handle}</p>
            </div>
            {!task.end && (
              // 목업 인플은 X 숫자 ID가 없어 DM 대신 프로필을 새 탭으로 연다.
              <a
                className="mock-profile-link"
                href={`https://x.com/${person.handle}`}
                target="_blank"
                rel="noreferrer"
                title={`X에서 @${person.handle}에게 DM — 목업에서는 프로필이 새 탭으로 열려요`}
              >
                DM <span aria-hidden>↗</span>
              </a>
            )}
            {prePost && (
              <span className="mock-task-influencer-tools">
                <button type="button" onClick={replacePerson}>
                  바꾸기
                </button>
                <button type="button" onClick={() => notify('목업: 인플루언서를 미정으로 되돌렸어요.')}>
                  해제
                </button>
              </span>
            )}
          </div>
        </Section>
        <Section title="일정" aside={<span className="mock-muted">한국 시간</span>}>
          <TaskSchedule task={task} locked={locked} onEditDate={startSchedule} onChange={onChange} />
          {task.type === 'visit' && (
            <>
              {task.end && (
                <Notice danger>
                  <b>
                    {task.end.kind} · {task.end.reason}
                  </b>
                  <br />
                  {changedAt(task.end.at)} · 종료된 예약은 읽기 전용이에요.
                </Notice>
              )}
              {r ? (
                <>
                  <p className="mock-reservation-summary">
                    <strong>
                      {branch
                        ? locationLabel(branch, clients.find((c) => c.id === branch.clientId)?.name ?? '')
                        : '클리닉 미등록'}
                    </strong>
                    <span>
                      {fields?.name || '예약자 미입력'} · {fields?.treatment || '시술 미입력'}
                    </span>
                  </p>
                  <div className="mock-reservation-actions">
                    {!locked && (
                      <>
                        <div className="mock-current-task">
                          <div>
                            <span className="mock-current-task-label">지금 할 일</span>
                            <p>
                              {actions.confirm
                                ? '희망 일시를 확인하고 예약을 확정해 주세요.'
                                : actions.completeVisit
                                  ? '오늘 방문 여부를 확인해 주세요.'
                                  : currentStage === '확정'
                                    ? '방문 일정과 협찬 동의서를 확인해 주세요.'
                                    : currentStage === '방문'
                                      ? '원고와 게시물을 확인해 주세요.'
                                      : currentStage === '업로드'
                                        ? '금액과 결제 수단을 확인하고 정산을 요청해 주세요.'
                                        : '지급 결과를 확인하고 완료해 주세요.'}
                            </p>
                          </div>
                          {actions.confirm && (
                            <Button variant="primary" onClick={confirmSaved}>
                              예약 확정
                            </Button>
                          )}
                          {actions.completeVisit && (
                            <Button
                              variant="primary"
                              onClick={() => {
                                if (!canCompleteVisit(task, Date.now())) {
                                  notify('방문 완료는 희망일 당일에만 직접 처리할 수 있어요.');
                                  return;
                                }
                                onChange({ ...task, visited: true });
                                notify('방문 완료로 기록했어요.');
                              }}
                            >
                              방문 완료
                            </Button>
                          )}
                          {currentStage === '확정' && !actions.completeVisit && !r.consent && (
                            <Button onClick={() => reveal('consent')}>동의서 확인</Button>
                          )}
                          {currentStage === '방문' && (
                            <Button variant="ghost" onClick={() => reveal('posting')}>
                              게시로 이동 ↓
                            </Button>
                          )}
                          {(currentStage === '업로드' || currentStage === '정산') && (
                            <Button variant="ghost" onClick={() => reveal('money')}>
                              정산으로 이동 ↓
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                    {detailError && <Notice danger>{detailError}</Notice>}
                  </div>
                  {draft !== undefined && !locked && (
                    <p className="mock-muted">
                      작성 중인 수정 초안이 있어요. {actions.confirm ? '예약 수정 또는 확정' : '예약 수정'} 시
                      {r.phase === 'waiting'
                        ? '내용을 이어서 확인해 주세요.'
                        : '사유를 선택하고 이어서 확인해 주세요.'}
                    </p>
                  )}
                  <div className="mock-schedule-toolbar">
                    <button
                      className="mock-reservation-details-toggle"
                      aria-expanded={detailsOpen}
                      aria-controls="reservation-details"
                      onClick={() => setDetailsOpen((v) => !v)}
                    >
                      {detailsOpen ? '접기' : '자세히 보기'}{' '}
                      <span aria-hidden>{detailsOpen ? '⌃' : '⌄'}</span>
                    </button>
                    {!locked && (
                      <div className="mock-schedule-tools" role="group" aria-label="예약 관리">
                        <Button variant="ghost" onClick={startEdit}>
                          예약 수정
                        </Button>
                        {(actions.cancel || actions.noShow) && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEndReturn(null);
                              setView('failure');
                            }}
                          >
                            취소·노쇼
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {detailsOpen && (
                    <div id="reservation-details" className="mock-reservation-details">
                      <div className="mock-tabs" role="tablist" aria-label="예약 상세 보기">
                        {(
                          [
                            ['info', '예약 정보'],
                            ['sheet', '기재 시트'],
                            ['source', '고객 원문'],
                          ] as const
                        ).map(([id, label], i, tabs) => (
                          <button
                            key={id}
                            id={`reservation-tab-${id}`}
                            role="tab"
                            aria-selected={detailTab === id}
                            aria-controls={`reservation-tabpanel-${id}`}
                            tabIndex={detailTab === id ? 0 : -1}
                            className={detailTab === id ? 'active' : ''}
                            onClick={() => setDetailTab(id)}
                            onKeyDown={(e) => {
                              const next =
                                e.key === 'ArrowRight'
                                  ? (i + 1) % tabs.length
                                  : e.key === 'ArrowLeft'
                                    ? (i + tabs.length - 1) % tabs.length
                                    : e.key === 'Home'
                                      ? 0
                                      : e.key === 'End'
                                        ? tabs.length - 1
                                        : -1;
                              if (next < 0) return;
                              e.preventDefault();
                              setDetailTab(tabs[next][0]);
                              document.getElementById(`reservation-tab-${tabs[next][0]}`)?.focus();
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div
                        role="tabpanel"
                        id={`reservation-tabpanel-${detailTab}`}
                        aria-labelledby={`reservation-tab-${detailTab}`}
                        tabIndex={0}
                      >
                        {detailTab === 'info' && (
                          <dl className="mock-definition">
                            <dt>방문 클리닉</dt>
                            <dd>
                              {branch
                                ? locationLabel(
                                    branch,
                                    clients.find((c) => c.id === branch.clientId)?.name ?? '',
                                  )
                                : '미등록'}
                            </dd>
                            <dt>예약자</dt>
                            <dd>{fields?.name || '미입력'}</dd>
                            <dt>희망 시술</dt>
                            <dd>{fields?.treatment || '미입력'}</dd>
                            <dt>초진/재진</dt>
                            <dd>{fields?.visitType || '미입력'}</dd>
                            <dt>성별 · 생년월일</dt>
                            <dd>
                              {fields?.gender || '미입력'} · {fields?.birthDate || '미입력'}
                            </dd>
                            <dt>한국어 가능 여부</dt>
                            <dd>{fields?.koreanAbility || '미입력'}</dd>
                            {fields?.preferred2 && (
                              <>
                                <dt>제2희망 일시</dt>
                                <dd>{dateTime(fields.preferred2)}</dd>
                              </>
                            )}
                            {r.phase === 'confirmed' &&
                              !task.visited &&
                              !task.posted &&
                              !task.end &&
                              window && (
                                <>
                                  <dt>방문 처리</dt>
                                  <dd>
                                    <small>
                                      {window.start} 00:00에 방문으로 자동 변경 · 한국 시간
                                      <br />
                                      희망일 당일에는 직접 방문 완료를 처리할 수도 있어요.
                                    </small>
                                  </dd>
                                </>
                              )}
                            {task.visited && r.phase === 'confirmed' && (
                              <>
                                <dt>방문 기록</dt>
                                <dd>방문 완료</dd>
                              </>
                            )}
                            {r.phase === 'waiting' && task.visitOn && (
                              <>
                                <dt>기존 방문 기록</dt>
                                <dd>
                                  {task.visitOn} · 시간 미정
                                  {task.visited && (
                                    <small>기존 방문 완료 기록 유지 · 예약 상세는 조율 대기</small>
                                  )}
                                </dd>
                              </>
                            )}
                          </dl>
                        )}
                        {detailTab === 'sheet' && (
                          <>
                            <Field label="저장한 기재 시트">
                              <textarea readOnly value={r.sheet} rows={12} />
                            </Field>
                            <CopyButton key={r.sheet} text={r.sheet} label="기재 시트 복사" />
                          </>
                        )}
                        {detailTab === 'source' && (
                          <>
                            <p className="mock-muted">
                              고객이 보낸 원문이에요. 예약을 수정해도 원문은 유지해요.
                            </p>
                            <pre>{r.source || '수동 작성한 예약이에요.'}</pre>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Notice>
                    예약 상세가 없는 기존 방문 작업이에요.
                    {task.visitOn && (
                      <>
                        <br />
                        기존 방문일 {task.visitOn} · 시간 미정
                      </>
                    )}
                    {task.visited && (
                      <>
                        <br />
                        기존 방문 완료 기록을 유지해요.
                      </>
                    )}
                  </Notice>
                  {!locked && (
                    <div className="mock-schedule-tools">
                      <Button variant={currentStage === '대기' ? 'primary' : 'subtle'} onClick={onRegister}>
                        이 작업에 예약 추가
                      </Button>
                      {currentStage === '방문' && (
                        <Button variant="ghost" onClick={() => reveal('posting')}>
                          게시로 이동 ↓
                        </Button>
                      )}
                      {(actions.cancel || actions.noShow) && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEndReturn(null);
                            setView('failure');
                          }}
                        >
                          취소·노쇼
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Section>
        {r && (
          <Section
            title="예약 변경 내역"
            disclosure={disclosure('history')}
            actionLabel="자세히 보기"
            summary={
              <>
                <span>인플 요청 {count}/3</span>
                <span>{history[0] ? `최근 변경 ${changedAt(history[0].at)}` : '변경 내역 없음'}</span>
              </>
            }
          >
            {historyOpen && (
              <div id="reservation-history">
                <p className="mock-muted">대기 중 수정과 내 입력 정정은 횟수에서 제외해요.</p>
                {history.length === 0 ? (
                  <p className="mock-empty-small">아직 변경 내역이 없어요.</p>
                ) : (
                  (allHistory ? history : history.slice(0, 3)).map((h) => (
                    <article className="mock-history" key={h.id}>
                      <div>
                        <b>
                          {h.reason === 'waiting_edit'
                            ? '예약 수정 · 확정 전'
                            : h.reason === 'correction'
                              ? '내 입력 정정 · 횟수 제외'
                              : `${h.ordinal}회 인플루언서 요청`}
                        </b>
                        <time>{changedAt(h.at)}</time>
                      </div>
                      {h.stopped ? (
                        <p className="mock-danger-text">예약 변경 횟수 초과로 협찬 중단</p>
                      ) : h.differences ? (
                        h.differences.map((d, i) =>
                          d.field === 'sheet' ? (
                            <details key={i}>
                              <summary>{d.label} 전후 보기</summary>
                              <pre>{d.before}</pre>
                              <p>↓ 변경 후</p>
                              <pre>{d.after}</pre>
                            </details>
                          ) : (
                            <p key={i}>
                              <span className="mock-muted">{d.label}</span> <span>{dateTime(d.before)}</span>{' '}
                              <span aria-label="변경 후">→</span> <strong>{dateTime(d.after)}</strong>
                            </p>
                          ),
                        )
                      ) : (
                        <p className="mock-muted">변경 전후 내용이 저장되지 않은 기록이에요.</p>
                      )}
                    </article>
                  ))
                )}
                {history.length > 3 && (
                  <Button variant="ghost" onClick={() => setAllHistory((v) => !v)}>
                    {allHistory ? '최근 3건만 보기' : `전체 ${history.length}건 보기`}
                  </Button>
                )}
              </div>
            )}
          </Section>
        )}
        {task.type === 'visit' && (
          <Section
            title="협찬 동의서"
            id="task-consent"
            disclosure={disclosure('consent')}
            actionLabel={r?.phase === 'confirmed' && !r.consent && !locked ? '첨부' : '보기'}
            summary={
              <>
                {r?.consent ? (
                  <span title={r.consent.name}>{r.consent.name}</span>
                ) : (
                  <Badge tone={r?.phase === 'confirmed' && !locked ? 'amber' : ''}>동의서 미첨부</Badge>
                )}
                {!r?.consent && r?.phase !== 'confirmed' && !locked && <span>예약 확정 후 첨부</span>}
                {fileError && <span className="mock-danger-text">{fileError}</span>}
              </>
            }
          >
            {r?.consent ? (
              <div className="mock-consent-file">
                <span className="mock-pdf-icon">PDF</span>
                <div className="mock-consent-name">
                  <strong title={r.consent.name}>{r.consent.name}</strong>
                  <small>
                    {r.consent.uploadedAt ? `기획 담당자 · ${changedAt(r.consent.uploadedAt)} · ` : ''}
                    {(r.consent.size / 1024).toFixed(1)} KB
                  </small>
                </div>
                <a className="mock-profile-link" href={r.consent.url} target="_blank" rel="noreferrer">
                  보기 ↗
                </a>
                {!locked && (
                  <>
                    <Button variant="ghost" onClick={() => consentInput.current?.click()}>
                      바꾸기
                    </Button>
                    <Button
                      variant="icon"
                      aria-label="동의서 제거"
                      onClick={() => {
                        URL.revokeObjectURL(r.consent!.url);
                        onChange({ ...task, reservation: { ...r, consent: undefined } });
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <p className="mock-muted">
                {r?.phase === 'confirmed'
                  ? '첨부한 동의서가 없어요.'
                  : '예약 확정 후 동의서를 첨부할 수 있어요.'}
              </p>
            )}
            {r?.phase === 'confirmed' && !locked && (
              <>
                <input
                  ref={consentInput}
                  hidden
                  type="file"
                  aria-label="동의서 PDF"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    void attach(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {!r.consent && <Button onClick={() => consentInput.current?.click()}>PDF 첨부</Button>}
                <small className="mock-consent-help">PDF · 최대 10 MB</small>
              </>
            )}
            {fileError && <Notice danger>{fileError}</Notice>}
          </Section>
        )}
        <TaskMoney
          key={`${task.id}-${task.noCost}-${task.settlementActive}`}
          task={task}
          onChange={onChange}
          notify={notify}
          disclosure={task.type === 'visit' ? disclosure('money') : undefined}
        />
        {task.type !== 'rt' && (
          <TaskDraft
            task={task}
            locked={locked}
            available={availableDrafts}
            onSave={onContentDraft}
            disclosure={task.type === 'visit' ? disclosure('draft') : undefined}
          />
        )}
        <Section
          title="메모"
          id="task-memo"
          disclosure={task.type === 'visit' ? disclosure('memo') : undefined}
          actionLabel={locked ? '보기' : task.note ? '수정' : '추가'}
          summary={<span title={task.note}>{task.note || '메모 없음'}</span>}
        >
          <input
            aria-label="메모"
            value={task.note}
            readOnly={locked}
            onChange={(e) => onChange({ ...task, note: e.target.value })}
            placeholder="한 줄"
          />
        </Section>
        {task.type === 'visit' && (
          <TaskPosting task={task} onChange={onChange} notify={notify} disclosure={disclosure('posting')} />
        )}
      </div>
      <footer className="mock-task-footer">
        <Button disabled={navigation.index <= 0} onClick={navigation.previous}>
          ← 이전
        </Button>
        <span>
          {navigation.index < 0 ? '현재 필터에 없는 작업' : `${navigation.index + 1} / ${navigation.total}`}
        </span>
        <Button
          disabled={navigation.index < 0 || navigation.index >= navigation.total - 1}
          onClick={navigation.next}
        >
          다음 →
        </Button>
      </footer>
      {view === 'schedule' && scheduleField && (
        <ScheduleEditor
          hasReservation={!!r}
          title={scheduleField === 'preferred' ? '방문일 수정' : '업로드 기한 수정'}
          initialValue={
            scheduleField === 'preferred'
              ? fields?.preferred || task.visitOn
              : fields?.uploadDeadline || task.scheduledOn
          }
          withTime={scheduleField === 'preferred' && !!r}
          branch={branch}
          minimumDate={scheduleField === 'uploadDeadline' ? fields?.preferred.slice(0, 10) : undefined}
          defaultDeadline={scheduleField === 'uploadDeadline' ? window?.end : undefined}
          reason={reason}
          count={count}
          onApply={saveSchedule}
          onClose={closeEditor}
          onLimit={() => {
            setScheduleField(null);
            setView('limit');
          }}
        />
      )}
      {view === 'reason' && (
        <Modal title="수정 사유를 선택해 주세요" onClose={closeEditor}>
          <div className="mock-modal-body">
            <p className="mock-muted">실제로 변경한 내용을 저장했을 때만 이력이 남아요.</p>
            <button className="mock-reason" onClick={() => choose('customer_request')}>
              <b>인플루언서 요청</b>
              <span>예약 내용 변경 · 현재 {count}/3회</span>
            </button>
            <button className="mock-reason" onClick={() => choose('correction')}>
              <b>내 입력 정정</b>
              <span>잘못 입력한 내용 수정 · 요청 횟수 제외</span>
            </button>
          </div>
        </Modal>
      )}
      {view === 'limit' && (
        <Modal title="변경 요청 3회를 모두 사용했어요" onClose={closeEditor}>
          <div className="mock-modal-body">
            <Notice danger>
              네 번째 요청은 협찬 중단으로 기록해요. 기존 예약·기재 시트·첨부는 그대로 남아요.
            </Notice>
            <p className="mock-muted">이 안내를 닫으면 예약과 횟수는 바뀌지 않아요.</p>
          </div>
          <footer>
            <Button onClick={closeEditor}>뒤로가기</Button>
            <Button
              variant="primary"
              onClick={() => {
                onChange(stopForLimit(task));
                onDraft(undefined);
                setView(null);
                notify('4번째 요청을 기록하고 협찬을 중단했어요.');
              }}
            >
              요청 기록·협찬 중단
            </Button>
          </footer>
        </Modal>
      )}
      {view === 'edit' && (
        <Modal title="예약 수정" onClose={() => setView(null)} wide>
          <div className="mock-modal-body">
            <div className="mock-actions">
              {r?.phase === 'waiting' ? (
                <span className="mock-muted">확정 전에는 바로 수정할 수 있어요.</span>
              ) : (
                <>
                  <Badge tone="blue">
                    {reason === 'correction' ? '내 입력 정정 · 횟수 제외' : `인플루언서 요청 · ${count}/3`}
                  </Badge>
                  <Button variant="ghost" onClick={() => setView('reason')}>
                    사유 바꾸기
                  </Button>
                </>
              )}
              <span className="mock-muted">한국 시간 기준</span>
            </div>
            <div className="mock-grid two">
              {EDIT_FIELDS.map(([key, label, type]) =>
                key === 'name' ? (
                  <ReservationNameFields
                    key={key}
                    value={inputs.name}
                    onChange={(name) => onDraft(updateClientSheetInput(sheet, 'name', name))}
                  />
                ) : (
                  <div key={key} className={key === 'treatment' ? 'mock-span-two' : undefined}>
                    <Field label={label}>
                      <input
                        type={type ?? 'text'}
                        value={inputs[key]}
                        onChange={(e) => onDraft(updateReservationInput(sheet, key, e.target.value))}
                      />
                    </Field>
                  </div>
                ),
              )}
            </div>
            {branch && inputs.preferred && (
              <Notice>
                {timeGuidance(branch, inputs.preferred)}
                <small>
                  운영시간 밖 저장 정책은 검토 중이에요. 목업에서는 담당자가 확인 후 저장할 수 있어요.
                </small>
              </Notice>
            )}
            <details>
              <summary>기재 시트 전체 편집</summary>
              <textarea
                aria-label="수정 기재 시트"
                rows={10}
                value={sheet}
                onChange={(e) => onDraft(e.target.value)}
              />
            </details>
            <details>
              <summary>저장 실패·동시 수정 체험</summary>
              <Field label="저장 상황">
                <select
                  value={saveMode}
                  onChange={(e) => {
                    setSaveMode(e.target.value as SaveMode);
                    setConflict(null);
                    setError('');
                  }}
                >
                  <option value="success">정상 저장</option>
                  <option value="failure">저장 실패 1회</option>
                  <option value="conflict">다른 담당자의 수정</option>
                </select>
              </Field>
            </details>
            {error && <Notice danger>{error}</Notice>}
            {conflict?.reservation && (
              <div>
                <div className="mock-grid two">
                  <Field label="최신 저장본">
                    <textarea readOnly rows={8} value={conflict.reservation.sheet} />
                  </Field>
                  <Field label="내 입력 · 보존됨">
                    <textarea readOnly rows={8} value={sheet} />
                  </Field>
                </div>
                <Button
                  onClick={() => {
                    onChange(conflict);
                    setConflict(null);
                    setSaveMode('success');
                    setError('최신 값을 확인했어요. 보존된 내 입력을 검토한 뒤 수정 완료를 눌러 주세요.');
                  }}
                >
                  최신 값 확인 · 내 입력 유지
                </Button>
              </div>
            )}
          </div>
          <footer className="mock-reservation-edit-footer">
            <Button onClick={() => setView(null)}>뒤로가기 · 초안 유지</Button>
            <div className="mock-actions">
              {(actions.cancel || actions.noShow) && (
                <Button
                  disabled={!!conflict}
                  onClick={() => {
                    setEndReturn('edit');
                    setView('failure');
                  }}
                >
                  취소·노쇼
                </Button>
              )}
              <Button disabled={!!conflict} onClick={() => save(false)}>
                수정 완료
              </Button>
              {actions.confirm && (
                <Button variant="primary" disabled={!!conflict} onClick={() => save(true)}>
                  예약 확정
                </Button>
              )}
            </div>
          </footer>
        </Modal>
      )}
      {view === 'failure' && (
        <Modal title="취소·노쇼" onClose={() => setView(endReturn)}>
          <div className="mock-modal-body">
            <p className="mock-muted">현재 상황을 선택한 뒤 사유를 남겨 주세요.</p>
            {actions.cancel && (
              <button className="mock-reason" onClick={() => startEnd('취소', endReturn)}>
                <b>{r ? '예약 취소' : '작업 취소'}</b>
                <span>방문하기 전에 협찬을 취소했어요.</span>
              </button>
            )}
            {actions.noShow && (
              <button className="mock-reason" onClick={() => startEnd(actions.noShow!, endReturn)}>
                <b>{actions.noShow === '노쇼' ? '방문 노쇼' : '업로드 노쇼'}</b>
                <span>
                  {actions.noShow === '노쇼'
                    ? '예약일에 방문하지 않았어요.'
                    : '방문 후 약속한 콘텐츠를 올리지 않았어요.'}
                </span>
              </button>
            )}
          </div>
        </Modal>
      )}
      {view === 'end' && (
        <Modal
          title={
            endKind === '취소'
              ? r
                ? '예약 취소'
                : '작업 취소'
              : endKind === '노쇼'
                ? '노쇼 처리'
                : '업로드 노쇼'
          }
          onClose={() => setView(endReturn)}
        >
          <div className="mock-modal-body">
            <Notice>작업은 취소 단계로 표시하며, 예약과 첨부·변경 내역은 보존해요.</Notice>
            {endKind !== '취소' && (
              <p className="mock-muted">
                {endKind === '노쇼'
                  ? '방문일 당일 미방문 사유를 남겨 주세요.'
                  : '방문 후 콘텐츠 업로드 미이행 사유를 남겨 주세요. 방문 완료 기록은 유지해요.'}
              </p>
            )}
            <Field label="종료 사유">
              <textarea
                value={endReason}
                onChange={(e) => setEndReason(e.target.value)}
                rows={3}
                placeholder={
                  endKind === '업로드 노쇼'
                    ? '예: 방문 후 약속한 콘텐츠 미업로드'
                    : endKind === '노쇼'
                      ? '예: 연락 없이 미방문'
                      : '예: 인플루언서 일정 취소'
                }
              />
            </Field>
            {!endAllowed && (
              <Notice danger>예약 상태가 바뀌었어요. 돌아가서 현재 상태에 맞는 처리를 선택해 주세요.</Notice>
            )}
            {endError && <Notice danger>{endError}</Notice>}
          </div>
          <footer>
            <Button onClick={() => setView(endReturn)}>뒤로가기</Button>
            <Button
              variant="primary"
              disabled={!endReason.trim() || !endAllowed}
              onClick={() => {
                try {
                  onChange(endReservation(task, endKind, endReason, Date.now()));
                  onDraft(undefined);
                  setView(null);
                  notify(`${endKind}로 기록했어요.`);
                } catch (e) {
                  setEndError(e instanceof Error ? e.message : '예약 상태를 확인해 주세요.');
                }
              }}
            >
              {endKind} 기록
            </Button>
          </footer>
        </Modal>
      )}
    </aside>
  );
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'divider';
// 작업 패널 머리의 ··· 메뉴. 연속·끝 구분선은 그리지 않는다.
function TaskMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const rows = items.filter(
    (item, i) => item !== 'divider' || (i > 0 && i < items.length - 1 && items[i - 1] !== 'divider'),
  );
  return (
    <div className="mock-task-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="mock-task-header-icon"
        aria-label="작업 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>
      {open && (
        <div role="menu" aria-label="작업 메뉴">
          {rows.map((item, i) =>
            item === 'divider' ? (
              <hr key={`d${i}`} />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={item.danger ? 'danger' : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
