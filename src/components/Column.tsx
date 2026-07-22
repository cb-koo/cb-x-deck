'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnRow, SearchConfig, SortDir, SortKey, StoredTweet, TweetTranslation } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { TweetCard } from './TweetCard';
import { CooccurrencePanel } from './CooccurrencePanel';
import { PillarPanel } from './PillarPanel';
import { TrendPanel } from './TrendPanel';
import type { PillarPayload } from '@/lib/pillarStats';
import { ChevronDownIcon, RefreshIcon, SearchIcon, SettingsIcon, TrashIcon, UserIcon } from './XIcons';
import { Button } from './ui';

function lastRefreshedLabel(iso: string | null): string {
  if (!iso) return '미조회';
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

const SORT_LABEL: Record<SortKey, string> = { views: '조회수', date: '날짜', bookmarks: '북마크', retweets: 'RT' };

// 활성 기준 버튼에 방향을 말로 붙임 (기준에 따라 문구 분기)
function dirText(sort: SortKey, dir: SortDir): string {
  if (sort === 'date') return dir === 'desc' ? '최신순' : '오래된순';
  return dir === 'desc' ? '많은순' : '적은순';
}
// 활성 기준 버튼 호버/스크린리더용 — 현재 정렬 상태 + 다시 누르면 뒤집힌다는 안내
function dirLabel(sort: SortKey, dir: SortDir): string {
  return `${SORT_LABEL[sort]} ${dirText(sort, dir)} — 다시 누르면 정렬 순서가 바뀝니다`;
}

export function Column({ column, autoRefresh, onEdit, onDelete, onPickTag, tourAnchor }: {
  column: ColumnRow;
  autoRefresh?: boolean;   // 생성 직후 1회 자동 조회 (page.tsx가 방금 만든 컬럼에만 지정)
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
  tourAnchor?: boolean;
}) {
  // 서버는 항상 전체 tweets를 반환한다. 보기(view)는 전체/버림 두 가지뿐이며 dismissed 여부로만 갈린다.
  // 공출현(CooccurrencePanel) 집계는 항상 전체 tweets 기준이라 view/visible의 영향을 받지 않는다(목적=담론 자동 부상).
  const { member } = useMember();
  const [tweets, setTweets] = useState<StoredTweet[]>([]);
  const [sort, setSort] = useState<SortKey>(column.config.sort ?? 'views');
  const [dir, setDir] = useState<SortDir>(column.config.dir ?? 'desc');
  const [total, setTotal] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(column.lastRefreshedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [translations, setTranslations] = useState<Record<string, TweetTranslation>>({});
  const [showTranslations, setShowTranslations] = useState(false);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translateErr, setTranslateErr] = useState(''); // 번역 전용 오류(새로고침 err와 분리 — 재시도 동작이 다름)
  const [width, setWidth] = useState<number>(column.config.width ?? 400);
  const [showPillar, setShowPillar] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [pillarMap, setPillarMap] = useState<Record<string, string>>({});
  const [topicLabels, setTopicLabels] = useState<Record<string, string>>({});
  // 안정 참조 — 인라인 화살표를 넘기면 렌더마다 새 참조 → PillarPanel의 load useEffect 재발화 → 무한 GET 루프
  const handlePillarData = useCallback((p: PillarPayload) => {
    setPillarMap(p.tweetTopics);
    setTopicLabels(Object.fromEntries((p.stats?.rows ?? []).map((r) => [r.topicId, r.label])));
  }, []);

  // 보기 상태 = showDismissed 파생 (전체/버림)
  const viewRef = useRef<HTMLDetailsElement>(null);
  const view: 'all' | 'dismissed' = showDismissed ? 'dismissed' : 'all';
  const VIEW_LABEL = { all: '전체', dismissed: '버림' } as const;
  function pickView(v: 'all' | 'dismissed') {
    setShowDismissed(v === 'dismissed');
    // 버림 진입·이탈 양쪽에서 주제 필터 해제 (이탈 시 잔존 필터로 목록이 갑자기 줄어드는 혼동 방지)
    if (v === 'dismissed' || showDismissed) setTopicFilter(null);
    viewRef.current?.removeAttribute('open');
  }

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
        apiFetch(`/api/columns/${column.id}`, {
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
    const r = await apiFetch(`/api/columns/${column.id}/tweets?sort=${s}&dir=${dir}${showDismissed ? '&dismissed=only' : ''}`);
    if (r.ok) {
      const res = (await r.json()) as { tweets: StoredTweet[]; total: number };
      setTweets(res.tweets);
      setTotal(res.total);
      setHasMore(res.tweets.length === PAGE); // 꽉 찬 페이지면 뒤에 더 있을 가능성
    }
  }, [column.id, showDismissed, dir]);

  // 다음 페이지를 이어붙임 (정렬·새로고침 시 load()가 첫 페이지로 리셋)
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await apiFetch(`/api/columns/${column.id}/tweets?sort=${sort}&dir=${dir}&offset=${tweets.length}${showDismissed ? '&dismissed=only' : ''}`);
      if (r.ok) {
        const res = (await r.json()) as { tweets: StoredTweet[]; total: number };
        setTweets((prev) => [...prev, ...res.tweets]);
        setTotal(res.total);
        setHasMore(res.tweets.length === PAGE);
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

  // 버림 보기 중엔 주제 맵에 버림 트윗이 없어 필터를 걸면 항상 빈 목록이 된다 — 이때는 필터 미적용
  const visible = topicFilter && !showDismissed ? tweets.filter((t) => pillarMap[t.tweetId] === topicFilter) : tweets;

  // 성공 시 true. 실패는 translateErr에 담아 반환(호출자가 표시 전환을 성공에 게이팅)
  async function translateIds(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const r = await apiFetch('/api/tweets/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetIds: ids }),
    });
    if (!r.ok) {
      setTranslateErr((await r.json().catch(() => ({})) as { error?: string }).error ?? '번역에 실패했어요');
      return false;
    }
    const res = (await r.json()) as { translations: Record<string, TweetTranslation> };
    setTranslations((prev) => ({ ...prev, ...res.translations }));
    setTranslateErr('');
    return true;
  }

  async function translateAll() {
    if (showTranslations) { setShowTranslations(false); return; } // 토글 오프(캐시는 유지)
    setTranslatingAll(true); setTranslateErr('');
    const alreadyShown = tweets.some((t) => translations[t.tweetId]); // 캐시로 이미 보여줄 게 있나
    setShowTranslations(true); // 표시 모드 먼저 켬 — 청크가 도착하는 대로 그 카드가 바로 뜬다
    try {
      // 미번역분을 10건씩 순차 요청 → 각 응답 즉시 setTranslations로 위에서부터 순차 노출
      // (한 번에 전부 기다렸다 한꺼번에 뜨던 방식 → 번역되는 대로 점진 표시)
      const need = tweets.filter((t) => !translations[t.tweetId]).map((t) => t.tweetId);
      const size = 10;
      let anyOk = false;
      for (let i = 0; i < need.length; i += size) {
        if (await translateIds(need.slice(i, i + size))) anyOk = true;
      }
      // 보여줄 게 전무(캐시도 없고 전부 실패)면 표시 모드 원복 — '번역 숨기기' 오인 방지
      if (need.length > 0 && !anyOk && !alreadyShown) setShowTranslations(false);
    } finally {
      setTranslatingAll(false); // 네트워크 예외에도 '번역 중…' 고착 방지
    }
  }

  async function translateOne(tweetId: string) {
    setTranslatingIds((s) => new Set(s).add(tweetId));
    try { await translateIds([tweetId]); }
    finally { setTranslatingIds((s) => { const n = new Set(s); n.delete(tweetId); return n; }); }
  }

  async function refresh() {
    setBusy(true); setErr('');
    const r = await apiFetch(`/api/columns/${column.id}/refresh`, { method: 'POST' });
    if (r.ok) {
      setLastRefreshed(new Date().toISOString());
      await load(sort);
    } else {
      setErr((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    }
    setBusy(false);
  }

  async function save(tweetId: string) {
    if (!member) { setErr('내 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요'); return; }
    await apiFetch('/api/candidates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, sourceColumnId: column.id, workspaceId: column.workspaceId, memberId: member.id }),
    });
    await load(sort);
  }
  async function unsave(tweetId: string) {
    if (!member) { setErr('내 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요'); return; }
    await apiFetch(`/api/candidates?tweetId=${tweetId}&workspaceId=${column.workspaceId}&memberId=${member.id}`, { method: 'DELETE' });
    await load(sort);
  }

  async function dismissTweet(tweetId: string) {
    await apiFetch('/api/dismissed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, workspaceId: column.workspaceId, memberId: member?.id ?? null }),
    });
    await load(sort);
  }
  async function undismissTweet(tweetId: string) {
    await apiFetch(`/api/dismissed?tweetId=${tweetId}&workspaceId=${column.workspaceId}`, { method: 'DELETE' });
    await load(sort);
  }

  const keywords = column.kind === 'search' ? ((column.config as SearchConfig).keywords ?? []) : [];

  return (
    <section style={{ width }} className="relative flex h-full shrink-0 flex-col border-r border-x-border">
      <header className="border-b border-x-border bg-x-surface px-3 pt-2">
        <div className="flex items-center gap-1.5">
          {column.kind === 'watchlist'
            ? <UserIcon className="h-4 w-4 shrink-0 text-x-secondary" />
            : <SearchIcon className="h-4 w-4 shrink-0 text-x-secondary" />}
          <h2 className="truncate text-content font-bold">{column.title}</h2>
          {total > 0 && (
            <span className="shrink-0 rounded-full bg-x-text/5 px-1.5 py-0.5 text-caption text-x-muted"
                  title={showDismissed ? '버린 트윗 수' : '이 컬럼에 조회된 전체 트윗 수'}>{total.toLocaleString()}</span>
          )}
          <span className="ml-auto shrink-0 text-caption text-x-muted">{busy ? '새로고침 중…' : lastRefreshedLabel(lastRefreshed)}</span>
          <Button variant="icon" onClick={refresh} disabled={busy} title="새로고침"
                  data-tour={tourAnchor ? 'col-refresh' : undefined}
                  className={busy ? 'text-x-blue' : ''}>
            <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="icon" onClick={onEdit} title="설정"><SettingsIcon className="h-4 w-4" /></Button>
          <Button variant="icon" onClick={onDelete} title="컬럼 삭제"><TrashIcon className="h-4 w-4" /></Button>
        </div>
        <div data-tour={tourAnchor ? 'col-sort' : undefined} className="mt-0.5 flex flex-wrap items-center gap-0.5 pb-1">
          <span className="mr-0.5 shrink-0 text-caption text-x-muted">정렬</span>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => {
            const active = sort === k;
            return (
              <button key={k}
                      onClick={() => (active ? setDir((d) => (d === 'desc' ? 'asc' : 'desc')) : setSort(k))}
                      aria-label={active ? dirLabel(k, dir) : `${SORT_LABEL[k]} 기준으로 정렬`}
                      title={active ? dirLabel(k, dir) : `${SORT_LABEL[k]} 기준으로 정렬`}
                      className={`relative rounded px-2 py-1.5 text-ui hover:bg-x-text/5 ${active ? 'font-medium text-x-text' : 'text-x-secondary'}`}>
                {SORT_LABEL[k]}{active && <> {dirText(k, dir)} <span aria-hidden>{dir === 'desc' ? '↓' : '↑'}</span></>}
                {active && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-x-blue" />}
              </button>
            );
          })}
          <span className="mx-1.5 h-4 w-px shrink-0 bg-x-border-strong" aria-hidden />
          <span className="mr-0.5 shrink-0 text-caption text-x-muted">분석</span>
          <Button variant="ghost" onClick={() => setShowTrend((v) => !v)}
                  className={showTrend ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                  title="이 컬럼에 쌓인 트윗으로 주간 추이를 보여줘요 · 추가 비용 없음">
            추이{showTrend ? ' ✓' : ''}
          </Button>
          <Button variant="ghost" onClick={translateAll} disabled={translatingAll}
                  className={showTranslations ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                  title="이 컬럼에 불러온 트윗을 한국어로 — 몇 초 걸릴 수 있어요 (한 번 번역하면 저장돼요)">
            {translatingAll ? '번역 중…' : showTranslations ? '번역 숨기기' : '🌐 전체 번역'}
          </Button>
          {column.kind === 'watchlist' && (
            <Button variant="ghost" onClick={() => { setShowPillar((v) => !v); if (showPillar) setTopicFilter(null); }}
                    className={showPillar ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                    title="이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하">
              주제 분석{showPillar ? ' ✓' : ''}
            </Button>
          )}
          <details ref={viewRef} data-tour={tourAnchor ? 'col-view' : undefined} className="relative ml-auto shrink-0">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full px-2.5 py-1 text-ui text-x-secondary hover:bg-x-text/5 [&::-webkit-details-marker]:hidden">
              보기: {VIEW_LABEL[view]} <ChevronDownIcon className="h-3 w-3" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-x-border bg-white py-1 shadow-lg">
              {(['all', 'dismissed'] as const).map((v) => (
                <button key={v} onClick={() => pickView(v)}
                        className={`block w-full px-3 py-1.5 text-left text-ui hover:bg-x-hover ${view === v ? 'font-medium' : ''}`}>
                  {VIEW_LABEL[v]}
                  <span className="ml-1 text-caption text-x-muted">
                    {v === 'dismissed' ? '숨긴 트윗' : ''}
                  </span>
                </button>
              ))}
            </div>
          </details>
        </div>
        {err && <p className="pb-1 text-caption text-red-500">{err} <button onClick={refresh} className="underline">재시도</button></p>}
        {translateErr && <p className="pb-1 text-caption text-red-500">{translateErr} <button onClick={translateAll} className="underline">재시도</button></p>}
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
      {((topicFilter && !showDismissed) || showDismissed) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-x-border bg-white px-3 py-1.5">
          {topicFilter && !showDismissed && (
            <button onClick={() => setTopicFilter(null)} title="필터 해제"
                    className="flex items-center gap-1 rounded-full bg-x-blue/10 px-2.5 py-0.5 text-ui font-medium text-x-blue-hover hover:bg-x-blue/20">
              주제: {topicLabels[topicFilter] ?? '선택 주제'} <span aria-hidden>✕</span>
            </button>
          )}
          {showDismissed && (
            <button onClick={() => pickView('all')} title="보기 해제"
                    className="flex items-center gap-1 rounded-full bg-x-blue/10 px-2.5 py-0.5 text-ui font-medium text-x-blue-hover hover:bg-x-blue/20">
              버림 보기 <span aria-hidden>✕</span>
            </button>
          )}
          <span className="text-caption text-x-muted">{visible.length}건 표시 중</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0
          ? <p className="p-4 text-center text-ui text-x-muted">
              {topicFilter ? '이 주제의 트윗이 현재 목록에 없어요 (주제를 다시 눌러 해제)' : '트윗 없음'}
            </p>
          : visible.map((t, i) => (
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null}
                         tourAnchor={tourAnchor && i === 0}
                         onSave={save} onUnsave={unsave}
                         onDismiss={dismissTweet} onUndismiss={undismissTweet} dismissedView={showDismissed}
                         translation={translations[t.tweetId] ?? null}
                         showTranslation={showTranslations}
                         onTranslate={translateOne}
                         translating={translatingIds.has(t.tweetId)} />
            ))}
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
                  className="w-full border-t border-x-border py-3 text-center text-ui text-x-blue hover:bg-x-hover disabled:opacity-50">
            {loadingMore ? '불러오는 중…' : `더 불러오기 (${tweets.length}개 이후)`}
          </button>
        )}
      </div>
      <div onMouseDown={startResize} title="드래그로 폭 조절"
           className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-x-blue/40 active:bg-x-blue/60" />
    </section>
  );
}
