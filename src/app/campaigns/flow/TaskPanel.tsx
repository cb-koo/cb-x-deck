'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import { fetchTasksTargets, type TaskCreateRequest } from '@/lib/campaignApi';
import type { TaskCost } from '@/lib/campaignCost';
import {
  flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL, isOutOfRange, formatDateKo, type TaskType,
} from '@/lib/campaignJudgment';
import { taskOverdueDays, targetLabel } from '@/lib/campaignTableView';
import {
  PANEL_FIELD_ORDER, DISPLAY_TYPE_ORDER, costCell, replaceDisabledReason, detachConfirmMessage, type FlowRow, type PanelField,
} from '@/lib/campaignFlowView';
import { STATUS_LABEL } from '@/lib/draftStatus';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { InfluencerField } from '@/components/InfluencerField';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { Button } from '@/components/ui';
import { CostConfirmField } from './CostConfirmField';
import { TargetPicker, candidateLabel, type TargetValue } from '../TargetPicker';
import type { useCampaignTaskActions } from '../useCampaignTaskActions';
import { DraftMode, type DraftTab } from './draft/DraftMode';

// 편집 패널(b-task-7-brief.md §2) — 작업 하나(edit)와 새 작업(new)을 같은 골격에서 다룬다. 칸 순서는
// PANEL_FIELD_ORDER(campaignFlowView) 하나뿐 — 여기서 다시 적지 않는다. 저장은 두 갈래:
//  - edit: 칸마다 actions(useCampaignTaskActions, PATCH 낙관적 갱신)를 바로 부른다.
//  - new: 아무것도 서버에 쓰지 않고 로컬 상태로 들고 있다가 [만들기]에서 createTasksApi 한 번으로 보낸다
//    (중간에 실패해도 빈 작업이 안 남는다, 결정 3).
// 비용 칸(Task 8)은 edit 모드만 slots.cost(부모 FlowDetail이 채운다, task.cost·onSaveProfile 클로저가 필요해서)를
// 쓰고, new 모드는 이 파일이 직접 CostConfirmField를 그린다 — 로컬 상태(newCost)가 이 파일에만 있어서다
// (onSave가 로컬 setCost만 하고 true를 돌려주면 확정된다, 저장은 [만들기]에서 한 번에). 대상 칸(Task 9)도 같은
// 나눔: edit는 slots.target(TargetLinkField, actions.changeTarget 클로저가 필요), new는 TargetPicker를 직접
// 그려 로컬 상태(target)로 들고 있다가 [만들기]에서 targetTaskId/targetTweetUrl로 함께 보낸다. 게시 확인도
// 같은 이유로 slots.posted(다이얼로그는 FlowDetail이 연다, Task 10의 행 메뉴와 같은 다이얼로그를 쓴다).
// 취소된 작업(cancelledAt)의 편집기는 메모 한 칸뿐(R18) — 나머지는 값만 보여준다(거짓 어포던스 금지).
// 인플루언서 [바꾸기](교체, ADR 0005)는 Task 10에서 다이얼로그(ReplaceDialog)가 생겨 여기 버튼이 붙었다 —
// 게시 후·방문 지남·미배정 조건은 replaceDisabledReason(campaignFlowView) 하나로 행 메뉴(FlowRowMenu)와
// 판정을 공유한다 — 각자 판정하면 한쪽만 조건을 놓쳐 버튼이 있다/없다가 갈릴 수 있다.
type PanelMode = { kind: 'edit'; task: FlowRow; index: number; total: number } | { kind: 'new' };

