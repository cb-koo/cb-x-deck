'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';

export default function DeckPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);
  const [autoRefreshId, setAutoRefreshId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns?workspaceId=${wsId}`);
    if (r.ok) setColumns(await r.json());
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await fetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
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
    await fetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-x-border px-4 py-2">
        <button onClick={() => setModal({ mode: 'create' })}
                className="rounded-full bg-x-text px-4 py-1.5 text-sm font-bold text-white hover:opacity-90">
          + 컬럼
        </button>
      </div>
      <main className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-sm text-x-muted">컬럼이 없습니다 — “+ 컬럼”으로 검색/워치리스트 컬럼을 만드세요</p>
        )}
        {columns.map((c) => (
          <Column key={c.id} column={c}
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
