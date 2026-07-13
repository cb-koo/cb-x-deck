'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CandidateRow } from '@/lib/types';
import { groupCandidates, filterGroups } from '@/lib/candidateGroups';
import { CandidateCard } from '@/components/CandidateCard';
import { useMember } from '@/lib/memberContext';

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { members, member } = useMember();
  const meId = member?.id ?? null;
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<string | null>(null); // null = 전체

  // 전량 fetch 후 클라이언트에서 그룹 단위 필터 — 서버 필터를 쓰면 같은 트윗의 타인 코멘트 행이 잘려나감
  const load = useCallback(async () => {
    const [cr, tr] = await Promise.all([
      fetch(`/api/candidates?workspaceId=${wsId}`),
      fetch(`/api/tags?workspaceId=${wsId}`),
    ]);
    if (cr.ok) setCandidates(await cr.json());
    if (tr.ok) setTags(await tr.json());
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(
    () => filterGroups(groupCandidates(candidates), { memberId: activeMember, tag: activeTag }),
    [candidates, activeMember, activeTag],
  );

  const chip = 'rounded-full border px-2 py-0.5 text-xs';
  const on = 'border-gray-900 font-bold dark:border-gray-100';
  const off = 'border-gray-300 text-gray-500 dark:border-gray-700';
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h1 className="font-bold">📁 보관함 <span className="text-sm font-normal text-gray-400">{groups.length}건</span></h1>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <span className="mr-1 text-[11px] text-gray-400">멤버</span>
        <button onClick={() => setActiveMember(null)} className={`${chip} ${activeMember === null ? on : off}`}>전체</button>
        {members.map((m) => (
          <button key={m.id} onClick={() => setActiveMember(m.id)} className={`${chip} ${activeMember === m.id ? on : off}`}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />{m.name}
          </button>
        ))}
        <span className="ml-3 mr-1 text-[11px] text-gray-400">태그</span>
        <button onClick={() => setActiveTag(null)} className={`${chip} ${activeTag === null ? on : off}`}>전체</button>
        {tags.filter((t) => t.count > 0).map((t) => (
          <button key={t.id} onClick={() => setActiveTag(t.name)} className={`${chip} ${activeTag === t.name ? on : off}`}>
            #{t.name} {t.count}
          </button>
        ))}
      </div>
      <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.length === 0 && <p className="text-sm text-gray-400">저장된 후보가 없습니다 — 덱에서 ☆저장을 누르세요</p>}
        {groups.map((g) => <CandidateCard key={g.tweet.tweetId} group={g} meId={meId} onChanged={load} />)}
      </main>
    </div>
  );
}
