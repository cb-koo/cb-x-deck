'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useMember } from '@/lib/memberContext';
import { useToast } from '@/lib/toastContext';
import { tweetPermalink } from '@/lib/tweetLink';
import { ymd, ymdHm } from '@/lib/tableColumns';
import type { Member, StoredTweet, TableRow, TweetTranslation } from '@/lib/types';
import { TweetCard } from './TweetCard';

// 조회 진행 상태. 카드가 보이는지와는 별개다 — 잠정 카드는 조회 전에도 떠 있다.
type Load = 'loading' | 'done' | 'error' | 'missing';

// 표 행이 이미 들고 있는 값으로 만드는 잠정 카드 — 클릭 즉시 그리기 위해서다(2차 설계 §C-2).
// 없는 것만 비워둔다. 비워도 TweetCard가 알아서 견딘다: 아바타 null이면 회색 원,
// tweetUrl null이면 시각이 링크 없는 텍스트, media []면 그리드 자체가 안 나온다.
function provisionalFrom(row: TableRow): StoredTweet {
  return {
    tweetId: row.tweetId,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorAvatarUrl: null,
    authorFollowers: row.authorFollowers,
    text: row.text,
    media: [],
    quoted: null,
    metrics: row.metrics,
    tweetUrl: null,
    tweetCreatedAt: row.tweetCreatedAt,
    firstSeenAt: row.firstSeenAt,
    lastFetchedAt: row.lastFetchedAt,
    isNew: false,          // NEW는 컬럼 개념이라 표에는 없다
    savedBy: row.savedBy,
  };
}

