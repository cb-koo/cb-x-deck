'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CandidateRow } from '@/lib/types';
import { groupCandidates, filterGroups } from '@/lib/candidateGroups';
import { CandidateCard } from '@/components/CandidateCard';
import { ScoutList } from '@/components/ScoutList';
import { useTranslations } from '@/components/useTranslations';
import { Button } from '@/components/ui';
import { useMember } from '@/lib/memberContext';

type View = 'tweets' | 'scouts';

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { members, member } = useMember();
  const meId = member?.id ?? null;
  const [view, setView] = useState<View>('tweets');
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<string | null>(null); // null = 전체
  const { translations, showTranslations, translatingAll, translatingIds, translateErr,
          loadCached, translateAll, translateOne } = useTranslations();

  // 전량 fetch 후 클라이언트에서 그룹 단위 필터 — 서버 필터를 쓰면 같은 트윗의 타인 코멘트 행이 잘려나감
  const load = useCallback(async () => {
    const [cr, tr] = await Promise.all([
      apiFetch(`/api/candidates?workspaceId=${wsId}`),
      apiFetch(`/api/tags?workspaceId=${wsId}`),
    ]);
    if (cr.ok) setCandidates(await cr.json());
    if (tr.ok) setTags(await tr.json());
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(
    () => filterGroups(groupCandidates(candidates), { memberId: activeMember, tag: activeTag }),
    [candidates, activeMember, activeTag],
  );

  // 진입/갱신 시 덱에서 번역해둔 트윗을 캐시에서 조용히 불러온다(과금 없음). 미번역분은 카드 버튼으로 opt-in.
  const savedIds = useMemo(() => [...new Set(candidates.map((c) => c.tweet.tweetId))], [candidates]);
  useEffect(() => { if (savedIds.length > 0) loadCached(savedIds); }, [savedIds, loadCached]);

  const chip = 'rounded-full border px-2 py-0.5 text-xs hover:bg-x-hover';
  const on = 'border-x-text font-bold text-x-text';
  const off = 'border-x-border-strong text-x-secondary';
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-x-border px-4 py-2">
        <h1 className="font-bold">📁 보관함 <span className="text-sm font-normal text-x-muted">{view === 'tweets' ? `${groups.length}건` : ''}</span></h1>
        <div className="flex gap-1">
          <button onClick={() => setView('tweets')} className={`${chip} ${view === 'tweets' ? on : off}`}>트윗</button>
          <button onClick={() => setView('scouts')} className={`${chip} ${view === 'scouts' ? on : off}`}>섭외 후보</button>
        </div>
      </div>
      {view === 'tweets' && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-x-border px-4 py-2">
            <span className="mr-1 text-[11px] text-x-muted">멤버</span>
            <button onClick={() => setActiveMember(null)} className={`${chip} ${activeMember === null ? on : off}`}>전체</button>
            {members.map((m) => (
              <button key={m.id} onClick={() => setActiveMember(m.id)} className={`${chip} ${activeMember === m.id ? on : off}`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />{m.name}
              </button>
            ))}
            <span className="ml-3 mr-1 text-[11px] text-x-muted">태그</span>
            <button onClick={() => setActiveTag(null)} className={`${chip} ${activeTag === null ? on : off}`}>전체</button>
            {tags.filter((t) => t.count > 0).map((t) => (
              <button key={t.id} onClick={() => setActiveTag(t.name)} className={`${chip} ${activeTag === t.name ? on : off}`}>
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
          <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.length === 0 && <p className="text-sm text-x-muted">저장된 후보가 없습니다 — 덱에서 ☆저장을 누르세요</p>}
            {groups.map((g) => (
              <CandidateCard key={g.tweet.tweetId} group={g} meId={meId} onChanged={load}
                             translation={translations[g.tweet.tweetId] ?? null}
                             showTranslation={showTranslations}
                             onTranslate={translateOne}
                             translating={translatingIds.has(g.tweet.tweetId)} />
            ))}
          </main>
        </>
      )}
      {view === 'scouts' && <ScoutList wsId={wsId} />}
    </div>
  );
}
