'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { CampaignRow, CampaignTaskItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { DraftRow } from '@/lib/draftStore';
import type { CampaignMonthBudget } from '@/lib/clientBudget';
import {
  fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, patchInfluencerPricingApi,
  patchDraftApi, deleteDraftApi, rewriteDraftApi, regenPostApi, createTasksApi, type DraftPatchBody, type TaskCreateRequest,
} from '@/lib/campaignApi';
import type { TaskCost } from '@/lib/campaignCost';
import { flowStage, FLOW_STAGES, draftWriteHref, TASK_TYPE_LABEL, type TaskType, type FlowStage } from '@/lib/campaignJudgment';
import { draftLabel } from '@/lib/draftViews';
import { Button, PANEL } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import {
  EMPTY_FLOW_FILTER, matchesFlowFilter, sortFlowRows, flowStats, settleWaitCount, flowFooter, filterSummary,
  FLOW_SORT_LABEL, DISPLAY_TYPE_ORDER, matchesExtra, EXTRA_FILTERS,
  type FlowRow, type FlowFilter, type FlowSort, type ExtraFilter,
} from '@/lib/campaignFlowView';
import { CampaignHeader } from '../CampaignHeader';
import { useCampaignTaskActions } from '../useCampaignTaskActions';
import { AttachDraftModal } from '../AttachDraftModal';
import { FlowFilterBar } from './FlowFilterBar';
import { FlowTable } from './FlowTable';
import { FlowCards } from './FlowCards';
import { TaskPanel } from './TaskPanel';
import { CostConfirmField } from './CostConfirmField';
import { BulkCreateDialog } from './BulkCreateDialog';
import { useFlowTaskActions } from './useFlowTaskActions';

// 캠페인 v2 상세 컨테이너 — /campaigns의 CampaignDetail과 같은 계약(로드·낙관적 갱신·원고 카드 모달)을 쥐지만,
// 표는 작업 표(TaskTable) 대신 단계 기반 표(FlowTable, Task 6)고 달력·인플루언서별 비용 표는 없다(R10 — 단일 표 화면).
// 필터·정렬·패널 열림은 campaignFlowView(Task 2)의 순수 함수로 판정한다 — 이 파일은 상태만 쥐고 계산은 그쪽에 맡긴다.
//
// 원고 카드(peek)·patchCampaign·removeCampaign·요청 토큰(reqRef)·influencerOptions/clientData 로드는
// CampaignDetail과 그대로다 — 코드와 함께 그 이유를 설명하는 주석도 옮겼다.

interface DetailState {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[];
  deleteInfo: { taskCount: number; detachedTargets: number; activeRequests: number }; today: string;
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버 판정) — 카드의 '월 예산 잔액'(Task 11)
}
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };
// 오른쪽 패널이 여는 대상 — 기존 작업(taskId) 또는 새 작업(fresh). 둘 다 아니면 패널이 닫혀 있다.
type Panel = { taskId: string } | { fresh: true } | null;

