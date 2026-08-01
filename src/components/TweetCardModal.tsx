'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useMember } from '@/lib/memberContext';
import { useToast } from '@/lib/toastContext';
import { tweetPermalink } from '@/lib/tweetLink';
import type { Member, StoredTweet, TweetTranslation } from '@/lib/types';
import { TweetCard } from './TweetCard';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; tweet: StoredTweet }
  | { kind: 'missing' }        // 404 — 그 사이 삭제됐거나 컬럼에서 빠짐
  | { kind: 'error' };

// 표 보기에서 행을 누르면 뜨는 트윗 카드.
// 카드 자체는 TweetCard 그대로다(= X 미러링). 이 파일은 껍데기·조회·저장 배선만 한다.
// 모달 틀(배경·Esc·✕)은 ColumnSettings와 같은 패턴을 쓴다 — 두 모달의 조작감이 갈리지 않게.
export function TweetCardModal({ wsId, tweetId, onClose, onSavedByChange, translation, translating, onTranslate }: {
  wsId: string;
  tweetId: string;
  onClose: () => void;
  onSavedByChange: (tweetId: string, savedBy: Member[]) => void;
  translation: TweetTranslation | null;
  translating: boolean;
  onTranslate: (tweetId: string) => void;
}) {
  // 초기값이 'loading' — 이펙트 안에서 동기적으로 setState 하지 않기 위해서다(react-hooks/set-state-in-effect).
  // 호출부가 key={tweetId}로 렌더하므로 다른 행을 열면 이 컴포넌트가 새로 마운트되어 자연히 loading부터 시작한다.
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const { member } = useMember();
  const { show } = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  // 저장으로 만들어진 내 candidate.id — 저장 직후 메모 PATCH 배선용 (Column.tsx와 같은 방식)
  const savedIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/tweets/${encodeURIComponent(tweetId)}?workspaceId=${encodeURIComponent(wsId)}`);
        if (!alive) return;
        if (r.status === 404) { setState({ kind: 'missing' }); return; }
        if (!r.ok) { setState({ kind: 'error' }); return; }
        const d = await r.json() as { tweet: StoredTweet };
        if (!alive) return;
        setState({ kind: 'ok', tweet: d.tweet });
      } catch {
        if (alive) setState({ kind: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [wsId, tweetId, retry]);

  // Esc로 닫기 — ColumnSettings와 같은 처리. IME 조합 중 Esc는 글자 조합 취소라 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 열릴 때 포커스를 모달 안으로 — 그래야 Tab이 표 행이 아니라 카드를 돈다.
  // 닫을 때 눌렀던 행으로 되돌리는 것은 호출부(TweetTableView)가 한다.
  useEffect(() => { closeRef.current?.focus(); }, []);

  // 저장 상태를 카드와 표 행에 동시에 반영한다 — 한쪽만 바꾸면 팝업을 닫았을 때 표가 거짓말을 한다.
  function applySavedBy(savedBy: Member[]) {
    setState((cur) => (cur.kind === 'ok' ? { kind: 'ok', tweet: { ...cur.tweet, savedBy } } : cur));
    onSavedByChange(tweetId, savedBy);
  }

  async function save() {
    if (state.kind !== 'ok') return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = state.tweet.savedBy;
    if (before.some((m) => m.id === member.id)) return;   // 이미 저장됨 — 중복 추가 방지
    // 서버는 order by m.name으로 준다 — 같은 순서로 맞춰야 저장 직후와 재조회 후 배지 순서가 같다
    applySavedBy([...before, member].sort((a, b) => a.name.localeCompare(b.name)));
    try {
      // sourceColumnId를 보내지 않는다 — 표의 글은 특정 컬럼에서 온 게 아니다(서버에서 optional)
      const r = await apiFetch('/api/candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetId, workspaceId: wsId }),
      });
      if (!r.ok) { applySavedBy(before); show('저장하지 못했어요 — 잠시 후 다시 시도해주세요'); return; }
      const created = await r.json().catch(() => null) as { id?: string } | null;
      savedIdRef.current = created?.id ?? null;
    } catch {
      applySavedBy(before);
      show('저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  async function unsave() {
    if (state.kind !== 'ok') return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = state.tweet.savedBy;
    applySavedBy(before.filter((m) => m.id !== member.id));
    savedIdRef.current = null;
    try {
      const r = await apiFetch(`/api/candidates?tweetId=${encodeURIComponent(tweetId)}&workspaceId=${encodeURIComponent(wsId)}`, { method: 'DELETE' });
      if (!r.ok) { applySavedBy(before); show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요'); }
    } catch {
      applySavedBy(before);
      show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  // 저장 시점 인라인 메모 — 방금 만든 candidate 행에 PATCH (Column.tsx의 saveMemo와 같다).
  // false를 돌려주면 카드가 입력을 보존하고 재시도 버튼을 보여준다.
  async function saveMemo(_tweetId: string, memo: string): Promise<boolean> {
    const id = savedIdRef.current;
    if (!id) return false;
    try {
      const r = await apiFetch(`/api/candidates/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
      });
      return r.ok;
    } catch { return false; }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* 카드 위에 별도 테두리·여백을 얹지 않는다 — 카드(<article>)가 이미 자기 배경·여백을 들고 있고
          그게 X 미러링의 결과물이다. 껍데기는 위치·모서리·세로 넘침만 담당한다. */}
      <div role="dialog" aria-modal="true" aria-label="트윗 카드"
           className="max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto overflow-x-hidden rounded-2xl bg-white"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end px-2 pt-2">
          <button ref={closeRef} onClick={onClose} aria-label="닫기" title="닫기"
                  className="rounded-full p-2 text-x-secondary hover:bg-x-hover">✕</button>
        </div>
        {state.kind === 'loading' && <p className="px-4 pb-4 text-ui text-x-muted">불러오는 중…</p>}
        {state.kind === 'error' && (
          <p className="px-4 pb-4 text-ui text-red-500">
            글을 불러오지 못했어요. <button onClick={() => setRetry((n) => n + 1)} className="underline">다시 시도</button>
          </p>
        )}
        {state.kind === 'missing' && (
          <p className="px-4 pb-4 text-ui text-x-muted">
            이 글을 찾을 수 없어요 —{' '}
            <a href={tweetPermalink(null, tweetId)} target="_blank" rel="noopener" className="text-x-blue-text hover:underline">원문 보기 ↗</a>
          </p>
        )}
        {state.kind === 'ok' && (
          <TweetCard tweet={state.tweet}
                     meId={member?.id ?? null}
                     onSave={save}
                     onUnsave={unsave}
                     onSaveMemo={saveMemo}
                     libraryHref={`/w/${wsId}/library`}
                     translation={translation}
                     translating={translating}
                     onTranslate={onTranslate} />
        )}
      </div>
    </div>
  );
}
