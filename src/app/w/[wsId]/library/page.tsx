'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { LibraryEntry } from '@/lib/candidateStore';
import { filterLibrary } from '@/lib/candidateGroups';
import { CandidateCard } from '@/components/CandidateCard';
import { ScoutList } from '@/components/ScoutList';
import { useTranslations } from '@/components/useTranslations';
import { Button } from '@/components/ui';
import { useMember } from '@/lib/memberContext';
import { Toast } from '@/components/Toast';

type View = 'tweets' | 'scouts';

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { members, member } = useMember();
  const meId = member?.id ?? null;
  const [view, setView] = useState<View>('tweets');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<string | null>(null); // null = 전체
  const [loaded, setLoaded] = useState(false); // 첫 로드 완료 여부 — 로딩 중엔 빈 상태를 보이지 않게
  const [error, setError] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null); // 빼는 중인 tweetId
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { translations, showTranslations, translatingAll, translatingIds, translateErr,
          loadCached, translateAll, translateOne } = useTranslations();

  // 전량 fetch 후 클라이언트에서 그룹 단위 필터 — 서버 필터를 쓰면 같은 트윗의 타인 코멘트 행이 잘려나감
  const load = useCallback(async () => {
    setError(false);
    try {
      const [lr, tr] = await Promise.all([
        apiFetch(`/api/library?workspaceId=${wsId}`),
        apiFetch(`/api/tags?workspaceId=${wsId}`),
      ]);
      if (!lr.ok) { setError(true); return; }
      setEntries(await lr.json());
      if (tr.ok) setTags(await tr.json());
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  // 팀에서 빼기: 즉시 서버 삭제하지 않고 낙관적으로 숨긴 뒤 ~5초 실행취소 토스트. 타임아웃/이탈 시 커밋.
  const commitRemove = useCallback(async (tweetId: string) => {
    await apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${tweetId}`, { method: 'DELETE' });
    setPendingRemove((cur) => (cur === tweetId ? null : cur));
    load();
  }, [wsId, load]);

  const requestRemoveTeam = useCallback((tweetId: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current); // 대기 중 다른 요청 → 앞의 것 즉시 커밋
    setPendingRemove((prev) => { if (prev && prev !== tweetId) void commitRemove(prev); return tweetId; });
    removeTimer.current = setTimeout(() => { void commitRemove(tweetId); }, 5000);
  }, [commitRemove]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setPendingRemove(null); // 아무것도 삭제 안 함(지연 커밋이라 데이터 온전)
  }, []);

  // 대기 중 tweetId를 ref로 추적(언마운트 시 최신값 참조용) — pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋되므로, deps는 wsId만 두고 실제 이탈 시에만 커밋.
  const pendingRef = useRef<string | null>(null);
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRef.current) void apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${pendingRef.current}`, { method: 'DELETE' });
  }, [wsId]);

  const groups = useMemo(
    () => filterLibrary(entries, { memberId: activeMember, tag: activeTag }).filter((e) => e.tweet.tweetId !== pendingRemove),
    [entries, activeMember, activeTag, pendingRemove],
  );

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
            <span className="ml-3 mr-1 text-caption text-x-muted">태그</span>
            <button onClick={() => setActiveTag(null)} aria-pressed={activeTag === null} className={`${chip} ${activeTag === null ? on : off}`}>전체</button>
            {tags.filter((t) => t.count > 0).map((t) => (
              <button key={t.id} onClick={() => setActiveTag(t.name)} aria-pressed={activeTag === t.name} className={`${chip} ${activeTag === t.name ? on : off}`}>
                #{t.name} {t.count}
              </button>
            ))}
            <Button variant="ghost" onClick={() => translateAll(groups.map((g) => g.tweet.tweetId))} disabled={translatingAll}
                    className={`ml-auto ${showTranslations ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}`}
                    title="지금 보이는 트윗을 한국어로 — 덱에서 이미 번역한 건 무료로 바로 표시돼요 (새로 번역하면 저장돼 재사용돼요)">
              {translatingAll ? '번역 중…' : showTranslations ? '번역 숨기기' : '전체 번역'}
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
              <button onClick={() => { setActiveMember(null); setActiveTag(null); }} className="underline">필터 초기화</button>
            </p>
          ) : (
            <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => (
                <CandidateCard key={g.tweet.tweetId} entry={g} meId={meId} wsId={wsId} onChanged={load}
                               onRemoveTeam={requestRemoveTeam}
                               translation={translations[g.tweet.tweetId] ?? null}
                               showTranslation={showTranslations}
                               onTranslate={translateOne}
                               translating={translatingIds.has(g.tweet.tweetId)} />
              ))}
            </main>
          )}
        </>
      )}
      {view === 'scouts' && <ScoutList wsId={wsId} />}
      {pendingRemove && (
        <Toast message="팀 보관함에서 뺐어요" actionLabel="실행취소" onAction={undoRemove} />
      )}
    </div>
  );
}