export function TaskPanel({
  mode, campaign, today, influencerOptions, actions, onClose, onPrev, onNext, onCreate,
  menu, draftOpen, pickCount, draftCard, onDetachDraft, onReplace, onSaveProfilePricing, slots, overlayOpen, onDirtyChange,
}: {
  mode: PanelMode;
  campaign: CampaignRow;
  today: string;
  influencerOptions: InfluencerOption[];
  actions: ReturnType<typeof useCampaignTaskActions>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCreate: (body: TaskCreateRequest, more: boolean) => Promise<boolean>;
  menu: ReactNode;   // 헤더 ··· — edit 모드에만 채워진다(Task 10, FlowRowMenu). 원고 모드에서는 숨긴다(작업 동작이라서).
  // 원고 모드로 들어가라는 요청(행 메뉴 등 패널 바깥에서 왔을 수 있다, C 원고 모드 §Step1). seq가 매번 바뀌어야
  // 이미 같은 작업의 패널이 열려 있을 때(키 리마운트가 안 일어난다)도 같은 탭을 다시 요청하면 반영된다.
  draftOpen?: { tab: DraftTab; seq: number } | null;
  pickCount: number | null;   // '있는 원고 고르기 n' — Task 1의 후보 조회 합, 아직 못 읽었으면 null
  draftCard: ReactNode;       // 붙어 있는 원고의 카드 — FlowDetail이 만든다(로딩·에러 표시도 포함)
  onDetachDraft: (t: FlowRow) => void;
  onReplace: (t: FlowRow) => void;   // 인플루언서 칸의 [바꾸기] — ReplaceDialog를 여는 것은 FlowDetail 쪽(Task 10)
  // new 모드의 CostConfirmField가 이 파일 안에서 직접 만들어지는 이유는 위 주석 — 그래서 프로필 반영 저장만
  // 콜백으로 받는다(option.id·pricing patch·influencerOptions 재조회는 FlowDetail 쪽이 쥔 것들이라서).
  onSaveProfilePricing: (option: InfluencerOption, cost: TaskCost, type: TaskType) => Promise<boolean>;
  slots: { cost: ReactNode; target: ReactNode; posted: ReactNode };
  // 패널 위에 뜬 다른 오버레이(원고 카드·편집 모달·원고 고르기·한 번에 만들기)가 있는 동안은 패널의 Esc를 끈다 —
  // 안 그러면 [열기]로 연 원고 카드에서 Esc 한 번에 카드와 패널이 같이 닫힌다(generate 관례: 겹친 레이어는 위부터 하나씩).
  overlayOpen: boolean;
  // 새 작업 모드의 dirty 여부를 부모(FlowDetail)에 알린다(I1-3) — 표의 다른 행을 클릭했을 때 같은 확인을
  // 거치려면 부모가 알아야 하는데, 그 값은 이 컴포넌트의 로컬 상태에서만 계산된다.
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const task = mode.kind === 'edit' ? mode.task : null;
  const index = mode.kind === 'edit' ? mode.index : -1;
  const total = mode.kind === 'edit' ? mode.total : 0;
  const validIndex = index >= 0;

  // ── 원고 모드(C 원고 모드 §Step1) — 패널 로컬 상태다. 작업이 바뀌면(패널이 key로 remount) 초기값 'task'로
  // 돌아간다 — 따로 리셋 코드를 두지 않는다. draftOpen(패널 바깥, 행 메뉴 등에서 온 요청)이 오면 그 탭으로 연다.
  const [draftMode, setDraftMode] = useState<'task' | 'draft'>('task');
  const [draftTab, setDraftTab] = useState<DraftTab>('generate');
  useEffect(() => {
    if (!draftOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널 바깥(행 메뉴)에서 온 요청을 반영하는 것이 목적이라 동기 setState가 맞다
    setDraftTab(draftOpen.tab);
    setDraftMode('draft');
  }, [draftOpen]);
  const inDraftMode = draftMode === 'draft' && !!task;

  // ── 새 작업 로컬 상태 — 만들기 전까지 서버에 쓰지 않는다 ──
  const [newType, setNewType] = useState<TaskType | null>(null);
  const [handleInput, setHandleInput] = useState('');
  const [handle, setHandle] = useState('');
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [newCost, setNewCost] = useState<TaskCost | null>(null);
  // 대상(Task 9) — TargetPicker는 taskId만 돌려준다. 접힌 카드에 보여줄 라벨·게시 여부는 후보 목록에서
  // 다시 찾는다(TaskAddModal의 resolveTarget과 같은 패턴, 한 번 더 조회해도 50건 안에 있다).
  const [target, setTarget] = useState<TargetValue>(null);
  const [scheduledOn, setScheduledOn] = useState<string | null>(null);
  const [visitOn, setVisitOn] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // ── 편집 모드 로컬 상태 — 미배정 인플 입력 버퍼, 메모 입력 버퍼(값이 바뀌었을 때만 저장) ──
  const [editHandleInput, setEditHandleInput] = useState('');
  const [editHandleErr, setEditHandleErr] = useState<string | null>(null);
  const [noteBuf, setNoteBuf] = useState(task?.note ?? '');

  // 새 작업 모드에서 값이 하나라도 채워졌으면(유형은 빼고) Esc·[✕]로 닫을 때 경고 없이 사라지지 않게 한 번
  // 묻는다(I1) — DraftWriteModal의 dirty 관례와 같다. handleInput은 아직 커밋 전(엔터·블러 전) 값도 잡는다 —
  // 반쯤 친 핸들이야말로 경고 없이 사라지면 안 되는 값이다.
  const isNewDirty = useCallback((): boolean => (
    mode.kind === 'new' && (
      handleInput.trim() !== '' || newCost !== null || target !== null ||
      scheduledOn !== null || visitOn !== null || note.trim() !== ''
    )
  ), [mode.kind, handleInput, newCost, target, scheduledOn, visitOn, note]);
  const panelRef = useRef<HTMLElement | null>(null);
  const requestClose = useCallback(() => {
    if (isNewDirty() && !window.confirm('입력한 내용이 사라져요. 닫을까요?')) return;
    onClose();
  }, [isNewDirty, onClose]);
  // FlowDetail이 표의 다른 행을 클릭했을 때 같은 확인을 거치려면 지금 dirty 여부를 알아야 한다(I1-3) —
  // 이 컴포넌트 밖에서 못 보는 로컬 상태라 바뀔 때마다 콜백으로 올려 보낸다.
  useEffect(() => { onDirtyChange?.(isNewDirty()); }, [isNewDirty, onDirtyChange]);

  // 바깥을 누르면 닫는다(koo 09-19). 예외 셋: ① 패널 안 ② 표의 행 — 다른 작업으로 갈아타는 동작이라 행이 직접
  // 처리한다 ③ 포털로 body에 붙는 팝오버·메뉴·툴팁(비용·인플·필터·행 메뉴·ⓘ) — 패널에서 연 것인데 DOM 상으로는
  // 패널 밖이라, 안 빼면 팝오버를 누르는 순간 패널이 닫힌다. 패널 위에 모달이 떠 있으면(overlayOpen) 리스너를 끈다.
  useEffect(() => {
    if (overlayOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (t.closest('[data-flow-row]')) return;
      if (t.closest('[role="dialog"],[role="menu"],[role="tooltip"],[role="listbox"]')) return;
      requestClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [requestClose, overlayOpen]);

  // Esc는 패널만 닫는다 — 안에서 열린 팝오버(예정일 달력 등)는 capture에서 stopPropagation하므로 그쪽이 먼저 먹는다.
  // 패널 위의 오버레이(원고 카드·모달)가 떠 있으면 이 리스너 자체를 끈다 — 안 그러면 그 오버레이를 닫는 Esc가
  // 패널까지 같이 닫혀 버린다(FlowDetail의 peek Esc 관례와 같다: `if (!peekId || editing) return;`).
  useEffect(() => {
    if (overlayOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose, overlayOpen]);

  function resetNewFields() {
    setHandleInput(''); setHandle(''); setHandleErr(null);
    setScheduledOn(null); setVisitOn(null); setNote(''); setNewCost(null); setTarget(null);
  }
  async function resolveNewTarget(next: { taskId: string } | { url: string } | null) {
    if (next === null) { setTarget(null); return; }
    if ('url' in next) { setTarget(next); return; }
    const r = await fetchTasksTargets({ clientId: campaign.clientId, all: true });
    const c = r.ok ? r.data.find((x) => x.taskId === next.taskId) : undefined;
    setTarget({ taskId: next.taskId, label: c ? candidateLabel(c) : '선택한 작업', sub: c && c.campaignId !== campaign.id ? c.campaignName : null, posted: !!c?.postedAt });
  }
  function commitNewHandle(raw: string) {
    const v = raw.trim();
    if (!v) { setHandle(''); setHandleInput(''); setHandleErr(null); setNewCost(null); return; }
    const p = parseXHandle(v);
    if (!p.ok) { setHandleErr(handleParseMessage(p.reason)); return; }
    setHandle(p.handle); setHandleInput(p.handle); setHandleErr(null);
    // 사람이 바뀌면 앞사람 단가로 확인한 비용은 버린다 — 안 그러면 새 사람의 단가와 비교도 없이 '확정'으로 넘어간다(R24).
    setNewCost(null);
  }
  async function submitNew(more: boolean) {
    if (!newType || busy) return;
    setBusy(true);
    const body: TaskCreateRequest = {
      type: newType,
      influencers: handle ? [{ handle, cost: newCost }] : [],
      ...(handle ? {} : { cost: newCost ?? undefined }),
      scheduledOn, visitOn: newType === 'visit' ? visitOn : null,
      note,
      ...(target && 'taskId' in target ? { targetTaskId: target.taskId } : {}),
      ...(target && 'url' in target ? { targetTweetUrl: target.url } : {}),
    };
    const ok = await onCreate(body, more);
    setBusy(false);
    if (ok && more) resetNewFields();   // 유형은 유지 — 같은 유형을 연달아 만드는 게 실제 사용 패턴(결정 4)
  }

  async function commitEditHandle(t: FlowRow, raw: string) {
    const v = raw.trim();
    if (!v) return;
    const p = parseXHandle(v);
    if (!p.ok) { setEditHandleErr(handleParseMessage(p.reason)); return; }
    setEditHandleErr(null);
    // 게시된 작업의 최초 배정은 저장하는 순간 잠긴다(서버가 그 뒤의 변경·해제를 거절한다) — 오타 한 번이
    // 삭제·재생성 말고는 되돌릴 수 없는 상태를 만들므로, 블러로 조용히 저장하지 않고 한 번 묻는다.
    if (t.postedAt && !window.confirm(`@${p.handle}로 저장할까요?\n\n게시된 작업이라 나중에 바꿀 수 없어요.`)) return;
    const ok = await actions.assignInfluencer(t, p.handle, { autoCost: false });   // 비용은 [확인]이 확정한다(R24)
    if (ok) setEditHandleInput('');
  }

  // 인플루언서 해제(koo 09-19 결정 2) — 뼈대에 사람을 잘못 넣었을 때 다른 사람 이름을 대지 않고 미정으로
  // 되돌린다. 서버는 새 라우트 없이 PATCH의 influencerHandle:null이 받는다(influencerChangeGuard) —
  // 게시 뒤·방문일 지난 방문협찬은 [바꾸기]와 같은 disabledReason으로 버튼 자체를 막는다(거짓 어포던스 금지).
  // 확인 문구는 실제로 일어나는 일만 말한다(비용은 남는다 — 문구에 넣지 않는다).
  async function handleDetach(t: FlowRow) {
    if (!window.confirm(detachConfirmMessage(t))) return;
    await actions.assignInfluencer(t, null, { autoCost: false });
  }

  function fieldLabel(field: PanelField, type: TaskType): string {
    switch (field) {
      case 'influencer': return '인플루언서';
      case 'cost': return type === 'visit' ? '예산' : '비용';
      case 'draft': return '원고';
      case 'target': return `${TASK_TYPE_LABEL[type]} 대상`;
      case 'scheduled': return '게시 예정일';
      case 'dates': return '일정';
      case 'note': return '메모';
    }
  }

  // ── 편집 모드 칸 ──
  function renderEditField(field: PanelField, t: FlowRow): ReactNode {
    const cancelled = t.cancelledAt !== null;
    switch (field) {
      case 'influencer': {
        if (cancelled) return <span className="text-content text-x-muted">{t.influencerHandle ? `@${t.influencerHandle}` : '미정'}</span>;
        if (t.influencerHandle) {
          // 게시된 작업은 교체 자체가 서버 가드(POSTED_TASK_MESSAGE)에 막혀 있다 — FlowRowMenu의 prePost
          // 게이트와 같은 조건. 여기서 숨기지 않고 disabled로만 두면 눌렀을 때 400이 나는 거짓 어포던스가 된다.
          if (t.postedAt) return <span className="text-content">@{t.influencerHandle}</span>;
          const disabledReason = replaceDisabledReason(t, today);
          return (
            <div>
              <span className="flex items-center justify-between gap-2 text-content">
                <span>@{t.influencerHandle}</span>
                {/* [해제]는 [바꾸기]와 같은 판정(replaceDisabledReason)으로 막는다 — 방문한 인플루언서를
                    떼면 서버가 거절하는 것과 같은 조작이라 이유 문구도 같아야 한다(라벨-값 일치). */}
                <span className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onReplace(t)} disabled={!!disabledReason} title={disabledReason ?? undefined}
                          className="text-ui text-x-secondary hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline">
                    바꾸기
                  </button>
                  <button type="button" onClick={() => void handleDetach(t)} disabled={!!disabledReason} title={disabledReason ?? undefined}
                          className="text-ui text-x-secondary hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline">
                    해제
                  </button>
                </span>
              </span>
              {/* title만으로 끝내지 않는다(UX 원칙 2·5) — 비활성 이유를 보이는 문구로도 말한다 */}
              {disabledReason && <p className="mt-1 text-caption text-x-muted">{disabledReason}</p>}
            </div>
          );
        }
        return (
          <div>
            <InfluencerField value={editHandleInput} options={influencerOptions} hideLabel hideHelp
                             onChange={(v) => { setEditHandleInput(v); setEditHandleErr(null); }} error={editHandleErr}
                             onEnter={(v) => void commitEditHandle(t, v)} onBlur={(v) => void commitEditHandle(t, v)} />
            {/* C1-b가 이 배정을 이제 서버에서 허용한다 — 왜 이 칸이 아직 남아 있는지, 채우면 뭐가 달라지는지 알린다 */}
            {t.postedAt && <p className="mt-1 text-caption text-x-muted">게시 확인된 작업이에요 — 누가 올렸는지 적으면 정산 후보에 잡혀요. 한 번 적으면 바꿀 수 없어요</p>}
          </div>
        );
      }
      case 'cost': {
        if (!cancelled) return <>{slots.cost}</>;
        const cc = costCell(t, null);
        return <span className={`text-content ${cc.tone === 'muted' ? 'text-x-muted' : cc.tone === 'struck' ? 'text-x-muted line-through' : ''}`}>{cc.text}</span>;
      }
      case 'draft': {
        if (cancelled) return <span className="text-content text-x-muted">{t.cancelledDraftTitle ? `원고 있었음: ${t.cancelledDraftTitle}` : '—'}</span>;
        if (t.draftId) {
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 text-content">
              <span className="min-w-0 truncate" title={t.draftLabel ?? ''}>
                {t.draftLabel ?? '(제목 없음)'}{t.draftStatus && <span className="text-ui text-x-muted"> · {STATUS_LABEL[t.draftStatus]}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-ui">
                {/* setDraftTab 없이 연다 — 붙어 있으면 탭 대신 카드가 뜬다(DraftMode) */}
                <button type="button" onClick={() => setDraftMode('draft')} className="text-x-blue-text hover:underline">열기</button>
                <button type="button" onClick={() => onDetachDraft(t)} className="text-x-secondary hover:underline">떼기</button>
              </span>
            </div>
          );
        }
        return (
          <div>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-content">
              <button type="button" onClick={() => { setDraftTab('generate'); setDraftMode('draft'); }}
                      className="whitespace-nowrap text-x-blue-text hover:underline">새로 쓰기</button>
              <span aria-hidden className="text-x-muted">·</span>
              <button type="button" onClick={() => { setDraftTab('write'); setDraftMode('draft'); }}
                      className="whitespace-nowrap text-x-muted hover:text-x-secondary hover:underline">직접 쓰기</button>
              <span aria-hidden className="text-x-muted">·</span>
              <button type="button" onClick={() => { setDraftTab('pick'); setDraftMode('draft'); }}
                      className="whitespace-nowrap text-x-muted hover:text-x-secondary hover:underline">
                있는 원고 고르기{pickCount !== null ? ` ${pickCount}` : ''}
              </button>
            </span>
            <p className="mt-1 text-caption text-x-muted">인플루언서가 직접 쓰면 비워 둬요</p>
          </div>
        );
      }
      case 'target': {
        if (!cancelled) return <>{slots.target}</>;
        const tgt = targetLabel(t, campaign.id);
        return <span className={`text-content ${tgt.muted ? 'text-x-muted' : ''}`}>{tgt.text}{tgt.sub && ` · ${tgt.sub}`}</span>;
      }
      case 'scheduled':
        if (cancelled) return <span className="text-content text-x-muted">{t.scheduledOn ? formatDateKo(t.scheduledOn) : '미정'}</span>;
        return (
          <ScheduledOnField value={t.scheduledOn} overdueDays={taskOverdueDays(t, today)}
                           outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)}
                           emptyLabel="미정" onChange={(next) => void actions.changeScheduledOn(t, next)} />
        );
      case 'dates':
        if (cancelled) {
          return (
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-caption text-x-muted">방문일</p><p className="mt-0.5 text-content text-x-muted">{t.visitOn ? formatDateKo(t.visitOn) : '미정'}</p></div>
              <div><p className="text-caption text-x-muted">게시 예정일</p><p className="mt-0.5 text-content text-x-muted">{t.scheduledOn ? formatDateKo(t.scheduledOn) : '미정'}</p></div>
            </div>
          );
        }
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-caption text-x-muted">방문일 — 지나면 인플루언서를 바꿀 수 없어요</p>
              <div className="mt-0.5">
                <ScheduledOnField value={t.visitOn} overdueDays={null}
                                 outOfRange={isOutOfRange(t.visitOn, campaign.startsOn, campaign.endsOn)}
                                 ariaLabel="방문일" onChange={(next) => void actions.changeVisitOn(t, next)} />
              </div>
            </div>
            <div>
              <p className="text-caption text-x-muted">게시 예정일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={t.scheduledOn} overdueDays={taskOverdueDays(t, today)}
                                 outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)}
                                 emptyLabel="미정" onChange={(next) => void actions.changeScheduledOn(t, next)} />
              </div>
            </div>
          </div>
        );
      case 'note':
        return (
          <input value={noteBuf} onChange={(e) => setNoteBuf(e.target.value)}
                 onBlur={() => { if (noteBuf !== t.note) void actions.setNote(t, noteBuf); }}
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
                 placeholder="한 줄"
                 className="h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
        );
    }
  }

  // ── 새 작업 칸 — PANEL_FIELD_ORDER에서 'draft'만 뺀다(만들 때는 원고를 못 붙인다, 붙이기는 만든 뒤 편집 패널에서) ──
  const newFieldOrder: PanelField[] = newType ? PANEL_FIELD_ORDER[newType].filter((f) => f !== 'draft') : [];
  function renderNewField(field: PanelField): ReactNode {
    switch (field) {
      case 'influencer':
        return (
          <InfluencerField value={handleInput} options={influencerOptions} hideLabel hideHelp
                           onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr}
                           onEnter={commitNewHandle} onBlur={commitNewHandle} />
        );
      case 'cost': {
        // 명부 값(option)은 handle이 정해졌을 때만 있다 — 미정이면 disabledReason으로 비활성(브리프 §5).
        const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
        return (
          // key=handle — 인플루언서가 바뀌면(미정 → 배정 포함) 새 프로필 단가로 다시 초기화한다(마운트 시 한 번만
          // 채우는 필드라 안 그러면 방금 배정한 인플의 단가 제안이 안 보인다).
          <CostConfirmField key={handle} value={newCost} option={opt} type={newType as TaskType} label={fieldLabel('cost', newType as TaskType)}
                            onSave={async (c) => { setNewCost(c); return true; }}
                            onSaveProfile={(o, c) => onSaveProfilePricing(o, c, newType as TaskType)}
                            disabledReason={handle ? undefined : '인플을 정하면 프로필 단가로 채워요'} />
        );
      }
      case 'target':
        return <TargetPicker value={target} clientId={campaign.clientId} campaignId={campaign.id} onChange={(next) => void resolveNewTarget(next)} />;
      case 'scheduled':
        return (
          <ScheduledOnField value={scheduledOn} overdueDays={null}
                           outOfRange={isOutOfRange(scheduledOn, campaign.startsOn, campaign.endsOn)}
                           emptyLabel="미정" onChange={setScheduledOn} />
        );
      case 'dates':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-caption text-x-muted">방문일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={visitOn} overdueDays={null}
                                 outOfRange={isOutOfRange(visitOn, campaign.startsOn, campaign.endsOn)}
                                 ariaLabel="방문일" onChange={setVisitOn} />
              </div>
            </div>
            <div>
              <p className="text-caption text-x-muted">게시 예정일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={scheduledOn} overdueDays={null}
                                 outOfRange={isOutOfRange(scheduledOn, campaign.startsOn, campaign.endsOn)}
                                 emptyLabel="미정" onChange={setScheduledOn} />
              </div>
            </div>
          </div>
        );
      case 'note':
        return (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄"
                 className="h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
        );
      case 'draft':
        return null;
    }
  }

  const crumb = task ? `${FLOW_STAGE_LABEL[flowStage(task, task.settlement)]} · ${TASK_TYPE_LABEL[task.type]}` : '새 작업';
  const title: ReactNode = task
    ? (task.influencerHandle ? `@${task.influencerHandle}` : <span className="text-x-muted">인플루언서 미정</span>)
    : (newType ? `새 ${TASK_TYPE_LABEL[newType]} 작업` : '어떤 작업인가요?');
  // 원고 모드 헤더 — 작업 정보(단계·유형)는 이미 봤으니 크럼 자리는 뒤로가기로 바꾸고, 제목은 원고 쪽으로 말한다.
  const draftTitle = task ? `원고 · ${TASK_TYPE_LABEL[task.type]} · ${task.influencerHandle ? `@${task.influencerHandle}` : '인플루언서 미정'}` : '';

  return (
    <aside ref={panelRef} role="dialog" aria-label="작업 편집" className="fixed inset-y-0 right-0 z-40 flex w-[560px] flex-col border-l border-x-border bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-x-border px-6 pt-5 pb-4">
        <div className="min-w-0">
          {inDraftMode
            ? <button type="button" onClick={() => setDraftMode('task')} className="text-ui text-x-secondary hover:underline">← 작업으로</button>
            : <p className="text-ui text-x-secondary">{crumb}</p>}
          <h2 className="mt-0.5 truncate text-[20px]">{inDraftMode ? draftTitle : title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* ···(작업 메뉴)는 원고 모드에서 숨긴다 — 전부 작업 단위 동작이라 원고를 보는 중엔 부를 일이 없다 */}
          {task && !inDraftMode && menu}
          <button type="button" onClick={requestClose} aria-label="닫기" className="rounded-full p-1.5 text-x-secondary hover:bg-x-hover">✕</button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        {inDraftMode && task ? (
          <DraftMode attached={!!task.draftId} tab={draftTab} onTab={setDraftTab} pickCount={pickCount}
                     card={draftCard}
                     generate={<p className="text-ui text-x-muted">(Task 3에서 채웁니다)</p>}
                     write={<p className="text-ui text-x-muted">(Task 4에서 채웁니다)</p>}
                     pick={<p className="text-ui text-x-muted">(Task 5에서 채웁니다)</p>} />
        ) : task ? (
          <>
            {task.cancelledAt && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-ui text-slate-600">취소된 작업이에요 — ··· 메뉴의 [되돌리기]로 살릴 수 있어요</p>
            )}
            {PANEL_FIELD_ORDER[task.type].map((field) => (
              <div key={field}>
                <p className="text-ui text-x-secondary">{fieldLabel(field, task.type)}</p>
                <div className="mt-1">{renderEditField(field, task)}</div>
              </div>
            ))}
            {/* 게시 확인 — PANEL_FIELD_ORDER에 없는 칸이다(모든 유형에 있고, 취소된 작업엔 없다). 다이얼로그는
                FlowDetail이 열고(이 버튼과 행 메뉴(FlowRowMenu)의 [게시 확인]이 같은 상태를 연다, Task 10)
                값·증빙 라이트박스도 그쪽 클로저가 필요해 slots.posted로 받는다(slots.cost와 같은 이유) —
                FlowDetail이 취소된 작업이면 null을 준다. */}
            {slots.posted && (
              <div>
                <p className="text-ui text-x-secondary">게시</p>
                <div className="mt-1">{slots.posted}</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <p className="text-ui text-x-secondary">유형</p>
              <div role="group" aria-label="작업 유형" className="mt-1 inline-flex overflow-hidden rounded-lg border border-x-border-strong">
                {DISPLAY_TYPE_ORDER.map((k) => (
                  <button key={k} type="button" aria-pressed={newType === k} onClick={() => setNewType(k)} disabled={busy}
                          className={`border-r border-x-border-strong px-3.5 py-2 text-content last:border-r-0 disabled:opacity-50 ${newType === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                    {TASK_TYPE_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            {newFieldOrder.map((field) => (
              <div key={field}>
                <p className="text-ui text-x-secondary">{fieldLabel(field, newType as TaskType)}</p>
                <div className="mt-1">{renderNewField(field)}</div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-x-border px-6 py-3">
        {inDraftMode ? (
          // 원고 모드에서는 이전/다음 대신 이것 하나 — 작업 사이 이동은 작업 모드의 일이다.
          <Button onClick={() => setDraftMode('task')} className="ml-auto h-9 px-3.5 text-ui">작업으로</Button>
        ) : task ? (
          <div className="ml-auto flex items-center gap-3">
            <Button onClick={onPrev} disabled={!validIndex || index <= 0} className="h-9 px-3 text-ui">← 이전</Button>
            {validIndex
              ? <span className="text-ui text-x-muted tabular-nums">{index + 1} / {total}</span>
              : <span className="text-ui text-x-muted">지금 필터에 없는 작업이에요</span>}
            <Button onClick={onNext} disabled={!validIndex || index >= total - 1} className="h-9 px-3 text-ui">다음 →</Button>
          </div>
        ) : (
          <>
            <p className="text-ui text-x-muted">{newType ? '비어 있는 칸은 나중에 채워도 돼요' : '유형을 먼저 골라요'}</p>
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => void submitNew(true)} disabled={!newType || busy} className="h-9 px-3.5 text-ui">만들고 하나 더</Button>
              <Button variant="primary" onClick={() => void submitNew(false)} disabled={!newType || busy} className="h-9 px-3.5 text-ui">
                {busy ? '만드는 중…' : '만들기'}
              </Button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
