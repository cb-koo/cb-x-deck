'use client';
import { useEffect, useMemo, useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { fetchUnattachedDrafts } from '@/lib/campaignApi';
import { draftLabel, searchDrafts } from '@/lib/draftViews';
import { variantLabel } from '@/lib/draftUi';
import { kstShort } from '@/lib/datetime';
import { Button } from '@/components/ui';

// 있는 원고 고르기(스펙 §4-2) — 그 클라이언트의 작업에 안 붙은 원고만. 하나만 고른다(원고 1개 = 작업 1개).
// 형제 시안(A/B/C)은 라벨로 보여주되 하나만 붙이는 게 자연스럽다 — 도움말로 말한다.
export function AttachDraftModal({ clientId, onClose, onPick, title = '있는 원고 고르기' }: {
  clientId: string | null; onClose: () => void; onPick: (draft: DraftRow) => void; title?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    fetchUnattachedDrafts(clientId).then((r) => { if (!alive) return; if (r.ok) { setRows(r.data); setState('ready'); } else { setErr(r.error); setState('error'); } });
    return () => { alive = false; };
  }, [clientId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shown = useMemo(() => searchDrafts(rows, query), [rows, query]);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[640px] rounded-2xl bg-white p-5" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold">{title}</h2>
        <p className="mt-0.5 text-ui text-x-muted">작업에 아직 안 붙은 원고만 보여요. 시안이 여러 개(A/B/C)면 쓸 하나만 골라요.</p>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·본문으로 찾기" aria-label="원고 검색"
               className="mt-3 h-10 w-full rounded-lg border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
        <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-lg border border-x-border">
          {state === 'loading' && <p className="px-4 py-6 text-center text-ui text-x-muted">불러오는 중…</p>}
          {state === 'error' && <p role="alert" className="px-4 py-6 text-center text-ui text-red-600">{err}</p>}
          {state === 'ready' && shown.length === 0 && <p className="px-4 py-6 text-center text-ui text-x-muted">붙일 수 있는 원고가 없어요 — &ldquo;새로 만들기&rdquo;로 바로 써도 돼요</p>}
          {state === 'ready' && shown.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-3 border-b border-x-border px-4 py-3 text-left last:border-b-0 hover:bg-x-hover">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-content font-medium">{draftLabel(d).text}</span>
                <span className="block text-ui text-x-muted">{kstShort(d.createdAt)}{d.batchId !== null && ` · 시안 ${variantLabel(d.variantIndex ?? 0)}`}{d.influencerHandle && ` · @${d.influencerHandle}`}</span>
              </span>
              <span className="shrink-0 text-ui text-x-blue-text">고르기</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={onClose} className="h-10 px-4 text-content">닫기</Button></div>
      </div>
    </div>
  );
}
