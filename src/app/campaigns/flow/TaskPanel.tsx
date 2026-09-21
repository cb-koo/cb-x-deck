'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { DraftRow } from '@/lib/draftStore';
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
import { draftLabel } from '@/lib/draftViews';
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

// 폼 맥락(Task 4, 스펙 §4-6) — 새 작업 폼의 인플루언서·유형·대상을 FlowDetail에 알려, 그쪽이 원고 모드
// 세 갈래(폼 호스트)를 이 값으로 만든다. TaskPanel의 로컬 상태(newType·handle·target)를 그대로 옮긴 것뿐이라
// 새 상태 보관소가 아니다 — target은 인용RT의 targetRef 계산(대상 링크가 있을 때만)에만 쓰인다.
export type FormDraftContext = { type: TaskType | null; handle: string | null; target: TargetValue };

// 직접 쓰기에서 떠나기 전 확인(리뷰 지적 4) — 기존 두 번째 입구 DraftWriteModal.requestClose와 글자 하나까지
// 같은 문장을 쓴다(새로 짓지 말 것). 같은 기능이 같은 상황에서 다른 문구를 쓰면 사용자가 두 화면을 다른
// 기능으로 읽는다. export하는 이유 — FlowDetail이 이 값을 그대로 가져다 패널 닫기 자리의 closeConfirm을
// 만든다(Task 4e — 원고가 작성 중일 때 닫는 동작에 쓸 문장은 이 상수 하나뿐이라 FlowDetail이 새로 짓지
// 않고 가져다 쓴다).
export const DRAFT_WRITE_LOST_CONFIRM = '작성 중인 원고가 있어요. 닫으면 저장되지 않고 사라져요. 닫을까요?';

