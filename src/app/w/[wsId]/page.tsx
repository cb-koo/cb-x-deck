'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';
import { useToast } from '@/lib/toastContext';
import { useDeckDrag } from '@/lib/useDeckDrag';
import { useTour } from '@/lib/tour/useTour';
import { deckSteps } from '@/lib/tour/tourSteps';
import { hasSeenTour } from '@/lib/tour/tourState';
import { HelpButton } from '@/components/HelpButton';
import { TweetTableView } from '@/components/TweetTableView';

export default function DeckPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') === 'table' ? 'table' : 'cards';
  // 주소에 보기 모드를 남긴다 — 새로고침·북마크·링크 공유로 유지된다
  function setView(next: 'cards' | 'table') {
    // 표→카드로 돌아오면 Column이 다시 마운트된다. newColumnId를 남겨두면 "방금 만든 컬럼"으로
    // 다시 인식돼 유료 새로고침(POST /refresh)이 또 발생한다 — 보기 전환마다 비용이 나가면 안 된다.
    setNewColumnId(null);
    const p = new URLSearchParams(searchParams.toString());
    if (next === 'table') p.set('view', 'table'); else p.delete('view');
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const { show } = useToast();
  const deckRef = useRef<HTMLElement>(null);
  const { start, advance, activeTour } = useTour();
  const prevColCount = useRef(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [columnsError, setColumnsError] = useState(false);
  const didAutoStart = useRef(false);
  const [pendingHelpTour, setPendingHelpTour] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/columns?workspaceId=${wsId}`);
      if (r.ok) { setColumns(await r.json()); setColumnsError(false); }
      else setColumnsError(true);
    } catch {
      setColumnsError(true);
    } finally {
      setLoadedOnce(true);
    }
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  // 덱 첫 방문 시 1회 자동 투어. 최초 로드가 끝난 뒤 실행해야 실제 컬럼 수로 갈래(생성 유도 vs 사용법)를 고른다.
  // (로드 전엔 columns가 항상 []이라 '컬럼 없음' 갈래로 오판됨 — 기존 컬럼이 있는 사용자 배포 시 문제)
  // 표 보기에서는 시작하지 않는다 — 표에는 add-column 앵커 하나뿐이라 2단계짜리 반쪽 투어가 되고,
  // skipMissingElement + onDestroyed가 그걸 "봤다"고 기록해버려 진짜 투어를 영영 못 본다.
  // view를 의존성에 넣어 카드로 돌아왔을 때(아직 못 봤다면) 그때 시작한다.
  useEffect(() => {
    if (!loadedOnce || didAutoStart.current || hasSeenTour('deck') || view === 'table') return;
    didAutoStart.current = true;
    const t = setTimeout(() => start('deck', deckSteps()), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedOnce, view]);

  // 도움말 버튼을 표 보기에서 눌러도 같은 이유로 반쪽 투어가 된다 — 카드로 전환한 뒤(뷰가
  // 실제로 바뀐 걸 확인하고) 투어를 시작한다. setView는 router.replace라 즉시 반영되지 않는다.
  useEffect(() => {
    if (!pendingHelpTour || view !== 'cards') return;
    // setTimeout으로 미룬다 — 카드로 막 바뀐 직후라 Column이 커밋되는 시점과도 겹치고,
    // 이펙트 본문에서 곧장 setState를 부르지 않기 위해서다(다른 자동 투어 이펙트와 같은 방식).
    const t = setTimeout(() => {
      setPendingHelpTour(false);
      start('deck', deckSteps());
    }, 0);
    return () => clearTimeout(t);
  }, [pendingHelpTour, view, start]);

  function openHelp() {
    if (view === 'table') { setPendingHelpTour(true); setView('cards'); }
    else start('deck', deckSteps());
  }

  // 행동 유도형 자동 전진: 모달이 열리면 add-column→create-modal
  useEffect(() => {
    if (activeTour === 'deck' && modal) advance('add-column');
  }, [modal, activeTour, advance]);

  // 컬럼이 새로 생기면 create-modal→col-refresh
  useEffect(() => {
    if (activeTour === 'deck' && columns.length > prevColCount.current) advance('create-modal');
    prevColCount.current = columns.length;
  }, [columns.length, activeTour, advance]);

  const getColumnEl = useCallback(
    (id: string) => deckRef.current?.querySelector<HTMLElement>(`[data-column-id="${id}"]`) ?? null,
    [],
  );

  // 화면은 즉시 확정하고 저장은 뒤에서. 실패해도 드래그 직전 순서로 되돌리지 않는다 —
  // 거부되는 이유는 대개 다른 멤버가 그 사이 바꾼 것이라 그 순서도 이미 낡았다. 서버 것을 다시 받는다.
  const commitOrder = useCallback(async (ids: string[]) => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const next = ids.map((id) => byId.get(id)).filter((c): c is ColumnRow => !!c);
    if (next.length !== ids.length) return;
    setColumns(next);
    try {
      const r = await apiFetch('/api/columns/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, ids }),
      });
      if (!r.ok) {
        show(r.status === 409
          ? '다른 팀원이 컬럼을 바꿔서 순서를 저장하지 못했어요. 최신 상태로 새로 불러왔습니다.'
          : '순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
        await load();
      }
    } catch {
      show('순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
      await load();
    }
  }, [columns, wsId, load, show]);

  const { startDrag, moveByKeyboard } = useDeckDrag({
    columns, containerRef: deckRef, getColumnEl, onCommit: commitOrder,
  });

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await apiFetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { title: v.title, config: v.config } : { ...v, workspaceId: wsId }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    if (!isEdit) setNewColumnId(((await r.json()) as ColumnRow).id);
    await load();
  }

  // 삭제 확인은 Column 헤더의 인라인 확인 바가 담당(Sidebar 워크스페이스 삭제와 동일 패턴). 여기선 확정된 삭제만 수행.
  async function remove(col: ColumnRow) {
    await apiFetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-x-border bg-x-surface px-4 py-2">
        <button onClick={() => setModal({ mode: 'create' })}
                data-tour="add-column"
                className="rounded-full bg-x-text px-4 py-1.5 text-ui font-bold text-white hover:opacity-90">
          + 컬럼
        </button>
        {/* 같은 데이터의 다른 표현 — 카드는 한 건을 깊게, 표는 여러 건을 지표로 비교 */}
        <div className="flex items-center gap-1">
          <span className="text-caption text-x-muted">보기</span>
          {(['cards', 'table'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                    title={v === 'cards' ? 'X와 같은 카드로 봐요' : '지표를 나란히 놓고 비교하거나 노션·엑셀로 빼내요'}
                    className={`rounded-full border px-2.5 py-1 text-ui ${view === v ? 'border-x-text font-bold text-x-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
              {v === 'cards' ? '카드' : '표'}
            </button>
          ))}
        </div>
        <HelpButton onClick={openHelp} />
      </div>
      {view === 'table' ? (
        <TweetTableView wsId={wsId} columns={columns}
                        columnsLoaded={loadedOnce} columnsError={columnsError} onRetryColumns={load} />
      ) : (
      <main ref={deckRef} className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-ui text-x-muted">컬럼이 없습니다 — “+ 컬럼”으로 키워드/인플루언서 컬럼을 만드세요</p>
        )}
        {columns.map((c, i) => (
          <Column key={c.id} column={c}
                  index={i} total={columns.length}
                  tourAnchor={i === 0}
                  isNew={c.id === newColumnId}
                  onEdit={() => setModal({ mode: 'edit', column: c })}
                  onDelete={() => remove(c)}
                  onPickTag={(tag) => setModal({ mode: 'create', presetKeyword: tag })}
                  onGripPointerDown={(e) => startDrag(i, e)}
                  onKeyboardMove={(delta) => moveByKeyboard(i, delta)} />
        ))}
      </main>
      )}
      {modal && (
        <ColumnSettings initial={modal.mode === 'edit' ? modal.column : undefined}
                        presetKeyword={modal.presetKeyword}
                        onSubmit={submit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
