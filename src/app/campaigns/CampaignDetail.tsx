'use client';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
  summarizeStages, summarizePerf, deriveInfluencers, campaignTotal, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { CampaignHeader } from './CampaignHeader';
import { SummaryCards } from './SummaryCards';
import { ContentTable } from './ContentTable';
import { InfluencerCostTable } from './InfluencerCostTable';
import { AddDraftsModal } from './AddDraftsModal';
import { LinkPostModal } from './LinkPostModal';
import { useCampaignDraftActions } from './useCampaignDraftActions';

// 캠페인 상세 컨테이너 — 로드·낙관적 갱신·모달을 쥔다. 요약·인플 목록·합계·성과는 서버 응답을 그대로 쓰지 않고
// 같은 판정 함수(campaignJudgment)로 여기서 다시 계산한다 — 표에서 값을 고친 즉시 카드 숫자가 따라가야 하고,
// 서버와 같은 함수라 새로고침해도 숫자가 바뀌지 않는다. '오늘'은 서버가 준 today(서울) — 브라우저 시계를 쓰지 않는다.
interface DetailState { campaign: CampaignRow; drafts: CampaignDraftItem[]; costRows: InfluencerCostRow[]; today: string }
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };

export function CampaignDetail({ id, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — Task 15가 DraftCard `campaign` prop(다른 캠페인으로 옮기기)에 쓴다. 이 태스크에선 아직 안 읽는다.
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

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(InfluencerProfile 관례)
  const load = useCallback(async () => {
    const r = await fetchCampaignDetail(id);
    if (r.ok) {
      const { campaign, drafts, costRows, today } = r.data;   // summary·influencers는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, drafts, costRows, today });
      setLoadErr(false);
    } else {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
    setLoaded(true);
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- id 바뀔 때 1회 로드, setState는 전부 비동기 콜백(InfluencerProfile·tracking 관례)
  useEffect(() => { void load(); }, [load]);

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
    show('캠페인을 삭제했어요 — 원고는 콘텐츠 생성 목록에 그대로 있어요');
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
    <div className="min-w-0 px-6 py-6">
      {loadErr && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      <CampaignHeader campaign={data.campaign} today={data.today} onPatch={patchCampaign}
                      onDelete={() => void removeCampaign()} onAddDrafts={() => setAddOpen(true)} />
      <div className="mt-7">
        <SummaryCards summary={summary} perf={perf} total={total} />
      </div>
      <ContentTable rows={data.drafts} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions}
                    sort={sort} onSortChange={setSort} filter={filter} onFilterChange={setFilter}
                    onOpenDraft={setPeekId}
                    onChangeStatus={(d, s) => void actions.changeStatus(d, s)}
                    onAssignInfluencer={(d, h) => void actions.assignInfluencer(d, h)}
                    onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)}
                    onChangeCost={(d, next) => void actions.changeCost(d, next)}
                    onRemoveFromCampaign={(d) => {
                      if (window.confirm(`'${draftLabel(d).text}'을(를) 캠페인에서 뺄까요?\n\n원고는 남고 소속만 풀려요. 예정일·비용도 원고에 남아요.`)) void actions.removeFromCampaign(d);
                    }}
                    onLinkPost={setLinkFor} />
      <InfluencerCostTable lines={influencers} total={total}
                           onSaveExtraCosts={(h, next) => saveCostRow(h, { extraCosts: next })}
                           onSaveNote={(h, note) => saveCostRow(h, { note })} />

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
                       onDismissMediaDrop={() => setMediaDrop(null)} />
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
