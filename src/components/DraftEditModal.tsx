'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftContent } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';

// X 컴포즈 모달 구조: ✕ / 원본과 비교 / 아바타 40 / 입력 20px·lh24 / 하단 바 + 저장 36px (스펙 §4)
export function DraftEditModal({ draft, onClose, onSaved }: {
  draft: DraftRow; onClose: () => void; onSaved: (updated: DraftRow) => void;
}) {
  const base = draft.edited ?? draft.content;
  const [texts, setTexts] = useState(base.posts.map((p) => p.text));
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const empty = texts.some((t) => !t.trim());

  // Esc로 모달 닫기 — ColumnSettings 선례와 동일한 방식. IME 조합 중 Esc는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setErr(''); setSaving(true);
    const edited: DraftContent = {
      posts: base.posts.map((p, i) => ({ text: texts[i], media: p.media })),
    };
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edited }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    onSaved((await r.json()) as DraftRow);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[600px] rounded-2xl bg-white" role="dialog" aria-label="초안 편집"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={onClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
          <button onClick={() => setCompare(!compare)} className="text-[15px] font-bold text-x-blue-text hover:underline">
            {compare ? '편집으로 돌아가기' : '원본과 비교'}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">
          {base.posts.map((p, i) => {
            const len = xWeightedLength(texts[i]);
            return (
              <div key={i} className="flex gap-3 py-2">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                      style={{ background: draft.member?.color ?? '#1d9bf0' }}>
                  {(draft.member?.name ?? '초').slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  {base.posts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {base.posts.length}</p>}
                  {compare ? (
                    <div className="space-y-2">
                      <p className="whitespace-pre-wrap rounded-lg bg-x-surface p-2 text-[15px] leading-5 text-x-secondary">{draft.content.posts[i]?.text}</p>
                      <p className="whitespace-pre-wrap text-[15px] leading-5">{texts[i]}</p>
                    </div>
                  ) : (
                    <textarea value={texts[i]} rows={Math.max(3, texts[i].split('\n').length + 1)}
                              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
                              className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted"
                              placeholder="본문을 입력하세요" autoFocus={i === 0} />
                  )}
                  <p className={`text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>{len} / {X_MAX_WEIGHTED}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="border-t border-x-border px-4 py-2 text-[14px] font-bold text-x-blue-text">
          🌐 인플루언서가 자기 계정으로 게시합니다 — PR 표기 안내를 함께 전달하세요
        </p>
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-2.5">
          {err && <span className="text-ui text-red-500">{err}</span>}
          <button onClick={save} disabled={saving || empty || compare}
                  className="ml-auto h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
