'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';

export default function DeckPage() {
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/columns');
    if (r.ok) setColumns(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await fetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { title: v.title, config: v.config } : v),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    await load();
  }

  async function remove(col: ColumnRow) {
    if (!confirm(`컬럼 "${col.title}" 삭제? (보관함의 후보는 유지됩니다)`)) return;
    await fetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-screen flex-col">
      <nav className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h1 className="font-bold">cb-x-deck</h1>
        <button onClick={() => setModal({ mode: 'create' })}
                className="rounded-full border border-gray-300 px-3 py-0.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
          + 컬럼
        </button>
        <a href="/library" className="ml-auto text-sm text-gray-500 hover:underline">📁 보관함</a>
      </nav>
      <main className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-sm text-gray-400">컬럼이 없습니다 — “+ 컬럼”으로 검색/워치리스트 컬럼을 만드세요</p>
        )}
        {columns.map((c) => (
          <Column key={c.id} column={c}
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
