'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnRow, SearchConfig, SortKey, StoredTweet, ViewMode } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { TweetCard } from './TweetCard';
import { CooccurrencePanel } from './CooccurrencePanel';
import { PillarPanel } from './PillarPanel';
import { TrendPanel } from './TrendPanel';
import type { PillarPayload } from '@/lib/pillarStats';
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
  // isNew(직전 새로고침 이후 새로 들어온 트윗)로 거를 뿐이다. 공출현(CooccurrencePanel) 집계는
  // 항상 전체 tweets 기준이며 mode/visible의 영향을 받지 않는다(목적=담론 자동 부상).
  const { member } = useMember();
  const [tweets, setTweets] = useState<StoredTweet[]>([]);
  const [sort, setSort] = useState<SortKey>(column.config.sort ?? 'views');
  const [mode, setMode] = useState<ViewMode>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(column.lastRefreshedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [width, setWidth] = useState<number>(column.config.width ?? 400);
  const [showPillar, setShowPillar] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [pillarMap, setPillarMap] = useState<Record<string, string>>({});
  // 안정 참조 — 인라인 화살표를 넘기면 렌더마다 새 참조 → PillarPanel의 load useEffect 재발화 → 무한 GET 루프
  const handlePillarData = useCallback((p: PillarPayload) => setPillarMap(p.tweetTopics), []);

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

  const PAGE = 200;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (s: SortKey) => {
    const r = await fetch(`/api/columns/${column.id}/tweets?sort=${s}${showDismissed ? '&dismissed=only' : ''}`);
    if (r.ok) {
      const page = (await r.json()) as StoredTweet[];
      setTweets(page);
      setHasMore(page.length === PAGE); // 꽉 찬 페이지면 뒤에 더 있을 가능성
    }
  }, [column.id, showDismissed]);

  // 다음 페이지를 이어붙임 (정렬·새로고침 시 load()가 첫 페이지로 리셋)
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/columns/${column.id}/tweets?sort=${sort}&offset=${tweets.length}${showDismissed ? '&dismissed=only' : ''}`);
      if (r.ok) {
        const page = (await r.json()) as StoredTweet[];
        setTweets((prev) => [...prev, ...page]);
        setHasMore(page.length === PAGE);
      }
    } finally { setLoadingMore(false); }
  }

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

  const modeFiltered = mode === 'new' ? tweets.filter((t) => t.isNew) : tweets;
  // 버림 보기 중엔 주제 맵에 버림 트윗이 없어 필터를 걸면 항상 빈 목록이 된다 — 이때는 필터 미적용
  const visible = topicFilter && !showDismissed ? modeFiltered.filter((t) => pillarMap[t.tweetId] === topicFilter) : modeFiltered;

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

  async function dismissTweet(tweetId: string) {
    await fetch('/api/dismissed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, workspaceId: column.workspaceId, memberId: member?.id ?? null }),
    });
    await load(sort);
  }
  async function undismissTweet(tweetId: string) {
    await fetch(`/api/dismissed?tweetId=${tweetId}&workspaceId=${column.workspaceId}`, { method: 'DELETE' });
    await load(sort);
  }

  const btn = 'rounded px-1.5 py-0.5 text-xs hover:bg-x-hover';
  const iconBtn = 'rounded-full p-1.5 text-x-secondary transition-colors hover:bg-x-blue/10 hover:text-x-blue disabled:opacity-60';
  const keywords = column.kind === 'search' ? ((column.config as SearchConfig).keywords ?? []) : [];

  return (
    <section style={{ width }} className="relative flex h-full shrink-0 flex-col border-r border-x-border">
      <header className="border-b border-x-border px-3 py-2">
        <div className="flex items-center gap-1">
          <h2 className="truncate font-bold">{column.kind === 'watchlist' ? '👤 ' : '🔍 '}{column.title}</h2>
          <span className="ml-auto text-[11px] text-x-muted">{busy ? '새로고침 중…' : lastRefreshedLabel(lastRefreshed)}</span>
          <button onClick={refresh} disabled={busy} className={`${iconBtn} ${busy ? 'text-x-blue' : ''}`} title="새로고침">
            <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onEdit} className={iconBtn} title="설정"><SettingsIcon className="h-4 w-4" /></button>
          <button onClick={onDelete} className={iconBtn} title="컬럼 삭제"><TrashIcon className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button key={k} onClick={() => setSort(k)}
                    className={`relative rounded px-2 py-1 text-[13px] hover:bg-x-hover ${sort === k ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
              {SORT_LABEL[k]}
              {sort === k && <span className="absolute inset-x-2 bottom-0 h-1 rounded-full bg-x-blue" />}
            </button>
          ))}
          <button onClick={() => setShowTrend((v) => !v)}
                  className={`${btn} ${showTrend ? 'font-bold text-x-text' : ''}`}
                  title="이 컬럼에 쌓인 트윗으로 주간 추이를 보여줘요 · 추가 비용 없음">
            추이{showTrend ? '✓' : ''}
          </button>
          {column.kind === 'watchlist' && (
            <button onClick={() => { setShowPillar((v) => !v); if (showPillar) setTopicFilter(null); }}
                    className={`${btn} ${showPillar ? 'font-bold text-x-text' : ''}`}
                    title="이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하">
              주제 분석{showPillar ? '✓' : ''}
            </button>
          )}
          <span className="ml-auto" />
          <button onClick={() => setMode(mode === 'new' ? 'all' : 'new')} className={btn}
                  title="NEW = 직전 새로고침 이후 새로 들어온 트윗">
            {mode === 'new' ? 'NEW만' : '전체'}
          </button>
          <button onClick={() => { setShowDismissed((v) => !v); setTopicFilter(null); }} className={`${btn} ${showDismissed ? 'font-bold text-x-text' : ''}`} title="버림 보기">
            {showDismissed ? '버림✓' : '버림'}
          </button>
        </div>
        {err && <p className="mt-1 text-xs text-red-500">{err} <button onClick={refresh} className="underline">재시도</button></p>}
      </header>
      {/* 새로고침 진행 표시 — 완료 전까지 상단 인디케이터 */}
      {busy && (
        <div className="h-0.5 overflow-hidden bg-x-blue/20">
          <div className="h-full w-1/3 animate-[deck-indeterminate_1.2s_ease-in-out_infinite] bg-x-blue" />
        </div>
      )}
      {showTrend && (
        <TrendPanel columnId={column.id} kind={column.kind}
                    onAfterBackfill={() => load(sort)}
                    onClose={() => setShowTrend(false)} />
      )}
      {column.kind === 'search' && (
        <CooccurrencePanel tweets={tweets} excludeKeywords={keywords} onPick={onPickTag} />
      )}
      {column.kind === 'watchlist' && showPillar && (
        <PillarPanel columnId={column.id}
                     topicFilter={topicFilter} onTopicFilter={setTopicFilter}
                     onData={handlePillarData}
                     onAfterBackfill={() => load(sort)}
                     onClose={() => { setShowPillar(false); setTopicFilter(null); }} />
      )}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0
          ? <p className="p-4 text-center text-sm text-x-muted">
              {topicFilter ? '이 주제의 트윗이 현재 목록에 없어요 (주제를 다시 눌러 해제)'
                : mode === 'new' ? '신규 유입 없음 — 그 자체가 시그널입니다' : '트윗 없음'}
            </p>
          : visible.map((t) => (
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null}
                         onSave={save} onUnsave={unsave}
                         onDismiss={dismissTweet} onUndismiss={undismissTweet} dismissedView={showDismissed} />
            ))}
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
                  className="w-full border-t border-x-border py-3 text-center text-sm text-x-blue hover:bg-x-hover disabled:opacity-50">
            {loadingMore ? '불러오는 중…' : `더 불러오기 (${tweets.length}개 이후)`}
          </button>
        )}
      </div>
      <div onMouseDown={startResize} title="드래그로 폭 조절"
           className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-x-blue/40 active:bg-x-blue/60" />
    </section>
  );
}
