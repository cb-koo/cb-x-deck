'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useEffect, useState } from 'react';
import type { CandidateRow, TweetTranslation } from '@/lib/types';
import type { CandidateGroup } from '@/lib/candidateGroups';
import { TweetCard } from './TweetCard';

// 콘텐츠당 카드 1장 + 멤버별 코멘트(=candidate.memo). 내 행만 편집 가능.
// 번역 prop은 페이지가 공유 훅(useTranslations)에서 내려주는 것을 TweetCard로 그대로 전달.
export function CandidateCard({ group, meId, onChanged, translation, showTranslation, onTranslate, translating }: {
  group: CandidateGroup; meId: string | null; onChanged: () => void;
  translation?: TweetTranslation | null; showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void; translating?: boolean;
}) {
  const mine = group.entries.find((e) => e.member.id === meId) ?? null;

  async function unsave() {
    if (!mine) return;
    if (!confirm('내 코멘트를 제거할까요? (내 메모·태그만 삭제, 다른 멤버 코멘트는 유지)')) return;
    await apiFetch(`/api/candidates?tweetId=${group.tweet.tweetId}&workspaceId=${mine.workspaceId}&memberId=${mine.member.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-x-border">
      <TweetCard tweet={{ ...group.tweet, isNew: false }} meId={meId} onUnsave={unsave}
                 translation={translation} showTranslation={showTranslation}
                 onTranslate={onTranslate} translating={translating} />
      <div className="divide-y divide-x-border border-t border-x-border">
        {group.entries.map((e) =>
          e.member.id === meId
            ? <MyComment key={e.id} entry={e} onChanged={onChanged} onUnsave={unsave} />
            : <TheirComment key={e.id} entry={e} />)}
        {!mine && meId && <AddComment tweetId={group.tweet.tweetId} workspaceId={group.entries[0].workspaceId} meId={meId} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function CommentByline({ entry: e }: { entry: CandidateRow }) {
  return (
    <p className="flex items-center gap-1 text-[11px] text-x-muted">
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
            style={{ backgroundColor: e.member.color }}>{e.member.name.slice(0, 1)}</span>
      {e.member.name} · {new Date(e.savedAt).toLocaleDateString('ko-KR')}
    </p>
  );
}

function MyComment({ entry: e, onChanged, onUnsave }: { entry: CandidateRow; onChanged: () => void; onUnsave: () => void }) {
  const [memo, setMemo] = useState(e.memo);
  const [tagInput, setTagInput] = useState('');
  useEffect(() => { setMemo(e.memo); }, [e.memo]);

  async function saveMemo() {
    if (memo === e.memo) return;
    await apiFetch(`/api/candidates/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }) });
    onChanged();
  }
  async function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    await apiFetch(`/api/candidates/${e.id}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    setTagInput('');
    onChanged();
  }
  async function removeTag(tagId: string) {
    await apiFetch(`/api/candidates/${e.id}/tags/${tagId}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between">
        <CommentByline entry={e} />
        <button onClick={onUnsave} className="text-[11px] text-x-muted hover:text-red-500">제거</button>
      </div>
      <textarea value={memo} onChange={(ev) => setMemo(ev.target.value)} onBlur={saveMemo}
                placeholder="메모 (예: 반복 재현 포맷, 레티날 담론)"
                className="mt-1 w-full resize-none rounded-md border border-x-border-strong bg-transparent p-1 text-sm outline-none focus:border-x-blue" rows={2} />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {e.tags.map((t) => (
          <button key={t.id} onClick={() => removeTag(t.id)}
                  className="rounded-full bg-x-border px-2 py-0.5 text-xs hover:line-through">#{t.name} ✕</button>
        ))}
        <input value={tagInput} onChange={(ev) => setTagInput(ev.target.value)}
               onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) addTag(); }}
               placeholder="+태그" className="w-20 bg-transparent text-xs outline-none" />
      </div>
    </div>
  );
}

function TheirComment({ entry: e }: { entry: CandidateRow }) {
  return (
    <div className="p-2">
      <CommentByline entry={e} />
      {e.memo && <p className="mt-1 whitespace-pre-wrap text-sm">{e.memo}</p>}
      {e.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {e.tags.map((t) => (
            <span key={t.id} className="rounded-full bg-x-border px-2 py-0.5 text-xs text-x-secondary">#{t.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// 미저장 멤버의 코멘트 달기 = 내 저장 행 생성 + 메모 (코멘트를 달면 내 저장으로 계산됨)
function AddComment({ tweetId, workspaceId, meId, onChanged }: { tweetId: string; workspaceId: string; meId: string; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const memo = text.trim();
    if (!memo || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetId, workspaceId, memberId: meId }),
      });
      if (!res.ok) return;
      const created = await res.json();
      await apiFetch(`/api/candidates/${created.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }) });
      setText('');
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-1 p-2">
      <input value={text} onChange={(ev) => setText(ev.target.value)}
             onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) submit(); }}
             placeholder="코멘트 달기 (저장으로 계산됨)"
             className="w-full rounded-md border border-x-border-strong bg-transparent p-1 text-sm outline-none focus:border-x-blue" />
      <button onClick={submit} disabled={busy || !text.trim()}
              className="shrink-0 rounded px-2 py-1 text-xs text-x-secondary hover:bg-x-hover disabled:opacity-40">등록</button>
    </div>
  );
}
