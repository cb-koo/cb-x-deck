'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { CampaignRow, CampaignDraftItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { DraftRow } from '@/lib/draftStore';
import type { ExtraCost } from '@/lib/campaignCost';
import {
  fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, putInfluencerCostApi, deleteDraftApi, rewriteDraftApi, regenPostApi,
} from '@/lib/campaignApi';
import {
  summarizeStages, summarizePerf, deriveInfluencers, campaignTotal, matchesStageFilter,
  STAGE_FILTERS, STAGE_FILTER_LABEL, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import type { DetailView } from '@/lib/campaignView';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { CampaignHeader } from './CampaignHeader';
import { SummaryCards } from './SummaryCards';
import { ContentTable } from './ContentTable';
import { WeekCalendar } from './WeekCalendar';
import { InfluencerCostTable } from './InfluencerCostTable';
import { AddDraftsModal } from './AddDraftsModal';
import { LinkPostModal } from './LinkPostModal';
import { useCampaignDraftActions } from './useCampaignDraftActions';

// 캠페인 상세 컨테이너 — 로드·낙관적 갱신·모달을 쥔다. 요약·인플 목록·합계·성과는 서버 응답을 그대로 쓰지 않고
// 같은 판정 함수(campaignJudgment)로 여기서 다시 계산한다 — 표에서 값을 고친 즉시 카드 숫자가 따라가야 하고,
// 서버와 같은 함수라 새로고침해도 숫자가 바뀌지 않는다. '오늘'은 서버가 준 today(서울) — 브라우저 시계를 쓰지 않는다.

// 섹션 패널(QA 7라운드 결정 B) — 오너 피드백: 전부 같은 흰 배경이라 헤더·요약·표가 "경계 없이 붙어 보인다".
// 간격만으로 나누던 것을 연회색 바닥(page.tsx의 bg-x-surface) 위 흰 패널 4장으로 바꿨다: 헤더 / 요약 / 콘텐츠 진행 현황 / 인플루언서별 비용.
// 데이터 중심 대시보드의 관례(리서치 §3)라 처음 보는 사람도 어디까지가 한 섹션인지 스크롤만 해도 알 수 있다.
// 패널 사이 간격(space-y-5 = 20px)이 섹션 간 여백의 단일 소스다 — 안쪽 컴포넌트가 각자 mt-8을 두면 간격이 두 벌이 된다.
const PANEL = 'rounded-xl border border-x-border bg-white p-5';
// 패널 제목 — 16px semibold(가독성 기준: 본문 15px보다 한 단 위, text-caption은 쓰지 않는다)
const PANEL_TITLE = 'text-[16px] font-semibold';

interface DetailState { campaign: CampaignRow; drafts: CampaignDraftItem[]; costRows: InfluencerCostRow[]; today: string }
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };

