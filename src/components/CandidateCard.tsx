'use client';
import { useState } from 'react';
import type { CandidateRow } from '@/lib/types';
import { TweetCard } from './TweetCard';

export function CandidateCard({ c, onChanged }: { c: CandidateRow; onChanged: () => void }) {
  const [memo, setMemo] = useState(c.memo);
  const [tagInput, setTagInput] = useState('');

  async function saveMemo() {
    if (memo === c.memo) return;
    await fetch(`/api/candidates/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }) });
    onChanged();
  }
  async function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    await fetch(`/api/candidates/${c.id}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    setTagInput('');
    onChanged();
  }
  async function removeTag(tagId: string) {
    await fetch(`/api/candidates/${c.id}/tags/${tagId}`, { method: 'DELETE' });
    onChanged();
  }
  async function unsave() {
    if (!confirm('보관함에서 제거할까요? (메모·태그도 삭제됩니다)')) return;
    await fetch(`/api/candidates?tweetId=${c.tweet.tweetId}&workspaceId=${c.workspaceId}&memberId=${c.member.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800">
      <TweetCard tweet={{ ...c.tweet, seenByMe: false }} meId={c.member.id} onUnsave={unsave} />
      <div className="border-t border-gray-100 p-2 dark:border-gray-800">
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={saveMemo}
                  placeholder="메모 (예: 반복 재현 포맷, 레티날 담론)"
                  className="w-full resize-none rounded border border-gray-200 bg-transparent p-1 text-sm dark:border-gray-700" rows={2} />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {c.tags.map((t) => (
            <button key={t.id} onClick={() => removeTag(t.id)}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-xs hover:line-through dark:bg-gray-800">#{t.name} ✕</button>
          ))}
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
                 placeholder="+태그" className="w-20 bg-transparent text-xs outline-none" />
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ backgroundColor: c.member.color }}>{c.member.name.slice(0, 1)}</span>
          {c.member.name} · 저장 {new Date(c.savedAt).toLocaleDateString('ko-KR')}
        </p>
      </div>
    </div>
  );
}