export function TaskPanel({
  mode, campaign, today, influencerOptions, actions, onClose, onPrev, onNext, onCreate,
  menu, draftOpen, pickCount, draftCard, draftGenerate, draftWrite, draftPick, draftBusy, closeConfirm, moveConfirm, onDetachDraft, onReplace, onSaveProfilePricing, slots, overlayOpen, onDirtyChange,
  newDraft, onNewDraftChange, onNewContextChange, formHandleFill,
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
  // tab이 null이면 "작업 모드로 되돌려라"는 뜻(C 원고 모드 리뷰 지적 4) — FlowDetail의 openPanel이
  // 같은 작업 행을 다시 눌렀을 때 이 신호를 보낸다(패널이 원고 모드에 머물러 있어도 행 클릭 = 그 작업을 연다).
  draftOpen?: { tab: DraftTab | null; seq: number } | null;
  pickCount: number | null;   // '있는 원고 고르기 n' — Task 1의 후보 조회 합, 아직 못 읽었으면 null
  draftCard: ReactNode;       // 붙어 있는 원고의 카드 — FlowDetail이 만든다(로딩·에러 표시도 포함)
  draftGenerate: ReactNode;   // 'AI로 만들기' 탭 본체(DraftGenerate, C 원고 모드 Task 3) — FlowDetail이 만든다
  draftWrite: ReactNode;      // '직접 쓰기' 탭 본체(DraftWrite, C 원고 모드 Task 4) — FlowDetail이 만든다
  draftPick: ReactNode;       // '있는 원고 고르기' 탭 본체(DraftPick, C 원고 모드 Task 5) — FlowDetail이 만든다
  // 시안을 만드는 동안(draftGenerate 내부 busy) 또는 직접 쓰는 동안(draftWrite의 저장·이미지 업로드)
  // 패널의 바깥 클릭·Esc 닫기를 끈다 — 요청이 오래 걸려도 실수로 닫혀 만들던/쓰던 걸 잃지 않게(아래 두
  // useEffect가 막는다). 탭 버튼·← 작업으로·푸터 작업으로도 이 값으로 비활성한다(리뷰 지적 2) — 탭을
  // 바꾸면 두 컴포넌트 모두 언마운트돼 진행 중인 요청이 화면에서 끊겨 보인다. 헤더 [✕ 닫기]는 막지 않는다
  // (패널이 닫혀도 생성 결과는 미부착 원고로 남는다, DraftGenerate의 '화면을 떠나도…' 안내와 같은 전제).
  // FlowDetail이 draftGenerate·draftWrite 두 busy를 OR로 합쳐 이 하나의 값으로 넘긴다. label은 켜는 쪽이
  // 준다(리뷰 지적 3, DraftMode와 같은 계약) — null이면 안 막혀 있다는 뜻.
  draftBusy: { label: string } | null;
  // 패널 닫기(requestClose, Esc·바깥 클릭·✕)에서 쓸 확인 문구(Task 4e) — FlowDetail이 이미 어느 쪽이
  // 작성 중인지 안다(생성 탭의 방향성 / 직접 쓰기의 원고, draftGenDirty·draftWriteOnlyDirty)라 이 컴포넌트는
  // 그 판정을 다시 하지 않고 이미 고른 문장을 그대로 받는다. null이면 작성 중이 아니라는 뜻 — 묻지 않고
  // 그대로 닫는다.
  closeConfirm: string | null;
  // 자리를 옮기는 동작(requestTabChange · requestDraftModeExit — 탭 전환 · ← 작업으로 · 푸터 작업으로)에서
  // 쓸 확인 문구(Task 4e) — closeConfirm과 같은 출처 판정을 쓰지만 닫는 게 아니라 옮기는 동작이라 문장이
  // 다르다. null이면 묻지 않고 그대로 옮긴다.
  moveConfirm: string | null;
  onDetachDraft: (t: FlowRow) => void;
  onReplace: (t: FlowRow) => void;   // 인플루언서 칸의 [바꾸기] — ReplaceDialog를 여는 것은 FlowDetail 쪽(Task 10)
  // new 모드의 CostConfirmField가 이 파일 안에서 직접 만들어지는 이유는 위 주석 — 그래서 프로필 반영 저장만
  // 콜백으로 받는다(option.id·pricing patch·influencerOptions 재조회는 FlowDetail 쪽이 쥔 것들이라서).
  onSaveProfilePricing: (option: InfluencerOption, cost: TaskCost, type: TaskType) => Promise<boolean>;
  slots: { cost: ReactNode; target: ReactNode; posted: ReactNode };
  // 패널 위에 뜬 다른 오버레이(편집 모달·한 번에 만들기 등)가 있는 동안은 패널의 Esc를 끈다 —
  // 안 그러면 그 레이어를 닫는 Esc 한 번에 오버레이와 패널이 같이 닫힌다(generate 관례: 겹친 레이어는 위부터 하나씩).
  overlayOpen: boolean;
  // 새 작업 모드에서 "떠나면 잃는 것"을 부모(FlowDetail)에 알린다(I1-3, Task 4 §6) — 표의 다른 행을
  // 클릭했을 때 같은 확인을 거치려면 부모가 알아야 하는데, 그 값은 이 컴포넌트의 로컬 상태에서만 계산된다.
  // boolean이 아니라 문장 조각(string|null)을 올린다 — FlowDetail:419·429의 행 전환 확인이 "입력한 내용이
  // 사라져요"로 고정돼 있으면 원고만 고르고 칸은 비운 경우 거짓말이 된다(원고는 '있는 원고 고르기'에
  // 남아 안 사라진다). null이면 잃을 게 없다는 뜻 — 묻지 않는다. requestClose가 쓰는 것과 같은 조각
  // (newDirtyParts, 아래)이고, 어미(마침 문구)만 자리마다 다르다.
  onDirtyChange?: (msg: string | null) => void;
  // 새 작업 폼에서 고른 원고(Task 3 원고 칸) — 주인은 FlowDetail이다(스펙 §4-6, Task 4에서 세 갈래와 함께
  // 배선한다). 이 컴포넌트는 받아서 그리기만 한다. 떼는 동작(onNewDraftChange(null))도 서버를 부르지
  // 않는다 — 아직 어디에도 붙은 적이 없어 폼에서 내려놓는 것뿐이고, 원고는 '있는 원고 고르기'에 남는다.
  newDraft: DraftRow | null;
  onNewDraftChange: (d: DraftRow | null) => void;
  // 폼 맥락이 바뀔 때마다 위로 알린다(Task 4 §Step1, onDirtyChange와 같은 관례) — FlowDetail이 이 값으로
  // 폼 호스트(DraftHost)를 만든다. 새 상태 보관소가 아니다 — 이 컴포넌트가 이미 든 값(newType·handle·target)을
  // 그대로 올리기만 한다.
  onNewContextChange?: (ctx: FormDraftContext) => void;
  // '있는 원고 고르기'에서 고른 원고의 주인이 폼의 인플루언서와 다를 때(스펙 §4-3 "고르는 순간의 주인
  // 불일치") — FlowDetail이 pickedHandleNotice로 판정해 채울 값이 있으면 이 신호를 보낸다. seq가 매번
  // 바뀌어야 같은 핸들을 연달아 골라도(예: 뗐다가 같은 원고를 다시 고름) 반영된다(draftOpenReq와 같은 관례).
  formHandleFill?: { handle: string | null; seq: number } | null;
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
    if (draftOpen.tab === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널 바깥(같은 행 재클릭 등)에서 온 요청을 반영하는 것이 목적이라 동기 setState가 맞다
      setDraftMode('task');
      return;
    }
    setDraftTab(draftOpen.tab);
    setDraftMode('draft');
  }, [draftOpen]);
  // 취소된 작업은 원고 모드에 머무르지 않는다(리뷰 지적 1, 거짓 어포던스) — 원고 모드인 채로 그 작업이
  // 표의 ···에서 취소되면(서버가 draft_id를 뗀다) 자리표시자 탭 세 개가 취소된 작업 위에 남는다. 취소된
  // 작업의 원고 칸은 이미 스냅샷 텍스트만 보여주므로 작업 모드로 돌아오는 것이 맞다.
  // 새 작업 폼(mode.kind === 'new')도 원고 모드를 연다(Task 4 §1) — 취소라는 개념이 없으므로 그 가드는
  // task가 있을 때만 적용한다. 폼에서 draftMode가 'draft'가 되는 건 원고 칸의 세 버튼(newFieldOrder가
  // 'draft'를 포함할 때만 보인다 → newType이 이미 정해져 있다)을 눌렀을 때뿐이다.
  const inDraftMode = draftMode === 'draft' && (mode.kind === 'new' || (!!task && !task.cancelledAt));

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
  const isFormFieldsFilled = useCallback((): boolean => (
    mode.kind === 'new' && (
      handleInput.trim() !== '' || newCost !== null || target !== null ||
      scheduledOn !== null || visitOn !== null || note.trim() !== ''
    )
  ), [mode.kind, handleInput, newCost, target, scheduledOn, visitOn, note]);
  // 원고만 고르고 다른 칸은 그대로 둔 채 닫으려는 경우도 dirty다(Task 3 §4) — 원고는 잃지 않지만(폼에서
  // 내려놓을 뿐 '있는 원고 고르기'에 남는다), 그 사실을 묻지 않고 닫으면 "방금 고른 게 어디 갔지"가 된다.
  // 문장 조각만 만들고 마침 문구(닫을까요?/다른 작업을 열까요?)는 부르는 쪽이 붙인다(Task 4 §6) — 이
  // 컴포넌트 안(requestClose, '닫을까요?')과 FlowDetail(행 전환, '다른 작업을 열까요?')이 같은 사실을
  // 서로 다른 동작 문구로 말해야 해서다. null이면 잃을 게 없다는 뜻.
  const newDirtyParts = useCallback((): string | null => {
    const parts: string[] = [];
    if (isFormFieldsFilled()) parts.push('입력한 내용이 사라져요.');
    if (mode.kind === 'new' && newDraft) parts.push("고른 원고는 '있는 원고 고르기'에 남아요.");
    return parts.length ? parts.join(' ') : null;
  }, [isFormFieldsFilled, mode.kind, newDraft]);
  const panelRef = useRef<HTMLElement | null>(null);
  // 직접 쓰기·생성 탭에서 작성 중일 때 닫기 전 확인(리뷰 지적 4, Task 4c §3에서 생성 탭까지 넓혔다,
  // Task 4e에서 문구를 closeConfirm으로 받게 바꿨다) — closeConfirm은 FlowDetail이 어느 탭이 작성
  // 중인지 이미 반영해서 내려준다. null이면 작성 중이 아니라는 뜻이라 묻지 않는다.
  // 원고를 고른 채 닫으면 문구가 갈린다(Task 3 §4, 사실만 말한다) — 입력칸이 채워졌으면 "사라져요", 원고가
  // 있으면 "'있는 원고 고르기'에 남아요"(잃지 않는다), 둘 다면 두 문장을 이어 잃는 것과 안 잃는 것을 함께 말한다.
  const requestClose = useCallback(() => {
    const dirtyMsg = newDirtyParts();
    if (dirtyMsg && !window.confirm(`${dirtyMsg} 닫을까요?`)) return;
    if (closeConfirm !== null && !window.confirm(closeConfirm)) return;
    onClose();
  }, [newDirtyParts, closeConfirm, onClose]);
  // FlowDetail이 표의 다른 행을 클릭했을 때 같은 확인을 거치려면 지금 dirty 여부를 알아야 한다(I1-3) —
  // 이 컴포넌트 밖에서 못 보는 로컬 상태라 바뀔 때마다 콜백으로 올려 보낸다.
  useEffect(() => { onDirtyChange?.(newDirtyParts()); }, [newDirtyParts, onDirtyChange]);
  // 탭 전환 · ← 작업으로 · 푸터 작업으로(리뷰 지적 4) — 탭을 바꾸거나 원고 모드를 나가면 DraftWrite가
  // 언마운트돼 친 글과 이미 올라간 이미지가 확인 없이 사라진다. 문구는 패널 닫기와 다르다(moveConfirm,
  // Task 4e) — 닫는 게 아니라 자리를 옮기는 동작이라서다.
  const requestTabChange = useCallback((t: DraftTab) => {
    if (moveConfirm !== null && !window.confirm(moveConfirm)) return;
    setDraftTab(t);
  }, [moveConfirm]);
  const requestDraftModeExit = useCallback(() => {
    if (moveConfirm !== null && !window.confirm(moveConfirm)) return;
    setDraftMode('task');
  }, [moveConfirm]);
  // 폼 맥락을 위로 알린다(Task 4 §Step1) — FlowDetail이 이 값으로 폼 호스트(DraftHost)와 인용RT의
  // targetRef를 만든다. edit 모드에서도 도는데(newType 등은 그 모드에서 안 바뀌므로 매번 null) 무해하다 —
  // FlowDetail은 mode.kind === 'new'일 때만 이 값을 쓴다.
  useEffect(() => {
    onNewContextChange?.({ type: newType, handle: handle || null, target });
  }, [newType, handle, target, onNewContextChange]);
  // 있는 원고 고르기에서 주인이 다른 원고를 고르면, 폼이 비어 있던 경우 FlowDetail이 pickedHandleNotice의
  // fill로 이 신호를 보낸다(위 formHandleFill 주석) — commitNewHandle로 기존 핸들 입력과 같은 검증·저장
  // 경로를 탄다(새 로직이 아니다). handle이 null이면(카드에서 해제) 빈 문자열로 — commitNewHandle('')은
  // 이미 '비우기'로 정의돼 있다(handle 커밋 함수 본문 참고).
  useEffect(() => {
    if (!formHandleFill) return;
    commitNewHandle(formHandleFill.handle ?? '');
  }, [formHandleFill]);

  // 바깥을 누르면 닫는다(koo 09-19). 예외 셋: ① 패널 안 ② 표의 행 — 다른 작업으로 갈아타는 동작이라 행이 직접
  // 처리한다 ③ 포털로 body에 붙는 팝오버·메뉴·툴팁(비용·인플·필터·행 메뉴·ⓘ) — 패널에서 연 것인데 DOM 상으로는
  // 패널 밖이라, 안 빼면 팝오버를 누르는 순간 패널이 닫힌다. 패널 위에 모달이 떠 있으면(overlayOpen) 리스너를 끈다.
  useEffect(() => {
    if (overlayOpen || draftBusy) return;   // 시안을 만드는 동안은 바깥을 눌러도 안 닫는다(위 draftBusy 주석)
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
  }, [requestClose, overlayOpen, draftBusy]);

  // Esc는 패널만 닫는다 — 안에서 열린 팝오버(예정일 달력 등)는 capture에서 stopPropagation하므로 그쪽이 먼저 먹는다.
  // 패널 위의 오버레이(모달 등)가 떠 있으면 이 리스너 자체를 끈다 — 안 그러면 그 오버레이를 닫는 Esc가
  // 패널까지 같이 닫혀 버린다(overlayOpen이 true인 동안 통째로 끈다). draftBusy도 같은 이유로 끈다.
  useEffect(() => {
    if (overlayOpen || draftBusy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose, overlayOpen, draftBusy]);

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
                      className="whitespace-nowrap text-x-blue-text hover:underline">AI로 만들기</button>
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

  // 새 작업 폼에서 원고를 떼는 동작(Task 3 §2) — 서버를 부르지 않는다. 원고는 어디에도 붙은 적이 없어
  // '떼기'가 아니라 '내려놓기'다 — 사실대로 확인 문구가 그렇게 말한다.
  function detachNewDraft() {
    if (!window.confirm("폼에서 내려놓을까요? 원고는 지워지지 않고 '있는 원고 고르기'에 남아요.")) return;
    onNewDraftChange(null);
  }

  // 새 작업 칸 — 원고 칸도 그대로 쓴다(스펙 §4-1). RT는 PANEL_FIELD_ORDER.rt에 'draft'가 없어 자동으로 빠진다.
  const newFieldOrder: PanelField[] = newType ? PANEL_FIELD_ORDER[newType] : [];
  function renderNewField(field: PanelField): ReactNode {
    switch (field) {
      case 'influencer':
        // 원고가 들어오면 인플루언서 칸을 칩(읽기 전용)으로 바꾼다(스펙 §4-3) — 서버가 붙는 순간 원고의
        // 주인을 작업 값으로 덮어쓰므로(coalesce 반대 방향), 화면에서도 고정해 둔다. 비용·일정·대상·메모는
        // 이 잠금과 무관하다(Global Constraints).
        if (newDraft) {
          return (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg border border-x-border-strong bg-x-hover px-2.5 py-2 text-content text-x-secondary">
                {handle ? `@${handle}` : '미정'}
              </span>
              <span className="text-caption text-x-muted">원고를 떼면 바꿀 수 있어요</span>
            </div>
          );
        }
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
      case 'draft': {
        // 원고 칸(스펙 §4-1) — 모양은 편집 패널(renderEditField 'draft')과 같다. 다른 점은 [떼기]가
        // 서버 detach가 아니라 폼에서 내려놓는 것뿐이다(위 detachNewDraft) — 아직 어디에도 안 붙어서다.
        if (newDraft) {
          return (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-content">
                <span className="min-w-0 truncate" title={draftLabel(newDraft).text}>
                  {draftLabel(newDraft).text}
                  <span className="text-ui text-x-muted"> · {STATUS_LABEL[newDraft.status]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-ui">
                  {/* setDraftTab 없이 연다 — 이미 골라 둔 원고면 탭 대신 카드가 뜬다(Task 4의 attached 판정) */}
                  <button type="button" onClick={() => setDraftMode('draft')} className="text-x-blue-text hover:underline">열기</button>
                  <button type="button" onClick={detachNewDraft} className="text-x-secondary hover:underline">떼기</button>
                </span>
              </div>
              <p className="mt-1 text-caption text-x-muted">만들기를 누르면 이 원고가 함께 붙어요</p>
            </div>
          );
        }
        return (
          <div>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-content">
              <button type="button" onClick={() => { setDraftTab('generate'); setDraftMode('draft'); }}
                      className="whitespace-nowrap text-x-blue-text hover:underline">AI로 만들기</button>
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
    }
  }

  const crumb = task ? `${FLOW_STAGE_LABEL[flowStage(task, task.settlement)]} · ${TASK_TYPE_LABEL[task.type]}` : '새 작업';
  const title: ReactNode = task
    ? (task.influencerHandle ? `@${task.influencerHandle}` : <span className="text-x-muted">인플루언서 미정</span>)
    : (newType ? `새 ${TASK_TYPE_LABEL[newType]} 작업` : '어떤 작업인가요?');
  // 원고 모드 헤더 — 작업 정보(단계·유형)는 이미 봤으니 크럼 자리는 뒤로가기로 바꾸고, 제목은 원고 쪽으로 말한다.
  // 새 작업 폼(Task 4)도 같은 모양 — newType은 여기 도달할 때 항상 정해져 있다(원고 칸은 유형을 고른
  // 뒤에만 뜬다, inDraftMode 주석 참고).
  const draftTitle = task
    ? `원고 · ${TASK_TYPE_LABEL[task.type]} · ${task.influencerHandle ? `@${task.influencerHandle}` : '인플루언서 미정'}`
    : (newType ? `원고 · ${TASK_TYPE_LABEL[newType]} · ${handle ? `@${handle}` : '인플루언서 미정'}` : '');

  return (
    <aside ref={panelRef} role="dialog" aria-label="작업 편집" className="fixed inset-y-0 right-0 z-40 flex w-[560px] flex-col border-l border-x-border bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-x-border px-6 pt-5 pb-4">
        <div className="min-w-0">
          {inDraftMode
            ? (
              <span className="flex items-center gap-1.5">
                {/* 생성·저장 중엔 막는다(리뷰 지적 2) — 탭을 바꾸면 그 컴포넌트가 언마운트돼 요청이 화면에서
                    끊겨 보인다. title만으로 끝내지 않고 보이는 이유를 옆에 둔다(거짓 어포던스 금지). 작성
                    중인 글이 있으면 확인을 먼저 받는다(리뷰 지적 4, requestDraftModeExit). */}
                <button type="button" onClick={requestDraftModeExit} disabled={!!draftBusy}
                        className="text-ui text-x-secondary hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline">
                  ← 작업으로
                </button>
                {draftBusy && <span className="text-caption text-x-muted">{draftBusy.label}</span>}
              </span>
            )
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
        {inDraftMode ? (
          <DraftMode attached={task ? !!task.draftId : !!newDraft} tab={draftTab} onTab={requestTabChange} busy={draftBusy} pickCount={pickCount}
                     card={draftCard}
                     generate={draftGenerate}
                     write={draftWrite}
                     pick={draftPick} />
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
              {/* 원고가 들어오면 유형도 칩(읽기 전용)으로 바꾼다(스펙 §4-3) — RT로 바꾸면 이미 고른 원고를
                  어떻게 할지가 모호해진다. 한 마운트 안에서는 newType이 항상 먼저 있다(원고 칸은 유형을
                  고른 뒤에만 뜬다) — 단, newDraft는 FlowDetail(formDraft)이 들고 있어 패널이 새로 열려도
                  (행 전환·재오픈으로 key가 바뀌어도) 안 비워지면 newType=null인 채로 newDraft만 남을 수
                  있다. FlowDetail이 패널을 닫거나 다른 행으로 옮길 때 formDraft를 비우는 것이 전제다(Task 4). */}
              {newDraft ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-lg border border-x-border-strong bg-x-hover px-3.5 py-2 text-content text-x-secondary">
                    {TASK_TYPE_LABEL[newType as TaskType]}
                  </span>
                  <span className="text-caption text-x-muted">원고를 떼면 바꿀 수 있어요</span>
                </div>
              ) : (
                <div role="group" aria-label="작업 유형" className="mt-1 inline-flex overflow-hidden rounded-lg border border-x-border-strong">
                  {DISPLAY_TYPE_ORDER.map((k) => (
                    <button key={k} type="button" aria-pressed={newType === k} onClick={() => setNewType(k)} disabled={busy}
                            className={`border-r border-x-border-strong px-3.5 py-2 text-content last:border-r-0 disabled:opacity-50 ${newType === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                      {TASK_TYPE_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
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
          // 생성 중엔 이 버튼도 막는다(리뷰 지적 2, 위 헤더 ← 작업으로와 같은 이유·같은 문구).
          <div className="ml-auto flex items-center gap-2">
            {draftBusy && <span className="text-caption text-x-muted">{draftBusy.label}</span>}
            <Button onClick={requestDraftModeExit} disabled={!!draftBusy} className="h-9 px-3.5 text-ui">작업으로</Button>
          </div>
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
