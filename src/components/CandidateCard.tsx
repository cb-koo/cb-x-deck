'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useState } from 'react';
import type { CandidateRow } from '@/lib/types';
import type { LibraryEntry } from '@/lib/candidateStore';
import { kstShort } from '@/lib/datetime';
import { TweetCard } from './TweetCard';
import { PenIcon } from './XIcons';

// 콘텐츠당 카드 1장 + 멤버별 코멘트(=candidate.memo). 내 행만 편집 가능.
// 번역 prop은 페이지가 공유 훅(useTranslations)에서 내려주는 것을 TweetCard로 그대로 전달.
export function CandidateCard({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating }: {
  entry: LibraryEntry; meId: string | null; wsId: string; onChanged: () => void; onRemoveTeam: (tweetId: string) => void;
  translation?: import('@/lib/types').TweetTranslation | null; showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void; translating?: boolean;
}) {
  const mine = entry.candidates.find((e) => e.member.id === meId) ?? null;
  // 저장만 하고 코멘트를 안 단 경우가 흔함(저장=메모 없는 후보행 생성) → 메모가 있을 때만 "함께 삭제" 경고
  const hasMyNote = !!mine && !!mine.memo?.trim();
  const [confirming, setConfirming] = useState(false);         // 저장 취소 확인(메모 있을 때만)
  const [removingTeam, setRemovingTeam] = useState(false);      // 팀에서 빼기 확인
  // 코멘트 접기(밀도 개선 spec §5): 2개 이상이면 최신 1개만 먼저. candidates는 savedAt 오름차순 → 최신 = 마지막.
  // 표시 순서는 오름차순 유지 — 펼치면 이전 코멘트가 위로 드러나 이미 보이던 최신 코멘트 위치가 안 튄다.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const visibleComments = commentsOpen ? entry.candidates : entry.candidates.slice(-1);

  // 저장 취소 요청 → 메모가 있을 때만 인라인 확인, 없으면 즉시 취소(마찰 최소화)
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
      <TweetCard tweet={{ ...entry.tweet, isNew: false }} dense meId={meId}
                 translation={translation} showTranslation={showTranslation}
                 onTranslate={onTranslate} translating={translating} />

      {confirming && (
        <div className="border-t border-red-300 bg-red-50 p-2 text-caption">
          <p className="mb-1 text-red-600">내 코멘트를 삭제할까요? 메모가 사라져요. (트윗은 팀 보관함에 남아요)</p>
          <div className="flex gap-1">
            <button onClick={() => { setConfirming(false); doUnsave(); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">코멘트 삭제</button>
            <button onClick={() => setConfirming(false)} className="rounded border border-x-border-strong px-2 py-0.5">그대로 두기</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-x-border border-t border-x-border">
        {entry.candidates.length >= 2 && (
          <div className="px-2 py-1.5">
            <button onClick={() => setCommentsOpen((v) => !v)} className="text-caption text-x-blue-text hover:underline">
              {commentsOpen ? '코멘트 접기 ▴' : `코멘트 ${entry.candidates.length - 1}개 더 보기 ▾`}
            </button>
          </div>
        )}
        {visibleComments.map((e) =>
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
        <span className="flex items-center gap-1">
          {/* 아래 TweetCard는 이 entry.tweet을 그대로 넘겨받아 t.savedBy.length > 0이면 자체 풋터에 이미 "초안"을 노출함
              (코멘트가 1개라도 있으면 savedBy가 채워짐) → 여기선 그 조건이 거짓일 때(코멘트 없는 담기만 된 카드)만 보완 노출해 중복을 막는다 */}
          {entry.tweet.savedBy.length === 0 && (
            <a href={`/generate?ref=${entry.tweet.tweetId}`} title="이 트윗을 레퍼런스로 초안 만들기"
               className="flex items-center gap-1 rounded-full px-2 py-1 text-ui text-x-secondary hover:bg-x-blue/10 hover:text-x-blue-text">
              <PenIcon className="h-[15px] w-[15px]" />초안
            </a>
          )}
          <button onClick={() => setRemovingTeam(true)} className={`hover:text-red-500 ${removingTeam ? 'font-medium text-red-500' : ''}`}>팀 보관함에서 빼기</button>
        </span>
      </div>
    </div>
  );
}

function CommentByline({ entry: e }: { entry: CandidateRow }) {
  return (
    <p className="flex items-center gap-1 text-caption text-x-muted">
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
            style={{ backgroundColor: e.member.color }}>{e.member.name.slice(0, 1)}</span>
      {e.member.name} · {kstShort(e.savedAt)}
    </p>
  );
}

// 평소엔 읽기 전용(확정본 보호), [수정] 눌러야 편집 모드 → [저장]/[취소]로 커밋·잠금.
// 항상 열린 textarea가 실수 편집을 부르던 문제 해소 + 저장 상태를 명시화 (checklist §F·G·K).
function MyComment({ entry: e, onChanged, onUnsave }: { entry: CandidateRow; onChanged: () => void; onUnsave: () => void }) {
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState(e.memo);   // 편집 모드 전용 초안값 — 읽기 표시는 e.memo를 직접 씀
  const [saving, setSaving] = useState(false);
  function beginEdit() { setMemo(e.memo); setEditing(true); }   // 진입 시 최신 값 seed (effect 불필요)

  async function save() {
    setSaving(true);
    try {
      if (memo !== e.memo) {
        await apiFetch(`/api/candidates/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }) });
      }
      setEditing(false);
      onChanged();
    } finally { setSaving(false); }
  }
  function cancel() { setMemo(e.memo); setEditing(false); }   // 편집 취소 = 원래 값 복원

  return (
    <div className="p-2">
      <div className="flex items-center justify-between">
        <CommentByline entry={e} />
        {editing ? (
          <div className="flex items-center gap-1">
            <button onClick={save} disabled={saving}
                    className="rounded px-2 py-1 text-caption font-medium text-x-blue-text hover:bg-x-hover disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
            <button onClick={cancel} className="rounded px-2 py-1 text-caption text-x-muted hover:bg-x-hover">취소</button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={beginEdit} className="rounded px-2 py-1 text-caption text-x-blue-text hover:bg-x-hover hover:underline">수정</button>
            <button onClick={onUnsave} className="rounded px-2 py-1 text-caption text-x-muted hover:text-red-500">제거</button>
          </div>
        )}
      </div>

      {editing ? (
        <textarea autoFocus value={memo} onChange={(ev) => setMemo(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Escape') cancel();                                              // Esc = 취소
                    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) save();               // Cmd/Ctrl+Enter = 저장
                  }}
                  placeholder="메모 (예: 반복 재현 포맷, 레티날 담론)"
                  className="mt-1 w-full resize-none rounded-md border border-x-border-strong bg-white p-1 text-ui outline-none focus:border-x-blue" rows={2} />
      ) : (
        e.memo?.trim()
          ? <p className="mt-1 whitespace-pre-wrap text-ui">{e.memo}</p>
          : <p className="mt-1 text-ui text-x-muted">메모 없음 <span className="text-caption">— 수정으로 추가할 수 있어요</span></p>
      )}
    </div>
  );
}

function TheirComment({ entry: e }: { entry: CandidateRow }) {
  return (
    <div className="p-2">
      <CommentByline entry={e} />
      {e.memo && <p className="mt-1 whitespace-pre-wrap text-ui">{e.memo}</p>}
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
