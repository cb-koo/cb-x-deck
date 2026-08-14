'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { draftLabel } from '@/lib/draftViews';
import { TrackAddForm } from '@/components/TrackAddForm';
import { TrackingTable, type DraftOption, type DraftsState } from '@/components/TrackingTable';
import type { TrackedPostRow } from '@/lib/trackingStore';
import type { DraftRow } from '@/lib/draftStore';

const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

export default function TrackingPage() {
  const { show, hide } = useToast();
  const [rows, setRows] = useState<TrackedPostRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null); // 목록에서 숨김(커밋 완료까지)
  const [undoId, setUndoId] = useState<string | null>(null);               // 실행취소 토스트 노출(커밋 시작 전까지)
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [draftsState, setDraftsState] = useState<DraftsState>('idle');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 등록 = 첫 측정(서버). created:false는 오류가 아니라 정보라 입력을 비우고 그 행을 짚어준다.
  const addTracked = useCallback(async (url: string): Promise<'ok' | 'keep'> => {
    setAdding(true);
    try {
      const res = await apiFetch('/api/tracking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: boolean; row?: TrackedPostRow; error?: string };
      if (!res.ok || !data.row) {
        show(data.error ?? '추적을 시작하지 못했어요 — 잠시 후 다시 시도해 주세요'); // 실패 시 입력 보존
        return 'keep';
      }
      const row = data.row;
      // 같은 id가 이미 있으면 자리(등록순)를 흔들지 않고 값만 갱신한다 — 맨 위로 끌어올리면 등록순이 거짓이 된다
      setRows((cur) => (cur.some((r) => r.id === row.id)
        ? cur.map((r) => (r.id === row.id ? row : r))
        : [row, ...cur]));
      if (pendingRemove === row.id) setPendingRemove(null); // 중단 대기 중이던 게시물을 다시 등록 — 숨김 해제
      show(data.created === false ? '이미 추적 중이에요' : '추적을 시작했어요 — 지금 지표를 담아뒀어요');
      flash(row.id);
      return 'ok';
    } catch {
      show('추적을 시작하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
      return 'keep';
    } finally {
      setAdding(false);
    }
  }, [show, flash, pendingRemove]);

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
    const targets = rows.filter((r) => r.id !== pendingRemove).map((r) => r.id);
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

  // 추적 중단: 즉시 DELETE하지 않고 낙관적으로 숨긴 뒤 ~5초 실행취소 토스트.
  // pendingRemove=목록 숨김(커밋 완료까지), undoId=토스트/실행취소(커밋 시작 전까지).
  // 토스트는 DELETE 시작 순간 내린다 — 삭제가 이미 나간 뒤 실행취소를 눌러 측정 기록이 소실되는 레이스 방지.
  const commitRemove = useCallback(async (id: string) => {
    await apiFetch(`/api/tracking/${id}`, { method: 'DELETE' });
    await load(); // 서버 상태로 다시 맞춘다 — 삭제가 실패했다면 행이 되돌아와야 정직하다
    setPendingRemove((cur) => (cur === id ? null : cur));
  }, [load]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setUndoId(null);
    hide();
    setPendingRemove(null); // 행 복원, 아무것도 삭제 안 함
  }, [hide]);

  // 토스트 노출 ⟺ undoId !== null 을 유지한다. undoId가 바뀌는 지점마다 show/hide를 짝지어 부른다
  // (effect로 배선하면 react-hooks/set-state-in-effect 위반).
  const requestRemove = useCallback((row: TrackedPostRow) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (undoId && undoId !== row.id) void commitRemove(undoId); // 대기 중 다른 건 즉시 커밋
    setPendingRemove(row.id);
    setUndoId(row.id);
    if (pickerFor === row.id) setPickerFor(null);
    // duration:null = 자동 소멸 없음, dismissible:false = ✕ 없음.
    // 5초 뒤 삭제가 커밋되므로 토스트가 먼저 사라지거나 사용자가 닫아 실행취소 기회를 잃으면 안 된다.
    show('추적을 중단했어요 — 쌓인 측정 기록도 함께 지워져요', {
      actionLabel: '실행취소', onAction: undoRemove, duration: null, dismissible: false,
    });
    removeTimer.current = setTimeout(() => {
      setUndoId((cur) => (cur === row.id ? null : cur)); // 실행취소 불가 시점 → 토스트 내림
      hide();
      void commitRemove(row.id);
    }, 5000);
  }, [undoId, commitRemove, pickerFor, show, hide, undoRemove]);

  // 대기 중 id를 ref로 추적(언마운트 시 최신값 참조용) — pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋된다(library/page.tsx와 동일 이유).
  const pendingRef = useRef<string | null>(null);
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    hide();   // 프로바이더는 레이아웃에 있어 페이지를 떠나도 살아있다 — 지속 토스트를 남기지 않는다
    if (pendingRef.current) void apiFetch(`/api/tracking/${pendingRef.current}`, { method: 'DELETE' });
  }, [hide]);

  // 원고 목록은 연결 UI를 처음 열 때만 받아온다(비용 없는 조회지만 표 진입마다 전량 받을 이유는 없다).
  const loadDrafts = useCallback(async () => {
    setDraftsState('loading');
    try {
      const r = await apiFetch('/api/drafts');
      if (!r.ok) throw new Error(String(r.status));
      const list = (await r.json()) as DraftRow[];
      // 라벨은 원고 화면과 같은 폴백 체인을 쓴다 — 표와 목록이 같은 원고를 다르게 부르면 안 된다
      setDrafts(list.map((d) => ({ id: d.id, label: draftLabel(d).text })));
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

  const visible = rows.filter((r) => r.id !== pendingRemove);

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
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
        <TrackAddForm busy={adding} onSubmit={addTracked} />
      </div>

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
          <TrackingTable rows={visible} highlightId={highlightId} refreshingIds={refreshingIds}
                         drafts={drafts} draftsState={draftsState} onLoadDrafts={() => void loadDrafts()}
                         pickerFor={pickerFor} onOpenPicker={openPicker}
                         onLinkDraft={(row, draftId) => void linkDraft(row, draftId)}
                         onRefresh={(row) => void refreshOne(row.id)} onRemove={requestRemove} />
        </>
      )}
    </main>
  );
}
