'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import type { LibraryEntry } from '@/lib/candidateStore';
import { filterLibrary } from '@/lib/candidateGroups';
import { CandidateCard } from '@/components/CandidateCard';
import { ScoutList } from '@/components/ScoutList';
import { useTranslations } from '@/components/useTranslations';
import { Button } from '@/components/ui';
import { useMember } from '@/lib/memberContext';
import { useToast } from '@/lib/toastContext';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';

type View = 'tweets' | 'scouts';

// 열 개수: 기존 그리드 브레이크포인트(md 768 / xl 1280)를 그대로 따른다. SSR 스냅샷은 3.
const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};
const getCols = () =>
  window.matchMedia('(min-width: 1280px)').matches ? 3 : window.matchMedia('(min-width: 768px)').matches ? 2 : 1;

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { members, member } = useMember();
  const { show, hide } = useToast();
  const meId = member?.id ?? null;
  const [view, setView] = useState<View>('tweets');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [activeMember, setActiveMember] = useState<string | null>(null); // null = 전체
  const [loaded, setLoaded] = useState(false); // 첫 로드 완료 여부 — 로딩 중엔 빈 상태를 보이지 않게
  const [error, setError] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null); // 리스트에서 숨김(커밋 완료까지)
  const [undoTweet, setUndoTweet] = useState<string | null>(null); // 실행취소 토스트 노출(커밋 시작 전까지)
  const [addOpen, setAddOpen] = useState(false);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { translations, showTranslations, translatingAll, translateProgress, translatingIds, translateErr,
          loadCached, translateAll, translateOne } = useTranslations();

  // 전량 fetch 후 클라이언트에서 그룹 단위 필터 — 서버 필터를 쓰면 같은 트윗의 타인 코멘트 행이 잘려나감
  const load = useCallback(async () => {
    setError(false);
    try {
      const lr = await apiFetch(`/api/library?workspaceId=${wsId}`);
      if (!lr.ok) { setError(true); return; }
      setEntries(await lr.json());
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  // 링크 추가 성공 — 결과를 판단까지 서술(UX 원칙 3): 중복이면 ★ 표시만 갱신됐음을 알린다
  const handleAdded = useCallback((r: AddedByLink) => {
    void load();
    show(r.alreadyInLibrary ? '이미 보관함에 있어요 — 내 저장(★)으로 표시했어요' : '보관함에 추가했어요');
  }, [load, show]);

  // 팀에서 빼기: 즉시 서버 삭제하지 않고 낙관적으로 숨긴 뒤 ~5초 실행취소 토스트.
  // pendingRemove=리스트 숨김(커밋 완료까지), undoTweet=토스트/실행취소(커밋 시작 전까지).
  // 토스트는 DELETE 시작 순간 내림 — 삭제가 이미 나간 뒤 실행취소를 눌러 데이터가 소실되는 레이스 방지.
  const commitRemove = useCallback(async (tweetId: string) => {
    await apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${tweetId}`, { method: 'DELETE' });
    await load();
    setPendingRemove((cur) => (cur === tweetId ? null : cur));
  }, [wsId, load]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setUndoTweet(null);
    hide();
    setPendingRemove(null); // 카드 복원, 아무것도 삭제 안 함
  }, [hide]);

  // 토스트 노출 ⟺ undoTweet !== null 을 유지한다. undoTweet이 바뀌는 지점마다 show/hide를 짝지어 부른다
  // (effect로 배선하면 react-hooks/set-state-in-effect 위반).
  const requestRemoveTeam = useCallback((tweetId: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (undoTweet && undoTweet !== tweetId) void commitRemove(undoTweet); // 대기 중 다른 건 즉시 커밋
    setPendingRemove(tweetId);
    setUndoTweet(tweetId);
    // duration:null = 자동 소멸 없음, dismissible:false = ✕ 없음.
    // 5초 뒤 삭제가 커밋되므로 토스트가 먼저 사라지거나 사용자가 닫아 실행취소 기회를 잃으면 안 된다.
    show('팀 보관함에서 뺐어요', { actionLabel: '실행취소', onAction: undoRemove, duration: null, dismissible: false });
    removeTimer.current = setTimeout(() => {
      setUndoTweet((cur) => (cur === tweetId ? null : cur)); // 실행취소 불가 시점 → 토스트 내림
      hide();
      void commitRemove(tweetId);
    }, 5000);
  }, [commitRemove, undoTweet, show, hide, undoRemove]);

  // 대기 중 tweetId를 ref로 추적(언마운트 시 최신값 참조용) — pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋되므로, deps는 wsId와 참조 고정된 hide만 둔다.
  const pendingRef = useRef<string | null>(null);
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    hide();   // 프로바이더는 레이아웃에 있어 페이지를 떠나도 살아있다 — 지속 토스트를 남기지 않는다
    if (pendingRef.current) void apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${pendingRef.current}`, { method: 'DELETE' });
  }, [wsId, hide]);

  const groups = useMemo(
    () => filterLibrary(entries, { memberId: activeMember }).filter((e) => e.tweet.tweetId !== pendingRemove),
    [entries, activeMember, pendingRemove],
  );

  // 열 분배(masonry-lite): 인덱스 라운드로빈으로 나눠 각 열이 독립적으로 쌓인다.
  // 행 정렬 그리드는 행마다 최장 카드 아래에 빈 공간이 남았음(08-15 QA). 높이 측정 없이 인덱스로만
  // 배정하므로 카드 펼침·편집은 같은 열 아래쪽만 밀어내고 열 간 점프가 없다 — masonry 반려 사유 회피.
  const cols = useSyncExternalStore(subscribeResize, getCols, () => 3);
  const columns = useMemo(() => {
    const out: (typeof groups)[] = Array.from({ length: cols }, () => []);
    groups.forEach((g, i) => out[i % cols].push(g));
    return out;
  }, [groups, cols]);

  // 진입/갱신 시 덱에서 번역해둔 트윗을 캐시에서 조용히 불러온다(과금 없음). 미번역분은 카드 버튼으로 opt-in.
  const savedIds = useMemo(() => entries.map((e) => e.tweet.tweetId), [entries]);
  useEffect(() => { if (savedIds.length > 0) loadCached(savedIds); }, [savedIds, loadCached]);

  const chip = 'rounded-full border px-2 py-0.5 text-ui hover:bg-x-hover';
  const on = 'border-x-text font-bold text-x-text';
  const off = 'border-x-border-strong text-x-secondary';
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-x-border px-4 py-2">
        <h1 className="font-bold">📁 보관함 <span className="text-ui font-normal text-x-muted">{view === 'tweets' && loaded && !error ? `${groups.length}건` : ''}</span></h1>
        <div className="flex gap-1">
          <button onClick={() => setAddOpen(true)} className={`${chip} ${off}`}>🔗 링크로 추가</button>
          <button onClick={() => setView('tweets')} aria-pressed={view === 'tweets'} className={`${chip} ${view === 'tweets' ? on : off}`}>트윗</button>
          <button onClick={() => setView('scouts')} aria-pressed={view === 'scouts'} className={`${chip} ${view === 'scouts' ? on : off}`}>섭외 후보</button>
        </div>
      </div>
      {view === 'tweets' && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-x-border px-4 py-2">
            <span className="mr-1 text-caption text-x-muted">멤버</span>
            <button onClick={() => setActiveMember(null)} aria-pressed={activeMember === null} className={`${chip} ${activeMember === null ? on : off}`}>전체</button>
            {members.map((m) => (
              <button key={m.id} onClick={() => setActiveMember(m.id)} aria-pressed={activeMember === m.id} className={`${chip} ${activeMember === m.id ? on : off}`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />{m.name}
              </button>
            ))}
            <Button variant="ghost" onClick={() => translateAll(groups.map((g) => g.tweet.tweetId))} disabled={translatingAll}
                    className={`ml-auto ${showTranslations ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}`}
                    title="지금 보이는 트윗을 한국어로 — 덱에서 이미 번역한 건 무료로 바로 표시돼요 (새로 번역하면 저장돼 재사용돼요)">
              {translatingAll
                ? `번역 중… ${translateProgress ? `${translateProgress.done}/${translateProgress.total}` : ''}`
                : showTranslations ? '번역 숨기기' : '전체 번역'}
            </Button>
          </div>
          {translateErr && (
            <p className="border-b border-x-border px-4 py-1 text-caption text-red-500">
              {translateErr} <button onClick={() => translateAll(groups.map((g) => g.tweet.tweetId))} className="underline">재시도</button>
            </p>
          )}
          {!loaded ? (
            <p className="p-4 text-ui text-x-muted">불러오는 중…</p>
          ) : error ? (
            <p className="p-4 text-ui text-red-500">보관함을 불러오지 못했어요. <button onClick={load} className="underline">재시도</button></p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-ui text-x-muted">아직 저장한 트윗이 없어요 — 덱에서 트윗의 ☆를 누르면 여기에 모입니다</p>
          ) : groups.length === 0 ? (
            <p className="p-4 text-ui text-x-muted">
              조건에 맞는 저장물이 없어요 — 필터를 바꾸거나{' '}
              <button onClick={() => setActiveMember(null)} className="underline">필터 초기화</button>
            </p>
          ) : (
            <main className="flex items-start gap-3 p-4">
              {columns.map((column, ci) => (
                <div key={ci} className="flex min-w-0 flex-1 flex-col gap-3">
                  {column.map((g) => (
                    <CandidateCard key={g.tweet.tweetId} entry={g} meId={meId} wsId={wsId} onChanged={load}
                                   onRemoveTeam={requestRemoveTeam}
                                   translation={translations[g.tweet.tweetId] ?? null}
                                   showTranslation={showTranslations}
                                   onTranslate={translateOne}
                                   translating={translatingIds.has(g.tweet.tweetId)} />
                  ))}
                </div>
              ))}
            </main>
          )}
        </>
      )}
      {view === 'scouts' && <ScoutList wsId={wsId} />}
      <AddByLinkModal open={addOpen} onClose={() => setAddOpen(false)} fixedWsId={wsId} onAdded={handleAdded} />
    </div>
  );
}
