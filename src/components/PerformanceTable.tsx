// src/components/PerformanceTable.tsx
'use client';
import { Fragment } from 'react';
import { formatFull } from '@/lib/format';
import { kstDate } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';
import type { ContentRow, ContentPost } from '@/lib/performanceStore';
import {
  formatPct, rate, sampleState, SAMPLE_LABEL, type PerfRow, type PerfSortKey,
} from '@/lib/performanceJudgment';

export type Grouping = 'content' | 'influencer';

// 표 한 행의 표시 모델 — 콘텐츠 행은 ContentRow를 그대로, 인플루언서 묶기는 groupByInfluencer 결과(PerfRow)를 쓴다.
export type TableRow = PerfRow & Partial<Pick<ContentRow, 'draftId' | 'utmContent' | 'format' | 'threadTotal' | 'posts' | 'sharedUtmContent'>>;

interface Col { key: PerfSortKey | 'title' | 'influencer' | 'open' | 'count'; label: string; width: number; numeric?: boolean; sort?: PerfSortKey }

const CONTENT_COLS: Col[] = [
  { key: 'title', label: '콘텐츠', width: 240 },
  { key: 'influencer', label: '인플루언서', width: 150 },
  { key: 'postedAt', label: '게시', width: 70, sort: 'postedAt' },
  { key: 'views', label: '조회', width: 90, numeric: true, sort: 'views' },
  { key: 'clicks', label: '클릭', width: 80, numeric: true, sort: 'clicks' },
  { key: 'arrivals', label: '도착', width: 80, numeric: true, sort: 'arrivals' },
  { key: 'taps', label: '탭', width: 70, numeric: true, sort: 'taps' },
  { key: 'clickRate', label: '클릭률', width: 80, numeric: true, sort: 'clickRate' },
  { key: 'tapRate', label: '탭률', width: 200, numeric: true, sort: 'tapRate' },
  { key: 'contribution', label: '탭 기여', width: 80, numeric: true, sort: 'contribution' },
  { key: 'open', label: '열기', width: 120 },
];
const INFLUENCER_COLS: Col[] = [
  { key: 'influencer', label: '인플루언서', width: 200 },
  { key: 'count', label: '콘텐츠', width: 80, numeric: true },
  ...CONTENT_COLS.filter((c) => ['views', 'clicks', 'arrivals', 'taps', 'clickRate', 'tapRate', 'contribution'].includes(c.key)),
];

