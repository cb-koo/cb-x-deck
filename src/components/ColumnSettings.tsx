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
  const [minRetweets, setMinRetweets] = useState(init.minRetweets ?? null);
  const [minReplies, setMinReplies] = useState(init.minReplies ?? null);
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
          config: { keywords: kws.map((k) => k.ja), minFaves: minFaves || null,
                    minRetweets: minRetweets || null, minReplies: minReplies || null, minViews: minViews || null,
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

  const input = 'w-full rounded-md border border-x-border-strong bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-x-blue focus:ring-1 focus:ring-x-blue';
  const label = 'mb-1 block text-[13px] font-medium text-x-secondary';
  const chip = 'rounded-full border border-x-border-strong px-3 py-1 text-[13px] hover:bg-x-hover';
  const section = 'mt-5 border-t border-x-border pt-4';
  const sectionTitle = 'mb-3 text-[13px] font-bold text-x-text';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[90vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-bold text-x-text">{initial ? '칼럼 설정' : '새 칼럼'}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-x-secondary hover:bg-x-hover" title="닫기">✕</button>
        </div>

        {!initial && (
          <div className="mb-4 flex gap-2">
            {(['search', 'watchlist'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                      className={kind === k
                        ? 'rounded-full bg-x-text px-4 py-1.5 text-[13px] font-bold text-white'
                        : `${chip} px-4 py-1.5 text-x-secondary`}>
                {k === 'search' ? '검색' : '워치리스트'}
              </button>
            ))}
          </div>
        )}

        {kind === 'search' ? (
          <>
            <div>
              <label className={label}>키워드 (OR 조합 · 한국어는 자동 번역)</label>
              <div className="flex gap-2">
                <input className={input} value={kwInput} placeholder="키워드 입력 후 Enter (한국어 OK)"
                       disabled={translating} autoFocus
                       onChange={(e) => setKwInput(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addKwInput(); }} />
                <button onClick={suggest} disabled={busy || translating} className={`${chip} shrink-0 text-x-secondary disabled:opacity-50`}>
                  {busy ? '…' : '연관 제안'}
                </button>
              </div>
              {translating && <p className="mt-1 text-[13px] text-x-muted">일본어로 번역 중…</p>}
              {keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <button key={k.ja} className={chip} title="클릭하면 제거"
                            onClick={() => setKeywords(keywords.filter((x) => x.ja !== k.ja))}>{chipLabel(k)} ✕</button>
                  ))}
                </div>
              )}
              {sug && (sug.variants.length + sug.adjacent.length > 0) && (
                <div className="mt-3 rounded-xl border border-dashed border-x-border-strong p-3">
                  <p className="mb-1.5 text-[13px] text-x-secondary">표기 변형</p>
                  <div className="mb-2 flex flex-wrap gap-1.5">{sug.variants.map((k) => <button key={k.ja} className={chip} onClick={() => addChip({ ja: k.ja, ko: k.ko || null })}>+ {k.ja}{k.ko ? ` (${k.ko})` : ''}</button>)}</div>
                  <p className="mb-1.5 text-[13px] text-x-secondary">인접 개념</p>
                  <div className="flex flex-wrap gap-1.5">{sug.adjacent.map((k) => <button key={k.ja} className={chip} onClick={() => addChip({ ja: k.ja, ko: k.ko || null })}>+ {k.ja}{k.ko ? ` (${k.ko})` : ''}</button>)}</div>
                </div>
              )}
            </div>

            <div className={section}>
              <p className={sectionTitle}>필터</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><label className={label}>최소 좋아요</label>
                  <input type="number" className={input} value={minFaves ?? ''} onChange={(e) => setMinFaves(e.target.value ? +e.target.value : 0)} /></div>
                <div><label className={label}>최소 조회수 (재필터)</label>
                  <input type="number" className={input} value={minViews ?? ''} onChange={(e) => setMinViews(e.target.value ? +e.target.value : null)} /></div>
                <div><label className={label}>최소 RT</label>
                  <input type="number" className={input} value={minRetweets ?? ''} onChange={(e) => setMinRetweets(e.target.value ? +e.target.value : null)} /></div>
                <div><label className={label}>최소 답글</label>
                  <input type="number" className={input} value={minReplies ?? ''} onChange={(e) => setMinReplies(e.target.value ? +e.target.value : null)} /></div>
                <div><label className={label}>since (이 날짜부터)</label>
                  <input type="date" className={input} value={sinceDate ?? ''} onChange={(e) => setSinceDate(e.target.value)} /></div>
                <div><label className={label}>until (이 날짜까지)</label>
                  <input type="date" className={input} value={untilDate ?? ''} onChange={(e) => setUntilDate(e.target.value)} /></div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[14px] text-x-secondary">
                <input type="checkbox" checked={imagesOnly} onChange={(e) => setImagesOnly(e.target.checked)} /> 이미지 있는 트윗만
              </label>
            </div>
          </>
        ) : (
          <div>
            <label className={label}>계정 핸들</label>
            <input className={input} value={handle} placeholder="@hadakan__" autoFocus onChange={(e) => setHandle(e.target.value)} />
          </div>
        )}

        <div className={section}>
          <p className={sectionTitle}>고급</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {kind === 'search' && (
              <div><label className={label}>언어</label>
                <input className={input} value={lang ?? ''} onChange={(e) => setLang(e.target.value)} /></div>
            )}
            <div><label className={label}>페이지 상한</label>
              <input type="number" className={input} value={maxPages ?? 3} onChange={(e) => setMaxPages(+e.target.value || 3)} /></div>
            <div className="col-span-2"><label className={label}>칼럼 이름 (비우면 자동)</label>
              <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
        </div>

        {err && <p className="mt-3 text-[13px] text-x-pink">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className={`${chip} px-4 py-1.5 text-x-secondary`}>취소</button>
          <button onClick={submit} className="rounded-full bg-x-text px-5 py-1.5 text-[13px] font-bold text-white hover:opacity-90">
            {initial ? '저장' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
