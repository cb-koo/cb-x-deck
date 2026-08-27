'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { CampaignRow, CampaignTaskItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { ExtraCost } from '@/lib/campaignCost';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { DraftRow } from '@/lib/draftStore';
import {
  fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, putInfluencerCostApi,
  patchDraftApi, deleteDraftApi, rewriteDraftApi, regenPostApi, type DraftPatchBody,
} from '@/lib/campaignApi';
import {
  summarizeTasks, summarizeTaskPerf, deriveTaskInfluencers, taskCampaignTotal, matchesTaskFilter, subtotalsByType,
  STAGE_FILTERS, STAGE_FILTER_LABEL, type StageFilter, type TaskSortKey,
} from '@/lib/campaignJudgment';
import type { DetailView } from '@/lib/campaignView';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { CampaignHeader } from './CampaignHeader';
import { SummaryCards } from './SummaryCards';
import { TaskTable } from './TaskTable';
import { InfluencerCostTable } from './InfluencerCostTable';
import { useCampaignTaskActions } from './useCampaignTaskActions';

// 캠페인 상세 컨테이너 — 로드·낙관적 갱신·모달을 쥔다. 요약·인플 목록·합계·성과는 서버 응답을 그대로 쓰지 않고
// 같은 판정 함수(campaignJudgment)로 여기서 다시 계산한다 — 표에서 값을 고친 즉시 카드 숫자가 따라가야 하고,
// 서버와 같은 함수라 새로고침해도 숫자가 바뀌지 않는다. '오늘'은 서버가 준 today(서울) — 브라우저 시계를 쓰지 않는다.
//
// 표는 작업 표(TaskTable)다. 원고는 작업에 붙은 '재료'라 표에서 이름을 누르면 원고 카드가 열린다 —
// 작업 목록엔 원고 본문이 없으므로 그때 GET /api/drafts/[id]로 한 건만 받아 카드에 넘긴다(같은 원고를 다시 열면 재요청 없음).
// 달력은 Task 14에서 작업 기준으로 온다.

// 섹션 패널(QA 7라운드 결정 B) — 오너 피드백: 전부 같은 흰 배경이라 헤더·요약·표가 "경계 없이 붙어 보인다".
// 간격만으로 나누던 것을 연회색 바닥(page.tsx의 bg-x-surface) 위 흰 패널 4장으로 바꿨다: 헤더 / 요약 / 작업 진행 현황 / 인플루언서별 비용.
// 데이터 중심 대시보드의 관례(리서치 §3)라 처음 보는 사람도 어디까지가 한 섹션인지 스크롤만 해도 알 수 있다.
// 패널 사이 간격(space-y-5 = 20px)이 섹션 간 여백의 단일 소스다 — 안쪽 컴포넌트가 각자 mt-8을 두면 간격이 두 벌이 된다.
const PANEL = 'rounded-xl border border-x-border bg-white p-5';
// 패널 제목 — 16px semibold(가독성 기준: 본문 15px보다 한 단 위, text-caption은 쓰지 않는다)
const PANEL_TITLE = 'text-[16px] font-semibold';

interface DetailState {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[];
  deleteInfo: { taskCount: number; detachedTargets: number }; today: string;
}
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };

