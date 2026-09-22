'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { CampaignRow, CampaignTaskItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { DraftRow } from '@/lib/draftStore';
import type { CampaignPeriodBudget } from '@/lib/clientBudget';
import {
  fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, patchInfluencerPricingApi,
  patchDraftApi, deleteDraftApi, rewriteDraftApi, regenPostApi, createTasksApi, refreshCampaignPerfApi,
  fetchDraftCandidatesApi,
  type DraftPatchBody, type TaskCreateRequest,
} from '@/lib/campaignApi';
import type { TaskCost } from '@/lib/campaignCost';
import {
  flowStage, FLOW_STAGES, TASK_TYPE_LABEL, formatDateKo, isTaskExcluded,
  deriveTaskInfluencers, taskCampaignTotal, targetUrlOf, type TaskType, type FlowStage,
} from '@/lib/campaignJudgment';
import { draftLabel, draftPreviewLine } from '@/lib/draftViews';
import { targetLabel } from '@/lib/campaignTableView';
import { parseTweetLink } from '@/lib/tweetLink';
import { pickedHandleNotice, type DraftHost } from '@/lib/draftHost';
import { Button, PANEL } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { useSignedTaskProofUrls } from '@/components/useSignedTaskProofUrls';
import { ImageLightbox } from '@/components/ImageLightbox';
import {
  EMPTY_FLOW_FILTER, matchesFlowFilter, sortFlowRows, flowStats, settleWaitCount, flowFooter, filterSummary,
  FLOW_SORT_LABEL, DISPLAY_TYPE_ORDER, matchesExtra, EXTRA_FILTERS, replaceDisabledReason,
  type FlowRow, type FlowFilter, type FlowSort, type ExtraFilter,
} from '@/lib/campaignFlowView';
import { POSTED_TASK_MESSAGE } from '@/lib/campaignTaskInput';
import { CampaignHeader } from '../CampaignHeader';
import { useCampaignTaskActions } from '../useCampaignTaskActions';
import { LinkPostModal } from '../LinkPostModal';
import { FlowFilterBar } from './FlowFilterBar';
import { FlowTable } from './FlowTable';
import { FlowCards } from './FlowCards';
import { TaskPanel, DRAFT_WRITE_LOST_CONFIRM, type FormDraftContext } from './TaskPanel';
import { CostConfirmField } from './CostConfirmField';
import { TargetLinkField } from './TargetLinkField';
import { PostedDialog } from './PostedDialog';
import { RemovedDialog } from './RemovedDialog';
import { BulkCreateDialog } from './BulkCreateDialog';
import { FlowRowMenu, type FlowRowMenuActions } from './FlowRowMenu';
import { CancelDialog } from './CancelDialog';
import { ReplaceDialog } from './ReplaceDialog';
import { useFlowTaskActions } from './useFlowTaskActions';
import { type DraftTab } from './draft/DraftMode';
import { DraftGenerate } from './draft/DraftGenerate';
import { DraftWrite } from './draft/DraftWrite';
import { DraftPick } from './draft/DraftPick';

// 캠페인 v2 상세 컨테이너 — /campaigns의 CampaignDetail과 같은 계약(로드·낙관적 갱신·원고 카드 모달)을 쥐지만,
// 표는 작업 표(TaskTable) 대신 단계 기반 표(FlowTable, Task 6)고 달력·인플루언서별 비용 표는 없다(R10 — 단일 표 화면).
// 필터·정렬·패널 열림은 campaignFlowView(Task 2)의 순수 함수로 판정한다 — 이 파일은 상태만 쥐고 계산은 그쪽에 맡긴다.
//
// 원고 카드(패널의 원고 모드가 그린다)·patchCampaign·removeCampaign·요청 토큰(reqRef)·influencerOptions 로드는
// CampaignDetail과 그대로다 — 코드와 함께 그 이유를 설명하는 주석도 옮겼다. clientData는 로딩/실패/성공
// 셋을 구분하도록 이 화면에서 갈렸다(리뷰 지적 4) — CampaignDetail은 손대지 않는다.

// 다른 작업으로 넘어가며 작성 중인 걸 잃는 경우의 확인 문구(Task 4d §2·§3) — TaskPanel의
// DRAFT_WRITE_LOST_CONFIRM은 '닫을까요?'로 끝나 패널을 통째로 닫는 동작(TaskPanel.requestClose)에만
// 맞는다. 여기 모인 자리(openPanel·openNew·openDraftMode, 아래)는 패널을 닫지 않고 다른 작업으로
// 바꾸므로, 이 파일에 이미 있던 전환용 문구(새 작업 dirty용 '입력한 내용이 사라져요.
// 다른 작업을 열까요?')와 같은 결로 새로 둔다 — 새 문장을 짓지 않고 그 어미를 그대로 쓴다.
// 직접 쓰기(원고)와 'AI로 만들기'(방향성)는 잃는 대상이 다르므로 문장도 나눈다 — 생성 탭에서 "원고가
// 있어요"라고 말하면 거짓이다(방향성 입력일 뿐, Task 4d §3). export하지 않는다 — page.tsx(왼쪽 목록
// 클릭, Task 4d §6)는 이 상수가 아니라 onLeaveConfirmChange로 이미 골라진 문장 자체를 받는다(아래
// FlowDetail의 onLeaveConfirmChange prop 주석) — 그래야 어느 탭이 작성 중인지 모르는 page.tsx에서도
// 정확한 문장이 뜬다.
const DRAFT_WRITE_SWITCH_CONFIRM = '작성 중인 원고가 있어요. 다른 작업을 열면 저장되지 않고 사라져요. 다른 작업을 열까요?';
const DRAFT_DIRECTION_SWITCH_CONFIRM = '쓰던 방향성이 있어요. 다른 작업을 열면 사라져요. 다른 작업을 열까요?';
// TaskPanel 안쪽 세 자리(requestClose·requestTabChange·requestDraftModeExit)에 내려줄 문구(Task 4e) —
// 위 SWITCH_CONFIRM 둘과 같은 출처(원고/방향성) 구분을 쓰지만 동작이 다르다. 닫기 쪽 원고 문장은
// DraftWriteModal.requestClose와 글자까지 맞춰야 해서 TaskPanel이 export하는 DRAFT_WRITE_LOST_CONFIRM을
// 그대로 쓰고, 나머지 셋은 그 말투에 맞춰 새로 둔다. 이동 쪽(탭 전환·← 작업으로·작업으로)은 다른 작업을
// 여는 동작이 아니므로 '다른 작업을 열까요?'를 쓰지 않고 이 자리를 떠난다는 뜻으로 쓴다.
const DRAFT_DIRECTION_LOST_CONFIRM = '쓰던 방향성이 있어요. 닫으면 사라져요. 닫을까요?';
const DRAFT_WRITE_LEAVE_CONFIRM = '작성 중인 원고가 있어요. 나가면 저장되지 않고 사라져요. 나갈까요?';
const DRAFT_DIRECTION_LEAVE_CONFIRM = '쓰던 방향성이 있어요. 나가면 사라져요. 나갈까요?';
// 취소·삭제는 '열지도' '나가지도' 않는다 — 그 작업을 그렇게 만들면 원고 모드가 함께 꺼진다. 그래서 문장도
// 그 동작을 가리켜야 한다(최종 수정 보고 (b)): 어느 문장을 쓰든 잃는 것은 같지만, 무엇을 하려는 참이냐가 다르다.
const DRAFT_WRITE_DISCARD_CONFIRM = '작성 중인 원고가 있어요. 계속하면 저장되지 않고 사라져요. 계속할까요?';
const DRAFT_DIRECTION_DISCARD_CONFIRM = '쓰던 방향성이 있어요. 계속하면 사라져요. 계속할까요?';

interface DetailState {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[];
  deleteInfo: { taskCount: number; detachedTargets: number; activeRequests: number }; today: string;
  budget: CampaignPeriodBudget | null;   // 이 기간 클라이언트 예산(서버 판정) — 카드의 '예산 기간 잔액'
}
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };
// 오른쪽 패널이 여는 대상 — 기존 작업(taskId) 또는 새 작업(fresh). 둘 다 아니면 패널이 닫혀 있다.
type Panel = { taskId: string } | { fresh: true } | null;

