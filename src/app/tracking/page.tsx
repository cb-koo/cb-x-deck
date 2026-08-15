'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { draftLabel } from '@/lib/draftViews';
import { TrackAddForm } from '@/components/TrackAddForm';
import { TrackAddManyDialog } from '@/components/TrackAddManyDialog';
import { TrackingTable, type DraftOption, type DraftsState, type TrackSortKey, type TrackSortDir } from '@/components/TrackingTable';
import { ShowMoreButton } from '@/components/ShowMoreButton';
import { PAGE_STEP } from '@/lib/draftPaging';
import type { TrackedPostRow } from '@/lib/trackingStore';
import type { DraftRow } from '@/lib/draftStore';

const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// addOne의 결과 — 토스트·플래시·입력 보존의 판단은 호출자(addMany)가 한다.
type AddOutcome =
  | { kind: 'added' | 'dup'; row: TrackedPostRow }
  | { kind: 'fail'; msg: string };

export default function TrackingPage() {
  const { show, hide } = useToast();
  const [rows, setRows] = useState<TrackedPostRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAddMany, setShowAddMany] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // 추적 중단은 배치 단위다(한 건 = 크기 1 배치): pendingRemove = 숨김(커밋 완료까지),
  // undoActive = 실행취소 토스트 노출(커밋 시작 전까지). 배치는 한 번에 하나 — 새 요청이 오면 앞 배치를 즉시 커밋.
  const [pendingRemove, setPendingRemove] = useState<ReadonlySet<string>>(new Set());
  const [undoActive, setUndoActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // 정렬은 페이지가 소유한다(DraftTable·TweetTable 관례) — 표는 받은 순서를 그대로 그린다.
  const [sort, setSort] = useState<TrackSortKey>('created');
  const [dir, setDir] = useState<TrackSortDir>('desc');
  const [shownCount, setShownCount] = useState(PAGE_STEP);
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [draftsState, setDraftsState] = useState<DraftsState>('idle');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 대기 중 id들을 ref로 추적(비동기 콜백 재개 시 최신값 참조용) — pendingRemove를 그대로 클로저로 읽으면
  // addOne이 네트워크 응답을 기다리는 동안 배치가 바뀌어도 옛 값을 들고 있게 된다(아래 addOne 참조).
  // 커밋 타이머도 예약 시점의 id 목록이 아니라 발화 시점의 이 ref를 읽는다 — 재등록으로 일부가
  // 철회된 배치에서 철회된 행까지 지우면 안 되기 때문이다.
  const pendingRef = useRef<ReadonlySet<string>>(new Set());

  // setState는 전부 await 뒤에 둔다 — 동기 setState를 앞에 넣으면 set-state-in-effect에 걸린다(influencers 관례)
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/tracking');
      if (!r.ok) throw new Error(String(r.status));
      setRows((await r.json()) as TrackedPostRow[]);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다 (clients·influencers 관례)
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(influencers 관례)
  useEffect(() => { load(); }, [load]);

  // 방금 등록한(또는 이미 추적 중이던) 행으로 데려가 2초 강조한다 — 목록이 길면 어디 들어갔는지 안 보인다
  const flash = useCallback((id: string) => {
    setHighlightId(id);
    // rAF: setRows/setHighlightId는 이미 커밋된 뒤 다음 프레임에 실행되므로 그때 DOM에 행이 있다.
    // 렌더 전에 부르면 getElementById가 null이라 스크롤이 조용히 사라진다.
    requestAnimationFrame(() => {
      document.getElementById(`tracked-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlightId(null), 2000);
  }, []);

  // 등록 한 건 = 첫 측정(서버). created:false는 오류가 아니라 정보다.
  const addOne = useCallback(async (url: string): Promise<AddOutcome> => {
    try {
      const res = await apiFetch('/api/tracking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: boolean; row?: TrackedPostRow; error?: string };
      if (!res.ok || !data.row) {
        return { kind: 'fail', msg: data.error ?? '추적을 시작하지 못했어요 — 잠시 후 다시 시도해 주세요' };
      }
      const row = data.row;
      // 같은 id가 이미 있으면 자리(등록순)를 흔들지 않고 값만 갱신한다 — 맨 위로 끌어올리면 등록순이 거짓이 된다
      setRows((cur) => (cur.some((r) => r.id === row.id)
        ? cur.map((r) => (r.id === row.id ? row : r))
        : [row, ...cur]));
      // 재등록은 취소 의사 표시이므로 예약된 삭제에서 이 행을 철회한다.
      // pendingRemove를 클로저로 그냥 읽지 않는다: addOne이 응답을 기다리는 사이 배치가 바뀔 수 있다 — ref로 최신값을.
      if (pendingRef.current.has(row.id)) {
        const next = new Set(pendingRef.current);
        next.delete(row.id);
        setPendingRemove(next);
        if (next.size === 0) { // 배치가 비면 커밋할 것도 없다 — 타이머·토스트까지 거둔다
          if (removeTimer.current) clearTimeout(removeTimer.current);
          removeTimer.current = null;
          setUndoActive(false);
          hide();
        }
      }
      return { kind: data.created === false ? 'dup' : 'added', row };
    } catch {
      return { kind: 'fail', msg: '추적을 시작하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' };
    }
  }, [hide]);

  // 단건 등록(폼 경로) — 결과를 그 건의 말로 알려주고 그 행을 짚어준다.
  // 여러 건은 TrackAddManyDialog가 addOne을 직접 순차로 부르며 줄마다 결과를 그린다.
  const addSingle = useCallback(async (url: string): Promise<'ok' | 'keep'> => {
    setAdding(true);
    try {
      const r = await addOne(url);
      if (r.kind === 'fail') { show(r.msg); return 'keep'; } // 실패 시 입력 보존
      show(r.kind === 'dup' ? '이미 추적 중이에요' : '추적을 시작했어요 — 지금 지표를 담아뒀어요');
      flash(r.row.id);
      return 'ok';
    } finally {
      setAdding(false);
    }
  }, [addOne, show, flash]);

  // 한 건 새로고침. 실패(502)면 행을 건드리지 않는다 — 못 가져온 것은 게시물의 상태가 아니라 우리 사정이다.
  // quiet: 전체 새로고침은 건마다 토스트를 띄우지 않고 끝나고 한 번 집계한다.
  const refreshOne = useCallback(async (id: string, quiet = false): Promise<boolean> => {
    setRefreshingIds((cur) => new Set(cur).add(id));
    try {
      const res = await apiFetch(`/api/tracking/${id}/refresh`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { row?: TrackedPostRow; error?: string };
      if (!res.ok || !data.row) {
        if (!quiet) show(data.error ?? FETCH_FAILED);
        return false;
      }
      const row = data.row;
      setRows((cur) => cur.map((r) => (r.id === row.id ? row : r)));
      return true;
    } catch {
      if (!quiet) show(FETCH_FAILED);
      return false;
    } finally {
      setRefreshingIds((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
    }
  }, [show]);

  // 전체 새로고침 — 순차 호출(동시 호출은 수집 출처에 부담이고 진행률도 못 보여준다).
  // '볼 수 없음' 행도 포함한다: 다시 보이게 됐다면 그 사실을 알아야 하고, appendSnapshot이 복귀를 수용한다.
  const refreshAll = useCallback(async () => {
    if (bulk) return;
    const targets = rows.filter((r) => !pendingRemove.has(r.id)).map((r) => r.id);
    if (targets.length === 0) return;
    setBulk({ done: 0, total: targets.length });
    let failed = 0;
    for (const id of targets) {
      if (!(await refreshOne(id, true))) failed += 1;
      setBulk((cur) => (cur ? { ...cur, done: cur.done + 1 } : cur));
    }
    setBulk(null);
    // 숫자만 던지지 않는다 — 몇 건이 왜 비었는지, 다음에 무엇을 하면 되는지까지 말한다(UX 원칙 3)
    show(failed === 0
      ? `${targets.length}건 모두 지표를 새로 가져왔어요`
      : `${targets.length}건 중 ${failed}건은 지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요`);
  }, [bulk, rows, pendingRemove, refreshOne, show]);

  // 배치 커밋: 발화 시점의 pendingRef를 지운다 — 예약 시점 목록을 쓰면 그 사이 재등록으로
  // 철회된 행까지 지운다(위 pendingRef 주석). 순차 DELETE 후 서버 상태로 다시 맞춘다 —
  // 일부가 실패했다면 그 행이 되돌아와야 정직하다.
  const commitRemove = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      await apiFetch(`/api/tracking/${id}`, { method: 'DELETE' });
    }
    await load();
    setPendingRemove((cur) => {
      const next = new Set(cur);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, [load]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = null;
    setUndoActive(false);
    hide();
    setPendingRemove(new Set()); // 행 복원, 아무것도 삭제 안 함
  }, [hide]);

  // 토스트 노출 ⟺ undoActive 를 유지한다. undoActive가 바뀌는 지점마다 show/hide를 짝지어 부른다
  // (effect로 배선하면 react-hooks/set-state-in-effect 위반).
  // 여러 건은 확인을 먼저 받는다 — 5초 실행취소만으로는 "어? 방금 뭐였지"를 알아차리기에 짧다는
  // 원고 표의 실사용 피드백(2026-08-13)을 그대로 따른다. 한 건은 기존대로 실행취소만.
  const requestRemove = useCallback((rowsToRemove: TrackedPostRow[]) => {
    if (rowsToRemove.length === 0) return;
    if (rowsToRemove.length > 1 &&
        !window.confirm(`고른 게시물 ${rowsToRemove.length}건의 추적을 중단할까요?\n\n중단 후 5초 안에는 실행 취소할 수 있어요. 쌓인 측정 기록도 함께 지워져요.`)) return;
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (undoActive && pendingRef.current.size > 0) void commitRemove([...pendingRef.current]); // 대기 중 앞 배치는 즉시 커밋
    const ids = new Set(rowsToRemove.map((r) => r.id));
    setPendingRemove(ids);
    setUndoActive(true);
    setSelectedIds(new Set()); // 지운 것을 고른 채로 두지 않는다 (원고 표와 같은 규칙)
    if (pickerFor !== null && ids.has(pickerFor)) setPickerFor(null);
    // duration:null = 자동 소멸 없음, dismissible:false = ✕ 없음.
    // 5초 뒤 삭제가 커밋되므로 토스트가 먼저 사라지거나 사용자가 닫아 실행취소 기회를 잃으면 안 된다.
    show(rowsToRemove.length === 1
      ? '추적을 중단했어요 — 쌓인 측정 기록도 함께 지워져요'
      : `${rowsToRemove.length}건 추적을 중단했어요 — 쌓인 측정 기록도 함께 지워져요`, {
      actionLabel: '실행취소', onAction: undoRemove, duration: null, dismissible: false,
    });
    removeTimer.current = setTimeout(() => {
      setUndoActive(false); // 실행취소 불가 시점 → 토스트 내림
      hide();
      void commitRemove([...pendingRef.current]);
    }, 5000);
  }, [undoActive, commitRemove, pickerFor, show, hide, undoRemove]);

  // pendingRef 최신화: pendingRemove가 바뀔 때마다 ref에 반영한다.
  // (언마운트 cleanup은 이 ref를 deps 없이 참조해야 한다 — pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋된다. library/page.tsx와 동일 이유.)
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    hide();   // 프로바이더는 레이아웃에 있어 페이지를 떠나도 살아있다 — 지속 토스트를 남기지 않는다
    pendingRef.current.forEach((id) => { void apiFetch(`/api/tracking/${id}`, { method: 'DELETE' }); });
  }, [hide]);

  // 원고 목록은 연결 UI를 처음 열 때만 받아온다(비용 없는 조회지만 표 진입마다 전량 받을 이유는 없다).
  const loadDrafts = useCallback(async () => {
    setDraftsState('loading');
    try {
      const r = await apiFetch('/api/drafts');
      if (!r.ok) throw new Error(String(r.status));
      const list = (await r.json()) as DraftRow[];
      // 라벨은 원고 화면과 같은 폴백 체인을 쓴다 — 표와 목록이 같은 원고를 다르게 부르면 안 된다
      setDrafts(list.map((d) => ({
        id: d.id, label: draftLabel(d).text,
        createdAt: d.createdAt, influencerHandle: d.influencerHandle,
      })));
      setDraftsState('ready');
    } catch {
      setDraftsState('error');
    }
  }, []);

  const openPicker = useCallback((id: string | null) => {
    setPickerFor(id);
    // 이미 받았거나 받는 중이면 다시 부르지 않는다 — 행마다 열 때 목록을 새로 받을 이유가 없다
    if (id !== null && draftsState !== 'ready' && draftsState !== 'loading') void loadDrafts();
  }, [draftsState, loadDrafts]);

  const linkDraft = useCallback(async (row: TrackedPostRow, draftId: string | null) => {
    setPickerFor(null);
    try {
      const res = await apiFetch(`/api/tracking/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId }),
      });
      const data = (await res.json().catch(() => ({}))) as { row?: TrackedPostRow; error?: string };
      if (!res.ok || !data.row) {
        show(data.error ?? '원고를 연결하지 못했어요 — 잠시 후 다시 시도해 주세요');
        return;
      }
      const next = data.row;
      setRows((cur) => cur.map((r) => (r.id === next.id ? next : r)));
      show(draftId === null ? '원고 연결을 해제했어요' : `원고를 연결했어요 — ${next.draftLabel ?? '제목 없는 원고'}`);
    } catch {
      show('원고를 연결하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    }
  }, [show]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onSort = useCallback((k: TrackSortKey) => {
    setSort((cur) => {
      if (cur === k) { setDir((d) => (d === 'desc' ? 'asc' : 'desc')); return cur; }
      setDir('desc'); // 새 기준은 큰 값부터 — 지표·시각 모두 "많은/최근 것"이 먼저 궁금하다
      return k;
    });
  }, []);

  const visible = rows.filter((r) => !pendingRemove.has(r.id));
  const sorted = useMemo(() => {
    const val = (r: TrackedPostRow): string | number | null => {
      if (sort === 'created') return r.createdAt;
      if (sort === 'posted') return r.postedAt;
      if (sort === 'captured') return r.capturedAt;
      return r.metrics?.[sort] ?? null;
    };
    return [...visible].sort((a, b) => {
      const va = val(a), vb = val(b);
      // 값이 없는 행은 방향과 무관하게 맨 뒤 — '모름'이 0이나 최신처럼 끼어들면 순서가 거짓말이 된다
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      // 시각은 ISO 문자열이라 사전순 = 시간순
      const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
      return dir === 'desc' ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visible은 rows·pendingRemove의 파생값
  }, [rows, pendingRemove, sort, dir]);
  const shown = useMemo(() => sorted.slice(0, shownCount), [sorted, shownCount]);

  // 선택의 '보이는 것'은 실제로 그려진 것이다 — 절단 밖·숨김 행이 카운트·삭제에 끼면 안 된다(generate 관례)
  const selectedVisible = shown.filter((r) => selectedIds.has(r.id));
  const allSelected = shown.length > 0 && selectedVisible.length === shown.length;

  const toggleAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(shown.map((r) => r.id)));
  }, [allSelected, shown]);

  return (
    // 1600: 데이터 표는 폭이 정보 용량이라 읽기 폭(1100)보다 넓게 — 단 무제한 전폭은 초광폭에서
    // 행 추적(왼쪽 게시물 ↔ 오른쪽 동작)이 무너지므로 상한은 남긴다(koo 결정 08-15).
    // 등록 폼은 자체 캡(520px)이 있어 같이 넓어지지 않는다.
    <main className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-1 flex items-baseline gap-2">
        <h1 className="text-[20px] font-bold">트래킹</h1>
        {loaded && !loadErr && visible.length > 0 && (
          <span className="text-ui text-x-muted">{visible.length}건</span>
        )}
      </div>
      <p className="mb-4 text-caption text-x-muted">
        게시된 게시물의 반응을 모아 보는 곳이에요. 지표는 새로고침을 누른 순간에만 다시 가져와요(자동 수집 없음).
      </p>

      <div className="mb-5 rounded-xl border border-x-border p-3">
        <TrackAddForm busy={adding} onSubmit={addSingle} onOpenMany={() => setShowAddMany(true)} />
      </div>
      {showAddMany && (
        <TrackAddManyDialog onClose={() => setShowAddMany(false)} onAddOne={addOne} />
      )}

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">추적 목록을 불러오지 못했습니다</p>
          <Button onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && visible.length === 0 && (
        <p className="py-8 text-center text-ui text-x-secondary">
          전달한 원고가 게시되면, 게시물 링크를 등록해 반응을 추적하세요. 링크는 X의 공유 → 링크 복사로 얻을 수 있어요.
        </p>
      )}

      {loaded && !loadErr && visible.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-end">
            {/* 비용 유발 액션은 버튼에 값을 적어 opt-in으로 둔다(UX 원칙 6) — 몇 건이면 몇 번 호출인지 라벨이 말한다 */}
            <Button onClick={() => void refreshAll()} disabled={bulk !== null} className="whitespace-nowrap"
                    aria-live="polite">
              {bulk
                ? `새로고침 중… ${bulk.done}/${bulk.total}`
                : `전체 새로고침 (${visible.length}건 — API 호출 ${visible.length}회)`}
            </Button>
          </div>
          <TrackingTable rows={shown} highlightId={highlightId} refreshingIds={refreshingIds}
                         selectedIds={selectedIds} onToggleSelect={toggleSelect}
                         allSelected={allSelected} onToggleAll={toggleAll}
                         sort={sort} dir={dir} onSort={onSort}
                         drafts={drafts} draftsState={draftsState} onLoadDrafts={() => void loadDrafts()}
                         pickerFor={pickerFor} onOpenPicker={openPicker}
                         onLinkDraft={(row, draftId) => void linkDraft(row, draftId)}
                         onRefresh={(row) => void refreshOne(row.id)} onRemove={(row) => requestRemove([row])} />
          {/* '더 보기'는 표 스크롤 컨테이너 밖 — 표를 끝까지 내리지 않아도 잘렸다는 사실이 보인다(TweetTableView 관례) */}
          <ShowMoreButton total={sorted.length} shown={shown.length}
                          onMore={() => setShownCount((n) => n + PAGE_STEP)} />
          {/* 여러 건을 고르면 뜨는 바 — 결과를 내려가 고른 뒤 액션을 찾아 되올라오지 않게 하단 sticky(BulkActionBar 규격) */}
          {selectedVisible.length > 0 && (
            <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-3 border-t border-x-border bg-white px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
              <span className="text-ui font-bold">{selectedVisible.length}개 선택됨</span>
              <Button onClick={() => requestRemove(selectedVisible)} className="whitespace-nowrap"
                      title="고른 게시물을 목록에서 빼고 쌓인 측정 기록도 지워요">
                추적 중단 ({selectedVisible.length}건)
              </Button>
              <button onClick={() => setSelectedIds(new Set())}
                      className="text-ui text-x-muted hover:text-x-secondary">
                선택 해제
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
