'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { KwPair } from '@/lib/suggest';
import type { ExaResult } from '@/lib/exa';
import { formatDate } from '@/lib/format';

interface Extraction { keywords: KwPair[]; hooks: KwPair[] }
const chipKey = (k: KwPair) => k.ja;
const chipLabel = (k: KwPair) => (k.ko && k.ko !== k.ja ? `${k.ja} (${k.ko})` : k.ja);

export default function ResearchPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [results, setResults] = useState<ExaResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extractions, setExtractions] = useState<Record<string, Extraction | 'loading'>>({});
  const [selected, setSelected] = useState<KwPair[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdColumn, setCreatedColumn] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    setCreatedColumn(null);
    try {
      const res = await apiFetch('/api/research/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? `검색 실패 (${res.status})`); return; }
      setApplied(body.applied);
      setResults(body.results);
      setExtractions({});
      setSelected([]);
    } finally { setSearching(false); }
  }

  async function extract(r: ExaResult) {
    setExtractions((m) => ({ ...m, [r.url]: 'loading' }));
    const res = await apiFetch('/api/research/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: r.title ?? '', text: r.text }),
    });
    if (!res.ok) {
      setExtractions((m) => { const { [r.url]: _drop, ...rest } = m; return rest; });
      setError('키워드 추출 실패 — 다시 시도하세요');
      return;
    }
    const ex = await res.json() as Extraction;
    setExtractions((m) => ({ ...m, [r.url]: ex }));
  }

  function toggle(k: KwPair) {
    setSelected((s) => (s.some((x) => chipKey(x) === chipKey(k)) ? s.filter((x) => chipKey(x) !== chipKey(k)) : [...s, k]));
  }

  async function createColumn() {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const title = selected.map(chipLabel).join('·');
      const res = await apiFetch('/api/columns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: wsId, kind: 'search', title,
          config: { keywords: selected.map((k) => k.ja), minFaves: 300, minViews: null, sinceDate: null,
                    untilDate: null, lang: 'ja', imagesOnly: true, maxPages: 3, sort: 'views', width: null },
        }),
      });
      if (!res.ok) { setError('컬럼 생성 실패'); return; }
      setCreatedColumn(title);
      setSelected([]);
    } finally { setCreating(false); }
  }

  const isSelected = (k: KwPair) => selected.some((x) => chipKey(x) === chipKey(k));
  const chip = (k: KwPair, kind: 'keyword' | 'hook') => (
    <button key={`${kind}-${chipKey(k)}`} onClick={() => toggle(k)}
            className={`rounded-full border px-2 py-0.5 text-xs ${isSelected(k)
              ? 'border-blue-500 bg-blue-50 font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300'
              : 'border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}>
      {kind === 'hook' && '🪝 '}{chipLabel(k)}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto pb-24">
      <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h1 className="font-bold">🔍 리서치 <span className="text-sm font-normal text-gray-400">웹 기사에서 덱 키워드 발굴 (exa)</span></h1>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) search(); }}
               placeholder="주제·브랜드·시술 등 (한국어면 일본어로 변환해 검색)"
               className="w-full max-w-xl rounded border border-gray-300 bg-transparent px-3 py-1.5 text-sm dark:border-gray-700" />
        <button onClick={search} disabled={searching || !query.trim()}
                className="shrink-0 rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">
          {searching ? '검색 중…' : '검색'}
        </button>
      </div>
      {applied && applied !== query.trim() && (
        <p className="px-4 text-xs text-gray-400">적용된 질의: {applied}</p>
      )}
      {error && <p className="px-4 py-1 text-sm text-red-500">{error}</p>}

      <main className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
        {results.map((r) => {
          const ex = extractions[r.url];
          return (
            <div key={r.url} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline">
                    {r.title ?? r.url}
                  </a>
                  <p className="text-[11px] text-gray-400">{new URL(r.url).hostname} · {formatDate(r.publishedDate)}</p>
                </div>
                <button onClick={() => extract(r)} disabled={ex === 'loading'}
                        className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900">
                  {ex === 'loading' ? '추출 중…' : ex ? '다시 추출' : '키워드 추출'}
                </button>
              </div>
              <p className="mt-1 line-clamp-3 text-sm text-gray-500">{r.text}</p>
              {ex && ex !== 'loading' && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {ex.keywords.map((k) => chip(k, 'keyword'))}
                  {ex.hooks.map((k) => chip(k, 'hook'))}
                  {ex.keywords.length === 0 && ex.hooks.length === 0 && <span className="text-xs text-gray-400">추출된 키워드 없음</span>}
                </div>
              )}
            </div>
          );
        })}
        {!searching && results.length === 0 && !error && (
          <p className="text-sm text-gray-400">주제를 검색하면 일본어 웹 기사에서 덱 검색용 키워드·훅을 발굴합니다</p>
        )}
      </main>

      {(selected.length > 0 || createdColumn) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-gray-400">선택 {selected.length}개</span>
              {selected.map((k) => chip(k, 'keyword'))}
              <button onClick={createColumn} disabled={creating}
                      className="ml-2 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40">
                {creating ? '생성 중…' : '컬럼 만들기'}
              </button>
            </div>
          )}
          {createdColumn && (
            <p className="mt-1 text-sm text-green-600 dark:text-green-400">
              ✓ 컬럼 생성됨: {createdColumn} — <Link href={`/w/${wsId}`} className="underline">덱에서 보기</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
