'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { newDraftsSince, filterDrafts, statusCounts, siblingCount, type DraftListFilter } from '@/lib/draftUi';
import { Toast } from '@/components/Toast';
import { DraftCard } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { RefPickerSheet } from '@/components/RefPickerSheet';
import { DraftFilterBar } from '@/components/DraftFilterBar';
import { DraftTable } from '@/components/DraftTable';
import { DraftKanban } from '@/components/DraftKanban';
import { DraftComposer, ComposerFooter, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_WIDTH_KEY } from '@/lib/panelResize';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { DraftRow } from '@/lib/draftStore';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftStatus } from '@/lib/draftStatus';

const COMPOSER_KEY = 'cbx-composer'; // 직전 설정 유지 (스펙 §4 "바꾸기 — 직전 값 유지")
// 보기 방식 — 렌즈(필터)와 달리 작업 방식 선호라 저장한다 (스펙 2차 §확정 결정)
type ResultView = 'cards' | 'table' | 'kanban';
const VIEW_KEY = 'cbx-generate-view';

export default function GeneratePage() {
  return (
    <Suspense>
      <Workbench />
    </Suspense>
  );
}

function Workbench() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Array<{ client: ClientRow; procedures: ProcedureRow[] }>>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(DEFAULT_COMPOSER);
  const [refRows, setRefRows] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<DraftListFilter>({ status: 'all', clientId: '' });
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<DraftRow | null>(null);
  // 좌패널 폭 — 드래그 리사이즈, 더블클릭 복원, 저장값은 복원 시 클램프 (스펙 §경계 조건)
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [view, setViewState] = useState<ResultView>('cards');
  // 패널 접힘: null=자동(카드 뷰=펼침, 테이블·칸반=접힘), 'open'|'closed'=수동 고정(세션 한정)
  const [panelPref, setPanelPref] = useState<'open' | 'closed' | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 좌패널 풋터에서 생성하면 우측이 스크롤된 상태일 수 있어 결과가 소리 없이 화면 밖에 놓이지 않게 하기 위함(T11 계열)
  const resultsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw === null) return;
    setPanelW(clampPanelWidth(Number(raw), rootRef.current?.clientWidth ?? Infinity));
  }, []);
  function applyWidth(w: number) {
    const clamped = clampPanelWidth(w, rootRef.current?.clientWidth ?? Infinity);
    setPanelW(clamped);
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
  }
  const abortRef = useRef<AbortController | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Record<string, string[]>>({});
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genStartedAt = useRef(0); // 이번 생성 요청 시각 — 폴링 병합의 하한선
  const genCount = useRef(1); // 이번 생성의 시안 수 — 스켈레톤 문구용
  const draftsRef = useRef<DraftRow[]>([]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const lastWsId = typeof window !== 'undefined' ? localStorage.getItem(LAST_WS_KEY) : null;
  useEffect(() => {
    const v = localStorage.getItem(VIEW_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원 (COMPOSER_KEY와 같은 관례)
    if (v === 'table' || v === 'kanban') setViewState(v);
  }, []);
  const setView = useCallback((v: ResultView) => { setViewState(v); localStorage.setItem(VIEW_KEY, v); }, []);
  const panelOpen = panelPref !== null ? panelPref === 'open' : view === 'cards';
  const clientNameOf = useCallback(
    (id: string | null) => (id ? (clients.find((c) => c.client.id === id)?.client.name ?? '?') : '—'),
    [clients]);

  // 테이블·칸반에서 원고를 눌렀을 때 — 카드 뷰로 점프해 정독. 필터에 가려 있으면 전체로(T11 계열: 점프가 소리 없이 실패하지 않게)
  function openCard(id: string) {
    setView('cards');
    const target = draftsRef.current.find((d) => d.id === id);
    if (target) setFilter((f) => (filterDrafts([target], f).length > 0 ? f : { status: 'all', clientId: '' }));
    setHighlightId(id);
    setTimeout(() => { // 카드 뷰 DOM이 그려진 다음 프레임에 스크롤
      document.querySelector(`[data-draft-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    setTimeout(() => setHighlightId(null), 1600);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로컬 저장값 복원(기존 코드베이스 관례, RefPickerSheet 선례)
    try { const s = localStorage.getItem(COMPOSER_KEY); if (s) setComposer({ ...DEFAULT_COMPOSER, ...JSON.parse(s) }); } catch { /* 무시 */ }
    Promise.all([
      apiFetch('/api/clients').then((r) => r.json()),
      apiFetch('/api/drafts').then((r) => r.json()),
    ]).then(([c, d]) => {
      setClients(c); setDrafts(d); setLoaded(true);
      // 복원된 clientId가 응답 목록에 없으면(유령 클라이언트) 정리 — 400 방지
      setComposer((cur) => (cur.clientId && !(c as Array<{ client: ClientRow }>).some((x) => x.client.id === cur.clientId)
        ? { ...cur, clientId: null, procedureIds: [] } : cur));
    }).catch(() => { setLoaded(true); setToast('목록을 불러오지 못했어요 — 새로고침해 주세요'); });
  }, []);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);
  const updateComposer = useCallback((v: ComposerState) => {
    setComposer(v);
    localStorage.setItem(COMPOSER_KEY, JSON.stringify({ ...v, direction: '', count: 1 })); // 방향성·시안 수는 매번 새로
  }, []);

  // 진입점 A: /generate?ref=<tweetId> — 보관함에 있으면 레퍼런스로 연결
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (!ref) return;
    apiFetch('/api/references?scope=all').then((r) => r.json()).then((rows: ReferenceRow[]) => {
      const found = rows.find((x) => x.tweetId === ref);
      if (found) {
        setRefRows((cur) => (cur.some((x) => x.tweetId === ref) ? cur : [...cur, found]));
        setPanelPref('open'); // 접힌 상태로 진입해도 연결 결과가 보이게 (스펙 §경계 조건)
      } else setToast('이 트윗은 보관함에 없어요 — 덱에서 ☆ 저장한 뒤 다시 시도해주세요');
    });
  }, [searchParams]);

  const selectedRefIds = useMemo(() => refRows.map((x) => x.tweetId), [refRows]);

  const clientScoped = useMemo(
    () => filterDrafts(drafts, { status: 'all', clientId: filter.clientId }), [drafts, filter.clientId]);
  const visibleDrafts = useMemo(
    () => filterDrafts(clientScoped, { status: filter.status, clientId: '' }), [clientScoped, filter.status]);
  const counts = useMemo(() => statusCounts(clientScoped), [clientScoped]);

  const bannedFor = useCallback((d: DraftRow) => {
    const c = clients.find((x) => x.client.id === d.clientId);
    if (!c) return [];
    return [...c.client.bannedPhrases, ...c.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)];
  }, [clients]);

  async function generate() {
    if (generating) return;
    stopPolling();
    genStartedAt.current = Date.now();
    genCount.current = composer.count;
    setGenerating(true);
    resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const src = {
        clientId: composer.clientId, procedureIds: composer.procedureIds,
        refTweetIds: refRows.map((x) => x.tweetId),
        mode: refRows.length > 0 ? composer.mode : 'off',
        direction: composer.direction, format: composer.format,
        count: composer.count,
      };
      const r = await apiFetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ ...src, constraintsOn: composer.constraintsOn }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const created = body as DraftRow[];
      setDrafts((cur) => [...created, ...cur]);
      // 방금 만든 초안이 현재 필터에 가려 안 보이면 필터를 전체로 — 생성 결과가 소리 없이 사라지지 않게 (T11 리뷰 반영)
      setFilter((f) => (filterDrafts(created, f).length > 0 ? f : { status: 'all', clientId: '' }));
      setComposer((c) => ({ ...c, count: 1 })); // 시안 수는 1회용 — 다음 생성이 조용히 N배 비용이 되지 않게
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setToast('생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setGenerating(false); abortRef.current = null;
    }
  }

  // 다시 쓰기 — 같은 초안의 새 버전으로. 피드백이 있으면 반영, 없으면 같은 조건 재생성.
  // baseIndex = 사용자가 보고 있던 버전(그 버전을 기준으로 다시 쓴다).
  async function rewrite(id: string, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setRewritingId(id);
    try {
      const r = await apiFetch(`/api/drafts/${id}/rewrite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseIndex, ...(feedback ? { feedback } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setDrafts((cur) => cur.map((d) => (d.id === id ? (body as DraftRow) : d)));
    } catch {
      setToast('다시 쓰기 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setRewritingId(null);
    }
  }

  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  // 취소 = 기다리기만 중단(서버 생성은 계속) → 완성본을 폴링으로 자동 반영 (스펙 3-5)
  function cancelGenerate() {
    abortRef.current?.abort();
    setToast('기다리기를 취소했어요 — 완성되면 목록에 자동으로 나타나요');
    const deadline = Date.now() + 120_000; // 최대 2분
    stopPolling();
    pollTimer.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); return; }
      try {
        const r = await apiFetch('/api/drafts');
        if (!r.ok) return; // 조용히 다음 주기 재시도 (스펙 §4)
        const fetched = (await r.json()) as DraftRow[];
        // 판정은 ref 미러 기준 — setDrafts 업데이터의 동기 실행(eager state)에 기대지 않는다 (최종 리뷰 반영)
        const fresh = newDraftsSince(draftsRef.current, fetched, genStartedAt.current);
        if (fresh.length === 0) return;
        // 삽입은 업데이터 안에서 재계산 — ref가 한 렌더 뒤처져도 중복 삽입이 없다
        setDrafts((cur) => [...newDraftsSince(cur, fetched, genStartedAt.current), ...cur]);
        stopPolling();
        setToast('아까 취소한 원고가 완성됐어요');
        resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        // 직접 성공 경로와 동일 — 완성본이 현재 필터에 가려 안 보이면 필터를 전체로 (T11 픽스 후속)
        setFilter((f) => (filterDrafts(fresh, f).length > 0 ? f : { status: 'all', clientId: '' }));
      } catch { /* 다음 주기 재시도 */ }
    }, 5000);
  }

  async function patchDraft(id: string, body: object) {
    const r = await apiFetch(`/api/drafts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((d) => (d.id === id ? updated : d))); return updated; }
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    return null;
  }

  // 삭제: 낙관적 제거 + 5초 실행취소 (보관함 패턴)
  function requestRemove(d: DraftRow) {
    setToast(null); // 죽은 에러 토스트가 삭제 직후 다시 뜨는 것을 방지
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) void apiFetch(`/api/drafts/${pendingRemove.id}`, { method: 'DELETE' });
    delete dismissedRef.current[d.id];
    setPendingRemove(d);
    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
    removeTimer.current = setTimeout(() => {
      void apiFetch(`/api/drafts/${d.id}`, { method: 'DELETE' });
      setPendingRemove(null);
    }, 5000);
  }
  function undoRemove() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) setDrafts((cur) => [pendingRemove, ...cur]);
    setPendingRemove(null);
  }

  // 무시/되돌리기 — 연속 클릭 레이스 방지: 렌더 클로저가 아니라 ref 미러에서 누적 계산 (리뷰 발견)
  function toggleDismiss(d: DraftRow, key: string, dismiss: boolean) {
    const base = dismissedRef.current[d.id] ?? d.dismissedFlags;
    const next = dismiss ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    dismissedRef.current[d.id] = next;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: next } : x)));
    void patchDraft(d.id, { dismissedFlags: next });
  }
  function restoreAllFlags(d: DraftRow) {
    dismissedRef.current[d.id] = [];
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: [] } : x)));
    void patchDraft(d.id, { dismissedFlags: [] });
  }

  function changeStatus(d: DraftRow, status: DraftStatus) {
    const prev = d.status;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, status } : x)));
    void patchDraft(d.id, { status }).then((updated) => {
      // 실패 롤백은 이 요청이 세팅한 값이 아직 표시 중일 때만 — 연속 변경 시 뒤 갱신을 덮지 않도록 (무시 표식 레이스 픽스와 같은 계열)
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.status === status ? { ...x, status: prev } : x)));
    });
  }

  async function regenPost(d: DraftRow, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await apiFetch(`/api/drafts/${d.id}/regen-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((x) => (x.id === d.id ? updated : x))); }
    else setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setRegenBusy(null);
  }

  return (
    <div ref={rootRef} style={{ ['--panel-w' as string]: `${panelW}px` }}
         className={`flex flex-col lg:h-full lg:flex-row ${resizing ? 'select-none' : ''}`}>
      {/* 좌: 생성 패널 — 접히면 lg에서 레일로. <lg 스택에서는 접기 개념 없음(항상 펼침) */}
      <div className={`flex shrink-0 flex-col bg-x-surface lg:min-h-0 ${panelOpen ? 'lg:w-[var(--panel-w)]' : 'lg:hidden'}`}>
        <div className="space-y-3 p-4 lg:flex-1 lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
              <p className="mt-0.5 text-caption text-x-secondary">레퍼런스와 클라이언트 정보를 조합해 인플루언서에게 보낼 X 원고 초안을 만들어요.</p>
            </div>
            <button onClick={() => setPanelPref('closed')} aria-label="생성 패널 접기" title="생성 패널 접기"
                    className="hidden shrink-0 rounded p-1 text-x-muted hover:bg-x-hover lg:block">«</button>
          </div>
          {loaded && clients.length === 0 && (
            <p className="rounded-lg bg-x-surface p-3 text-caption text-x-secondary">
              클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 — <a href="/clients" className="font-bold text-x-blue-text hover:underline">등록하러 가기</a>
            </p>
          )}
          <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                         refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                         onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                         onClearRefs={() => setRefRows([])} />
        </div>
        <ComposerFooter clients={clients} value={composer} refRows={refRows}
                        generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate} />
      </div>
      {!panelOpen && (
        <div className="hidden w-12 shrink-0 flex-col items-center gap-1.5 border-r border-x-border bg-x-surface py-3 lg:flex">
          <button onClick={() => setPanelPref('open')} aria-label="생성 패널 펼치기" title="생성 패널 펼치기"
                  className="rounded p-1.5 text-x-secondary hover:bg-x-hover">»</button>
          <button onClick={() => setPanelPref('open')} aria-label="새 원고 만들기 — 생성 패널이 펼쳐집니다" title="새 원고"
                  className="rounded p-1.5 text-[15px] font-bold text-x-blue-text hover:bg-x-blue/10">✚</button>
          {generating && <span role="status" aria-label="원고 생성 중" className="mt-1 h-2 w-2 animate-pulse rounded-full bg-x-blue" />}
        </div>
      )}

      {/* 구분선 — lg 전용 드래그 핸들. 키보드 화살표로도 조절 (스펙 §접근성). 접힘 상태에선 리사이즈 대상이 없어 숨김 */}
      {panelOpen && (
      <div role="separator" aria-orientation="vertical" aria-label="패널 폭 조절" tabIndex={0}
           onPointerDown={(e) => { setResizing(true); e.currentTarget.setPointerCapture(e.pointerId); }}
           onPointerMove={(e) => { if (resizing && rootRef.current) applyWidth(e.clientX - rootRef.current.getBoundingClientRect().left); }}
           onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)}
           onDoubleClick={() => applyWidth(PANEL_DEFAULT)}
           onKeyDown={(e) => {
             const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
             if (d) { e.preventDefault(); applyWidth(panelW + d); }
           }}
           className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-x-border hover:bg-x-blue/50 focus:bg-x-blue/60 focus:outline-none lg:block" />
      )}

      {/* 우: 결과 영역 — 필터 헤더는 스크롤 밖 고정 행 (Dense Scan List) */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {loaded && drafts.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-x-border bg-x-surface px-4 py-2">
            <div className="flex gap-1" role="group" aria-label="보기 방식">
              {(['cards', 'table', 'kanban'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                        className={`rounded-full border px-2.5 py-0.5 text-[13px] ${view === v ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                  {v === 'cards' ? '카드' : v === 'table' ? '테이블' : '칸반'}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <DraftFilterBar counts={counts} total={clientScoped.length} filter={filter}
                              clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                              onChange={setFilter} showStatusTabs={view !== 'kanban'} />
            </div>
          </div>
        )}
        {/* 스크롤 컨테이너와 flex 정렬을 분리 — 높이 제약된 flex 컬럼에서는 overflow-hidden인 카드가
            flex 아이템으로 찌그러진다(automatic minimum size 0). 정렬은 자연 높이의 내부 div가 담당. */}
        <div ref={resultsRef} className="lg:flex-1 lg:overflow-y-auto">
          <div className={view === 'cards' ? 'flex flex-col items-center gap-4 p-6' : 'p-4'}>
          {generating && view === 'cards' && (
            <div className="w-full max-w-[600px] animate-pulse rounded-2xl border border-x-border-strong bg-white px-4 py-3">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-x-border" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-1/3 rounded bg-x-border" />
                  <div className="h-3.5 w-full rounded bg-x-border" />
                  <div className="h-3.5 w-4/5 rounded bg-x-border" />
                </div>
              </div>
              <p className="mt-2 text-ui text-x-secondary">
                {genCount.current > 1 ? `시안 ${genCount.current}개 작성 중… 개수만큼 조금 더 걸려요` : '원고 작성 중… 보통 15~30초 걸려요'}
              </p>
              <p className="mt-0.5 text-caption text-x-muted">취소해도 완성되면 목록에 저장됩니다 — 생성 자체는 멈추지 않아요</p>
            </div>
          )}
          {generating && view !== 'cards' && (
            <p className="mb-3 rounded-lg bg-white px-3 py-2 text-ui text-x-secondary">원고 작성 중… 완성되면 초안으로 나타나요 — 취소해도 생성은 계속됩니다</p>
          )}

          {loaded && drafts.length === 0 && !generating && (
            <p className="w-full max-w-[600px] rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
              아직 초안이 없어요. 방향성을 적거나 레퍼런스를 골라 첫 원고를 만들어보세요 — 만든 초안은 자동으로 저장돼요.
            </p>
          )}

          {loaded && drafts.length > 0 && visibleDrafts.length === 0 && !generating && view !== 'kanban' && (
            <p className="w-full max-w-[600px] rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
              이 조건에 맞는 초안이 없어요 — 탭이나 클라이언트 필터를 바꿔보세요.
            </p>
          )}

          {view === 'cards' && visibleDrafts.map((d) => (
            <div key={d.id} data-draft-id={d.id}
                 className={`w-full max-w-[600px] ${highlightId === d.id ? 'rounded-2xl ring-2 ring-x-blue' : ''}`}>
              <DraftCard draft={d} banned={bannedFor(d)}
                         onEdit={() => setEditing(d)}
                         onRewrite={(feedback, baseIndex) => rewrite(d.id, feedback, baseIndex)}
                         rewriteBusy={rewritingId === d.id}
                         onDelete={() => requestRemove(d)}
                         onRegenPost={(i) => regenPost(d, i)}
                         regenBusyIndex={regenBusy?.draftId === d.id ? regenBusy.index : null}
                         onDismissFlag={(key, dismiss) => toggleDismiss(d, key, dismiss)}
                         onRestoreAllFlags={() => restoreAllFlags(d)}
                         onChangeStatus={(s) => changeStatus(d, s)}
                         siblingTotal={d.batchId ? siblingCount(drafts, d.batchId) : null} />
            </div>
          ))}
          {view === 'table' && loaded && visibleDrafts.length > 0 && (
            <DraftTable drafts={visibleDrafts} clientNameOf={clientNameOf}
                        onChangeStatus={changeStatus} onOpenCard={openCard} />
          )}
          {/* 가드는 drafts 기준 — 클라이언트 필터가 0건이어도 빈 5열+드롭 안내가 그려져야
              무설명 빈 화면이 되지 않는다(T4 리뷰 발견). 초안 0건은 위의 빈 상태 문구가 담당. */}
          {view === 'kanban' && loaded && drafts.length > 0 && (
            <DraftKanban drafts={clientScoped} clientNameOf={clientNameOf}
                         onChangeStatus={changeStatus} onOpenCard={openCard} />
          )}
          </div>
        </div>
      </div>

      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { setDrafts((cur) => cur.map((d) => (d.id === u.id ? u : d))); setEditing(null); }} />
      )}
      <RefPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} lastWsId={lastWsId}
                      selectedIds={selectedRefIds} seedRows={refRows} onApply={setRefRows} />
      {pendingRemove && <Toast message="초안을 삭제했어요" actionLabel="실행 취소" onAction={undoRemove} />}
      {toast && !pendingRemove && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
