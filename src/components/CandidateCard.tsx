'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useEffect, useState } from 'react';
import type { CandidateRow } from '@/lib/types';
import type { LibraryEntry } from '@/lib/candidateStore';
import { TweetCard } from './TweetCard';

// 콘텐츠당 카드 1장 + 멤버별 코멘트(=candidate.memo). 내 행만 편집 가능.
// 번역 prop은 페이지가 공유 훅(useTranslations)에서 내려주는 것을 TweetCard로 그대로 전달.
export function CandidateCard({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating }: {
  entry: LibraryEntry; meId: string | null; wsId: string; onChanged: () => void; onRemoveTeam: (tweetId: string) => void;
  translation?: import('@/lib/types').TweetTranslation | null; showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void; translating?: boolean;
}) {
  const mine = entry.candidates.find((e) => e.member.id === meId) ?? null;
  // 저장만 하고 코멘트를 안 단 경우가 흔함(저장=메모 없는 후보행 생성) → 메모·태그가 있을 때만 "함께 삭제" 경고
  const hasMyNote = !!mine && (!!mine.memo?.trim() || mine.tags.length > 0);
  const [confirming, setConfirming] = useState(false);         // 저장 취소 확인(메모 있을 때만)
  const [removingTeam, setRemovingTeam] = useState(false);      // 팀에서 빼기 확인

  // 저장 취소 요청 → 메모·태그가 있을 때만 인라인 확인, 없으면 즉시 취소(마찰 최소화)
  const requestUnsave = () => { if (mine) { if (hasMyNote) setConfirming(true); else doUnsave(); } };
  async function doUnsave() {
    if (!mine) return;
    await apiFetch(`/api/candidates?tweetId=${entry.tweet.tweetId}&workspaceId=${mine.workspaceId}`, { method: 'DELETE' });
    onChanged();
  }
  return (
    <div className="overflow-hidden rounded-xl border border-x-border">
      {/* 보관함 카드엔 ★저장 토글을 두지 않는다 — 별은 덱(피드에서 담는 입구)의 개념.
          내 참여 취소는 코멘트의 '제거', 합류는 '코멘트 달기', 트윗 제거는 '팀 보관함에서 빼기'로 일원화. */}
      <TweetCard tweet={{ ...entry.tweet, isNew: false }} meId={meId}
                 translation={translation} showTranslation={showTranslation}
                 onTranslate={onTranslate} translating={translating} />

      {confirming && (
        <div className="border-t border-red-300 bg-red-50 p-2 text-caption">
          <p className="mb-1 text-red-600">내 코멘트를 삭제할까요? 메모·태그가 사라져요. (트윗은 팀 보관함에 남아요)</p>
          <div className="flex gap-1">
            <button onClick={() => { setConfirming(false); doUnsave(); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">코멘트 삭제</button>
            <button onClick={() => setConfirming(false)} className="rounded border border-x-border-strong px-2 py-0.5">그대로 두기</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-x-border border-t border-x-border">
        {entry.candidates.map((e) =>
          e.member.id === meId
            ? <MyComment key={e.id} entry={e} onChanged={onChanged} onUnsave={requestUnsave} />
            : <TheirComment key={e.id} entry={e} />)}
        {!mine && meId && (
          <AddComment tweetId={entry.tweet.tweetId} workspaceId={entry.candidates[0]?.workspaceId ?? wsId} meId={meId} onChanged={onChanged} />
        )}
      </div>

      {removingTeam && (
        <div className="border-t border-red-300 bg-red-50 p-2 text-caption">
          <p className="mb-1 text-red-600">
            이 트윗을 팀 보관함에서 뺄까요?{entry.candidates.length > 0 ? ` 팀원 ${entry.candidates.length}명의 코멘트도 함께 삭제됩니다.` : ''} (실행취소 가능)
          </p>
          <div className="flex gap-1">
            <button onClick={() => { setRemovingTeam(false); onRemoveTeam(entry.tweet.tweetId); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">팀에서 빼기</button>
            <button onClick={() => setRemovingTeam(false)} className="rounded border border-x-border-strong px-2 py-0.5">그대로 두기</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-x-border px-2 py-1 text-caption text-x-muted">
        <span>{entry.candidates.length === 0 ? `담은 사람: ${entry.addedBy?.name ?? '팀'} · 저장한 사람 없음` : ''}</span>
        <button onClick={() => setRemovingTeam(true)} className={`hover:text-red-500 ${removingTeam ? 'font-medium text-red-500' : ''}`}>팀 보관함에서 빼기</button>
      </div>
    </div>
  );
}

function CommentByline({ entry: e }: { entry: CandidateRow }) {
  return (
    <p className="flex items-center gap-1 text-caption text-x-muted">
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
        <button onClick={onUnsave} className="text-caption text-x-muted hover:text-red-500">제거</button>
      </div>
      <textarea value={memo} onChange={(ev) => setMemo(ev.target.value)} onBlur={saveMemo}
                placeholder="메모 (예: 반복 재현 포맷, 레티날 담론)"
                className="mt-1 w-full resize-none rounded-md border border-x-border-strong bg-transparent p-1 text-ui outline-none focus:border-x-blue" rows={2} />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {e.tags.map((t) => (
          <button key={t.id} onClick={() => removeTag(t.id)}
                  className="rounded-full bg-x-border px-2 py-0.5 text-caption hover:line-through">#{t.name} ✕</button>
        ))}
        <input value={tagInput} onChange={(ev) => setTagInput(ev.target.value)}
               onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) addTag(); }}
               placeholder="+태그" className="w-20 bg-transparent text-caption outline-none" />
      </div>
    </div>
  );
}

function TheirComment({ entry: e }: { entry: CandidateRow }) {
  return (
    <div className="p-2">
      <CommentByline entry={e} />
      {e.memo && <p className="mt-1 whitespace-pre-wrap text-ui">{e.memo}</p>}
      {e.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {e.tags.map((t) => (
            <span key={t.id} className="rounded-full bg-x-border px-2 py-0.5 text-caption text-x-secondary">#{t.name}</span>
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
             className="w-full rounded-md border border-x-border-strong bg-transparent p-1 text-ui outline-none focus:border-x-blue" />
      <button onClick={submit} disabled={busy || !text.trim()}
              className="shrink-0 rounded px-2 py-1 text-caption text-x-secondary hover:bg-x-hover disabled:opacity-40">등록</button>
    </div>
  );
}
