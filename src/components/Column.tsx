'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnRow, SearchConfig, SortKey, StoredTweet, ViewMode } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { useSeenTracker } from '@/lib/useSeenTracker';
import { TweetCard } from './TweetCard';
import { CooccurrencePanel } from './CooccurrencePanel';
import { RefreshIcon, SettingsIcon, TrashIcon } from './XIcons';

function lastRefreshedLabel(iso: string | null): string {
  if (!iso) return '미조회';
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

const SORT_LABEL: Record<SortKey, string> = { views: '조회수', date: '날짜', bookmarks: '북마크', retweets: 'RT' };

export function Column({ column, autoRefresh, onEdit, onDelete, onPickTag }: {
  column: ColumnRow;
  autoRefresh?: boolean;   // 생성 직후 1회 자동 조회 (page.tsx가 방금 만든 컬럼에만 지정)
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
}) {
  // 기본 뷰는 mode='all'(전체) — 서버는 항상 전체 tweets를 반환하고, 'new'는 클라이언트에서
  // !seenByMe로 거를 뿐이다. 공출현(CooccurrencePanel) 집계는 항상 전체 tweets 기준으로 돌아가며
  // mode/visible의 영향을 받지 않는다 — "새 트윗만"으로 읽음 처리할수록 담론 신호가 사라지는 것을
  // 막기 위함(목적=담론 자동 부상).
  const { member } = useMember();
  const { observe } = useSeenTracker(member?.id ?? null);
  const [tweets, setTweets] = useState<StoredTweet[]>([]);
  const [sort, setSort] = useState<SortKey>(column.config.sort ?? 'views');
  const [mode, setMode] = useState<ViewMode>('all');
  const [lastRefreshed, setLastRefreshed] = useState(column.lastRefreshedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [width, setWidth] = useState<number>(column.config.width ?? 400);

  // 우측 가장자리 드래그로 폭 조절, 놓으면 config.width로 저장
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.min(720, Math.max(280, startW + ev.clientX - startX));
      setWidth(w);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (w !== startW) {
        fetch(`/api/columns/${column.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: { ...column.config, width: w } }),
        });
      }
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const load = useCallback(async (s: SortKey) => {
    const r = await fetch(`/api/columns/${column.id}/tweets?sort=${s}${member ? `&memberId=${member.id}` : ''}`);
    if (r.ok) setTweets(await r.json());
  }, [column.id, member]);

  useEffect(() => { load(sort); }, [load, sort]);

  // 생성 직후 1회 자동 조회 — 미조회(lastRefreshedAt=null) 상태일 때만, 재실행 방지 가드
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRefresh && !autoRan.current && !column.lastRefreshedAt) {
      autoRan.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const visible = mode === 'new' ? tweets.filter((t) => !t.seenByMe) : tweets;

  async function refresh() {
    setBusy(true); setErr('');
    const r = await fetch(`/api/columns/${column.id}/refresh`, { method: 'POST' });
    if (r.ok) {
      setLastRefreshed(new Date().toISOString());
      await load(sort);
    } else {
      setErr((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    }
    setBusy(false);
  }

  async function save(tweetId: string) {
    if (!member) { setErr('사이드바에서 멤버를 선택하세요'); return; }
    await fetch('/api/candidates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, sourceColumnId: column.id, workspaceId: column.workspaceId, memberId: member.id }),
    });
    await load(sort);
  }
  async function unsave(tweetId: string) {
    if (!member) { setErr('사이드바에서 멤버를 선택하세요'); return; }
    await fetch(`/api/candidates?tweetId=${tweetId}&workspaceId=${column.workspaceId}&memberId=${member.id}`, { method: 'DELETE' });
    await load(sort);
  }

  const btn = 'rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800';
  const iconBtn = 'rounded-full p-1.5 text-[#536471] transition-colors hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0] disabled:opacity-60';
  const keywords = column.kind === 'search' ? ((column.config as SearchConfig).keywords ?? []) : [];

  return (
    <section style={{ width }} className="relative flex h-full shrink-0 flex-col border-r border-gray-200 dark:border-gray-800">
      <header className="border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <div className="flex items-center gap-1">
          <h2 className="truncate font-bold">{column.kind === 'watchlist' ? '👤 ' : '🔍 '}{column.title}</h2>
          <span className="ml-auto text-[11px] text-gray-400">{busy ? '새로고침 중…' : lastRefreshedLabel(lastRefreshed)}</span>
          <button onClick={refresh} disabled={busy} className={`${iconBtn} ${busy ? 'text-[#1d9bf0]' : ''}`} title="새로고침">
            <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onEdit} className={iconBtn} title="설정"><SettingsIcon className="h-4 w-4" /></button>
          <button onClick={onDelete} className={iconBtn} title="컬럼 삭제"><TrashIcon className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button key={k} onClick={() => setSort(k)}
                    className={`${btn} ${sort === k ? 'font-bold underline' : 'text-gray-500'}`}>{SORT_LABEL[k]}</button>
          ))}
          <span className="ml-auto" />
          <button onClick={() => setMode(mode === 'new' ? 'all' : 'new')} className={btn}>
            {mode === 'new' ? '새 트윗만' : '전체'}
          </button>
        </div>
        {err && <p className="mt-1 text-xs text-red-500">{err} <button onClick={refresh} className="underline">재시도</button></p>}
      </header>
      {/* 새로고침 진행 표시 — 완료 전까지 상단 인디케이터 */}
      {busy && (
        <div className="h-0.5 overflow-hidden bg-[#1d9bf0]/20">
          <div className="h-full w-1/3 animate-[deck-indeterminate_1.2s_ease-in-out_infinite] bg-[#1d9bf0]" />
        </div>
      )}
      {column.kind === 'search' && (
        <CooccurrencePanel tweets={tweets} excludeKeywords={keywords} onPick={onPickTag} />
      )}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0
          ? <p className="p-4 text-center text-sm text-gray-400">{mode === 'new' ? '새 트윗 없음 — 🔄 새로고침' : '트윗 없음'}</p>
          : visible.map((t) => (
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null} observe={observe}
                         onSave={save} onUnsave={unsave} />
            ))}
      </div>
      <div onMouseDown={startResize} title="드래그로 폭 조절"
           className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-[#1d9bf0]/40 active:bg-[#1d9bf0]/60" />
    </section>
  );
}