export function PerformanceTable({ rows, grouping, totalTaps, sort, dir, onSort, expandedKey, onToggleExpand }: {
  rows: TableRow[];                 // 이미 정렬된 배열 — 여기서 순서를 바꾸지 않는다(DraftTable·LinkTable 관례)
  grouping: Grouping;
  totalTaps: number;                // 탭 기여 분모(utm_content 단위 중복 없이 페이지가 계산)
  sort: PerfSortKey; dir: 'asc' | 'desc'; onSort: (k: PerfSortKey) => void;
  expandedKey: string | null; onToggleExpand: (key: string) => void;
}) {
  const cols = grouping === 'content' ? CONTENT_COLS : INFLUENCER_COLS;
  const expandable = grouping === 'content';
  const total = cols.reduce((s, c) => s + c.width, 0) + (expandable ? 32 : 0);
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-x-border">
      <table className="table-fixed border-collapse text-content" style={{ width: `max(${total}px, 100%)` }}>
        <colgroup>
          {expandable && <col style={{ width: 32 }} />}
          {cols.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          <col />
        </colgroup>
        <thead className="text-ui text-x-secondary">
          {/* 퍼널 4열 위 그룹 헤더 — 조회→클릭→도착→탭이 한 흐름이라는 것을 한 번만 말한다 */}
          <tr>
            {expandable && <th rowSpan={2} aria-hidden="true" />}
            {cols.map((c) => c.key === 'views'
              ? <th key="funnel" colSpan={4} className="border-b border-x-border pb-1 pt-2 text-center text-[12px] font-medium text-x-muted">퍼널 · 조회 → 클릭 → 도착 → 탭</th>
              : ['clicks', 'arrivals', 'taps'].includes(c.key) ? null
              : <th key={c.key} rowSpan={2} scope="col" onClick={c.sort ? () => onSort(c.sort!) : undefined}
                    className={`whitespace-nowrap px-4 py-2.5 font-bold ${c.numeric ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer hover:text-x-text' : ''} border-b border-x-border-strong`}>
                  {c.label}{c.sort && sort === c.sort && <span aria-hidden className="ml-0.5 text-[10px]">{dir === 'desc' ? '▾' : '▴'}</span>}
                </th>)}
            <th rowSpan={2} aria-hidden="true" />
          </tr>
          <tr>
            {cols.filter((c) => ['views', 'clicks', 'arrivals', 'taps'].includes(c.key)).map((c) => (
              <th key={c.key} scope="col" onClick={() => onSort(c.sort!)}
                  className="cursor-pointer whitespace-nowrap border-b border-x-border-strong px-4 py-2 text-right font-bold hover:text-x-text">
                {c.label}{sort === c.sort && <span aria-hidden className="ml-0.5 text-[10px]">{dir === 'desc' ? '▾' : '▴'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = expandedKey === r.key;
            const clickRate = rate(r.clicks, r.views);
            const tapRate = rate(r.taps, r.arrivals);
            const state = sampleState(r.arrivals);
            const badge = SAMPLE_LABEL[state];
            const contribution = totalTaps > 0 ? r.taps / totalTaps : null;
            const main = r.posts?.find((p) => p.role === 'main') ?? null;
            return (
              <Fragment key={r.key}>
                <tr className="h-12 border-b border-x-border hover:bg-x-hover">
                  {expandable && (
                    <td className="pl-2">
                      <button onClick={() => onToggleExpand(r.key)} aria-expanded={open}
                              title="자세히 — 스레드 읽기 흐름(트윗별 조회)" aria-label={open ? '접기' : '자세히 보기'}
                              className="rounded p-1.5 text-[11px] leading-none text-x-muted hover:bg-x-surface hover:text-x-secondary">
                        {open ? '▼' : '▶'}
                      </button>
                    </td>
                  )}
                  {grouping === 'content' && (
                    <td className="truncate px-4" title={`utm_content: ${r.utmContent} · ${r.format === 'thread' ? `스레드 ${r.threadTotal ?? '?'}개` : '단일 게시물'}${r.sharedUtmContent ? ' · 같은 utm_content를 쓰는 링크가 둘 이상 — 방문이 양쪽에 같이 보여요' : ''}`}>
                      {r.title}
                    </td>
                  )}
                  <td className="truncate px-4">
                    {/* 재기용 판단은 프로필에서 — 단가·계정 분석·참여 이력이 거기 있다 */}
                    <a href={`/influencers?i=${encodeURIComponent(r.influencerHandle)}`} className="inline-flex items-center gap-2 hover:underline">
                      <span aria-hidden className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-x-surface text-[10px] font-bold text-x-secondary">{r.influencerHandle[0]?.toUpperCase()}</span>
                      @{r.influencerHandle}
                    </a>
                  </td>
                  {grouping === 'influencer' && <td className="px-4 text-right tabular-nums">{r.contentCount}</td>}
                  {grouping === 'content' && <td className="px-4 tabular-nums text-x-secondary">{r.postedAt ? kstDate(r.postedAt).slice(5).replace('-', '/').replace(/^0/, '') : '—'}</td>}
                  <td className="px-4 text-right tabular-nums">
                    {r.views !== null ? formatFull(r.views)
                      : grouping === 'content' && r.draftId
                        ? <a href="/tracking" className="text-ui text-x-blue-text hover:underline" title="게시물을 트래킹에 등록하면 조회가 채워져요">게시물 연결 전</a>
                        : <span className="text-x-muted">—</span>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.clicks !== null ? formatFull(r.clicks) : <span className="text-ui text-x-muted">측정 전</span>}</td>
                  <td className="px-4 text-right tabular-nums">{formatFull(r.arrivals)}</td>
                  <td className="px-4 text-right tabular-nums font-semibold">{formatFull(r.taps)}</td>
                  <td className="px-4 text-right tabular-nums" title="클릭 ÷ 본문 조회">{formatPct(clickRate, 1)}</td>
                  {/* 분모 병기 — 퍼센트 단독은 표본 크기를 감춘다. 표본이 적으면 값 자체를 흐리게(문구만 있으면 곧 무시된다) */}
                  <td className="whitespace-nowrap px-4 text-right tabular-nums">
                    <span className={state === 'early' ? 'opacity-40' : 'font-semibold'}>{formatPct(tapRate)}</span>
                    {tapRate !== null && <span className="ml-1 text-ui text-x-muted">({r.taps}/{r.arrivals})</span>}
                    {badge && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[12px] ${state === 'ref' ? 'bg-amber-50 text-amber-800' : 'bg-x-surface text-x-muted'}`}>{badge}</span>
                    )}
                  </td>
                  <td className="px-4 text-right tabular-nums">{formatPct(contribution)}</td>
                  {grouping === 'content' && (
                    <td className="whitespace-nowrap px-4 text-ui">
                      {r.draftId && <a href={`/generate?draft=${r.draftId}`} className="text-x-blue-text hover:underline">원고</a>}
                      {r.draftId && main && <span className="mx-1 text-x-muted">·</span>}
                      {main && <a href={tweetPermalink(main.authorHandle, main.tweetId)} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">X 게시물</a>}
                    </td>
                  )}
                  <td aria-hidden="true" />
                </tr>
                {open && expandable && <ThreadFlow row={r} colCount={cols.length + 2} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 펼침 = 스레드 읽기 흐름. 부모 열을 공유하는 자식 행 — 조회 칸에 트윗별 조회(1/ 대비 %), 링크 줄만 클릭 칸.
// 헤더도 그래프도 없다: 부모 헤더가 위에 있고, 숫자가 세로로 이어 읽힌다(LinkTable 펼침 문법).
function ThreadFlow({ row, colCount }: { row: TableRow; colCount: number }) {
  const posts = row.posts ?? [];
  const main = posts.find((p) => p.role === 'main') ?? null;
  const edge = 'shadow-[inset_2px_0_0_rgba(21,115,173,0.4)]';
  const cell = 'h-9 bg-x-surface text-ui tabular-nums';
  const label = (p: ContentPost, i: number) =>
    p.role === 'link' ? '🔗 링크 댓글' : p.role === 'main' ? '1/ 본문' : `${i + 1}/`;
  if (posts.length === 0) {
    return (
      <tr><td className={edge} /><td colSpan={colCount - 1} className={`${cell} border-b border-x-border-strong px-4 text-x-muted`}>
        등록된 게시물이 없어요 — 트래킹에서 게시물을 등록하면 여기 채워져요
      </td></tr>
    );
  }
  return (
    <>
      <tr>
        <td className={edge} />
        <td colSpan={colCount - 1} className="h-8 bg-x-surface px-4 text-ui text-x-muted">
          스레드 읽기 흐름 · {posts.length}개 등록{row.threadTotal ? ` / 스레드 ${row.threadTotal}개` : ''} · %는 1/ 본문 조회 대비
        </td>
      </tr>
      {posts.map((p, i) => {
        const pct = p.role !== 'main' && main?.views && p.views !== null ? formatPct(p.views / main.views) : '';
        const last = i === posts.length - 1;
        const b = last ? 'border-b border-x-border-strong' : '';
        return (
          <tr key={p.tweetId}>
            <td className={`${edge} ${cell} ${b}`} />
            <td className={`${cell} ${b} pl-10 text-x-secondary`}>{label(p, i)}</td>
            <td className={`${cell} ${b}`} /><td className={`${cell} ${b}`} />
            <td className={`${cell} ${b} px-4 text-right`}>
              <span className="inline-flex w-full justify-end gap-1.5"><span className="w-11 text-left text-[12px] text-x-muted">{pct}</span><span>{p.views === null ? '—' : formatFull(p.views)}</span></span>
            </td>
            <td className={`${cell} ${b} px-4 text-right`}>{p.role === 'link' && row.clicks !== null ? formatFull(row.clicks) : ''}</td>
            {Array.from({ length: colCount - 6 }, (_, k) => <td key={k} className={`${cell} ${b}`} />)}
          </tr>
        );
      })}
      <tr><td className={edge} /><td colSpan={colCount - 1} className="h-8 bg-x-surface px-4 text-[12px] text-x-muted">조회·클릭은 마지막 새로고침 시점 값이에요.</td></tr>
    </>
  );
}
