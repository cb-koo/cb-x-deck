'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';
import { useTour } from '@/lib/tour/useTour';
import { deckSteps } from '@/lib/tour/tourSteps';
import { hasSeenTour } from '@/lib/tour/tourState';
import { HelpButton } from '@/components/HelpButton';

export default function DeckPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);
  const [autoRefreshId, setAutoRefreshId] = useState<string | null>(null);
  const { start, advance, activeTour } = useTour();
  const prevColCount = useRef(0);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/columns?workspaceId=${wsId}`);
    if (r.ok) setColumns(await r.json());
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  // 덱 첫 방문 시 1회 자동 투어 (렌더 안정화 후). 첫 사용자는 컬럼 0개라 생성 유도 갈래로 진입.
  useEffect(() => {
    if (hasSeenTour('deck')) return;
    const t = setTimeout(() => start('deck', deckSteps(columns.length > 0)), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 행동 유도형 자동 전진: 모달이 열리면 add-column→create-modal
  useEffect(() => {
    if (activeTour === 'deck' && modal) advance('add-column');
  }, [modal, activeTour, advance]);

  // 컬럼이 새로 생기면 create-modal→col-refresh
  useEffect(() => {
    if (activeTour === 'deck' && columns.length > prevColCount.current) advance('create-modal');
    prevColCount.current = columns.length;
  }, [columns.length, activeTour, advance]);

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await apiFetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { title: v.title, config: v.config } : { ...v, workspaceId: wsId }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    if (!isEdit) setAutoRefreshId(((await r.json()) as ColumnRow).id);
    await load();
  }

  async function remove(col: ColumnRow) {
    if (!confirm(`컬럼 "${col.title}" 삭제? (보관함의 후보는 유지됩니다)`)) return;
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
        <HelpButton onClick={() => start('deck', deckSteps(columns.length > 0))} />
      </div>
      <main className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-ui text-x-muted">컬럼이 없습니다 — “+ 컬럼”으로 키워드/인플루언서 컬럼을 만드세요</p>
        )}
        {columns.map((c, i) => (
          <Column key={c.id} column={c}
                  tourAnchor={i === 0}
                  autoRefresh={c.id === autoRefreshId}
                  onEdit={() => setModal({ mode: 'edit', column: c })}
                  onDelete={() => remove(c)}
                  onPickTag={(tag) => setModal({ mode: 'create', presetKeyword: tag })} />
        ))}
      </main>
      {modal && (
        <ColumnSettings initial={modal.mode === 'edit' ? modal.column : undefined}
                        presetKeyword={modal.presetKeyword}
                        onSubmit={submit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