export function CampaignDetail({ id, campaigns, view, onViewChange, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — DraftCard `campaign` prop(다른 캠페인으로 옮기기)의 후보
  view: DetailView;           // [표 | 주간 달력] — page가 쥐고 localStorage에 기억한다(캠페인을 바꿔도 유지)
  onViewChange: (v: DetailView) => void;
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·콘텐츠 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [sort, setSort] = useState<ContentSortKey>('default');
  const [filter, setFilter] = useState<StageFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [linkFor, setLinkFor] = useState<CampaignDraftItem | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [mediaDrop, setMediaDrop] = useState<{ draftId: string; notice: MediaDropNotice } | null>(null);

  // 요청 토큰 — 캠페인을 빠르게 갈아타면 앞 캠페인의 응답이 뒤에 도착할 수 있다. 그때 화면에는 이미 다른 캠페인이
  // 떠 있으므로 옛 응답은 성공이든 실패든 버린다(남의 캠페인 데이터·오류 배너가 붙는 것을 막는다).
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const token = ++reqRef.current;
    const r = await fetchCampaignDetail(id);
    if (token !== reqRef.current) return;   // 그 사이 다른 캠페인(또는 새 로드)이 시작됐다 — 이 응답은 화면의 것이 아니다
    if (r.ok) {
      const { campaign, drafts, costRows, today } = r.data;   // summary·influencers는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, drafts, costRows, today });
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

  const setDrafts: Dispatch<SetStateAction<CampaignDraftItem[]>> = useCallback((next) => {
    setData((cur) => (cur ? { ...cur, drafts: typeof next === 'function' ? next(cur.drafts) : next } : cur));
  }, []);
  const actions = useCampaignDraftActions({ campaign: data?.campaign ?? null, setDrafts, influencerOptions, show, onChanged });

  // 파생값 — 서버와 같은 함수(campaignJudgment). 원고 하나를 고치면 넷이 함께 바뀐다.
  const summary = useMemo(() => (data ? summarizeStages(data.drafts, data.today) : null), [data]);
  const perf = useMemo(() => (data ? summarizePerf(data.drafts) : null), [data]);
  const influencers = useMemo(() => (data ? deriveInfluencers(data.drafts, data.costRows) : []), [data]);
  // 툴바 칩의 숫자 — 표·달력이 쓰는 matchesStageFilter 그대로라 '전달됨 2'를 눌렀을 때 나오는 행 수와 항상 같다
  const stageCounts = useMemo(() => Object.fromEntries(
    STAGE_FILTERS.map((f) => [f, (data?.drafts ?? []).filter((d) => matchesStageFilter(d, f)).length]),
  ) as Record<StageFilter, number>, [data]);
  const total = useMemo(() => campaignTotal(influencers), [influencers]);
  const peeked = peekId && data ? data.drafts.find((d) => d.id === peekId) ?? null : null;
  const bannedFor = useCallback((d: DraftRow) => (clientData
    ? [...clientData.client.bannedPhrases,
       ...clientData.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)]
    : []), [clientData]);

  // Esc로 원고 모달 닫기 — 편집 모달이 위에 있으면 그쪽 Esc가 우선(generate 관례)
  useEffect(() => {
    if (!peekId || editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setPeekId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing]);

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
    show(r.data.deleted ? '캠페인을 삭제했어요 — 원고는 콘텐츠 생성 목록에 그대로 있어요' : '이미 삭제된 캠페인이에요');
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

  // DraftCard 단일 표면(스펙 §3-2) — /generate와 같은 카드, 같은 동사. 응답(DraftRow)은 published·perf를 유지한 채 병합한다.
  const mergeRow = useCallback((row: DraftRow) => setDrafts((cur) => cur.map((x) => (x.id === row.id ? { ...x, ...row } : x))), [setDrafts]);
  async function rewrite(d: CampaignDraftItem, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setMediaDrop((cur) => (cur?.draftId === d.id ? null : cur));   // 지난 안내는 걷는다 — 이번 결과로 대체된다
    setRewritingId(d.id);
    const r = await rewriteDraftApi(d.id, baseIndex, feedback);
    setRewritingId(null);
    if (!r.ok) { show(r.error); return; }
    mergeRow(r.data);
    // 스레드가 짧아져 이미지가 빠졌으면 알린다 — generate/page.tsx rewrite와 같은 계산(비교 기준은 '직전 최신' = history의 끝)
    const i = r.data.history.length - 1;
    const prevLatest = r.data.history[i];
    const notice = prevLatest ? droppedMediaOnRewrite(prevLatest, r.data.edited ?? r.data.content, i) : null;
    if (notice) setMediaDrop({ draftId: d.id, notice });
  }
  async function regenPost(d: CampaignDraftItem, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await regenPostApi(d.id, index);
    setRegenBusy(null);
    if (r.ok) mergeRow(r.data); else show(r.error);
  }
  async function removeDraft(d: CampaignDraftItem) {
    // 캠페인 화면의 삭제는 확인 + 즉시(5초 실행취소는 /generate 목록의 문법 — 여기선 카드 하나를 열어놓고 지운다)
    if (!window.confirm(`'${draftLabel(d).text}' 원고를 삭제할까요?\n\n캠페인에서만 빼려면 표의 ··· 메뉴에서 '캠페인에서 빼기'를 쓰세요.`)) return;
    setPeekId(null);
    const r = await deleteDraftApi(d.id);
    if (!r.ok) { show(r.error); return; }
    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
    show('원고를 삭제했어요');
    onChanged();
  }
  function toggleDismiss(d: CampaignDraftItem, key: string, dismiss: boolean) {
    const next = dismiss ? [...new Set([...d.dismissedFlags, key])] : d.dismissedFlags.filter((k) => k !== key);
    void actions.setDismissed(d, next);
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
    <div className="min-w-0 space-y-5 p-5 pb-12">
      {loadErr && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      {/* draftCount는 목록용 파생값(미사용 제외 + 이 세션의 변경이 반영 안 됨)이라 삭제 안내에 쓰면 거짓이 된다 — 화면에 실린 원고 수를 넘긴다 */}
      <div className={PANEL}>
        <CampaignHeader campaign={data.campaign} draftCount={data.drafts.length} today={data.today} onPatch={patchCampaign}
                        onDelete={() => void removeCampaign()} onAddDrafts={() => setAddOpen(true)} />
      </div>
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>캠페인 요약</h2>
        <div className="mt-3.5">
          <SummaryCards summary={summary} perf={perf} total={total} />
        </div>
      </div>
      {/* 콘텐츠 툴바 두 줄(QA 5라운드) — 오너 피드백: 제목이 뜻을 담아야 한다('콘텐츠 N' → '콘텐츠 진행 현황').
          첫 줄은 제목+건수만. 둘째 줄은 왼쪽 정렬로 [표 | 주간 달력] + 단계 필터 칩 — 오른쪽에는 아무것도 두지 않는다.
          건수(N건)는 이 캠페인의 원고 전부(= 표의 '전체' 행 수)라 제목과 표가 같은 숫자를 말한다 — 미사용을 빼면 표와 어긋난다.
          칩은 표·달력 공용으로 올려 두 보기에서 뜻이 같다. 칩·버튼 높이는 32px, 글자는 13px. */}
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>
          콘텐츠 진행 현황 <span className="text-ui font-normal text-x-muted tabular-nums">{data.drafts.length}건</span>
        </h2>
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="콘텐츠 보기" className="inline-flex rounded-full border border-x-border-strong p-0.5">
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
        {/* 표·달력은 이 패널 안에 들어간다 — 세그먼트 아래 간격은 두 컴포넌트의 <section className="mt-3">이 쥔다 */}
        {view === 'table' ? (
          <ContentTable rows={data.drafts} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions}
                        sort={sort} onSortChange={setSort} filter={filter}
                        onOpenDraft={setPeekId}
                        onChangeStatus={(d, s) => void actions.changeStatus(d, s)}
                        onAssignInfluencer={(d, h) => void actions.assignInfluencer(d, h)}
                        onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)}
                        onChangeCost={(d, next) => void actions.changeCost(d, next)}
                        onRemoveFromCampaign={(d) => {
                          if (window.confirm(`'${draftLabel(d).text}'을(를) 캠페인에서 뺄까요?\n\n원고는 남고 소속만 풀려요. 예정일·비용도 원고에 남아요.`)) void actions.removeFromCampaign(d);
                        }}
                        onLinkPost={setLinkFor} />
        ) : (
          // 드래그 저장 = 표와 같은 changeScheduledOn — 실패하면 apply가 카드를 원위치로 되돌리고 서버 문구를 토스트로 띄운다(§7)
          <WeekCalendar rows={data.drafts} campaign={data.campaign} today={data.today} filter={filter}
                        onOpenDraft={setPeekId}
                        onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)} />
        )}
      </div>
      <div className={PANEL}>
        <InfluencerCostTable lines={influencers} total={total}
                             onSaveExtraCosts={(h, next) => saveCostRow(h, { extraCosts: next })}
                             onSaveNote={(h, note) => saveCostRow(h, { note })} />
      </div>

      {addOpen && (
        <AddDraftsModal campaign={data.campaign} onClose={() => setAddOpen(false)}
                        onAdded={(n) => { setAddOpen(false); show(`원고 ${n}개를 넣었어요 — 예정일은 표에서 채워요`); void load(); onChanged(); }} />
      )}
      {linkFor && (
        <LinkPostModal draft={linkFor} onClose={() => setLinkFor(null)}
                       onLinked={() => { setLinkFor(null); show('게시물을 연결했어요 — 게시됨으로 표시되고 조회수가 잡혀요'); void load(); }} />
      )}
      {peeked && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6" onClick={() => setPeekId(null)}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setPeekId(null)} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-bold text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            <DraftCard draft={peeked} banned={bannedFor(peeked)}
                       onEdit={() => setEditing(peeked)}
                       onRewrite={(feedback, baseIndex) => void rewrite(peeked, feedback, baseIndex)}
                       rewriteBusy={rewritingId === peeked.id}
                       onDelete={() => void removeDraft(peeked)}
                       onRegenPost={(i) => void regenPost(peeked, i)}
                       regenBusyIndex={regenBusy?.draftId === peeked.id ? regenBusy.index : null}
                       onDismissFlag={(key, dismiss) => toggleDismiss(peeked, key, dismiss)}
                       onRestoreAllFlags={() => void actions.setDismissed(peeked, [])}
                       onChangeStatus={(s) => void actions.changeStatus(peeked, s)}
                       onChangeTitle={(next) => void actions.changeTitle(peeked, next)}
                       siblingTotal={null}
                       influencerOptions={influencerOptions}
                       onAssignInfluencer={(next) => void actions.assignInfluencer(peeked, next)}
                       onSaveMedia={(next) => void actions.saveMedia(peeked, next)}
                       mediaDropNotice={mediaDrop?.draftId === peeked.id ? mediaDrop.notice : null}
                       onDismissMediaDrop={() => setMediaDrop(null)}
                       campaign={{
                         options: campaigns, today: data.today,
                         // 표가 이미 아는 게시 여부를 넘겨야 카드의 밀림 판정이 표와 같은 말을 한다(Task 12 published prop)
                         published: peeked.published,
                         // 다른 캠페인으로 옮기면(또는 없음) 이 화면에서 사라진다 — 카드를 먼저 닫는다. 같은 캠페인이면 moveToCampaign이 no-op.
                         onChange: (campaignId) => { if (campaignId !== data.campaign.id) setPeekId(null); void actions.moveToCampaign(peeked, campaignId); },
                         onChangeScheduledOn: (next) => void actions.changeScheduledOn(peeked, next),
                         onChangeCost: (next) => void actions.changeCost(peeked, next),
                       }} />
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