export function CampaignDetail({ id, view, onViewChange, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — 원고 카드의 '다른 캠페인으로 옮기기' 후보(Task 11에서 다시 쓴다)
  view: DetailView;           // [표 | 주간 달력] — page가 쥐고 localStorage에 기억한다(캠페인을 바꿔도 유지)
  onViewChange: (v: DetailView) => void;
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·작업 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [filter, setFilter] = useState<StageFilter>('all');
  const [sort, setSort] = useState<TaskSortKey>('created');
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
  // 모달은 Task 12에서 붙인다 — 지금은 표의 입구(원고 붙이기·대상 고르기)가 가리킨 작업만 쥔다(값을 읽는 쪽이 아직 없어 setter만 꺼낸다)
  const [, setAttachFor] = useState<CampaignTaskItem | null>(null);
  const [, setTargetFor] = useState<CampaignTaskItem | null>(null);

  // 요청 토큰 — 캠페인을 빠르게 갈아타면 앞 캠페인의 응답이 뒤에 도착할 수 있다. 그때 화면에는 이미 다른 캠페인이
  // 떠 있으므로 옛 응답은 성공이든 실패든 버린다(남의 캠페인 데이터·오류 배너가 붙는 것을 막는다).
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const token = ++reqRef.current;
    const r = await fetchCampaignDetail(id);
    if (token !== reqRef.current) return;   // 그 사이 다른 캠페인(또는 새 로드)이 시작됐다 — 이 응답은 화면의 것이 아니다
    if (r.ok) {
      const { campaign, tasks, costRows, deleteInfo, today } = r.data;   // summary·influencers는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, tasks, costRows, deleteInfo, today });
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
  const actions = useCampaignTaskActions({ campaignId: id, setTasks, influencerOptions, show, onChanged });

  // 파생값 — 서버와 같은 함수(campaignJudgment). 작업 하나를 고치면 넷이 함께 바뀐다.
  const summary = useMemo(() => (data ? summarizeTasks(data.tasks, data.today) : null), [data]);
  const perf = useMemo(() => (data ? summarizeTaskPerf(data.tasks) : null), [data]);
  const influencers = useMemo(() => (data ? deriveTaskInfluencers(data.tasks, data.costRows) : []), [data]);
  // 툴바 칩의 숫자 — 표가 쓰는 matchesTaskFilter 그대로라 '전달됨 2'를 눌렀을 때 나오는 행 수와 항상 같다
  const stageCounts = useMemo(() => Object.fromEntries(
    STAGE_FILTERS.map((f) => [f, (data?.tasks ?? []).filter((t) => matchesTaskFilter(t, f, data?.today ?? '')).length]),
  ) as Record<StageFilter, number>, [data]);
  const total = useMemo(() => taskCampaignTotal(influencers), [influencers]);
  // 표 하단 유형 줄 — 서버가 준 값 대신 여기서 다시 센다(표에서 유형·비용을 고친 즉시 따라가야 한다)
  const byType = useMemo(() => (data ? subtotalsByType(data.tasks) : []), [data]);
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

  // 추가 비용·메모 — PUT 응답 행으로 costRows를 갈아끼운다(같은 핸들은 lower 기준 하나). 합계가 목록 보조줄에도 실리므로 onChanged.
  const saveCostRow = useCallback(async (handle: string, patch: { extraCosts?: ExtraCost[]; note?: string }) => {
    const r = await putInfluencerCostApi(id, handle, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => {
      if (!cur) return cur;
      const others = cur.costRows.filter((x) => x.influencerHandle.toLowerCase() !== r.data.influencerHandle.toLowerCase());
      return { ...cur, costRows: [...others, r.data] };
    });
    onChanged();
    return true;
  }, [id, show, onChanged]);

  // ── 원고 카드(표에서 원고 이름을 누르면 열린다) — 원고 자체의 편집은 기존 PATCH /api/drafts/[id] 그대로 ──
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
  if (!data || !summary || !perf) return null;

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
                        onDelete={() => void removeCampaign()}
                        onAddDrafts={() => show('작업 추가로 바꾸는 중이에요 — 곧 여기서 작업을 추가할 수 있어요')} />
      </div>
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>캠페인 요약</h2>
        <div className="mt-3.5">
          <SummaryCards summary={summary} perf={perf} total={total} />
        </div>
      </div>
      {/* 툴바 두 줄(QA 5라운드) — 첫 줄은 제목+건수만, 둘째 줄은 [표 | 주간 달력] + 단계 필터 칩.
          건수(N건)는 이 캠페인의 작업 전부(= 표의 '전체' 행 수)라 제목과 표가 같은 숫자를 말한다. */}
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>
          작업 진행 현황 <span className="text-ui font-normal text-x-muted tabular-nums">{data.tasks.length}건</span>
        </h2>
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="작업 보기" className="inline-flex rounded-full border border-x-border-strong p-0.5">
            {(['table', 'calendar'] as DetailView[]).map((v) => (
              <button key={v} type="button" onClick={() => onViewChange(v)} aria-pressed={view === v}
                      className={`h-8 rounded-full px-3.5 text-ui ${view === v ? 'bg-x-text font-bold text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                {v === 'table' ? '표' : '주간 달력'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGE_FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-ui tabular-nums ${
                        filter === f ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                {STAGE_FILTER_LABEL[f]} {stageCounts[f]}
              </button>
            ))}
          </div>
        </div>
        {/* 표·달력은 이 패널 안에 들어간다 — 세그먼트 아래 간격은 TaskTable의 <section className="mt-3">이 쥔다 */}
        {view === 'table' ? (
          <TaskTable rows={data.tasks} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions}
                     sort={sort} onSortChange={setSort} filter={filter}
                     byType={byType} total={total} summary={summary}
                     actions={actions}
                     onOpenDraft={setPeekId}
                     onAttachDraft={(t) => { setAttachFor(t); show('원고 붙이기 화면을 만드는 중이에요 — 곧 여기서 원고를 고를 수 있어요'); }}
                     onPickTarget={(t) => { setTargetFor(t); show('대상 고르기 화면을 만드는 중이에요 — 곧 여기서 RT·인용RT 대상을 고를 수 있어요'); }}
                     onDelete={(t) => {
                       if (window.confirm(`이 작업을 지울까요?${t.draftId ? '\n\n원고는 남아요.' : ''}`)) void actions.remove(t);
                     }} />
        ) : (
          <p className="mt-3 text-ui text-x-muted">달력을 작업 기준으로 바꾸는 중…</p>
        )}
      </div>
      <div className={PANEL}>
        <InfluencerCostTable lines={influencers} total={total}
                             onSaveExtraCosts={(h, next) => saveCostRow(h, { extraCosts: next })}
                             onSaveNote={(h, note) => saveCostRow(h, { note })} />
      </div>

      {peekId && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6" onClick={closePeek}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={closePeek} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-bold text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            {peeked ? (
              <DraftCard draft={peeked} banned={bannedFor(peeked)}
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
                           void actions.assignInfluencer(peekTask, next);
                         }}
                         onSaveMedia={(next) => void patchDraft(peeked, { edited: next })}
                         mediaDropNotice={mediaDrop?.draftId === peeked.id ? mediaDrop.notice : null}
                         onDismissMediaDrop={() => setMediaDrop(null)} />
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