export function FlowDetail({ id, campaigns, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — 원고 카드의 작업 칸이 '어느 캠페인의 작업에 붙일지' 고를 때 쓴다
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·작업 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  // 원고 카드(peek) — 표에서 누른 원고 id와 그 원고 한 건. 작업 목록엔 본문이 없어 열 때 받아 온다.
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekDraft, setPeekDraft] = useState<DraftRow | null>(null);
  const [peekErr, setPeekErr] = useState(false);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [mediaDrop, setMediaDrop] = useState<{ draftId: string; notice: MediaDropNotice } | null>(null);

  // 이 화면만의 상태 — 필터·정렬·오른쪽 패널·"한 번에 만들기" 열림(§4-2, §4-3, koo 09-18)
  const [filter, setFilter] = useState<FlowFilter>(EMPTY_FLOW_FILTER);
  const [sort, setSort] = useState<FlowSort>({ key: null, dir: 1 });
  const [panel, setPanel] = useState<Panel>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // 있는 원고 고르기(패널의 [있는 원고 고르기]) — CampaignDetail의 attachFor와 같은 패턴, 같은 모달(AttachDraftModal)
  const [attachFor, setAttachFor] = useState<CampaignTaskItem | null>(null);

  // 요청 토큰 — 캠페인을 빠르게 갈아타면 앞 캠페인의 응답이 뒤에 도착할 수 있다. 그때 화면에는 이미 다른 캠페인이
  // 떠 있으므로 옛 응답은 성공이든 실패든 버린다(남의 캠페인 데이터·오류 배너가 붙는 것을 막는다).
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const token = ++reqRef.current;
    const r = await fetchCampaignDetail(id);
    if (token !== reqRef.current) return;   // 그 사이 다른 캠페인(또는 새 로드)이 시작됐다 — 이 응답은 화면의 것이 아니다
    if (r.ok) {
      const { campaign, tasks, costRows, deleteInfo, today, budget } = r.data;   // 카드·필터 집계는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, tasks, costRows, deleteInfo, today, budget });
      setLoadErr(false);
    } else {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
    setLoaded(true);
  }, [id]);
  // id가 바뀌면 이전 캠페인의 data를 먼저 지우고 로딩 상태로 돌아간다 — 안 지우면 새 캠페인을 불러오는 동안
  // 앞 캠페인의 헤더·표·합계가 새 id의 화면인 척 남아 있고, '최신이 아닐 수 있어요' 배너도 남의 데이터에 붙는다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- id 전환 시의 리셋이 목적이라 동기 setState가 맞다(그 뒤 로드는 비동기 콜백)
    setData(null); setLoaded(false); setLoadErr(false);
    setPanel(null);   // 다른 캠페인의 작업 id를 들고 있던 패널이 새 캠페인 화면에 남지 않게
    void load();
  }, [load]);

  // 배정 자동완성 후보(+단가) — 실패해도 빈 목록(자유 입력은 그대로 동작, generate 관례)
  useEffect(() => {
    apiFetch('/api/drafts/influencers').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((inf) => setInfluencerOptions(Array.isArray(inf) ? inf : []));
  }, []);
  // 금지 표현(DraftCard 검수 표식) — 이 캠페인의 클라이언트 하나만 필요하다. 클라가 없거나 실패하면 표식 없음.
  const clientId = data?.campaign.clientId ?? null;
  useEffect(() => {
    if (!clientId) return;
    apiFetch(`/api/clients/${clientId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((c) => setClientData(c as ClientData | null));
  }, [clientId]);

  // 카드를 열 때 원고 한 건을 받아 온다 — 같은 원고를 다시 열면 이미 있는 것을 쓴다(재요청 없음).
  useEffect(() => {
    if (!peekId || peekDraft?.id === peekId) return;
    let alive = true;
    apiFetch(`/api/drafts/${peekId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (!alive) return; setPeekDraft((d as DraftRow | null) ?? null); setPeekErr(d === null); });
    return () => { alive = false; };
  }, [peekId, peekDraft]);

  // 닫아도 받아 둔 원고는 버리지 않는다 — 같은 원고를 다시 열면 요청 없이 바로 보인다(peekId만 내린다)
  const closePeek = useCallback(() => { setPeekId(null); setPeekErr(false); }, []);
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
  const flowActions = useFlowTaskActions({ campaignId: id, show, reload: load, onChanged });
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
    const inf: unknown = await apiFetch('/api/drafts/influencers').then((res) => (res.ok ? res.json() : [])).catch(() => []);
    if (Array.isArray(inf)) setInfluencerOptions(inf as InfluencerOption[]);
    return true;
  }, [show]);

  // ── 이 화면의 파생값(§4-2·§4-3) — 필터·정렬·통계는 campaignFlowView의 순수 함수로 계산한다. 여기서 다시 판정하지 않는다. ──
  // shown = 필터·정렬을 적용한 표시 순서. 표가 그리는 순서이자 패널의 이전/다음이 걷는 순서다(하나의 소스).
  const shown = useMemo(() => (data ? sortFlowRows(data.tasks.filter((t) => matchesFlowFilter(t, filter, data.today)), sort) : []), [data, filter, sort]);
  const stats = useMemo(() => (data ? flowStats(data.tasks) : null), [data]);
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
  // 카드(Task 11)의 성과 업데이트 버튼 자리 — refreshCampaignPerfApi 연결은 그 작업의 몫(b-task-11-brief.md §2)
  const cancelledCount = 0;   // TODO(Task 11): data.tasks.filter(isTaskExcluded).length
  const [refreshing] = useState(false);   // TODO(Task 11): 실제 진행 상태로 교체
  const onRefresh = useCallback(() => { /* TODO(Task 11): refreshCampaignPerfApi(id) 연결 */ }, []);

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
  const openPanel = useCallback((taskId: string) => setPanel({ taskId }), []);
  const openNew = useCallback(() => setPanel({ fresh: true }), []);
  const openBulk = useCallback(() => setBulkOpen(true), []);
  const onRowClick = useCallback((t: FlowRow) => openPanel(t.id), [openPanel]);
  const onPanelPrev = useCallback(() => { if (panelIndex > 0) setPanel({ taskId: shown[panelIndex - 1].id }); }, [panelIndex, shown]);
  const onPanelNext = useCallback(() => { if (panelIndex >= 0 && panelIndex < shown.length - 1) setPanel({ taskId: shown[panelIndex + 1].id }); }, [panelIndex, shown]);
  // 행 "···" 메뉴 — 취소·되돌리기·교체·게시물 연결·삭제(Task 10까지는 아무것도 없다, b-task-6-brief.md §3).
  // flowActions(취소·되돌리기·교체)는 이미 준비돼 있다 — Task 10은 메뉴·확인 다이얼로그만 얹으면 된다.
  const renderMenu = useCallback((t: FlowRow): ReactNode => { void t; void flowActions; return null; }, [flowActions]);

  // 오른쪽 패널의 [만들기]/[만들고 하나 더] — 새 작업은 만들기 전까지 로컬 상태로 들고 있다가 한 번에 보낸다
  // (결정 3, b-task-7-brief.md). more가 아니면 방금 만든 작업으로 패널을 전환한다.
  const createTask = useCallback(async (body: TaskCreateRequest, more: boolean): Promise<boolean> => {
    const r = await createTasksApi(id, body);
    if (!r.ok) { show(r.error); return false; }
    await load(); onChanged();
    if (!more) setPanel({ taskId: r.data.tasks[0].id });
    return true;
  }, [id, show, load, onChanged]);

  // 원고 떼기(패널의 [떼기]) — 확인 없이(원고는 남는다고 토스트가 말한다), 작업의 원고 칸만 비운다(§5)
  const detachDraft = useCallback(async (t: CampaignTaskItem) => {
    if (!t.draftId) return;
    const r = await patchDraftApi(t.draftId, { taskId: null });
    if (!r.ok) { show(r.error); return; }
    await load();
    onChanged();   // 붙이기(onPick)도 부른다 — 한쪽만 부르면 왼쪽 목록의 '원고 없음' 수가 어긋난다
    show('작업에서 뗐어요 — 작업도 원고도 남아 있어요');
  }, [show, load, onChanged]);

  // 한 번에 만들기(§4-1) — 유형마다 createTasksApi를 DISPLAY_TYPE_ORDER 순으로. 하나라도 실패하면 멈추고
  // 거기까지 만들어진 걸 문구로 알린다(조용히 일부만 만들지 않는다).
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
        if (firstId) setPanel({ taskId: firstId });
        return;
      }
      made.push(`${TASK_TYPE_LABEL[type]} ${r.data.tasks.length}개`);   // 요청 수가 아니라 실제로 만들어진 수
      if (!firstId) firstId = r.data.tasks[0].id;
    }
    await load(); onChanged();
    if (firstId) setPanel({ taskId: firstId });
    show(`${made.join(' · ')} 만들었어요`);
  }, [id, show, load, onChanged]);

  // 열려 있는 원고가 붙은 작업 — 카드의 인플루언서 배정이 이 작업으로 간다(캠페인의 단위는 작업이다)
  const peekTask = useMemo(() => (peekId && data ? data.tasks.find((t) => t.draftId === peekId) ?? null : null), [peekId, data]);
  const peeked = peekDraft?.id === peekId ? peekDraft : null;
  const bannedFor = useCallback((d: DraftRow) => (clientData
    ? [...clientData.client.bannedPhrases,
       ...clientData.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)]
    : []), [clientData]);

  // Esc로 원고 카드 닫기 — 편집 모달이 위에 있으면 그쪽 Esc가 우선(generate 관례)
  useEffect(() => {
    if (!peekId || editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) closePeek(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing, closePeek]);

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

  // ── 원고 카드(표에서 원고를 누르면 열린다) — 원고 자체의 편집은 기존 PATCH /api/drafts/[id] 그대로 ──
  // 응답(DraftRow)으로 카드를 갈아끼우고, 표의 '원고' 칸(상태·라벨)도 같이 맞춘다 — 카드에서 고친 제목이 표에 그대로 보여야 한다.
  function mergeRow(row: DraftRow) {
    setPeekDraft((cur) => (cur?.id === row.id ? row : cur));
    setTasks((cur) => cur.map((t) => (t.draftId === row.id ? { ...t, draftStatus: row.status, draftLabel: draftLabel(row).text } : t)));
  }
  async function patchDraft(d: DraftRow, body: DraftPatchBody) {
    const r = await patchDraftApi(d.id, body);
    if (r.ok) mergeRow(r.data); else show(r.error);
    return r.ok;
  }
  // 원고를 작업에 붙이기·떼기(§5) — 원고가 저장하는 캠페인 값은 taskId 하나다. 붙이면 캠페인·예정일·비용이
  // 그 작업에서 따라오므로 낙관적 갱신을 하지 않고 응답 행으로 카드를 갈아끼운 뒤 표도 다시 불러온다
  // (표의 '원고' 열은 작업 쪽 행이라 이 원고 한 건만 고쳐서는 맞출 수 없다).
  async function attachPeek(draftId: string, taskId: string | null) {
    const r = await patchDraftApi(draftId, { taskId });
    if (!r.ok) { show(r.error); return; }
    setPeekDraft((cur) => (cur?.id === r.data.id ? r.data : cur));
    await load();
    show(taskId ? '작업에 붙였어요' : '작업에서 뗐어요 — 작업도 원고도 남아 있어요');
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
    // 원고를 지워도 작업은 남는다(작업이 캠페인의 단위다) — 확인 문구가 그렇게 말한다
    if (!window.confirm(`'${draftLabel(d).text}' 원고를 삭제할까요?\n\n작업은 남고 원고만 떨어져요.`)) return;
    const r = await deleteDraftApi(d.id);
    if (!r.ok) { show(r.error); return; }
    closePeek();
    setTasks((cur) => cur.map((t) => (t.draftId === d.id ? { ...t, draftId: null, draftStatus: null, draftLabel: null } : t)));
    show('원고를 삭제했어요 — 작업은 남아 있어요');
    onChanged();
  }

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
        <FlowCards stats={stats} budget={data.budget} clientId={data.campaign.clientId}
                   cancelledCount={cancelledCount} refreshing={refreshing} onRefresh={onRefresh} />
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
                   onOpenDraft={setPeekId} onAttachDraft={setAttachFor}
                   onGenerateHref={(t) => draftWriteHref(t.id, id)}
                   onDetachDraft={(t) => void detachDraft(t)}
                   onSaveProfilePricing={saveProfilePricing}
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
                     target: <div className="text-ui text-x-muted">대상 칸(Task 9)</div>,
                   }}
                   // 패널 위에 뜬 다른 레이어(원고 카드·편집 모달·원고 고르기·한 번에 만들기)가 있으면 패널의
                   // Esc를 끈다 — 안 그러면 그 레이어를 닫는 Esc 한 번에 패널까지 같이 닫힌다.
                   overlayOpen={!!peekId || !!editing || !!attachFor || bulkOpen} />
      )}
      {bulkOpen && <BulkCreateDialog onClose={() => setBulkOpen(false)} onCreate={bulkCreate} />}
      {attachFor && (
        <AttachDraftModal clientId={data.campaign.clientId} title="이 작업에 붙일 원고 고르기"
                          emptyHint="붙일 수 있는 원고가 없어요 — 창을 닫고 [새로 만들기]를 누르면 바로 쓸 수 있어요"
                          onClose={() => setAttachFor(null)}
                          onPick={async (d) => {
                            const r = await patchDraftApi(d.id, { taskId: attachFor.id });
                            if (!r.ok) { show(r.error); return; }
                            setAttachFor(null);
                            show('원고를 붙였어요');
                            void load(); onChanged();
                          }} />
      )}

      {peekId && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6" onClick={closePeek}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={closePeek} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            {peeked ? (
              // 배정은 작업이 쥔다 — 카드에는 그 작업의 인플을 얹어 넘긴다(원고에 남아 있는 옛 값이 아니라 화면과 같은 값 하나)
              <DraftCard draft={{ ...peeked, influencerHandle: peekTask?.influencerHandle ?? peeked.influencerHandle }} banned={bannedFor(peeked)}
                         onEdit={() => setEditing(peeked)}
                         onRewrite={(feedback, baseIndex) => void rewrite(peeked, feedback, baseIndex)}
                         rewriteBusy={rewritingId === peeked.id}
                         onDelete={() => void removeDraft(peeked)}
                         onRegenPost={(i) => void regenPost(peeked, i)}
                         regenBusyIndex={regenBusy?.draftId === peeked.id ? regenBusy.index : null}
                         onDismissFlag={(key, dismiss) => void patchDraft(peeked, {
                           dismissedFlags: dismiss ? [...new Set([...peeked.dismissedFlags, key])] : peeked.dismissedFlags.filter((k) => k !== key),
                         })}
                         onRestoreAllFlags={() => void patchDraft(peeked, { dismissedFlags: [] })}
                         onChangeStatus={(s) => { void patchDraft(peeked, { status: s }).then((ok) => {
                           // 미사용 ↔ 그 외는 요약 N·인플 작업 수·합계의 모집단이 바뀐다 — 목록 보조줄도 따라가야 한다
                           if (ok && (s === 'unused' || peeked.status === 'unused')) onChanged();
                         }); }}
                         onChangeTitle={(next) => void patchDraft(peeked, { title: next ?? '' })}
                         siblingTotal={null}
                         influencerOptions={influencerOptions}
                         // 배정은 작업의 값이다(§2-5) — 카드에서 바꿔도 저장되는 곳은 이 원고가 붙은 작업이고,
                         // 카드 표시만 같은 값으로 맞춰 둔다(작업이 없으면 배정할 곳도 없다).
                         onAssignInfluencer={(next) => {
                           if (!peekTask) { show('이 원고가 붙은 작업을 찾지 못했어요 — 새로고침해 주세요'); return; }
                           setPeekDraft((cur) => (cur?.id === peeked.id ? { ...cur, influencerHandle: next } : cur));
                           void actions.assignInfluencer(peekTask, next, { autoCost: false });   // 비용은 패널의 [확인]이 확정한다(R24)
                         }}
                         onSaveMedia={(next) => void patchDraft(peeked, { edited: next })}
                         mediaDropNotice={mediaDrop?.draftId === peeked.id ? mediaDrop.notice : null}
                         onDismissMediaDrop={() => setMediaDrop(null)}
                         // 작업 칸 — 이 화면은 캠페인 하나를 보고 있지만 후보는 전 캠페인이다(다른 캠페인의 작업으로 옮길 수 있다)
                         task={{
                           campaigns, today: data.today,
                           onAttach: (taskId) => void attachPeek(peeked.id, taskId),
                           onDetach: () => void attachPeek(peeked.id, null),
                           onCreateTask: async (campaignId: string, type: TaskType) => {
                             // 작업 만들기 + 이 원고 붙이기를 한 트랜잭션으로(서버가 draftId를 받아 처리) — 따로 하면
                             // 작업만 만들고 붙임에 실패했을 때 원고 없는 고아 작업이 남는다(리뷰 발견).
                             // 새 작업은 이 원고의 배정 인플루언서로 만든다 — 미배정이면 미배정 작업 한 건.
                             const r = await createTasksApi(campaignId, {
                               type, draftId: peeked.id,
                               influencers: peeked.influencerHandle ? [{ handle: peeked.influencerHandle }] : [],
                             });
                             if (!r.ok) { show(r.error); return false; }   // 409(이미 다른 작업에 붙음)도 이 문구로 충분하다
                             onChanged();   // 작업 수가 늘었다 — 왼쪽 목록의 보조줄도 따라가야 한다
                             await load();
                             const d = await apiFetch(`/api/drafts/${peeked.id}`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
                             setPeekDraft((d as DraftRow | null) ?? peeked);
                             return true;
                           },
                         }} />
            ) : (
              <div className="rounded-2xl border border-x-border-strong bg-white px-4 py-6 text-content text-x-secondary" role={peekErr ? 'alert' : undefined}>
                {peekErr ? '원고를 불러오지 못했어요 — 닫고 다시 눌러 주세요' : '원고를 불러오는 중…'}
              </div>
            )}
          </div>
        </div>
      )}
      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { mergeRow(u); setEditing(null); }}
                        onMediaSaved={mergeRow} />
      )}
    </div>
  );
}
