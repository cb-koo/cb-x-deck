'use client';
import { useState } from 'react';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';

export interface ColumnSettingsProps {
  initial?: ColumnRow;                        // 없으면 신규 생성
  presetKeyword?: string;                     // 공출현 클릭으로 열릴 때
  onSubmit: (v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) => Promise<void>;
  onClose: () => void;
}

export function ColumnSettings({ initial, presetKeyword, onSubmit, onClose }: ColumnSettingsProps) {
  const isSearch = (initial?.kind ?? 'search') === 'search';
  const [kind, setKind] = useState<ColumnKind>(initial?.kind ?? 'search');
  const init = (initial?.config ?? {}) as Partial<SearchConfig & WatchlistConfig>;
  const [keywords, setKeywords] = useState<string[]>(init.keywords ?? (presetKeyword ? [presetKeyword] : []));
  const [kwInput, setKwInput] = useState('');
  const [handle, setHandle] = useState(init.handle ?? '');
  const [minFaves, setMinFaves] = useState(init.minFaves ?? 300);
  const [minViews, setMinViews] = useState(init.minViews ?? null);
  const [sinceDate, setSinceDate] = useState(init.sinceDate ?? '');
  const [untilDate, setUntilDate] = useState(init.untilDate ?? '');
  const [lang, setLang] = useState(init.lang ?? 'ja');
  const [imagesOnly, setImagesOnly] = useState(init.imagesOnly !== false);
  const [maxPages, setMaxPages] = useState(init.maxPages ?? 3);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [sug, setSug] = useState<{ variants: string[]; adjacent: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const addKw = (k: string) => { const t = k.trim(); if (t && !keywords.includes(t)) setKeywords([...keywords, t]); };

  async function suggest() {
    const base = kwInput.trim() || keywords[keywords.length - 1];
    if (!base) return;
    setBusy(true);
    const r = await fetch('/api/suggest-keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: base }) });
    setSug(r.ok ? await r.json() : { variants: [], adjacent: [] });
    setBusy(false);
  }

  async function submit() {
    setErr('');
    try {
      if (kind === 'search') {
        if (keywords.length === 0 && kwInput.trim()) addKw(kwInput);
        const kws = kwInput.trim() && !keywords.includes(kwInput.trim()) ? [...keywords, kwInput.trim()] : keywords;
        if (kws.length === 0) { setErr('키워드를 입력하세요'); return; }
        await onSubmit({
          kind, title: title || kws.join('·'),
          config: { keywords: kws, minFaves: minFaves || null, minViews: minViews || null,
                    sinceDate: sinceDate || null, untilDate: untilDate || null, lang: lang || null,
                    imagesOnly, maxPages: maxPages || 3, sort: init.sort ?? 'views' },
        });
      } else {
        if (!handle.trim()) { setErr('계정 핸들을 입력하세요'); return; }
        await onSubmit({ kind, title: title || `@${handle.replace(/^@/, '')}`,
          config: { handle: handle.replace(/^@/, ''), userId: init.userId ?? '', maxPages: maxPages || 3, sort: init.sort ?? 'views' } });
      }
      onClose();
    } catch (e) { setErr((e as Error).message); }
  }

  const chip = 'rounded-full border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800';
  const input = 'w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[90vh] w-[380px] overflow-y-auto rounded-xl bg-white p-4 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-bold">{initial ? '컬럼 설정' : '새 컬럼'}</h2>
        {!initial && (
          <div className="mb-3 flex gap-2">
            {(['search', 'watchlist'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                      className={`${chip} ${kind === k ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : ''}`}>
                {k === 'search' ? '검색' : '워치리스트'}
              </button>
            ))}
          </div>
        )}
        <label className="mb-2 block text-xs text-gray-500">컬럼 이름 (비우면 자동)
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></label>

        {kind === 'search' ? (
          <>
            <label className="mb-1 block text-xs text-gray-500">키워드 (OR 조합)</label>
            <div className="mb-1 flex flex-wrap gap-1">
              {keywords.map((k) => (
                <button key={k} className={chip} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>{k} ✕</button>
              ))}
            </div>
            <div className="mb-2 flex gap-1">
              <input className={input} value={kwInput} placeholder="키워드 입력 후 Enter"
                     onChange={(e) => setKwInput(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { addKw(kwInput); setKwInput(''); } }} />
              <button onClick={suggest} disabled={busy} className={chip}>{busy ? '…' : '연관 제안'}</button>
            </div>
            {sug && (sug.variants.length + sug.adjacent.length > 0) && (
              <div className="mb-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-600">
                <p className="mb-1 text-[11px] text-gray-500">표기 변형</p>
                <div className="mb-1 flex flex-wrap gap-1">{sug.variants.map((k) => <button key={k} className={chip} onClick={() => addKw(k)}>+ {k}</button>)}</div>
                <p className="mb-1 text-[11px] text-gray-500">인접 개념</p>
                <div className="flex flex-wrap gap-1">{sug.adjacent.map((k) => <button key={k} className={chip} onClick={() => addKw(k)}>+ {k}</button>)}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">최소 좋아요<input type="number" className={input} value={minFaves ?? ''} onChange={(e) => setMinFaves(e.target.value ? +e.target.value : 0)} /></label>
              <label className="block text-xs text-gray-500">최소 조회수(재필터)<input type="number" className={input} value={minViews ?? ''} onChange={(e) => setMinViews(e.target.value ? +e.target.value : null)} /></label>
              <label className="block text-xs text-gray-500">since<input type="date" className={input} value={sinceDate ?? ''} onChange={(e) => setSinceDate(e.target.value)} /></label>
              <label className="block text-xs text-gray-500">until<input type="date" className={input} value={untilDate ?? ''} onChange={(e) => setUntilDate(e.target.value)} /></label>
              <label className="block text-xs text-gray-500">언어<input className={input} value={lang ?? ''} onChange={(e) => setLang(e.target.value)} /></label>
              <label className="block text-xs text-gray-500">페이지 상한<input type="number" className={input} value={maxPages ?? 3} onChange={(e) => setMaxPages(+e.target.value || 3)} /></label>
            </div>
            <label className="mt-2 flex items-center gap-1 text-xs text-gray-500">
              <input type="checkbox" checked={imagesOnly} onChange={(e) => setImagesOnly(e.target.checked)} /> 이미지 있는 트윗만
            </label>
          </>
        ) : (
          <>
            <label className="mb-2 block text-xs text-gray-500">계정 핸들
              <input className={input} value={handle} placeholder="@hadakan__" onChange={(e) => setHandle(e.target.value)} /></label>
            <label className="block text-xs text-gray-500">페이지 상한
              <input type="number" className={input} value={maxPages ?? 3} onChange={(e) => setMaxPages(+e.target.value || 3)} /></label>
          </>
        )}

        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={chip}>취소</button>
          <button onClick={submit} className={`${chip} bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900`}>{initial ? '저장' : '만들기'}</button>
        </div>
      </div>
    </div>
  );
}