export function FlowDetail({ id, onChanged, onDeleted, onLeaveConfirmChange }: {
  id: string;
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·작업 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
  // 직접 쓰기·생성 탭이 작성 중이면 그때 띄울 확인 문장을 부모(page.tsx)에 올린다(Task 4d §6) — 왼쪽
  // 목록에서 다른 캠페인을 누르면 이 컴포넌트째로 언마운트된다(page.tsx가 key={picked.id}로 그린다).
  // 패널 안쪽 가드(openPanel 등, 아래)는 같은 캠페인 안에서 다른 작업으로 넘어갈 때만 닿고, 캠페인
  // 자체를 바꾸는 그 클릭에는 안 닿는다. boolean이 아니라 문장 자체를 올리는 이유 — page.tsx는 어느 탭이
  // 작성 중인지 모르므로, boolean만 받으면 원고용 문장 하나로 고정해야 해서 생성 탭이 작성 중일 때도
  // "원고가 있어요"라는 거짓을 말하게 된다(Task 4d §3과 같은 문제, 아래 draftSwitchConfirm 참고).
  onLeaveConfirmChange?: (confirmMessage: string | null) => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]);
  // undefined=아직 못 읽음(로딩 중), null=읽다가 실패, 객체=성공(리뷰 지적 4 — 실패를 로딩 중이라고 말하지 않는다)
  const [clientData, setClientData] = useState<ClientData | null | undefined>(undefined);
  // 원고 카드 — 패널이 보여줄 작업에 붙은 원고 한 건. 작업 목록엔 본문이 없어 열 때 받아 온다.
  const [cardDraft, setCardDraft] = useState<DraftRow | null>(null);
  // 실패한 원고의 id(리뷰 지적 3) — boolean이면 어느 원고의 실패인지 몰라, 한 원고를 못 읽은 뒤 다른
  // 작업의 패널을 열면 그 작업의 카드 자리에 실패 문구가 한 프레임 비칠 수 있다. 카드 자리의 판정은
  // cardErr === panelDraftId로 한다.
  const [cardErr, setCardErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [mediaDrop, setMediaDrop] = useState<{ draftId: string; notice: MediaDropNotice } | null>(null);
  // 새 작업 폼에서 고른 원고(Task 3 원고 칸) — 주인은 여기(스펙 §4-6). TaskPanel에 newDraft로 내려주고,
  // 아래 세 갈래(폼 호스트)의 onChosen이 채운다(Task 4).
  const [formDraft, setFormDraft] = useState<DraftRow | null>(null);
  // 폼 맥락(스펙 §4-6) — TaskPanel의 로컬 상태(newType·handle·target)를 그대로 옮겨 받는다(onNewContextChange).
  // 이 값으로 폼 호스트(DraftHost)와 인용RT의 대상 정보를 만든다 — "선택된 작업으로 만들 때와 같은 함수"를
  // task 대신 이 맥락 객체로 부른다.
  const [formCtx, setFormCtx] = useState<FormDraftContext>({ type: null, handle: null, target: null });
  // 있는 원고 고르기에서 주인이 다른 원고를 고르면(pickedHandleNotice) TaskPanel의 handle 칸을 채우라는
  // 신호(draftOpenReq와 같은 seq 관례) — TaskPanel이 값 소유자라 여기서 직접 못 바꾼다.
  // handle이 null일 수 있다 — 카드에서 인플루언서를 해제(→null)했을 때도 폼의 잠긴 칩을 같이 비워야
  // 한다(안 그러면 카드는 '미배정', 잠긴 칩은 옛 사람을 계속 말하는 어긋남이 생긴다).
  const [formHandleFill, setFormHandleFill] = useState<{ handle: string | null; seq: number } | null>(null);
  const formHandleFillSeqRef = useRef(0);
  // ref 접근을 useCallback 하나로 모은다 — renderDraftCard(아래, 훅이 아닌 평범한 함수)가 돌려주는 JSX의
  // 이벤트 콜백 안에서 ref.current를 직접 건드리면 React Compiler가 "렌더 중 ref 접근"으로 오판해(그
  // 콜백이 실제로는 클릭 때만 도는 이벤트 핸들러인데도) 같은 함수 안의 다른 콜백들까지 최적화를 포기한다
  // (직접 겪음 — 이 함수를 만들기 전엔 renderDraftCard 안 무관한 줄들까지 함께 에러가 났다). draftOpenSeqRef
  // 처럼 useCallback 안에 갇힌 ref 접근은 문제가 없어, 그 관례를 그대로 따른다.
  const bumpFormHandleFill = useCallback((handle: string | null) => {
    formHandleFillSeqRef.current += 1;
    setFormHandleFill({ handle, seq: formHandleFillSeqRef.current });
  }, []);

  // 이 화면만의 상태 — 필터·정렬·오른쪽 패널·"한 번에 만들기" 열림(§4-2, §4-3, koo 09-18)
  const [filter, setFilter] = useState<FlowFilter>(EMPTY_FLOW_FILTER);
  const [sort, setSort] = useState<FlowSort>({ key: null, dir: 1 });
  const [panel, setPanel] = useState<Panel>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // 게시 확인 다이얼로그(Task 9) — 패널의 [게시] 버튼과 행 메뉴(FlowRowMenu)의 [게시 확인]이 둘 다 이 상태를
  // 연다(Task 10). RT 증빙 라이트박스는 TaskTable과 같은 관례(useSignedTaskProofUrls로 배치 서명 + zoomUrl 하나).
  const [postedFor, setPostedFor] = useState<FlowRow | null>(null);
  // 게시 내림 표시 다이얼로그(koo 09-19 결정 3) — 패널의 [내림 표시] 버튼이 연다. PostedDialog와 같은
  // 자리. [내림 표시]는 항상 지금 패널이 보여주는 작업(panelTask)에서만 열리므로 대상은 boolean 하나로
  // 충분하다 — postedFor처럼 클릭 시점 작업을 따로 들고 있으면, 다이얼로그 안에서 증빙을 올려도(그
  // setProof는 data.tasks만 갱신) 그 스냅샷은 갱신되지 않아 옛 화면(PostedCell, task가 살아있는 prop)과
  // 동작이 달라진다.
  const [removedOpen, setRemovedOpen] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // 게시물 연결(트래킹)·취소·교체(Task 10) — 셋 다 ··· 메뉴에서만 연다(행·패널 공용, FlowRowMenu)
  const [linkFor, setLinkFor] = useState<FlowRow | null>(null);
  const [cancelFor, setCancelFor] = useState<FlowRow | null>(null);
  const [replaceFor, setReplaceFor] = useState<FlowRow | null>(null);
  // 원고 카드에서 고른 핸들을 교체 다이얼로그가 이어받게(있음+다른 핸들, koo QA) — 행 메뉴로 열 때는 없다(빈 입력부터).
  const [replaceInitialHandle, setReplaceInitialHandle] = useState<string | null>(null);
  // 원고 모드(§5) — '있는 원고 고르기' 입구 라벨의 개수와 pick 탭의 후보에 쓴다. 캠페인 단위로 한 번 읽고,
  // 원고를 붙이거나 뗄 때마다 다시 읽는다(reloadCandidates). undefined=아직 못 읽음(로딩 중), null=읽다가
  // 실패, 객체=성공 — clientData(위)와 같은 모양(리뷰 지적 2, Task 3에서 같은 문제를 고친 방식을 따른다).
  // 실패를 로딩 중이라고 말하지 않는다 — DraftPick이 이 둘을 구분해 읽는다.
  const [candidates, setCandidates] = useState<{ siblings: DraftRow[]; others: DraftRow[] } | null | undefined>(undefined);
  // 행 메뉴 등 패널 바깥에서 온 "원고 모드로 열어라" 요청 — 이미 같은 작업의 패널이 열려 있으면 key
  // 리마운트가 안 일어나 TaskPanel의 로컬 mode가 안 바뀐다. seq를 매번 올려 그 경우에도 요청이 전달되게 한다.
  // tab이 null이면 "작업 모드로 되돌려라"는 뜻(리뷰 지적 4) — openPanel이 같은 작업 행을 다시 눌렀을 때
  // 이 신호를 보낸다(패널이 원고 모드일 때도 행 클릭 = 그 작업을 연다가 지켜져야 한다).
  const [draftOpenReq, setDraftOpenReq] = useState<{ tab: DraftTab | null; seq: number } | null>(null);
  const draftOpenSeqRef = useRef(0);
  // AI로 만들기(Task 3)가 시안을 만들거나 붙이는 동안 · 직접 쓰기(Task 4)가 저장·업로드하는 동안 · 있는
  // 원고 고르기(Task 5)가 붙이는 동안 — TaskPanel이 이 값(셋을 합친 draftBusy)으로 바깥 클릭·Esc 닫기를
  // 끈다(생성/저장/붙이기 중 실수로 패널이 닫혀도 결과 자체는 남지만, 사용자가 붙일 기회를 놓치지 않게
  // 한다). 세 탭은 동시에 마운트되지 않으므로(DraftMode가 tab === 'generate' ? generate : tab === 'write'
  // ? write : pick 중 하나만 그린다) 실제로는 항상 하나만 값이 있지만, 어느 탭의 값인지 TaskPanel이 몰라도
  // 되게 여기서 미리 합친다. DraftGenerate·DraftWrite는 label을 스스로 안다(생성 중·붙이는 중, 저장 중·
  // 업로드 중이 서로 다른 사실이라 boolean 하나로는 거짓 어포던스가 된다 — 최종 리뷰 §3에서 DraftGenerate도
  // 붙이는 동안 잠그도록 넓혔다) — 그 값을 그대로 쓴다. 있는 원고 고르기는 붙이는 중인 원고의 id를 들고
  // 있다(DraftPick이 그 행에 "붙이는 중…"을 보여줘야 해서, DraftGenerate.attaching과 같은 모양) — 여기서는
  // 값이 있는지만 보고 label은 여기서 붙인다.
  const [draftGenBusy, setDraftGenBusy] = useState<{ label: string } | null>(null);
  const [draftWriteBusy, setDraftWriteBusy] = useState<{ label: string } | null>(null);
  const [draftPickBusy, setDraftPickBusy] = useState<string | null>(null);
  const draftBusy: { label: string } | null = draftGenBusy ?? draftWriteBusy ?? (draftPickBusy ? { label: '붙이는 중이에요' } : null);
  // 원고 모드가 "작성 중"인지(리뷰 지적 4, Task 4c §3에서 생성 탭까지 넓혔다) — DraftWrite의 로컬 상태
  // (posts)도, DraftGenerate의 방향성 글자도 이 컴포넌트가 못 보므로 콜백으로 받아 TaskPanel에 다시
  // 내려준다(onBusyChange와 같은 배선). openPanel 등(아래)은 합친 값 하나(draftWriteDirty)만 보면 되지만,
  // TaskPanel의 패널 안쪽 세 자리는 이미 골라진 문장(closeConfirm·moveConfirm, 아래)을 받는다(Task 4e —
  // 어느 탭인지는 TaskPanel이 몰라도 된다). 두 원천은 따로 든다(Task 4d §3) — "작성 중"인 이유가
  // 원고냐 방향성이냐에 따라 다른데, 합친 값 하나로는 이 파일의 전환 확인(openPanel 등, 아래)과
  // TaskPanel에 내려줄 문장 모두 어느 것을 골라야 할지 알 수 없다. 두 탭은 동시에 마운트되지
  // 않으므로(draftBusy 주석과 같은 전제) 둘 다 세워질 일은 없다.
  const [draftGenDirty, setDraftGenDirty] = useState(false);
  const [draftWriteOnlyDirty, setDraftWriteOnlyDirty] = useState(false);
  const draftWriteDirty = draftGenDirty || draftWriteOnlyDirty;
  // 어느 쪽이 작성 중인지에 따라 문장을 고른다(Task 4d §3) — 직접 쓰기는 원고를 잃고, 생성 탭은 방향성을
  // 잃는다. 두 탭이 동시에 마운트되지 않으므로(위 주석) 여기서도 동시에 참일 일이 없다. openPanel·openNew·
  // openDraftMode(아래)가 이 값을 쓴다.
  const draftSwitchConfirm = draftGenDirty ? DRAFT_DIRECTION_SWITCH_CONFIRM : DRAFT_WRITE_SWITCH_CONFIRM;
  // TaskPanel 안쪽 세 자리(requestClose·requestTabChange·requestDraftModeExit)에 내려줄 문장(Task 4e) —
  // 위 draftSwitchConfirm과 같은 출처 판정(draftGenDirty ? 방향성 : 원고)이지만 동작별로 문장이 갈린다
  // (닫기=closeConfirm, 이동=moveConfirm). 둘 다 작성 중이 아니면 null — TaskPanel은 null이면 묻지 않고 그대로 진행한다.
  const closeConfirm = draftWriteDirty ? (draftGenDirty ? DRAFT_DIRECTION_LOST_CONFIRM : DRAFT_WRITE_LOST_CONFIRM) : null;
  const moveConfirm = draftWriteDirty ? (draftGenDirty ? DRAFT_DIRECTION_LEAVE_CONFIRM : DRAFT_WRITE_LEAVE_CONFIRM) : null;
  // 취소·삭제 자리(confirmLoseDraftFor)가 쓰는 문장 — 같은 출처 판정, 다른 동작.
  const discardConfirm = draftGenDirty ? DRAFT_DIRECTION_DISCARD_CONFIRM : DRAFT_WRITE_DISCARD_CONFIRM;
  // page.tsx로 한 단계 더 올린다(Task 4d §6) — 왼쪽 목록 클릭(캠페인 전환)은 이 컴포넌트 바깥이라 패널
  // 안쪽 가드(openPanel 등)가 안 닿는다. boolean이 아니라 "띄울 문장 자체"를 올린다(자문 리뷰) — 그냥
  // dirty만 올리면 page.tsx는 어느 탭인지 몰라 DRAFT_WRITE_SWITCH_CONFIRM 하나로 고정되고, 생성 탭이
  // 작성 중일 때도 "원고가 있어요"라고 말하는 거짓말이 된다(Task 4d §3이 막던 것과 같은 모양). 언마운트
  // 되면 null로 정리한다(DraftWrite·DraftGenerate의 onDirtyChange 정리 관례와 같다) — 안 그러면 캠페인을
  // 지운 직후처럼 이 컴포넌트가 사라진 뒤에도 부모가 옛 문장을 들고 있어 다음 전환에 엉뚱한 확인이 뜬다.
  useEffect(() => { onLeaveConfirmChange?.(draftWriteDirty ? draftSwitchConfirm : null); }, [draftWriteDirty, draftSwitchConfirm, onLeaveConfirmChange]);
  useEffect(() => () => onLeaveConfirmChange?.(null), [onLeaveConfirmChange]);
  // 레퍼런스 고르기 시트·링크 추가 모달이 원고 모드 안에서 떠 있는 동안(리뷰 지적 1, Critical) — 두 오버레이는
  // document keydown을 버블 단계에서 듣고 stopPropagation을 안 해서, 먼저 등록된 패널의 Esc가 패널째로 닫아
  // 버린다. overlayOpen(아래)에 OR로 더해 막는다 — 다른 오버레이들과 같은 자리, DraftGenerate의 onOverlayChange가 채운다.
  const [draftOverlayOpen, setDraftOverlayOpen] = useState(false);

  // 요청 토큰 — 캠페인을 빠르게 갈아타면 앞 캠페인의 응답이 뒤에 도착할 수 있다. 그때 화면에는 이미 다른 캠페인이
  // 떠 있으므로 옛 응답은 성공이든 실패든 버린다(남의 캠페인 데이터·오류 배너가 붙는 것을 막는다).
  const reqRef = useRef(0);
  // 성공 여부를 돌려준다(리뷰 지적 3) — 원고 붙이기(onDraftAttached)가 이 재조회로만 잠금을 풀 수 있어,
  // 실패를 알아야 그 잠금을 대신 풀어 준다.
  const load = useCallback(async (): Promise<boolean> => {
    const token = ++reqRef.current;
    const r = await fetchCampaignDetail(id);
    if (token !== reqRef.current) return r.ok;   // 그 사이 다른 캠페인(또는 새 로드)이 시작됐다 — 이 응답은 화면의 것이 아니다(더 새 로드가 마무리한다)
    if (r.ok) {
      const { campaign, tasks, costRows, deleteInfo, today, budget } = r.data;   // 카드·필터 집계는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, tasks, costRows, deleteInfo, today, budget });
      setLoadErr(false);
    } else {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
    setLoaded(true);
    return r.ok;
  }, [id]);
  // id가 바뀌면 이전 캠페인의 data를 먼저 지우고 로딩 상태로 돌아간다 — 안 지우면 새 캠페인을 불러오는 동안
  // 앞 캠페인의 헤더·표·합계가 새 id의 화면인 척 남아 있고, '최신이 아닐 수 있어요' 배너도 남의 데이터에 붙는다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- id 전환 시의 리셋이 목적이라 동기 setState가 맞다(그 뒤 로드는 비동기 콜백)
    setData(null); setLoaded(false); setLoadErr(false);
    setPanel(null);   // 다른 캠페인의 작업 id를 들고 있던 패널이 새 캠페인 화면에 남지 않게
    setCandidates(undefined);   // 다른 캠페인의 후보가 이 캠페인 화면에 남지 않게 — 로딩 중이지 실패가 아니다
    void load();
  }, [load]);

  // 원고 모드의 '있는 원고 고르기' 후보(§5-3, Task 1) — 캠페인 단위로 한 번 읽는다. 실패해도 화면을 막지
  // 않는다 — 읽지 못했으면 null로 남겨 '실패'를 말하고(리뷰 지적 2), DraftPick이 다시 시도할 길을 보여준다.
  // 붙이기·떼기 뒤에도 이 함수로 다시 읽는다(백그라운드 재조회) — 그때는 이미 보이던 목록을 undefined로
  // 덮지 않는다(안 그러면 붙이는 동안 잠깐 '불러오는 중…'이 다시 뜬다). 실패했던 상태에서 [다시 시도]를
  // 눌렀을 때만 로딩 중으로 되돌린다(cur === null일 때만) — 그래야 재시도 버튼을 누른 보람이 화면에 보인다.
  const candReqRef = useRef(0);   // load()의 reqRef와 같은 관례(리뷰 지적 3) — 별도 요청이라 토큰도 따로 둔다(공유하면 서로의 응답을 버린다)
  const reloadCandidates = useCallback(async () => {
    const token = ++candReqRef.current;
    setCandidates((cur) => (cur === null ? undefined : cur));
    const r = await fetchDraftCandidatesApi(id);
    if (token !== candReqRef.current) return;   // 그 사이 다른 캠페인(또는 새 재조회)이 시작됐다 — 이 응답은 화면의 것이 아니다
    setCandidates(r.ok ? r.data : null);
  }, [id]);
  // reloadCandidates 맨 앞의 setCandidates(재시도→로딩 전환, 위 주석)는 await 이전이라 아래 이펙트 안에서
  // 동기로 실행된다 — id 전환 시 그 리셋이 의도한 동작이라 다음 줄에서 끈다. 뒤이은 setCandidates(결과
  // 반영)는 fetch 뒤 콜백이라 원래도 안 걸린다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- id 전환 시 reloadCandidates 맨 앞의 동기 setCandidates(재시도→로딩 전환)를 의도적으로 태운다(바로 위 주석)
    void reloadCandidates();
  }, [reloadCandidates]);

  // 배정 자동완성 후보(+단가) — 실패해도 빈 목록(자유 입력은 그대로 동작, generate 관례)
  useEffect(() => {
    apiFetch('/api/drafts/influencers').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((inf) => setInfluencerOptions(Array.isArray(inf) ? inf : []));
  }, []);
  // 금지 표현(DraftCard 검수 표식) — 이 캠페인의 클라이언트 하나만 필요하다. 클라가 없거나 실패하면 표식 없음.
  const clientId = data?.campaign.clientId ?? null;
  useEffect(() => {
    if (!clientId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트가 바뀌면 로딩 상태로 되돌린다(그 뒤 읽기는 비동기 콜백 안에서)
    setClientData(undefined);   // 앞 클라이언트의 정보를 새 클라이언트인 척 잠깐 보여주지 않는다
    apiFetch(`/api/clients/${clientId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((c) => setClientData(c as ClientData | null));
  }, [clientId]);

  const setTasks: Dispatch<SetStateAction<CampaignTaskItem[]>> = useCallback((next) => {
    setData((cur) => (cur ? { ...cur, tasks: typeof next === 'function' ? next(cur.tasks) : next } : cur));
  }, []);
  const taskActions = useCampaignTaskActions({ campaignId: id, setTasks, influencerOptions, show, onChanged });
  // 게시 확인에 링크를 함께 넣으면 트래킹 등록까지 일어난다 — 그 결과(성과 스냅샷·게시물 연결)는 서버에만 있으므로
  // 낙관적 갱신으로는 못 채운다. 링크가 있었을 때만 상세를 다시 읽어 조회·좋아요가 표에 뜨게 한다.
  const actions = useMemo(() => ({
    ...taskActions,
    markPosted: async (t: CampaignTaskItem, date: string, postUrl?: string, proof?: string) => {
      const ok = await taskActions.markPosted(t, date, postUrl, proof);
      if (ok && postUrl) void load();
      return ok;
    },
  }), [taskActions, load]);
  // 취소·되돌리기·교체(ADR 0002·0005) — 낙관 갱신 없이 성공 뒤 상세를 다시 읽는다. 호출부(다이얼로그)는 Task 10.
  // useFlowTaskActions는 reload: () => Promise<void>를 받는다 — load()가 이제 성공 여부를 돌려주므로(리뷰
  // 지적 3) 그 계약을 안 건드리려고 결과를 버리는 얇은 래퍼로 감싼다.
  const reloadDetail = useCallback(async () => { await load(); }, [load]);
  const flowActions = useFlowTaskActions({ campaignId: id, show, reload: reloadDetail, onChanged });
  // 배정된 인플루언서의 명부 옵션 — FlowTable·TaskTable과 같은 매칭 규칙(핸들 대소문자 무관)
  const optionFor = useCallback(
    (handle: string | null) => (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined),
    [influencerOptions],
  );
  // 비용 [확인] 뒤 "프로필도 바꿀까요"에 예라고 답했을 때만(b-task-8-brief.md §3) — option.id 없으면(명부 밖)
  // 저장할 곳이 없다고 알리고 끝낸다. 성공하면 배정 자동완성 후보(단가 포함)를 다시 읽어 새 값이 바로 보이게 한다.
  const saveProfilePricing = useCallback(async (option: InfluencerOption, cost: TaskCost, type: TaskType): Promise<boolean> => {
    if (!option.id) { show('이 인플루언서는 명부에 없어 프로필을 바꿀 수 없어요'); return false; }
    const r = await patchInfluencerPricingApi(option.id, { [type]: cost.amount, currency: cost.currency });
    if (!r.ok) { show(r.error); return false; }
    // 재조회 실패면 들고 있던 후보를 유지한다 — 빈 배열로 덮으면 저장은 성공했는데 화면의 자동완성·단가 제안이
    // 통째로 사라져(새로고침 전까지) 사용자가 원인을 짚을 수 없다.
    const inf: unknown = await apiFetch('/api/drafts/influencers').then((res) => (res.ok ? res.json() : null)).catch(() => null);
    if (Array.isArray(inf) && inf.length) setInfluencerOptions(inf as InfluencerOption[]);
    return true;
  }, [show]);

  // ── 이 화면의 파생값(§4-2·§4-3) — 필터·정렬·통계는 campaignFlowView의 순수 함수로 계산한다. 여기서 다시 판정하지 않는다. ──
  // shown = 필터·정렬을 적용한 표시 순서. 표가 그리는 순서이자 패널의 이전/다음이 걷는 순서다(하나의 소스).
  const shown = useMemo(() => (data ? sortFlowRows(data.tasks.filter((t) => matchesFlowFilter(t, filter, data.today)), sort) : []), [data, filter, sort]);
  const stats = useMemo(() => (data ? flowStats(data.tasks) : null), [data]);
  // 계획 비용(카드용, b-task-11-brief.md §1) — stats.plannedCost(작업 비용만)와 달리 인플별 추가 비용까지 더한다.
  // /campaigns(CampaignDetail)의 '비용 합계'와 같은 함수라 두 화면이 같은 숫자를 말한다.
  const plannedTotal = useMemo(
    () => (data ? taskCampaignTotal(deriveTaskInfluencers(data.tasks, data.costRows)) : {}),
    [data],
  );
  const settleWait = useMemo(() => (data ? settleWaitCount(data.tasks) : 0), [data]);
  // 필터 드롭다운의 칩 개수 — "그 조건 하나만 켰을 때의 건수"(다른 묶음과 교차시키지 않는다, b-task-6-brief.md 명확화 3)
  const counts = useMemo(() => ({
    stage: Object.fromEntries(FLOW_STAGES.map((k) => [k, (data?.tasks ?? []).filter((t) => flowStage(t, t.settlement) === k).length])) as Record<FlowStage, number>,
    type: Object.fromEntries(DISPLAY_TYPE_ORDER.map((k) => [k, (data?.tasks ?? []).filter((t) => t.type === k).length])) as Record<TaskType, number>,
    extra: Object.fromEntries(EXTRA_FILTERS.map((k) => [k, (data?.tasks ?? []).filter((t) => matchesExtra(t, k, data?.today ?? '')).length])) as Record<ExtraFilter, number>,
  }), [data]);
  const summary = useMemo(() => filterSummary(filter, shown.length, data?.tasks.length ?? 0), [filter, shown, data]);
  const footer = useMemo(() => flowFooter(data?.tasks ?? [], data?.today ?? ''), [data]);
  const sortNote = sort.key ? `· ${FLOW_SORT_LABEL[sort.key]} ${sort.dir === 1 ? '오름차순' : '내림차순'}` : '· 만든 순';
  // 성과 [업데이트](비용 유발 — 게시물당 API 1회, UX 원칙 6 opt-in). 성공하면 상세를 다시 읽어야 새 스냅샷이 카드·표에 보인다.
  const cancelledCount = data?.tasks.filter(isTaskExcluded).length ?? 0;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const r = await refreshCampaignPerfApi(id);
    if (!r.ok) { setRefreshing(false); show(r.error); return; }
    await load();   // 새 스냅샷이 카드·표에 보이려면 상세를 다시 읽어야 한다 — 버튼은 그때까지 눌리지 않는다
    setRefreshing(false);
    show(r.data.total === 0
      ? '조회할 게시물이 없었어요'
      : `게시물 ${r.data.refreshed}건을 다시 조회했어요${r.data.unavailable ? ` · ${r.data.unavailable}건은 찾을 수 없어요` : ''}${r.data.failed ? ` · ${r.data.failed}건은 실패했어요` : ''}`);
  }, [id, show, load]);

  // 오른쪽 패널 — 이전/다음은 shown(표시 순서, 결정 4)을 걷지만, 패널이 보여줄 작업 자체는 data.tasks에서 찾는다.
  // shown으로 찾으면 패널을 연 채 필터를 바꾸거나(다른 세션 변경으로) 단계가 바뀌어 이 작업이 shown에서
  // 빠지는 순간 패널이 '작업 없음'으로 보인다 — 열려 있는 작업은 화면에서 안 보여도 패널 안에서는 계속 보여야 한다.
  const isNew = !!panel && 'fresh' in panel;
  const panelTaskId = panel && 'taskId' in panel ? panel.taskId : null;
  const panelIndex = panelTaskId ? shown.findIndex((t) => t.id === panelTaskId) : -1;
  const panelTask = panelTaskId ? (data?.tasks.find((t) => t.id === panelTaskId) ?? null) : null;
  // 표가 흐려지는 조건과 패널이 실제로 뜨는 조건은 항상 같아야 한다 — panelTaskId가 가리키는 작업이 다른 세션의
  // 삭제·취소로 data.tasks에서 사라지면(Task 10 삭제 등) panelTask가 null이 되는데, 그때 표만 흐리고 패널이
  // 없으면 "닫히지도 열리지도 않은" 상태로 보인다. 하나의 값으로 통일한다.
  const panelOpen = !!panel && (isNew || !!panelTask);
  // 패널을 닫거나(panel:null) 다른 행으로 옮기면(panel:{taskId}) formDraft를 비운다(Task 4 §5) — 안 비우면
  // 다음에 새 작업 폼을 열 때(TaskPanel이 key='new'로 리마운트돼 newType 등은 초기화되지만, formDraft는
  // 여기 남아 있어) 유형 없이 원고만 남아 TaskPanel의 유형 칩이 빈 라벨(TASK_TYPE_LABEL[null])로 뜬다.
  // 같은 새 작업 폼 안에서 자리를 옮기는 것(같은 'new' 키, 리마운트 없음)은 없으므로 isNew만 보면 된다.
  // formHandleFill도 같이 비운다(자문 리뷰) — 안 비우면 @A 원고를 고른 채 닫고 [+ 작업 추가]로 새 폼을
  // 열었을 때, TaskPanel이 마운트되며 그 옛 신호를 다시 받아 아무것도 안 골랐는데 인플루언서 칸이 @A로
  // 채워진다(openNew이 draftOpenReq를 null로 비우는 것과 같은 이유 — 신호는 한 번 쓰고 버려야 한다).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널이 새 작업 폼을 벗어날 때의 정리가 목적(isNew가 바뀔 때만 반응)
    if (!isNew) { setFormDraft(null); setFormHandleFill(null); }
  }, [isNew]);
  // 증빙 서명 URL — 패널이 지금 보여주는 작업 하나만(TaskTable처럼 표 전체를 배치하지 않는다, 패널은 한 번에 하나다)
  const proofUrls = useSignedTaskProofUrls(panelTask?.proof?.url ? [panelTask.proof.url] : []);
  // 원고 모드(§5) — 패널이 보여줄 작업에 원고가 붙어 있으면 카드를 그릴 원고 한 건을 받아 온다. 같은
  // 원고를 다시 열면 이미 받아 둔 것을 쓴다(재요청 없음).
  const panelDraftId = panelTask?.draftId ?? null;
  useEffect(() => {
    if (!panelDraftId || cardDraft?.id === panelDraftId) return;
    let alive = true;
    apiFetch(`/api/drafts/${panelDraftId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (!alive) return; setCardDraft((d as DraftRow | null) ?? null); setCardErr(d === null ? panelDraftId : null); });
    return () => { alive = false; };
  }, [panelDraftId, cardDraft]);
  const panelDraft = panelDraftId && cardDraft?.id === panelDraftId ? cardDraft : null;
  // tab:null을 보낸다(seq는 그대로 증가) — 이미 그 작업의 패널이 원고 모드로 열려 있으면(key 리마운트가
  // 없다) TaskPanel의 이펙트가 이 신호로 작업 모드로 돌려보낸다(리뷰 지적 4, "행 클릭 = 그 작업을 연다").
  // draftSwitchConfirm은 위(draftWriteDirty 바로 아래)에서 이미 정의했다 — page.tsx로 올리는 문장과
  // 여기서 쓰는 문장이 같은 값이어야 한다(Task 4d §3·§6).
  // 직접 쓰기·생성 탭이 작성 중이면(draftWriteDirty) 다른 작업으로 넘어가기 전에 확인한다(Task 4c §1) —
  // 여기 한 곳에서 막으면 이 함수를 부르는 모든 자리(행 클릭·행 메뉴 예정일 바꾸기·이전/다음·한 번에
  // 만들기 뒤 이동)가 한 번에 지켜진다. 새 작업 폼의 isNewDirty는 여기서 보지 않는다 — createTask가
  // 작업을 막 만든 뒤 이 함수로 그 작업을 여는데, 그 순간 isNew·newDirtyRef는 "방금 저장된 값"이라 여기서
  // 같이 물으면 저장 직후 스스로를 지운다는 거짓 경고가 된다(isNewDirty 확인은 openDraftMode·onRowClick이
  // 각자 진다). 문구는 '닫을까요?'가 아니라 '열까요?' 쪽이다(Task 4d §2) — 이 함수는 패널을 닫지 않고
  // 다른 작업으로 바꾼다.
  const openPanel = useCallback((taskId: string) => {
    // 지금 패널이 보여주는 바로 그 작업을 다시 누른 것이면 draftSwitchConfirm("다른 작업을 열까요?")을
    // 쓰지 않는다(리뷰 지적 4) — 다른 작업을 여는 게 아니라 그 작업의 작업 모드로 돌아가는 것이라 그
    // 문장은 사실이 아니다. 그렇다고 묻지 않는 것은 아니다 — 이 자리가 보내는 tab:null 신호를 TaskPanel의
    // draftOpen 이펙트가 확인 없이 그대로 받아 setDraftMode('task')를 부르고(위 tab:null 주석), 원고
    // 모드가 꺼지며 DraftWrite·DraftGenerate가 언마운트돼 작성 중인 글이 사라진다 — requestDraftModeExit
    // ("← 작업으로")가 같은 전환에 쓰는 moveConfirm("나갈까요?")을 여기서도 그대로 쓴다(새 문장을 짓지
    // 않는다, 다른 작업이면 지금처럼 draftSwitchConfirm).
    const msg = taskId === panelTaskId ? moveConfirm : draftSwitchConfirm;
    if (draftWriteDirty && msg && !window.confirm(msg)) return;
    draftOpenSeqRef.current += 1;
    setDraftOpenReq({ tab: null, seq: draftOpenSeqRef.current });
    setPanel({ taskId });
  }, [panelTaskId, draftWriteDirty, draftSwitchConfirm, moveConfirm]);
  // + 작업 추가(Task 4c §1 — 4b가 안 막았던 문) — 같은 확인. isNewDirty는 필요 없다(이미 새 작업 모드일 때
  // 다시 눌러도 key가 그대로 'new'라 TaskPanel이 리마운트되지 않고, 로컬 입력은 그대로 남는다).
  const openNew = useCallback(() => {
    if (draftWriteDirty && !window.confirm(draftSwitchConfirm)) return;
    setDraftOpenReq(null); setPanel({ fresh: true });
  }, [draftWriteDirty, draftSwitchConfirm]);
  const openBulk = useCallback(() => setBulkOpen(true), []);
  // 새 작업 모드가 dirty한 동안 다른 행을 클릭하면 로컬 입력이 경고 없이 사라진다(I1-3) — dirty 여부는
  // TaskPanel의 로컬 상태에만 있어 ref로 받아 둔다(매 렌더 상태로 올리면 이 화면 전체가 리렌더된다).
  // boolean이 아니라 TaskPanel이 이미 고른 문장 조각을 받는다(Task 4 §6) — "입력한 내용이 사라져요"로
  // 고정돼 있으면 원고만 고르고 칸은 비운 경우 거짓말이 된다(원고는 '있는 원고 고르기'에 남아 안 사라진다).
  // TaskPanel.requestClose가 쓰는 것과 같은 조각(newDirtyParts)이고, 어미만 여기서 다르게 붙인다.
  const newDirtyRef = useRef<string | null>(null);
  const onNewDirtyChange = useCallback((msg: string | null) => { newDirtyRef.current = msg; }, []);
  // 원고 모드로 열어라(행 메뉴 등 패널 바깥에서 온 요청) — 이 작업의 패널을 열고, seq를 올려 TaskPanel에
  // "지금 이 탭으로 원고 모드를 열어라"를 전달한다(이미 같은 작업 패널이 열려 있으면 key 리마운트가 없어
  // seq가 없으면 두 번째 요청이 무시된다). 표가 흐려질 뿐 막히진 않으므로(결정 3) 새 작업 dirty 확인도
  // onRowClick과 같은 규칙으로 지켜야 한다 — 안 그러면 ···에서 원고 모드로 바로 넘어가며 입력이 조용히 사라진다.
  // 직접 쓰기가 작성 중일 때도 같은 규칙으로 지켜야 한다(자문 리뷰) — openPanel(taskId)은 같은 작업을
  // 다시 눌렀을 때도 draftOpenReq{tab:null}을 보내는데, TaskPanel의 draftOpen 이펙트가 그 신호로
  // setDraftMode('task')를 확인 없이 직접 부른다(패널 안의 requestTabChange·requestDraftModeExit를
  // 거치지 않는 별도 경로). isNew 쪽 문장은 새로 짓지 않고 이 파일에 이미 있는 것을 그대로 쓴다 — 아래
  // draftWriteDirty 쪽은 openPanel과 같은 draftSwitchConfirm(위에서 정의, Task 4d §2·§3)을 쓴다.
  const openDraftMode = useCallback((t: FlowRow, tab: DraftTab) => {
    if (isNew && newDirtyRef.current && !window.confirm(`${newDirtyRef.current} 다른 작업을 열까요?`)) return;
    // openPanel과 같은 규칙 — 같은 작업이면 다른 작업을 여는 게 아니라 그 작업 안에서 자리를 옮기는 것이다.
    const msg = t.id === panelTaskId ? moveConfirm : draftSwitchConfirm;
    if (draftWriteDirty && msg && !window.confirm(msg)) return;
    draftOpenSeqRef.current += 1;
    setDraftOpenReq({ tab, seq: draftOpenSeqRef.current });
    setPanel({ taskId: t.id });
  }, [isNew, panelTaskId, draftWriteDirty, draftSwitchConfirm, moveConfirm]);
  // draftWriteDirty 확인은 openPanel이 이미 진다(위 주석) — 여기서 또 물으면 같은 클릭에 확인창이 두 번 뜬다.
  const onRowClick = useCallback((t: FlowRow) => {
    if (isNew && newDirtyRef.current && !window.confirm(`${newDirtyRef.current} 다른 작업을 열까요?`)) return;
    openPanel(t.id);
  }, [isNew, openPanel]);
  const onPanelPrev = useCallback(() => { if (panelIndex > 0) openPanel(shown[panelIndex - 1].id); }, [panelIndex, shown, openPanel]);
  const onPanelNext = useCallback(() => { if (panelIndex >= 0 && panelIndex < shown.length - 1) openPanel(shown[panelIndex + 1].id); }, [panelIndex, shown, openPanel]);
  // 취소·삭제도 패널의 확인을 먼저 지나야 한다(최종 리뷰 §1 — 같은 종류의 손실을 다섯 라운드에 걸쳐 막던
  // 것의 여섯 번째 문). 지금 패널이 보여주는 바로 그 작업을 표의 ··· 메뉴에서 취소·삭제하면 inDraftMode
  // 게이트가 꺼지며 DraftWrite·DraftGenerate가 언마운트돼 작성 중인 글·방향성이 확인 없이 사라진다(표는
  // 흐릴 뿐 막혀 있지 않고, 메뉴 셀은 클릭 전파를 막아 메뉴가 그대로 열린다). openPanel 등(위)이 다른
  // 확인 문장은 이 동작을 가리키는 것(discardConfirm)을 쓴다 — '다른 작업을 열까요?'는 여기서 사실이 아니다. 다른
  // 작업의 취소·삭제는 지금 패널과 무관하니 묻지 않는다(taskId !== panelTaskId).
  const confirmLoseDraftFor = useCallback((taskId: string): boolean => (
    taskId !== panelTaskId || !draftWriteDirty || window.confirm(discardConfirm)
  ), [panelTaskId, draftWriteDirty, discardConfirm]);
  // 행 "···" 메뉴(Task 10) — 표의 마지막 칸과 패널 헤더가 같은 컴포넌트(FlowRowMenu)를 쓴다. 여기 모인
  // 콜백들은 전부 "다이얼로그/모달을 연다" 또는 "확인 뒤 바로 실행한다" 둘 중 하나 — 실제 저장은 flowActions
  // (취소·되돌리기·교체, Task 7)나 actions.remove(useCampaignTaskActions)가 한다.
  const menuActions: FlowRowMenuActions = useMemo(() => ({
    posted: (t) => setPostedFor(t),
    schedule: (t) => openPanel(t.id),
    openDraftMode,
    linkPost: (t) => setLinkFor(t),
    replace: (t) => { setReplaceInitialHandle(null); setReplaceFor(t); },
    cancel: (t) => { if (confirmLoseDraftFor(t.id)) setCancelFor(t); },
    // 되돌리기는 확인 창 없이 즉시 실행한다 — 되돌리기 자체가 되돌리는 동작이고, 결과는 훅이 토스트로 알린다.
    // 취소돼 있던 작업에 붙어 있던 원고는 되돌리며 재부착되거나(reattached) 남의 것이 됐거나(taken) 지워졌을
    // 수 있다(restoreMessage) — 어느 쪽이든 후보 목록(있는 원고 고르기)이 달라질 수 있어 다시 읽는다.
    restore: (t) => { void flowActions.restore(t).then((ok) => { if (ok) void reloadCandidates(); }); },
    // 삭제는 기존 관례(CampaignDetail)와 같은 확인 문구 — actions.remove가 실제 삭제. 패널이 지금 이 작업을
    // 보고 있었으면(삭제된 작업 id로 남지 않게) 함께 닫는다. confirmLoseDraftFor가 먼저다 — 작성 중인 글을
    // 잃는 확인이, 작업 자체를 지울지 묻는 확인보다 앞서야 한다(최종 리뷰 §1).
    remove: (t) => {
      if (!confirmLoseDraftFor(t.id)) return;
      if (!window.confirm(`이 작업을 지울까요?${t.draftId ? '\n\n원고는 남아요.' : ''}`)) return;
      void actions.remove(t).then((ok) => {
        if (ok && panelTaskId === t.id) setPanel(null);
        // 원고가 붙어 있던 작업을 지우면 원고는 남되(토스트) 작업 없는 상태가 된다 — 후보로 다시 잡혀야 한다.
        if (ok && t.draftId) void reloadCandidates();
      });
    },
  }), [openPanel, openDraftMode, flowActions, actions, panelTaskId, reloadCandidates, confirmLoseDraftFor]);
  const renderMenu = useCallback((t: FlowRow): ReactNode => (
    <FlowRowMenu task={t} today={data?.today ?? ''} on={menuActions} />
  ), [menuActions, data?.today]);

  // 오른쪽 패널의 [만들기]/[만들고 하나 더] — 새 작업은 만들기 전까지 로컬 상태로 들고 있다가 한 번에 보낸다
  // (결정 3, b-task-7-brief.md). more가 아니면 방금 만든 작업으로 패널을 전환한다(openPanel). 이 시점의
  // draftWriteDirty는 항상 false다 — 패널이 'new' 모드인 동안은 DraftWrite·DraftGenerate 둘 다 마운트되지
  // 않아(DraftMode가 원고 모드일 때만 그린다) 그 dirty를 세울 주체가 없다. openPanel의 확인은 그래도
  // 통과하므로(값이 false라 물을 게 없다) 여기서 따로 처리하지 않는다.
  // 409(Task 5 §3) — draftId를 함께 보냈는데 그 사이 다른 작업이 그 원고를 가져갔다(route.ts:37·56 —
  // 이 라우트에서 409는 이 경우뿐이다). 서버 문구(DRAFT_ATTACHED_MESSAGE)를 토스트로 흘리지 않고
  // 'draft-taken'으로 돌려준다 — TaskPanel이 원고 칸 자리에서 사실대로 말한다. formDraft는 여기서 비운다
  // (주인이 이 컴포넌트라서) — TaskPanel은 다시 고를 수 있게 빈 칸을 보여준다. 가져간 원고는 후보(있는
  // 원고 고르기) 목록에서도 빠져야 한다 — onAttachFailed(아래 775줄 부근)의 같은 409 회복과 같은 이유로
  // 상세·후보를 다시 읽는다(최종 리뷰 §1, 안 그러면 화면에 남은 그 원고를 다시 골라 또 409를 받는다).
  const createTask = useCallback(async (body: TaskCreateRequest, more: boolean): Promise<'ok' | 'draft-taken' | 'error'> => {
    const r = await createTasksApi(id, body);
    if (!r.ok) {
      if (r.status === 409 && body.draftId) { setFormDraft(null); void load(); void reloadCandidates(); return 'draft-taken'; }
      show(r.error);
      return 'error';
    }
    await load(); onChanged();
    // draftId를 실어 성공했으면 그 원고는 이 작업에 붙었다 — 후보(작업 없는 원고) 목록에서 빠져야 한다
    // (detachDraft의 반대 방향, 위 538줄과 같은 이유).
    if (body.draftId) void reloadCandidates();
    // more(만들고 하나 더) — 폼을 비울 때 고른 원고도 비운다(스펙 §4-5, 유형은 TaskPanel이 유지한다).
    // more가 아니면 만든 작업으로 패널을 바꾼다 — isNew가 꺼지며 formDraft를 비우는 효과(위)가 대신 돈다.
    if (more) setFormDraft(null); else openPanel(r.data.tasks[0].id);
    return 'ok';
  }, [id, show, load, onChanged, openPanel, reloadCandidates]);

  // 원고 떼기(패널의 [떼기]) — 확인 없이(원고는 남는다고 토스트가 말한다), 작업의 원고 칸만 비운다(§5)
  const detachDraft = useCallback(async (t: CampaignTaskItem) => {
    if (!t.draftId) return;
    const r = await patchDraftApi(t.draftId, { taskId: null });
    if (!r.ok) { show(r.error); return; }
    await load();
    onChanged();   // 붙이기(onPick)도 부른다 — 한쪽만 부르면 왼쪽 목록의 '원고 없음' 수가 어긋난다
    void reloadCandidates();   // 뗀 원고가 다시 후보(작업 없는 원고)로 잡혀야 한다
    show('작업에서 뗐어요 — 작업도 원고도 남아 있어요');
  }, [show, load, onChanged, reloadCandidates]);

  // 한 번에 만들기(§4-1) — 유형마다 createTasksApi를 DISPLAY_TYPE_ORDER 순으로. 하나라도 실패하면 멈추고
  // 거기까지 만들어진 걸 문구로 알린다(조용히 일부만 만들지 않는다). [한 번에 만들기]는 패널이 무슨 모드든
  // (다른 작업의 직접 쓰기가 작성 중이어도) 열 수 있는 별도 다이얼로그다 — 아래 두 openPanel(firstId)가
  // 성공 뒤 그 작업으로 패널을 바꾸는데, 이때 draftWriteDirty가 여전히 true일 수 있다(Task 4c §1 셋째 문 —
  // "작업을 만든 뒤 패널을 여는 openPanel 호출들"). openPanel 안의 확인이 그 경우를 잡는다 — 만든 작업
  // 자체는 이미 서버에 남으니, 확인에서 취소해도 잃는 것은 없다(패널이 그 작업으로 안 바뀔 뿐).
  const bulkCreate = useCallback(async (counts: Record<TaskType, number>) => {
    let firstId: string | null = null;
    const made: string[] = [];
    for (const type of DISPLAY_TYPE_ORDER) {
      const n = counts[type];
      if (!n) continue;
      const r = await createTasksApi(id, { type, count: n, influencers: [] });
      if (!r.ok) {
        show(`${made.length ? made.join(' · ') + ' 만들었어요. ' : ''}${TASK_TYPE_LABEL[type]}에서 실패했어요 — ${r.error}`);
        await load(); onChanged();
        if (firstId) openPanel(firstId);
        return;
      }
      made.push(`${TASK_TYPE_LABEL[type]} ${r.data.tasks.length}개`);   // 요청 수가 아니라 실제로 만들어진 수
      if (!firstId) firstId = r.data.tasks[0].id;
    }
    await load(); onChanged();
    if (firstId) openPanel(firstId);
    show(`${made.join(' · ')} 만들었어요`);
  }, [id, show, load, onChanged, openPanel]);

  const bannedFor = useCallback((d: DraftRow) => (clientData
    ? [...clientData.client.bannedPhrases,
       ...clientData.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)]
    : []), [clientData]);

  const patchCampaign = useCallback(async (patch: CampaignPatchInput) => {
    const r = await patchCampaignApi(id, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => (cur ? { ...cur, campaign: r.data } : cur));
    onChanged();
    return true;
  }, [id, show, onChanged]);

  async function removeCampaign() {
    const r = await deleteCampaignApi(id);
    if (!r.ok) { show(r.error); return; }
    // deleted:false = 이미 없는 캠페인(다른 사람이 지웠거나 내 화면이 오래됐다) — 지웠다고 말하지 않되 화면은 똑같이 목록으로 빠진다
    show(r.data.deleted ? `캠페인을 삭제했어요 — 작업 ${r.data.taskCount}개도 지워졌고 원고는 남아 있어요` : '이미 삭제된 캠페인이에요');
    onDeleted();
  }

  // ── 원고 카드(패널의 원고 모드가 그린다) — 원고 자체의 편집은 기존 PATCH /api/drafts/[id] 그대로 ──
  // 응답(DraftRow)으로 카드를 갈아끼우고, 표의 '원고' 칸(상태·라벨)도 같이 맞춘다 — 카드에서 고친 제목이 표에 그대로 보여야 한다.
  function mergeRow(row: DraftRow) {
    setCardDraft((cur) => (cur?.id === row.id ? row : cur));
    // 폼(새 작업)에서 고른 원고의 카드도 같은 갱신 경로를 탄다(renderDraftCard(formDraft, null)) — 안
    // 맞추면 카드에서 다시 쓰기·상태·제목을 고쳐도 폼의 원고 칸·카드가 옛 값을 계속 보여준다.
    setFormDraft((cur) => (cur?.id === row.id ? row : cur));
    // draftFirstLine은 표의 원고 칸(R26)이 쓰는 값 — campaignTaskStore.firstLineOf와 같은 식(첫 포스트의
    // 첫 줄, 공백 정리, 비면 null)이어야 카드에서 고친 뒤와 새로고침 뒤가 같은 문구를 보여준다(Task 6, B 최종 리뷰 M1).
    // 식을 여기 다시 적지 않고 draftViews.draftPreviewLine을 쓴다 — 같은 규칙이 이미 테스트까지 있고(draftViews.test.ts),
    // 손으로 베낀 사본이 늘수록 서버와 어긋나도 아무도 모른다(Task 6 리뷰 Important 1).
    const firstLine = draftPreviewLine(row) || null;
    setTasks((cur) => cur.map((t) => (t.draftId === row.id
      ? { ...t, draftStatus: row.status, draftLabel: draftLabel(row).text, draftFirstLine: firstLine }
      : t)));
  }
  async function patchDraft(d: DraftRow, body: DraftPatchBody) {
    const r = await patchDraftApi(d.id, body);
    if (r.ok) mergeRow(r.data); else show(r.error);
    return r.ok;
  }

  async function rewrite(d: DraftRow, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setMediaDrop((cur) => (cur?.draftId === d.id ? null : cur));   // 지난 안내는 걷는다 — 이번 결과로 대체된다
    setRewritingId(d.id);
    const r = await rewriteDraftApi(d.id, baseIndex, feedback);
    setRewritingId(null);
    if (!r.ok) { show(r.error); return; }
    mergeRow(r.data);
    // 스레드가 짧아져 이미지가 빠졌으면 알린다(generate/page.tsx rewrite와 같은 계산 — 비교 기준은 '직전 최신')
    const i = r.data.history.length - 1;
    const prevLatest = r.data.history[i];
    const notice = prevLatest ? droppedMediaOnRewrite(prevLatest, r.data.edited ?? r.data.content, i) : null;
    if (notice) setMediaDrop({ draftId: d.id, notice });
  }
  async function regenPost(d: DraftRow, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await regenPostApi(d.id, index);
    setRegenBusy(null);
    if (r.ok) mergeRow(r.data); else show(r.error);
  }
  async function removeDraft(d: DraftRow) {
    // 원고를 지워도 작업은 남는다(작업이 캠페인의 단위다) — 확인 문구가 그렇게 말한다. 폼(새 작업)에서
    // 고른 원고는 아직 어디에도 붙지 않았으므로 "작업은 남고"가 거짓이다 — d.taskId 유무로 갈린다
    // (붙은 원고면 taskId가 있다, 폼에서 고르기만 한 원고는 null).
    const msg = d.taskId
      ? `'${draftLabel(d).text}' 원고를 삭제할까요?\n\n작업은 남고 원고만 떨어져요.`
      : `'${draftLabel(d).text}' 원고를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    const r = await deleteDraftApi(d.id);
    if (!r.ok) { show(r.error); return; }
    // 지운 원고가 캐시에 남아 다음 카드에 잘못 뜨지 않게 비운다(오버레이가 있던 시절의 closePeek과 같은 목적)
    setCardDraft(null); setCardErr(null);
    setFormDraft((cur) => (cur?.id === d.id ? null : cur));
    // draftFirstLine도 같이 비운다 — 남겨두면 draftId는 null이라 칸은 '미정'으로 보이지만, 검색(matchesSearch)은
    // draftId와 무관하게 draftFirstLine을 그대로 훑어 지워진 원고의 옛 첫 줄로 걸릴 수 있다.
    setTasks((cur) => cur.map((t) => (t.draftId === d.id ? { ...t, draftId: null, draftStatus: null, draftLabel: null, draftFirstLine: null } : t)));
    show(d.taskId ? '원고를 삭제했어요 — 작업은 남아 있어요' : '원고를 삭제했어요');
    onChanged();
    // 지운 원고가 어느 배치(batch)에 속했으면, 그 배치의 다른 원고들은 '형제 시안'이었다가 이 원고가
    // 없어지며 groupings(siblings/others)가 달라질 수 있다 — 후보를 다시 읽는다.
    void reloadCandidates();
  }

  // 원고 카드 배선 — 패널(원고 모드)이 이 하나를 쓴다(다시 쓰기·상태·이미지·금지 표현 등 전부 여기 하나,
  // C 원고 모드 §Step3). forTask는 배정이 실제로 저장되는 작업(카드의 인플루언서 표시·배정 변경이 이 값을
  // 쓴다) — 없으면 배정을 바꿀 수 없다고 말한다. 작업 칸(DraftTaskField, 다른 캠페인으로도 옮길 수 있는
  // 피커)은 그리지 않는다 — 작업 정보는 패널 본체가 이미 보여 준다.
  function renderDraftCard(d: DraftRow, forTask: CampaignTaskItem | null): ReactNode {
    return (
      // 배정은 작업이 쥔다 — 카드에는 그 작업의 인플을 얹어 넘긴다(원고에 남아 있는 옛 값이 아니라 화면과 같은 값 하나)
      <DraftCard draft={{ ...d, influencerHandle: forTask?.influencerHandle ?? d.influencerHandle }} banned={bannedFor(d)}
                 onEdit={() => setEditing(d)}
                 onRewrite={(feedback, baseIndex) => void rewrite(d, feedback, baseIndex)}
                 rewriteBusy={rewritingId === d.id}
                 onDelete={() => void removeDraft(d)}
                 onRegenPost={(i) => void regenPost(d, i)}
                 regenBusyIndex={regenBusy?.draftId === d.id ? regenBusy.index : null}
                 onDismissFlag={(key, dismiss) => void patchDraft(d, {
                   dismissedFlags: dismiss ? [...new Set([...d.dismissedFlags, key])] : d.dismissedFlags.filter((k) => k !== key),
                 })}
                 onRestoreAllFlags={() => void patchDraft(d, { dismissedFlags: [] })}
                 onChangeStatus={(s) => { void patchDraft(d, { status: s }).then((ok) => {
                   // 미사용 ↔ 그 외는 요약 N·인플 작업 수·합계의 모집단이 바뀐다 — 목록 보조줄도 따라가야 한다
                   if (ok && (s === 'unused' || d.status === 'unused')) onChanged();
                 }); }}
                 onChangeTitle={(next) => void patchDraft(d, { title: next ?? '' })}
                 siblingTotal={null}
                 influencerOptions={influencerOptions}
                 // 배정은 작업의 값이다(§2-5) — 카드에서 바꿔도 저장되는 곳은 이 원고가 붙은 작업이고,
                 // 카드 표시만 같은 값으로 맞춰 둔다(작업이 없으면 배정할 곳도 없다).
                 // 이미 인플이 있는 작업에서 (대소문자 무시하고) '다른' 핸들을 고르면 배정 API를 부르지
                 // 않고 교체 다이얼로그로 보낸다(koo QA 지적) — 교체에는 비용 이월·이전 증빙 정리·사유
                 // 기록이 붙는데 배정 API엔 없다. 방문협찬이 방문일을 지나 게시 전이면 행 메뉴·패널의
                 // [바꾸기]와 같은 이유(replaceDisabledReason)로 교체 자체가 막혀 있다 — 여기서도 먼저
                 // 판정해 다이얼로그가 열렸다가 제출에서야 실패하지 않게 한다(같은 판정 함수 하나, §AGENTS 4).
                 // 최초 배정(미배정→핸들)·해제(→null)·표기만 바뀐 같은 사람(대소문자 변경)은 지금 그대로
                 // 배정 API를 부른다 — 서버가 셋 다 허용한다. 완전히 같은 표기를 다시 고르는 것은 칩
                 // 자체가 걸러 이 콜백까지 오지 않는다(InfluencerChip.save).
                 onAssignInfluencer={(next) => {
                   if (!forTask) {
                     // 폼(새 작업)에서 고른 원고는 아직 붙은 작업이 없다 — "작업을 찾지 못했어요"는 거짓이다
                     // (찾을 작업 자체가 없다). 아직 아무 데도 안 붙은 원고이므로 원고 자체의 배정을 직접
                     // 바꾼다(/generate가 미부착 원고에 쓰는 것과 같은 패턴, patchDraft가 mergeRow로 카드·
                     // 폼(formDraft)을 함께 갱신한다). 폼의 인플루언서 칸(잠긴 칩)이 새 값을 보이도록 같은
                     // 신호(formHandleFill)로 채운다 — 해제(next=null)도 함께 보낸다(안 하면 카드는
                     // '미배정'인데 잠긴 칩은 옛 사람을 계속 말하는 어긋남이 생긴다).
                     void patchDraft(d, { influencerHandle: next }).then((ok) => {
                       if (ok) bumpFormHandleFill(next);
                     });
                     return;
                   }
                   const current = forTask.influencerHandle;
                   if (current && next && current.toLowerCase() !== next.toLowerCase()) {
                     // 게시 뒤에는 교체가 없다 — replaceDisabledReason은 미배정·방문일 지남만 보고 게시는
                     // 보지 않는다(다른 호출부들은 한 층 위에서 prePost로 걸러 이 함수까지 오지 않는다).
                     // 여기서 안 막으면 게시된 작업에서 교체 창이 열렸다가, 비용·사유·메모를 다 쓴 뒤
                     // 제출에서 서버가 거절한다 — 이 분기가 막으려던 바로 그 모양이다(최종 리뷰).
                     if (forTask.postedAt) { show(POSTED_TASK_MESSAGE); return; }
                     const reason = data ? replaceDisabledReason(forTask, data.today) : null;
                     if (reason) { show(reason); return; }
                     setReplaceInitialHandle(next); setReplaceFor(forTask); return;
                   }
                   setCardDraft((cur) => (cur?.id === d.id ? { ...cur, influencerHandle: next } : cur));
                   void actions.assignInfluencer(forTask, next, { autoCost: false });   // 비용은 패널의 [확인]이 확정한다(R24)
                 }}
                 onSaveMedia={(next) => void patchDraft(d, { edited: next })}
                 mediaDropNotice={mediaDrop?.draftId === d.id ? mediaDrop.notice : null}
                 onDismissMediaDrop={() => setMediaDrop(null)} />
    );
  }
  // 패널의 원고 모드가 그릴 카드 — 붙은 원고가 있으면(panelDraftId) 로딩·에러도 이 자리가 보여준다.
  // 폼(새 작업)에서 고른 원고는 붙은 작업이 아직 없으므로 로딩·에러가 없다 — formDraft가 이미 값 그 자체다
  // (renderDraftCard(formDraft, null) — Task 3의 '[열기]'가 이 카드를 연다, 스펙 §4-1).
  const draftCard: ReactNode = panelDraftId
    ? (panelDraft
        ? renderDraftCard(panelDraft, panelTask)
        : (
          <div className="rounded-2xl border border-x-border-strong bg-white px-4 py-6 text-content text-x-secondary" role={cardErr === panelDraftId ? 'alert' : undefined}>
            {cardErr === panelDraftId ? '원고를 불러오지 못했어요 — 새로고침해 주세요' : '원고를 불러오는 중…'}
          </div>
        ))
    : (isNew && formDraft ? renderDraftCard(formDraft, null) : null);
  // 화면은 중복 계산용 ID만 사용하고, 서버는 저장된 작업의 대상을 다시 읽는다.
  const quoteTarget = useMemo(() => {
    if (!panelTask || panelTask.type !== 'quoteRt' || !data) return null;
    const url = targetUrlOf({ targetTaskId: panelTask.targetTaskId, targetPostUrl: panelTask.target?.postUrl ?? null, targetTweetUrl: panelTask.targetTweetUrl });
    const parsed = url ? parseTweetLink(url) : null;
    return {
      request: { quoteTargetTaskId: panelTask.id },
      label: targetLabel(panelTask, data.campaign.id).text,
      tweetId: parsed?.ok ? parsed.tweetId : null,
    };
  }, [panelTask, data]);
  // 새 작업은 아직 ID가 없다. 링크 또는 대상 작업 ID만 보내고 본문은 서버에서 읽는다.
  const formQuoteTarget = useMemo(() => {
    if (formCtx.type !== 'quoteRt' || !formCtx.target) return null;
    const target = formCtx.target;
    const url = 'url' in target ? target.url : target.postUrl;
    const parsed = url ? parseTweetLink(url) : null;
    return {
      unknownLink: !('url' in target) && target.postUrl === undefined,
      request: { quoteTargetInput: 'url' in target ? { url: target.url } : { taskId: target.taskId } },
      label: 'url' in target ? target.url.replace(/^https?:\/\//, '') : target.label,
      tweetId: parsed?.ok ? parsed.tweetId : null,
    };
  }, [formCtx.type, formCtx.target]);
  // 시안 붙이기(Task 3) — 패널은 task.draftId가 채워지는 순간 스스로 카드로 전환한다(panelDraftId 이펙트).
  // 그러려면 상세를 다시 읽어야 한다(원고 카드 배선 주석과 같은 이유) — cardDraft는 미리 채워 둬 그 이펙트가
  // 같은 원고를 다시 조회하지 않게 한다(패치 응답이 이미 최신이다). 재조회 성공 여부를 돌려준다(리뷰 지적 3)
  // — 실패하면 DraftGenerate가 그걸로 attaching 잠금을 대신 풀고 새로고침을 안내한다(이 재조회가 유일한
  // 잠금 해제 경로라, 실패를 모르면 붙이기 버튼이 영영 '붙이는 중…'에 멈춘다).
  const onDraftAttached = useCallback(async (d: DraftRow): Promise<boolean> => {
    setCardDraft(d); setCardErr(null);
    const ok = await load();
    onChanged(); void reloadCandidates();
    return ok;
  }, [load, onChanged, reloadCandidates]);
  // 붙이기 실패 뒤 복구(최종 리뷰 §2) — 세 탭(AI로 만들기·직접 쓰기·있는 원고 고르기)이 모두 같은 PATCH
  // (patchDraftApi({ taskId }))를 쏘는데, 회복 규칙은 '있는 원고 고르기'(아래 attachExistingDraft)에만
  // 있었다. 409(이미 다른 원고가 붙었거나 작업이 취소된 뒤 — 다른 세션이 먼저 손댄 것)면 상세·후보를
  // 다시 읽어 낡은 화면을 되돌린다 — 안 그러면 같은 오류로 계속 재시도하게 된다. 세 자리가 각자 재조회
  // 코드를 베끼지 않고 여기 하나만 부르게 모은다(붙이기 성공 처리가 onDraftAttached 하나에 모인 것과 같은 결).
  const onAttachFailed = useCallback((status: number) => {
    if (status === 409) { void load(); void reloadCandidates(); }
  }, [load, reloadCandidates]);
  // 폼(새 작업 — 아직 안 만든 작업)의 원고 모드 호스트(Task 4 §Step2, 스펙 §4-2) — 알맹이는 작업 모드와
  // 같은 컴포넌트다, 호스트만 다르다. formCtx는 TaskPanel이 onNewContextChange로 올린 값(폼 입력의 사본).
  const formHost: DraftHost = { kind: 'form', influencerHandle: formCtx.handle };
  // 고른 뒤 갈 곳은 카드가 아니라 폼이다(스펙 §4-2 표 — "부착 없이 폼으로"·"폼으로"·"고르면 폼으로").
  // draftOpenReq에 tab:null을 보낸다 — TaskPanel의 draftOpen 이펙트가 확인 없이 setDraftMode('task')로
  // 돌려보내는, 이미 있는 채널(같은 행 재클릭이 쓰는 것과 같다, 위 openPanel 주석). 그 결과 DraftGenerate·
  // DraftWrite·DraftPick은 그 자리에서 언마운트되고(DraftMode가 더는 그리지 않는다) 정리 이펙트
  // (onDirtyChange(false)·onBusyChange(null))가 자연히 돈다 — 방향성 입력이 남아 이탈 확인이 계속 뜨는
  // 문제(Task 2·3 이월 항목)가 여기서 함께 해소된다. 나중에 원고 칸의 [열기]를 누르면 attached=true라
  // DraftMode가 곧장 카드를 보여준다(작업 호스트와 같은 재진입 규칙).
  const onFormChosen = useCallback((d: DraftRow) => {
    setFormDraft(d);
    draftOpenSeqRef.current += 1;
    setDraftOpenReq({ tab: null, seq: draftOpenSeqRef.current });
  }, []);
  // 패널의 원고 모드 · 'AI로 만들기' 탭 — clientData는 clientId가 있어도 아직 못 읽었으면 undefined(로딩
  // 중)거나 null(실패)이다(DraftGenerate가 그 둘과 성공을 구분해 읽는다 — clientId를 함께 받는 이유,
  // 리뷰 지적 4). clientName은 따로 넘기지 않는다 — clientData에서 파생되는 값이라 두 prop으로 같은
  // 사실을 넘기지 않는다(리뷰 지적 5).
  const draftGenerate: ReactNode = panelTask
    ? (
      <DraftGenerate host={{ kind: 'task', taskId: panelTask.id, draftId: panelTask.draftId, influencerHandle: panelTask.influencerHandle }}
                     clientId={clientId}
                     clientData={clientData} quoteTarget={quoteTarget}
                     onAttached={onDraftAttached} onAttachFailed={onAttachFailed} onGenerated={() => void reloadCandidates()}
                     onBusyChange={setDraftGenBusy} onOverlayChange={setDraftOverlayOpen}
                     onDirtyChange={setDraftGenDirty} />
    )
    : isNew
    ? (
      // onAttached·onAttachFailed는 필수 prop이지만 host.kind==='form'에서는 부르지 않는다(Task 2 계약) —
      // 작업 호스트와 같은 함수를 그대로 넘겨 두 번째 사본을 만들지 않는다(닿지 않는 코드라 무해하다).
      <DraftGenerate host={formHost}
                     clientId={clientId}
                     clientData={clientData} quoteTarget={formQuoteTarget}
                     onAttached={onDraftAttached} onAttachFailed={onAttachFailed} onGenerated={() => void reloadCandidates()}
                     onBusyChange={setDraftGenBusy} onOverlayChange={setDraftOverlayOpen}
                     onDirtyChange={setDraftGenDirty} onChosen={onFormChosen} />
    )
    : null;
  // 패널의 원고 모드 · '직접 쓰기' 탭(Task 4) — 붙이기 성공 뒤 동작은 'AI로 만들기'와 같은 재조회
  // (onDraftAttached, 위 주석 참고)를 그대로 재사용한다. 저장은 됐는데 붙이기만 실패했을 때는(원고가
  // 이미 저장돼 있다) 후보만 다시 읽는다 — onGenerated와 같은 함수(reloadCandidates)를 부른다.
  const draftWrite: ReactNode = panelTask
    ? (
      <DraftWrite host={{ kind: 'task', taskId: panelTask.id, draftId: panelTask.draftId, influencerHandle: panelTask.influencerHandle }}
                  clientId={clientId}
                  onAttached={onDraftAttached} onAttachFailed={onAttachFailed} onSavedUnattached={() => void reloadCandidates()}
                  onBusyChange={setDraftWriteBusy} onDirtyChange={setDraftWriteOnlyDirty} />
    )
    : isNew
    ? (
      // 폼 갈래는 저장까지만 하고 부착 PATCH는 건너뛴다(Task 2 계약) — onSavedUnattached는 그 PATCH가
      // 실패했을 때만 쓰는 신호라 폼에서는 안 불린다. 대신 onChosen이 '이미 저장된 원고'를 알리는 유일한
      // 신호라, 여기서 reloadCandidates까지 겸한다(안 그러면 저장한 원고가 '있는 원고 고르기'에 안 뜬다).
      <DraftWrite host={formHost}
                  clientId={clientId}
                  onAttached={onDraftAttached} onAttachFailed={onAttachFailed} onSavedUnattached={() => void reloadCandidates()}
                  onBusyChange={setDraftWriteBusy} onDirtyChange={setDraftWriteOnlyDirty}
                  onChosen={(d) => { onFormChosen(d); void reloadCandidates(); }} />
    )
    : null;
  // 패널의 원고 모드 · '있는 원고 고르기' 탭(Task 5) — 이미 만들어진 원고를 이 작업에 붙인다. 붙이기 자체는
  // 기존 patchDraftApi({ taskId })로 하고, 성공하면 'AI로 만들기'·'직접 쓰기'와 같은 재조회
  // (onDraftAttached, 위 주석 참고)를 그대로 재사용한다 — 세 번째 붙이기 경로를 새로 만들지 않는다.
  // panelTask가 없으면(패널이 새 작업 모드 등) 부를 일이 없다 — 그 경우 draftPick 자체가 null이라 이
  // 함수는 호출되지 않는다. draftPickBusy에 붙이는 원고의 id를 담는다(DraftGenerate.attach와 같은 값
  // 모양) — DraftPick이 그 id로 눌린 행만 "붙이는 중…"으로 보여주고 나머지도 함께 잠근다(원칙 1·2, 옆에
  // 진짜 이유를 둔다). 재진입 방지도 겸한다(진행 중이면 다른 행을 눌러도 중복 PATCH가 안 나간다).
  //
  // busy를 푸는 자리는 여기 하나뿐이다(리뷰 지적 1, Critical — 예전엔 실패 두 갈래에서만 풀어 성공하면
  // 패널이 영영 잠겼다). DraftGenerate·DraftWrite는 busy를 자식이 들고 언마운트 정리
  // (useEffect(() => () => onBusyChange(false), …))로 풀지만, DraftPick은 busy를 안 들고 onBusyChange도
  // 없다 — 붙이기 성공으로 카드로 바뀌며 이 탭이 언마운트돼도 부모의 draftPickBusy는 아무도 정리하지
  // 않는다. 그래서 onDraftAttached가 끝나면(성공이든 실패든) 여기서 곧장 푼다 — 그 시점엔 성공이면
  // load()가 이미 draftId를 채워 화면이 카드로 가 있어 깜빡일 일이 없다. 아래 panelTaskId·panelDraftId
  // 이펙트가 두 번째 안전망이다 — 패널이 보는 작업 자체가 바뀌면 이 값은 더 이상 뜻이 없으므로 어떤
  // 경로로도 굳지 않게 거기서도 리셋한다(둘 다 넣는다 — 하나는 정상 경로, 하나는 안전망).
  const attachExistingDraft = useCallback(async (d: DraftRow) => {
    if (!panelTask || draftPickBusy) return;
    setDraftPickBusy(d.id);
    const r = await patchDraftApi(d.id, { taskId: panelTask.id });
    if (!r.ok) {
      setDraftPickBusy(null);
      show(r.error);
      // 409(이미 원고가 있음·취소된 작업 등) 복구는 onAttachFailed 하나로 모은다(위 정의, 최종 리뷰 §2)
      // — 서버 문구는 그대로 보여 주고, 화면 되돌리기는 세 탭이 공유하는 그 함수가 한다.
      onAttachFailed(r.status);
      return;
    }
    const ok = await onDraftAttached(r.data);
    setDraftPickBusy(null);
    if (!ok) show('붙였어요 — 화면을 새로고침해 주세요');
  }, [panelTask, draftPickBusy, show, onDraftAttached, onAttachFailed]);
  // 안전망(위 attachExistingDraft 주석) — 패널이 보는 작업이 바뀌면(다른 작업을 열었거나, 이 작업에
  // 원고가 붙어 카드로 전환됐거나) draftPickBusy는 더 이상 뜻이 없다. 정상 경로가 이미 풀지만, 앞으로
  // 어느 경로가 그 정상 경로를 안 타더라도 여기서 다시 풀어 패널이 굳지 않게 한다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널이 보는 작업이 바뀔 때의 안전망 리셋이 목적(정상 경로가 이미 풀지만, 어떤 경로로도 굳지 않게 하는 두 번째 장치)
    setDraftPickBusy(null);
  }, [panelTaskId, panelDraftId]);
  // 폼(새 작업)의 '있는 원고 고르기' — 붙이지 않고 고른 사실만 올린다(스펙 §4-2 "고르면 폼으로"). 주인
  // 불일치(스펙 §4-3 "고르는 순간의 주인 불일치")를 pickedHandleNotice로 먼저 본다 — fill이 있으면
  // TaskPanel의 핸들 칸을 채우라는 신호(formHandleFill)를 보내고, notice가 있으면 토스트로 알린 뒤(막지
  // 않는다) onFormChosen으로 진행한다.
  const pickForForm = useCallback((d: DraftRow) => {
    const { fill, notice } = pickedHandleNotice(formCtx.handle, d.influencerHandle);
    if (notice) show(notice);
    if (fill) bumpFormHandleFill(fill);
    onFormChosen(d);
  }, [formCtx.handle, show, bumpFormHandleFill, onFormChosen]);
  const draftPick: ReactNode = panelTask
    ? <DraftPick host={{ kind: 'task', taskId: panelTask.id, draftId: panelTask.draftId, influencerHandle: panelTask.influencerHandle }}
                 candidates={candidates} onPick={(d) => void attachExistingDraft(d)} picking={draftPickBusy}
                 onRetry={() => void reloadCandidates()} />
    : isNew
    ? <DraftPick host={formHost} candidates={candidates} onPick={pickForForm} picking={draftPickBusy}
                 onRetry={() => void reloadCandidates()} />
    : null;
  // '있는 원고 고르기 n' — Task 1의 후보 조회 합. 아직 못 읽었거나(undefined) 실패했으면(null) 개수를
  // 모르므로 null(0이라고 거짓말하지 않는다, 결정 4) — 리뷰가 승인한 필터된 개수 계산은 그대로 둔다.
  const pickCount = candidates ? candidates.siblings.length + candidates.others.length : null;

  if (!loaded) return <p className="px-6 py-6 text-content text-x-muted">불러오는 중…</p>;
  if (loadErr && !data) {
    return (
      <div className="px-6 py-6">
        <p className="mb-2 text-content text-x-secondary" role="alert">캠페인을 불러오지 못했어요</p>
        <Button onClick={() => void load()}>다시 시도</Button>
      </div>
    );
  }
  if (!data || !stats) return null;

  return (
    <div className="min-w-0 space-y-5 p-5 pb-24">
      {loadErr && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      <div className={PANEL}>
        <CampaignHeader campaign={data.campaign} deleteInfo={data.deleteInfo} today={data.today} onPatch={patchCampaign}
                        onDelete={() => void removeCampaign()} />
      </div>
      <div className={PANEL}>
        <FlowCards stats={stats} plannedTotal={plannedTotal} budget={data.budget} clientId={data.campaign.clientId}
                   cancelledCount={cancelledCount} refreshing={refreshing} onRefresh={() => void onRefresh()} />
      </div>
      <div className={PANEL}>
        {/* [+ 작업 추가]는 오른쪽 패널을 새 작업 모드로 연다(Task 7). [한 번에 만들기]는 아직 뒤에 창이 없다(Task 7). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={openNew} className="h-9 px-3.5 text-ui">+ 작업 추가</Button>
          <Button variant="subtle" onClick={openBulk} className="h-9 px-3.5 text-ui">한 번에 만들기</Button>
        </div>
        <div className="mt-3.5">
          <FlowFilterBar filter={filter} onChange={setFilter} counts={counts} summary={summary}
                         sortNote={sortNote} settleWait={settleWait} campaignId={id} />
        </div>
        {/* 패널이 열려 있는 동안 표를 흐리게 — 스크림은 두지 않는다(다른 행을 눌러도 패널이 그 작업으로 바뀌어야 한다, 결정 3) */}
        <div className={panelOpen ? 'mt-3.5 opacity-60 transition-opacity' : 'mt-3.5'}>
          <FlowTable rows={shown} total={data.tasks.length} today={data.today} influencerOptions={influencerOptions}
                     sort={sort} onSortChange={setSort} footer={footer}
                     selectedId={panelTaskId} onRowClick={onRowClick} renderMenu={renderMenu} />
        </div>
      </div>

      {/* key: 다른 작업으로(이전/다음) 또는 새 작업으로 넘어가면 패널의 로컬 입력 버퍼(인플 입력칸·메모 등)를
          통째로 새로 시작한다 — 안 그러면 직전 작업에서 치던 값이 다음 작업 화면에 잠깐 남는다. */}
      {panelOpen && (
        <TaskPanel key={isNew ? 'new' : (panelTaskId ?? 'none')}
                   mode={isNew ? { kind: 'new' } : { kind: 'edit', task: panelTask as FlowRow, index: panelIndex, total: shown.length }}
                   campaign={data.campaign} today={data.today} influencerOptions={influencerOptions} actions={actions}
                   onClose={() => setPanel(null)} onPrev={onPanelPrev} onNext={onPanelNext} onCreate={createTask}
                   menu={panelTask ? renderMenu(panelTask) : null}
                   draftOpen={draftOpenReq} pickCount={pickCount} draftCard={draftCard}
                   draftGenerate={draftGenerate} draftWrite={draftWrite} draftPick={draftPick} draftBusy={draftBusy} closeConfirm={closeConfirm} moveConfirm={moveConfirm}
                   onDetachDraft={(t) => void detachDraft(t)}
                   onReplace={(t) => { setReplaceInitialHandle(null); setReplaceFor(t); }}
                   onSaveProfilePricing={saveProfilePricing}
                   newDraft={formDraft} onNewDraftChange={setFormDraft}
                   onNewContextChange={setFormCtx} formHandleFill={formHandleFill}
                   // edit 모드만 여기서 채운다 — new 모드의 비용 칸은 TaskPanel이 로컬 상태로 직접 그린다(위 주석).
                   slots={{
                     // key=influencerHandle — 인플루언서가 바뀌면(미정 → 배정 포함) 새 프로필 단가로 다시
                     // 초기화한다(마운트 시 한 번만 채우는 필드라 안 그러면 방금 배정한 인플의 단가 제안이 안 보인다).
                     cost: panelTask
                       ? <CostConfirmField key={panelTask.influencerHandle ?? ''} value={panelTask.cost} option={optionFor(panelTask.influencerHandle)} type={panelTask.type}
                                          label={panelTask.type === 'visit' ? '예산' : '비용'}
                                          onSave={(c) => actions.changeCost(panelTask, c)}
                                          onSaveProfile={(opt, c) => saveProfilePricing(opt, c, panelTask.type)}
                                          disabledReason={panelTask.influencerHandle ? undefined : '인플을 정하면 프로필 단가로 채워요'} />
                       : null,
                     // 대상은 링크 하나로 통일한다(Task 9) — actions.changeTarget이 taskId/url/null 셋을 받는다.
                     target: panelTask
                       ? <TargetLinkField task={panelTask} campaign={data.campaign} onChange={(next) => void actions.changeTarget(panelTask, next)} />
                       : null,
                     // 게시 확인(Task 9) — 취소된 작업엔 아무것도 주지 않는다(패널이 칸 자체를 그리지 않는다).
                     // 게시 전이면 다이얼로그를 여는 버튼, 게시됐으면 값(+RT 증빙 라이트박스)을 보여준다.
                     posted: panelTask && !panelTask.cancelledAt
                       ? (panelTask.postedAt
                           ? (
                             <div>
                               <p className="text-content">
                                 게시 {formatDateKo(panelTask.postedAt)}
                                 {panelTask.postUrl && (
                                   <> · <a href={panelTask.postUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">게시물 보기 ↗</a></>
                                 )}
                               </p>
                               {panelTask.type === 'rt' && (
                                 panelTask.proof
                                   ? (() => {
                                       const url = proofUrls[panelTask.proof!.url];
                                       return (
                                         <button type="button" disabled={!url} onClick={() => url && setZoomUrl(url)}
                                                 title={url ? '증빙 스크린샷 — 눌러서 크게 보기' : '증빙 스크린샷 불러오는 중…'}
                                                 className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-slate-200 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-slate-100">
                                           증빙 보기
                                         </button>
                                       );
                                     })()
                                   : <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-700">증빙 없음</span>
                               )}
                               {/* 게시 내림(koo 09-19 결정 3) — 기존 화면(PostedCell)에 있던 표시·되돌리기가
                                   v2에도 있어야 한다. v2만 쓰는 사람이 적을 데가 없으면 정산 판단에 쓰이는
                                   정보가 사라진다. 되돌리기는 확인 없이 즉시(되돌리는 동작이라 R18과 같은 결). */}
                               {panelTask.removedAt ? (
                                 <div className="mt-2">
                                   <p className="text-content">
                                     내림 {formatDateKo(panelTask.removedAt)}
                                     {panelTask.removedReason && ` · ${panelTask.removedReason}`}
                                   </p>
                                   <button type="button" onClick={() => void actions.unmarkRemoved(panelTask)}
                                           className="mt-1 text-ui text-x-secondary hover:underline">내림 취소</button>
                                 </div>
                               ) : (
                                 <button type="button" onClick={() => setRemovedOpen(true)}
                                         className="mt-2 block text-ui text-x-secondary hover:underline">내림 표시</button>
                               )}
                             </div>
                           )
                           : (panelTask.influencerHandle === null
                             // C1-a — 미배정 작업이 여기서 게시 확인되면 인플 배정·교체·취소·정산이 전부
                             // 막혀 삭제 말고는 복구 길이 없다(b-final-fix-brief.md C1). 행 메뉴(FlowRowMenu)의
                             // prePost 게이트와 같은 조건 — 그쪽만 막으면 패널에서 여전히 뚫린다.
                             ? (
                               <div>
                                 <Button variant="subtle" disabled title="인플루언서를 먼저 정해요" className="h-9 px-3.5 text-ui">게시 확인</Button>
                                 <p className="mt-1 text-caption text-x-muted">인플루언서를 먼저 정해요</p>
                               </div>
                             )
                             : <Button variant="subtle" onClick={() => setPostedFor(panelTask)} className="h-9 px-3.5 text-ui">게시 확인</Button>))
                       : null,
                   }}
                   // 패널 위에 뜬 다른 레이어(편집 모달·한 번에 만들기·게시 확인·게시물 연결·취소·교체·
                   // 원고 모드의 레퍼런스 고르기·링크 추가)가 있으면 패널의 Esc를 끈다 — 안 그러면 그 레이어를
                   // 닫는 Esc 한 번에 패널까지 같이 닫힌다(리뷰 지적 1, Critical).
                   overlayOpen={!!editing || bulkOpen || !!postedFor || removedOpen || !!linkFor || !!cancelFor || !!replaceFor || draftOverlayOpen}
                   onDirtyChange={onNewDirtyChange} />
      )}
      {bulkOpen && <BulkCreateDialog onClose={() => setBulkOpen(false)} onCreate={bulkCreate} />}
      {postedFor && (
        <PostedDialog task={postedFor} today={data.today}
                      onClose={() => setPostedFor(null)}
                      onSubmit={(date, url, proof) => void actions.markPosted(postedFor, date, url, proof)} />
      )}
      {removedOpen && panelTask && (
        <RemovedDialog task={panelTask} today={data.today} proofSignedUrl={panelTask.proof ? proofUrls[panelTask.proof.url] ?? null : null}
                       onClose={() => setRemovedOpen(false)}
                       onSetProof={(p) => void actions.setProof(panelTask, p)}
                       onSubmit={(date, reason) => void actions.markRemoved(panelTask, date, reason)} />
      )}
      {zoomUrl && <ImageLightbox urls={[zoomUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoomUrl(null)} />}
      {linkFor && (
        <LinkPostModal task={linkFor} onClose={() => setLinkFor(null)}
                       onLinked={() => {
                         setLinkFor(null);
                         show(linkFor?.postedAt ? '게시물을 연결했어요 — 조회수가 잡혀요' : '게시물을 연결했어요 — 게시됨으로 표시되고 조회수가 잡혀요');
                         void load(); onChanged();
                       }} />
      )}
      {cancelFor && (
        <CancelDialog task={cancelFor} onClose={() => setCancelFor(null)}
                      onConfirm={async (body) => {
                        const ok = await flowActions.cancel(cancelFor, body);
                        // 취소는 붙어 있던 원고를 뗀다(서버, cancelTask) — 후보로 다시 잡혀야 '있는 원고 고르기 n'이 맞다.
                        if (ok && cancelFor.draftId) void reloadCandidates();
                      }} />
      )}
      {replaceFor && (
        <ReplaceDialog task={replaceFor} influencerOptions={influencerOptions} initialHandle={replaceInitialHandle ?? undefined}
                       onClose={() => { setReplaceFor(null); setReplaceInitialHandle(null); }}
                       onConfirm={async (body) => { await flowActions.replace(replaceFor, body); }} />
      )}
      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { mergeRow(u); setEditing(null); }}
                        onMediaSaved={mergeRow} />
      )}
    </div>
  );
}
