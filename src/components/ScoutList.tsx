'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useState } from 'react';
import { formatCount } from '@/lib/format';
import type { Member } from '@/lib/types';

interface ScoutRow {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number | null;
  verified: boolean;
  sourceTweetId: string | null;
  sourceTweetUrl: string | null;
  savedAt: string;
  member: Member | null;
}

// 섭외 후보(스카우트) 보관함 뷰 — 리포스터 목록의 ☆ 섭외 후보에서 저장된 계정 모음
export function ScoutList({ wsId }: { wsId: string }) {
  const [scouts, setScouts] = useState<ScoutRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/scouts?workspaceId=${encodeURIComponent(wsId)}`);
    if (r.ok) setScouts(((await r.json()) as { scouts: ScoutRow[] }).scouts);
    setLoaded(true);
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  async function remove(handle: string) {
    await apiFetch(`/api/scouts?workspaceId=${encodeURIComponent(wsId)}&handle=${encodeURIComponent(handle)}`, { method: 'DELETE' });
    load();
  }

  if (loaded && scouts.length === 0) {
    return <p className="p-4 text-sm text-x-muted">아직 없어요 — 트윗 카드의 리포스터 목록에서 ☆ 섭외 후보를 누르면 여기에 모입니다</p>;
  }

  return (
    <div className="divide-y divide-x-border">
      {scouts.map((s) => (
        <div key={s.handle} className="flex items-center gap-2 px-4 py-2 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.avatarUrl
            ? <img src={s.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full" />
            : <div className="h-6 w-6 shrink-0 rounded-full bg-x-border-strong" />}
          <a href={`https://x.com/${s.handle}`} target="_blank" rel="noopener noreferrer" className="shrink-0 font-bold hover:underline">
            {s.name ?? s.handle}
          </a>
          {s.verified && <span className="shrink-0 text-x-blue-text" title="인증 계정">✓</span>}
          <span className="shrink-0 text-x-secondary">@{s.handle}</span>
          <span className="shrink-0 text-xs text-x-muted">
            {s.followers !== null ? `팔로워 ${formatCount(s.followers)}` : '팔로워 없음'}
          </span>
          {s.bio && <span className="min-w-0 flex-1 truncate text-xs text-x-muted">{s.bio}</span>}
          {s.sourceTweetUrl && (
            <a href={s.sourceTweetUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-x-blue-text hover:underline">
              출처 트윗 ↗
            </a>
          )}
          {s.member && (
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                  style={{ backgroundColor: s.member.color }} title={s.member.name}>
              {s.member.name.slice(0, 1)}
            </span>
          )}
          <button onClick={() => remove(s.handle)} className="ml-auto shrink-0 text-xs text-x-muted hover:text-red-500">
            ✕ 제거
          </button>
        </div>
      ))}
    </div>
  );
}
