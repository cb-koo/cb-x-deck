'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CandidateRow } from '@/lib/types';
import { CandidateCard } from '@/components/CandidateCard';

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const load = useCallback(async (tag: string | null) => {
    const [cr, tr] = await Promise.all([
      fetch(tag ? `/api/candidates?workspaceId=${wsId}&tag=${encodeURIComponent(tag)}` : `/api/candidates?workspaceId=${wsId}`),
      fetch(`/api/tags?workspaceId=${wsId}`),
    ]);
    if (cr.ok) setCandidates(await cr.json());
    if (tr.ok) setTags(await tr.json());
  }, [wsId]);
  useEffect(() => { load(activeTag); }, [load, activeTag]);

  const chip = 'rounded-full border px-2 py-0.5 text-xs';
  return (
    <div className="h-full overflow-y-auto">
      <nav className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h1 className="font-bold">📁 보관함 <span className="text-sm font-normal text-gray-400">{candidates.length}건</span></h1>
      </nav>
      <div className="flex flex-wrap gap-1 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <button onClick={() => setActiveTag(null)}
                className={`${chip} ${activeTag === null ? 'border-gray-900 font-bold dark:border-gray-100' : 'border-gray-300 text-gray-500 dark:border-gray-700'}`}>전체</button>
        {tags.filter((t) => t.count > 0).map((t) => (
          <button key={t.id} onClick={() => setActiveTag(t.name)}
                  className={`${chip} ${activeTag === t.name ? 'border-gray-900 font-bold dark:border-gray-100' : 'border-gray-300 text-gray-500 dark:border-gray-700'}`}>
            #{t.name} {t.count}
          </button>
        ))}
      </div>
      <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {candidates.length === 0 && <p className="text-sm text-gray-400">저장된 후보가 없습니다 — 덱에서 ☆저장을 누르세요</p>}
        {candidates.map((c) => <CandidateCard key={c.id} c={c} onChanged={() => load(activeTag)} />)}
      </main>
    </div>
  );
}
