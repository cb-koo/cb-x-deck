'use client';
import { useState } from 'react';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import type { KwPair } from '@/lib/suggest';

export interface ColumnSettingsProps {
  initial?: ColumnRow;                        // 없으면 신규 생성
  presetKeyword?: string;                     // 공출현 클릭으로 열릴 때
  onSubmit: (v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) => Promise<void>;
  onClose: () => void;
}

interface KwChip { ja: string; ko: string | null }

const hasHangul = (s: string) => /[가-힣]/.test(s);
const chipLabel = (k: KwChip) => (k.ko ? `${k.ja} (${k.ko})` : k.ja);

export function ColumnSettings({ initial, presetKeyword, onSubmit, onClose }: ColumnSettingsProps) {
  const [kind, setKind] = useState<ColumnKind>(initial?.kind ?? 'search');
  const init = (initial?.config ?? {}) as Partial<SearchConfig & WatchlistConfig>;
  const [keywords, setKeywords] = useState<KwChip[]>(
    (init.keywords ?? (presetKeyword ? [presetKeyword] : [])).map((k) => ({ ja: k, ko: null })));
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
  const [sug, setSug] = useState<{ variants: KwPair[]; adjacent: KwPair[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [err, setErr] = useState('');

  const addChip = (c: KwChip) => {
    const t = c.ja.trim();
    if (!t) return;
    setKeywords((prev) => (prev.some((x) => x.ja === t) ? prev : [...prev, { ja: t, ko: c.ko }]));
  };

  // 한국어 입력은 일본 뷰티 X 맥락 번역 후 일본어 칩으로 추가
  async function addKwInput() {
    const t = kwInput.trim();
    if (!t) return;
    if (!hasHangul(t)) { addChip({ ja: t, ko: null }); setKwInput(''); return; }
    setErr('');
    setTranslating(true);
    try {
      const r = await fetch('/api/translate-keyword', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: t }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `번역 오류 ${r.status}`);
      const pair = (await r.json()) as KwPair;
      addChip({ ja: pair.ja, ko: pair.ko });
      setKwInput('');
    } catch (e) { setErr((e as Error).message); } finally { setTranslating(false); }
  }

  async function suggest() {
    const base = kwInput.trim() || keywords[keywords.length - 1]?.ja;
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
        if (translating) { setErr('번역 중입니다 — 잠시 후 다시'); return; }
        if (keywords.length === 0 && kwInput.trim() && hasHangul(kwInput)) { setErr('한국어 키워드는 Enter로 번역 후 만들어주세요'); return; }
        const kws = kwInput.trim() && !hasHangul(kwInput) && !keywords.some((x) => x.ja === kwInput.trim())
          ? [...keywords, { ja: kwInput.trim(), ko: null }] : keywords;
        if (kws.length === 0) { setErr('키워드를 입력하세요'); return; }
        await onSubmit({
          kind, title: title || kws.map(chipLabel).join('·'),
          config: { keywords: kws.map((k) => k.ja), minFaves: minFaves || null, minViews: minViews || null,
                    sinceDate: sinceDate || null, untilDate: untilDate || null, lang: lang || null,
                    imagesOnly, maxPages: maxPages || 3, sort: init.sort ?? 'views', width: init.width ?? null },
        });
      } else {
        if (!handle.trim()) { setErr('계정 핸들을 입력하세요'); return; }
        await onSubmit({ kind, title: title || `@${handle.replace(/^@/, '')}`,
          config: { handle: handle.replace(/^@/, ''), userId: init.userId ?? '', maxPages: maxPages || 3, sort: init.sort ?? 'views', width: init.width ?? null } });
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
            <label className="mb-1 block text-xs text-gray-500">키워드 (OR 조합 · 한국어는 자동 번역)</label>
            <div className="mb-1 flex flex-wrap gap-1">
              {keywords.map((k) => (
                <button key={k.ja} className={chip} onClick={() => setKeywords(keywords.filter((x) => x.ja !== k.ja))}>{chipLabel(k)} ✕</button>
              ))}
            </div>
            <div className="mb-2 flex gap-1">
              <input className={input} value={kwInput} placeholder="키워드 입력 후 Enter (한국어 OK)"
                     disabled={translating}
                     onChange={(e) => setKwInput(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') addKwInput(); }} />
              <button onClick={suggest} disabled={busy || translating} className={chip}>{busy ? '…' : '연관 제안'}</button>
            </div>
            {translating && <p className="mb-2 text-[11px] text-gray-400">일본어로 번역 중…</p>}
            {sug && (sug.variants.length + sug.adjacent.length > 0) && (
              <div className="mb-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-600">
                <p className="mb-1 text-[11px] text-gray-500">표기 변형</p>
                <div className="mb-1 flex flex-wrap gap-1">{sug.variants.map((k) => <button key={k.ja} className={chip} onClick={() => addChip({ ja: k.ja, ko: k.ko || null })}>+ {k.ja}{k.ko ? ` (${k.ko})` : ''}</button>)}</div>
                <p className="mb-1 text-[11px] text-gray-500">인접 개념</p>
                <div className="flex flex-wrap gap-1">{sug.adjacent.map((k) => <button key={k.ja} className={chip} onClick={() => addChip({ ja: k.ja, ko: k.ko || null })}>+ {k.ja}{k.ko ? ` (${k.ko})` : ''}</button>)}</div>
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
