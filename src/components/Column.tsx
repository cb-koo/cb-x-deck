'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnRow, SearchConfig, SortDir, SortKey, StoredTweet } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { TweetCard } from './TweetCard';
import { useTranslations } from './useTranslations';
import { CooccurrencePanel } from './CooccurrencePanel';
import { PillarPanel } from './PillarPanel';
import { TrendPanel } from './TrendPanel';
import type { PillarPayload } from '@/lib/pillarStats';
import { ChevronDownIcon, RefreshIcon, SearchIcon, SettingsIcon, TrashIcon, UserIcon } from './XIcons';
import { Button } from './ui';
import { ColumnGrip } from './ColumnGrip';
import { SORT_LABEL, DECK_SORTS, dirText, dirLabel } from '@/lib/sortKeys';
import { relTimeFine } from '@/lib/relTime';

// relTime.ts로 옮긴 시/분 단위 포맷터 재사용 — suffix 없이 쓰는 관례는 InfluencerProfile.tsx의
// relTime(x, '').trim()과 동일하다.
function lastRefreshedLabel(iso: string | null): string {
  if (!iso) return '미조회';
  return relTimeFine(iso, '').trim();
}

export function Column({ column, isNew, index, total, onEdit, onDelete, onPickTag, onGripPointerDown, onKeyboardMove, tourAnchor }: {
  column: ColumnRow;
  isNew?: boolean;   // 방금 만든 컬럼 — 1회 자동 조회 + 화면으로 스크롤 + 잠깐 강조
  index: number;     // 0-based, 그립의 순서 안내용
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
  onGripPointerDown: (e: React.PointerEvent) => void;
  onKeyboardMove: (delta: -1 | 1) => void;
  tourAnchor?: boolean;
}) {
  // 서버는 항상 전체 tweets를 반환한다. 보기(view)는 전체/버림 두 가지뿐이며 dismissed 여부로만 갈린다.
  // 공출현(CooccurrencePanel) 집계는 항상 전체 tweets 기준이라 view/visible의 영향을 받지 않는다(목적=담론 자동 부상).
  const { member } = useMember();
  const [tweets, setTweets] = useState<StoredTweet[]>([]);
  const [sort, setSort] = useState<SortKey>(column.config.sort ?? 'views');
  const [dir, setDir] = useState<SortDir>(column.config.dir ?? 'desc');
  const [tweetTotal, setTweetTotal] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(column.lastRefreshedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false); // 컬럼 삭제 인라인 확인 (Sidebar 워크스페이스 삭제와 동일 패턴 — window.confirm 대체)
  // 번역 상태·동작은 보관함과 공유하는 훅으로 통일(캐시는 tweet_id 단위 전역)
  const { translations, showTranslations, translatingAll, translatingIds, translateErr,
          translateAll, translateOne } = useTranslations();
  const [width, setWidth] = useState<number>(column.config.width ?? 400);
  const rootRef = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState(false);
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
      setTweetTotal(res.total);
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
        setTweetTotal(res.total);
        setHasMore(res.tweets.length === PAGE);
      }
    } finally { setLoadingMore(false); }
  }

  useEffect(() => { load(sort); }, [load, sort]);

  // 생성 직후 1회 자동 조회 — 미조회(lastRefreshedAt=null) 상태일 때만, 재실행 방지 가드
  const autoRan = useRef(false);
  useEffect(() => {
    if (isNew && !autoRan.current && !column.lastRefreshedAt) {
      autoRan.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // 새 컬럼은 스트립 오른쪽 끝에 붙어 화면 밖일 수 있다. 스크롤로 데려오고 잠깐 강조해
  // "만들어졌다"를 눈에 보이게 한다 — 없으면 컬럼 4개 이상에서 화면이 그대로라 실패로 읽힌다.
  const cameIntoView = useRef(false);
  useEffect(() => {
    if (!isNew || cameIntoView.current || !rootRef.current) return;
    cameIntoView.current = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rootRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'end', block: 'nearest' });
    setHighlight(true);
    // cleanup에서 취소하지 않는다 — StrictMode 재실행 때 취소만 되고 가드에 막혀
    // 재예약이 안 돼 강조가 영영 안 꺼진다. 언마운트 후 setState는 React 18+에서 무해하게 무시된다.
    setTimeout(() => setHighlight(false), 1500);
  }, [isNew]);

  // 버림 보기 중엔 주제 맵에 버림 트윗이 없어 필터를 걸면 항상 빈 목록이 된다 — 이때는 필터 미적용
  const visible = topicFilter && !showDismissed ? tweets.filter((t) => pillarMap[t.tweetId] === topicFilter) : tweets;

  async function refresh() {
    setBusy(true); setErr('');
    const r = await apiFetch(`/api/columns/${column.id}/refresh`, { method: 'POST' });
    if (r.ok) {
      setLastRefreshed(new Date().toISOString());
      await load(sort);
    } else {
      setErr((await r.json().catch(() => ({})) as { error?: string }).error ?? `최신 트윗을 불러오지 못했어요. 잠시 후 다시 시도해 주세요 (코드 ${r.status})`);
    }
    setBusy(false);
  }

  // 저장으로 생성된 내 candidate.id를 tweetId별로 보관 — 저장 직후 인라인 메모(PATCH) 배선용.
  // load() 재조회의 StoredTweet엔 내 candidate.id가 없어 응답에서 잡아 둔다.
  const savedIdRef = useRef<Record<string, string>>({});
  async function save(tweetId: string) {
    if (!member) { setErr('내 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요'); return; }
    const r = await apiFetch('/api/candidates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, sourceColumnId: column.id, workspaceId: column.workspaceId, memberId: member.id }),
    });
    if (r.ok) {
      const created = await r.json().catch(() => null) as { id?: string } | null;
      if (created?.id) savedIdRef.current[tweetId] = created.id;
    }
    await load(sort);
  }
  // 저장 시점 인라인 메모 = 방금 만든 candidate 행에 memo PATCH (캡처는 여기, 정리·수정은 보관함)
  async function saveMemo(tweetId: string, memo: string): Promise<boolean> {
    const id = savedIdRef.current[tweetId];
    if (!id) return false;   // POST 응답 아직 (희귀) → 호출부가 입력 보존 후 재시도
    const r = await apiFetch(`/api/candidates/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
    });
    return r.ok;
  }
  async function unsave(tweetId: string) {
    delete savedIdRef.current[tweetId];
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
    <section ref={rootRef} data-column-id={column.id}
             style={{
               width,
               // 화면 밖 컬럼의 트윗 수백 개는 레이아웃·페인트를 건너뛴다. 화면 안 컬럼도
               // 강제되는 containment 덕에 한 컬럼의 변화가 다른 컬럼 레이아웃을 건드리지 않는다.
               // (Chrome 팀 가이드가 칸반 컬럼을 대표 사례로 든다)
               contentVisibility: 'auto',
               // 폭은 px로 확정이라 크기 추측이 없다 → "c-v:auto 하위로 scrollIntoView가
               // 어긋나는" 알려진 버그(csswg#9833)에 걸리지 않는다. 새 컬럼 자동 스크롤이
               // 이 위에서 동작하므로 이 값과 style.width는 반드시 같은 변수에서 나와야 한다.
               containIntrinsicWidth: `auto ${width}px`,
               // 높이축엔 contain-intrinsic-height가 없어도 된다 — 다만 이유가 "h-full이라서"가
               // 아니다. c-v:auto가 화면 밖에서 강제하는 size containment는 '내용에서 나오는
               // (intrinsic) 크기'만 무효화한다. 이 section의 높이는 상위 main의 flex-1 배분에서
               // 내려오는 definite 값이라 무효화 대상이 아니다(실측: 8컬럼 모두 773px 유지).
               // 그 조상 체인이 깨지면(예: 중간 래퍼가 height:auto로 바뀌면) 화면 밖에서 0px로
               // 접혀 스크롤바가 튄다 — 그때는 contain-intrinsic-height를 추가해야 한다.
             }}
             className={`relative flex h-full shrink-0 flex-col border-r border-x-border ${highlight ? 'ring-2 ring-inset ring-x-blue' : ''}`}>
      <header className="border-b border-x-border bg-x-surface px-3 pt-2">
        <div className="flex items-center gap-1.5">
          {total > 1 && (
            <ColumnGrip title={column.title} index={index} total={total} tourAnchor={tourAnchor}
                        onPointerDown={onGripPointerDown} onMove={onKeyboardMove} />
          )}
          {column.kind === 'watchlist'
            ? <UserIcon className="h-4 w-4 shrink-0 text-x-secondary" />
            : <SearchIcon className="h-4 w-4 shrink-0 text-x-secondary" />}
          <h2 className="truncate text-content font-bold">{column.title}</h2>
          {tweetTotal > 0 && (
            <span className="shrink-0 rounded-full bg-x-text/5 px-1.5 py-0.5 text-caption text-x-muted"
                  title={showDismissed ? '버린 트윗 수' : '이 컬럼에 조회된 전체 트윗 수'}>{tweetTotal.toLocaleString()}</span>
          )}
          <span className="ml-auto shrink-0 text-caption text-x-muted">{busy ? '새로고침 중…' : lastRefreshedLabel(lastRefreshed)}</span>
          <Button variant="icon" onClick={refresh} disabled={busy} title="새로고침" aria-label="새로고침"
                  data-tour={tourAnchor ? 'col-refresh' : undefined}
                  className={busy ? 'text-x-blue-text' : ''}>
            <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="icon" onClick={onEdit} title="컬럼 설정" aria-label="컬럼 설정"><SettingsIcon className="h-4 w-4" /></Button>
          <Button variant="icon" onClick={() => setConfirmingDelete(true)} title="컬럼 삭제" aria-label="컬럼 삭제"><TrashIcon className="h-4 w-4" /></Button>
        </div>
        {/* 1행 — 목록 제어: 정렬 + 보기 (지금 보는 목록을 바꾸는 컨트롤) */}
        <div data-tour={tourAnchor ? 'col-sort' : undefined} className="mt-0.5 flex flex-wrap items-center gap-0.5 pb-1">
          <span className="mr-0.5 shrink-0 text-caption text-x-muted">정렬</span>
          {DECK_SORTS.map((k) => {
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
        {/* 2행 — 분석 액션: 결과를 새로 만드는 컨트롤. 유료 액션은 비용을 버튼에 상시 표시(AGENTS.md 원칙6·비개발자 안심) */}
        <div data-tour={tourAnchor ? 'col-analyze' : undefined}
             className="flex flex-wrap items-center gap-0.5 border-t border-x-border pb-1 pt-1">
          <span className="mr-0.5 shrink-0 text-caption text-x-muted">분석</span>
          <Button variant="ghost" onClick={() => setShowTrend((v) => !v)}
                  className={showTrend ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                  title="이 컬럼에 쌓인 트윗으로 주간 추이를 보여줘요 · 추가 비용 없음">
            주간 추이{showTrend ? ' ✓' : ''}
          </Button>
          <Button variant="ghost" onClick={() => translateAll(tweets.map((t) => t.tweetId))} disabled={translatingAll}
                  data-tour={tourAnchor ? 'col-translate' : undefined}
                  className={showTranslations ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                  title="이 컬럼에 불러온 트윗을 한국어로 — 몇 초 걸릴 수 있어요 (한 번 번역하면 저장돼요)">
            {translatingAll ? '번역 중…' : showTranslations ? '번역 숨기기' : '전체 번역'}
          </Button>
          {column.kind === 'watchlist' && (
            <Button variant="ghost" onClick={() => { setShowPillar((v) => !v); if (showPillar) setTopicFilter(null); }}
                    className={showPillar ? 'border border-x-border-strong bg-white font-medium text-x-text' : ''}
                    title="이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하">
              주제별로 묶기 <span className="text-caption text-x-muted">~$0.05</span>{showPillar ? ' ✓' : ''}
            </Button>
          )}
        </div>
        {confirmingDelete && (
          <div className="mb-1 rounded border border-red-300 bg-red-50 p-2 text-caption">
            <p className="mb-1 text-red-600">컬럼 “{column.title}”을 삭제할까요? 보관함에 저장한 후보는 그대로 유지돼요.</p>
            <div className="flex gap-1">
              <button onClick={onDelete} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">삭제</button>
              <button onClick={() => setConfirmingDelete(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
            </div>
          </div>
        )}
        {err && <p className="pb-1 text-caption text-red-500">{err} <button onClick={refresh} className="underline">재시도</button></p>}
        {translateErr && <p className="pb-1 text-caption text-red-500">{translateErr} <button onClick={() => translateAll(tweets.map((t) => t.tweetId))} className="underline">재시도</button></p>}
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
          ? (
            <div className="p-6 text-center">
              {topicFilter && !showDismissed ? (
                <p className="text-ui text-x-muted">이 주제의 트윗이 현재 목록에 없어요 (주제를 다시 눌러 해제)</p>
              ) : showDismissed ? (
                <p className="text-ui text-x-muted">숨긴 트윗이 없어요</p>
              ) : !lastRefreshed ? (
                <>
                  <p className="text-ui text-x-secondary">아직 불러온 트윗이 없어요</p>
                  <p className="mt-1 text-caption text-x-muted">새로고침하면 이 컬럼의 최신 트윗을 가져와요</p>
                  <Button variant="primary" onClick={refresh} disabled={busy} className="mt-3">
                    {busy ? '불러오는 중…' : '지금 새로고침'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-ui text-x-secondary">조건에 맞는 트윗이 없어요</p>
                  <p className="mt-1 text-caption text-x-muted">설정에서 키워드나 기간을 넓혀 보세요</p>
                  <Button variant="subtle" onClick={onEdit} className="mt-3">컬럼 설정 열기</Button>
                </>
              )}
            </div>
          )
          : visible.map((t, i) => (
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null}
                         tourAnchor={tourAnchor && i === 0}
                         onSave={save} onUnsave={unsave} onSaveMemo={saveMemo}
                         libraryHref={`/w/${column.workspaceId}/library`}
                         onDismiss={dismissTweet} onUndismiss={undismissTweet} dismissedView={showDismissed}
                         translation={translations[t.tweetId] ?? null}
                         showTranslation={showTranslations}
                         onTranslate={translateOne}
                         translating={translatingIds.has(t.tweetId)} />
            ))}
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
                  className="w-full border-t border-x-border py-3 text-center text-ui text-x-blue-text hover:bg-x-hover disabled:opacity-50">
            {loadingMore ? '불러오는 중…' : `더 불러오기 (${tweets.length}개 이후)`}
          </button>
        )}
      </div>
      <div onMouseDown={startResize} title="드래그로 폭 조절"
           className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-x-blue/40 active:bg-x-blue/60" />
    </section>
  );
}