// 표 보기에서 행을 누르면 뜨는 트윗 카드.
// 카드 자체는 TweetCard 그대로다(= X 미러링). 이 파일은 모달 크롬·조회·저장 배선만 한다.
// 크롬 배치는 X의 게시 모달을 따른다(2차 설계 §A): ✕는 왼쪽, 오른쪽에 파란 텍스트 액션,
// 그 아래 한 줄에 컬럼명과 수집 정보.
export function TweetCardModal({ wsId, tweetId, row, cached, onLoaded, onClose, onSavedByChange,
                                 translation, translating, translateErr, onTranslate }: {
  wsId: string;
  tweetId: string;
  row: TableRow | null;
  cached: StoredTweet | null;
  onLoaded: (tweet: StoredTweet) => void;
  onClose: () => void;
  onSavedByChange: (tweetId: string, savedBy: Member[]) => void;
  translation: TweetTranslation | null;
  translating: boolean;
  translateErr: string;
  onTranslate: (tweetId: string) => void;
}) {
  // 초기값을 useState 초기화로 준다 — 이펙트 안에서 동기 setState를 하지 않기 위해서다
  // (react-hooks/set-state-in-effect). 호출부가 key={tweetId}로 렌더하므로 다른 행을 열면
  // 이 컴포넌트가 새로 마운트되어 자연히 초기값부터 시작한다.
  const [full, setFull] = useState<StoredTweet | null>(cached);
  const [load, setLoad] = useState<Load>(cached ? 'done' : 'loading');
  const [retry, setRetry] = useState(0);
  // translateErr는 useTranslations 훅의 값 — 카드마다 나뉘어 있지 않고, 실패 시 세팅된 채
  // 다음 성공 때만 지워진다. 그대로 렌더하면 방금 연 카드에 '다른 트윗'에서 난 실패가 튀어나온다.
  // key={tweetId} 리마운트 덕에 이 플래그는 카드마다 false로 시작해 남의 실패를 걸러낸다.
  const [translateAttempted, setTranslateAttempted] = useState(false);
  const { member } = useMember();
  const { show } = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  // 저장으로 만들어진 내 candidate.id — 저장 직후 메모 PATCH 배선용 (Column.tsx와 같은 방식)
  const savedIdRef = useRef<string | null>(null);

  // 화면에 그릴 카드. 완성본이 있으면 그것, 없으면 표 행으로 만든 잠정 카드.
  // row가 갱신되면(저장으로 부모가 행을 고치면) 잠정 카드도 따라 갱신된다.
  const tweet = full ?? (row ? provisionalFrom(row) : null);

  function handleTranslate(id: string) {
    setTranslateAttempted(true);
    onTranslate(id);
  }

  useEffect(() => {
    if (cached) return;   // 이미 완성본을 받아둔 트윗 — 네트워크를 타지 않는다
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/tweets/${encodeURIComponent(tweetId)}?workspaceId=${encodeURIComponent(wsId)}`);
        if (!alive) return;
        if (r.status === 404) { setLoad('missing'); return; }
        if (!r.ok) { setLoad('error'); return; }
        const d = await r.json() as { tweet: StoredTweet };
        if (!alive) return;
        setFull(d.tweet);
        setLoad('done');
        onLoaded(d.tweet);
      } catch {
        if (alive) setLoad('error');
      }
    })();
    return () => { alive = false; };
    // onLoaded는 호출부에서 useCallback으로 안정화한다
  }, [wsId, tweetId, retry, cached, onLoaded]);

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
  // 잠정 카드는 row에서 파생되므로 부모가 행을 고치면 따라 바뀐다. 완성본은 여기서 직접 고친다.
  function applySavedBy(savedBy: Member[]) {
    setFull((cur) => (cur ? { ...cur, savedBy } : cur));
    onSavedByChange(tweetId, savedBy);
  }

  async function save() {
    if (!tweet) return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = tweet.savedBy;
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
    if (!tweet) return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = tweet.savedBy;
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

  const columnTitles = row?.columnTitles ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* 카드 위에 별도 테두리·여백을 얹지 않는다 — 카드(<article>)가 이미 자기 배경·여백을 들고 있고
          그게 X 미러링의 결과물이다. 껍데기는 위치·모서리·세로 넘침만 담당한다. */}
      <div role="dialog" aria-modal="true" aria-label="트윗 카드"
           className="max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto overflow-x-hidden rounded-2xl bg-white"
           onClick={(e) => e.stopPropagation()}>
        {/* 상단 바 — X 게시 모달과 같은 배치: ✕ 왼쪽, 오른쪽에 파란 텍스트 액션.
            파랑은 x-blue가 아니라 x-blue-text를 쓴다 — 밝은 쪽은 텍스트 대비가 AA에 미달한다(globals.css). */}
        <div className="flex min-h-[53px] items-center justify-between px-2 py-1.5">
          <button ref={closeRef} onClick={onClose} aria-label="닫기" title="닫기"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-x-text hover:bg-x-hover">✕</button>
          {/* tweet이 null이면 row도 null이라(둘 다 없을 때만 이 상태다) 핸들 없는 /i/status/ 형식으로 떨어진다 */}
          <a href={tweetPermalink(tweet?.authorHandle ?? null, tweetId)}
             target="_blank" rel="noopener"
             className="rounded-full px-3.5 py-1.5 text-content font-bold text-x-blue-text hover:bg-x-hover">원문 ↗</a>
        </div>

        {/* 메타 줄 — 왼쪽에 이 글이 걸린 컬럼, 오른쪽에 언제 모았고 언제 마지막으로 가져왔는지.
            날짜는 표가 쓰는 함수를 그대로 쓴다(한국 시간) — 팝업은 표 바로 위에 뜨므로
            같은 값이 다른 날짜로 보이면 안 된다(2차 설계 §B). */}
        {(columnTitles.length > 0 || tweet) && (
          <div className="flex items-baseline justify-between gap-3 px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              {columnTitles.map((title) => (
                <span key={title}
                      className="rounded-full border border-x-border-strong px-2.5 py-0.5 text-ui font-bold text-x-secondary">
                  {title}
                </span>
              ))}
            </div>
            {tweet && (
              <p className="shrink-0 text-ui text-x-muted">
                수집 {ymd(tweet.firstSeenAt)} · 최종 수집 {ymdHm(tweet.lastFetchedAt)}
              </p>
            )}
          </div>
        )}

        {/* 카드 — 잠정이든 완성본이든 같은 컴포넌트. 하단 수집·갱신 줄은 위 메타 줄로 올렸으므로 끈다. */}
        {tweet && (
          <TweetCard tweet={tweet}
                     meId={member?.id ?? null}
                     onSave={save}
                     onUnsave={unsave}
                     onSaveMemo={saveMemo}
                     libraryHref={`/w/${wsId}/library`}
                     translation={translation}
                     translating={translating}
                     onTranslate={handleTranslate}
                     showCollectedAt={false} />
        )}

        {/* 카드가 없을 때(표 행도 캐시도 없는 경우 — 팝업이 열린 사이 목록이 다시 로드된 상황)의 상태 */}
        {!tweet && load === 'loading' && <p className="px-4 pb-4 text-ui text-x-muted">불러오는 중…</p>}
        {!tweet && load === 'error' && (
          <p className="px-4 pb-4 text-ui text-red-500">
            글을 불러오지 못했어요. <button onClick={() => setRetry((n) => n + 1)} className="underline">다시 시도</button>
          </p>
        )}
        {!tweet && load === 'missing' && (
          <p className="px-4 pb-4 text-ui text-x-muted">
            이 글을 찾을 수 없어요 —{' '}
            <a href={tweetPermalink(null, tweetId)} target="_blank" rel="noopener" className="text-x-blue-text hover:underline">원문 보기 ↗</a>
          </p>
        )}

        {/* 카드는 이미 읽을 수 있는데 나머지를 못 받은 경우 — 본문이 보이므로 실패의 크기가 다르다(2차 설계 §D) */}
        {tweet && load === 'error' && (
          <p className="px-4 pb-3 text-caption text-red-500">
            이미지·인용을 불러오지 못했어요. <button onClick={() => setRetry((n) => n + 1)} className="underline">다시 시도</button>
          </p>
        )}
        {tweet && load === 'missing' && (
          <p className="px-4 pb-3 text-caption text-x-muted">
            이 글은 지금 목록에 없어요 — 표에 있던 내용만 보여드려요
          </p>
        )}

        {/* 이 카드에서 실제로 번역을 시도했고, 그 시도가 아직 진행 중이 아닌데 실패가 남아 있을 때만.
            유료 API 경로라 사용자가 실패 여부를 반드시 알아야 한다. */}
        {translateAttempted && !translating && translateErr && (
          <p className="px-4 pb-4 text-caption text-red-500">
            {translateErr} <button onClick={() => handleTranslate(tweetId)} className="underline">다시 시도</button>
          </p>
        )}
      </div>
    </div>
  );
}
