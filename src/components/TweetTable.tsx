'use client';
import { useState } from 'react';
import type { SortDir, SortKey, TableRow } from '@/lib/types';
import { cellDisplay, type TableColumn } from '@/lib/tableColumns';
import { dirLabel, SORT_LABEL } from '@/lib/sortKeys';
import { tweetPermalink } from '@/lib/tweetLink';

// 칸 폭 기억 — 표를 새로고침해도 사용자가 맞춘 폭이 유지되도록 (칸 더보기와 같은 가벼운 방식, TweetTableView.tsx 참조)
const WIDTHS_KEY = 'table-col-widths';
const MIN_COL_WIDTH = 48;    // 이 아래로는 머리글 글자가 안 읽힌다
const MAX_COL_WIDTH = 720;   // 덱 컬럼 폭 조절(Column.tsx)과 같은 상한
const WIDTH_STEP = 24;       // 화살표 키 한 번에 움직이는 양

// 기본 폭 — 1500px 안팎 화면에서 기본 8칸이 꽉 차 보이고, 14칸(칸 더보기)도 무리 없이 가로 스크롤되도록 잡았다.
// 본문이 가장 넓고(읽는 목적), 지표 칸은 좁고(숫자만), 계정·열은 중간이다.
const DEFAULT_COL_WIDTH: Record<string, number> = {
  columns: 140,
  handle: 120,
  date: 100,
  text: 460,
  views: 88,
  likes: 88,
  retweets: 88,
  link: 72,
  replies: 88,
  quotes: 88,
  bookmarks: 96,
  followers: 96,
  saved: 140,
  fetchedAt: 150,
};
const FALLBACK_COL_WIDTH = 120;   // 앞으로 칸이 늘어나도 안전한 중간값

function defaultWidth(key: string): number {
  return DEFAULT_COL_WIDTH[key] ?? FALLBACK_COL_WIDTH;
}

function loadStoredWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch { return {}; }   // 접근 거부·손상된 값이면 기본 폭으로
}

function saveWidths(map: Record<string, number>) {
  try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(map)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

// 저장된 값이 없거나 손상됐으면 기본 폭으로 조용히 떨어진다 — 사용자가 안 건드린 칸은 항상 기본값 그대로.
function resolveWidth(map: Record<string, number>, key: string): number {
  const v = map[key];
  return typeof v === 'number' && v > 0 ? v : defaultWidth(key);
}

export function TweetTable({ rows, columns, sort, dir, onSort }: {
  rows: TableRow[]; columns: TableColumn[]; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  // 마운트 시 1회만 읽는다 — 이 컴포넌트는 표가 실제로 그려질 때만 나타나므로(TweetTableView의 로딩 갈래)
  // 서버 렌더를 탄 적이 없다. useEffect로 나중에 읽으면 set-state-in-effect가 걸리므로
  // (TweetTableView의 MORE_KEY도 이미 그 경고를 안고 있다) lazy initializer로 아예 이펙트를 안 쓴다.
  const [widths, setWidths] = useState<Record<string, number>>(() => loadStoredWidths());

  function widthFor(key: string): number {
    return resolveWidth(widths, key);
  }

  function commitWidth(key: string, w: number) {
    setWidths((cur) => {
      const next = { ...cur, [key]: w };
      saveWidths(next);
      return next;
    });
  }

  function resetWidth(key: string) {
    setWidths((cur) => {
      const next = { ...cur };
      delete next[key];
      saveWidths(next);
      return next;
    });
  }

  function nudgeWidth(key: string, delta: number) {
    setWidths((cur) => {
      const w = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, resolveWidth(cur, key) + delta));
      const next = { ...cur, [key]: w };
      saveWidths(next);
      return next;
    });
  }

  // 우측 가장자리 드래그로 폭 조절 — 덱 컬럼 폭 조절(Column.tsx startResize)과 같은 방식:
  // document에 mousemove/mouseup을 걸고, 놓을 때만 저장한다.
  function startResize(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();   // 정렬 버튼은 형제 요소라 원래도 안 타지만, 방어적으로 한 번 더 막는다
    const startX = e.clientX;
    const startW = widthFor(key);
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX));
      setWidths((cur) => ({ ...cur, [key]: w }));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (w !== startW) commitWidth(key, w);
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  return (
    // 가로·세로 스크롤은 부모(TweetTableView)의 컨테이너 하나가 담당한다.
    // 여기서 또 overflow-x-auto를 걸면 그 div가 sticky thead의 기준(가장 가까운 스크롤 컨테이너)이
    // 되어버리는데, 그 div 자신은 세로로 스크롤되지 않으므로 머리글이 고정되지 않는다.
    // table-fixed + 칸마다 명시한 폭이 있어야 드래그로 정한 폭이 실제로 유지된다(auto면 내용에 맞춰 다시 늘어난다).
    <table className="table-fixed border-collapse text-ui">
      <thead className="sticky top-0 z-10 bg-x-surface">
        <tr className="border-b border-x-border-strong text-left">
          {columns.map((c) => {
            const active = !!c.sort && c.sort === sort;
            const w = widthFor(c.key);
            return (
              <th key={c.key} scope="col"
                  // aria-sort는 정렬 가능한 칸에만. 없으면 스크린리더가 현재 정렬을 알 수 없다.
                  aria-sort={c.sort ? (active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
                  style={{ width: w }}
                  className={`relative overflow-hidden py-3 pl-2 pr-3 font-medium ${c.numeric ? 'text-right' : 'text-left'} ${active ? 'text-x-text' : 'text-x-secondary'}`}>
                {c.sort ? (
                  <button type="button" onClick={() => onSort(c.sort!)}
                          aria-label={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                          title={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                          className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-x-text/5">
                    {c.label}{active && <span aria-hidden> {dir === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                ) : <span className="block w-full truncate px-1 py-0.5">{c.label}</span>}
                {/* 폭 조절 손잡이 — ColumnGrip과 같은 접근성 처리를 폭 조절에 맞게 옮겼다:
                    role="button"이면 Enter/스페이스가 뭔가 할 거라는 기대를 주는데 이 손잡이는 화살표로만
                    움직인다. role 없이 두면 스크린리더 컨트롤 탐색에 아예 안 잡힌다(WCAG 4.1.2).
                    "N개 중 M번째" 대신 "폭 Npx"라는 값을 화살표로 바꾸는 컨트롤이라 여기서도 slider가 맞다. */}
                <span
                  role="slider"
                  aria-roledescription="칸 폭 조절 손잡이"
                  aria-label={`${c.label} 칸 폭 조절 — 끌어서 넓히거나 화살표 키를 누르세요`}
                  aria-valuemin={MIN_COL_WIDTH}
                  aria-valuemax={MAX_COL_WIDTH}
                  aria-valuenow={w}
                  aria-valuetext={`폭 ${w}픽셀`}
                  tabIndex={0}
                  title="끌어서 폭을 조절해요 — 더블클릭하면 기본 폭으로 돌아가요"
                  onMouseDown={(e) => startResize(c.key, e)}
                  onDoubleClick={(e) => { e.stopPropagation(); resetWidth(c.key); }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeWidth(c.key, -WIDTH_STEP); }
                    else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeWidth(c.key, WIDTH_STEP); }
                    else if (e.key === ' ') e.preventDefault();   // 스페이스로 페이지가 스크롤되는 것만 막는다
                  }}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 touch-none cursor-col-resize hover:bg-x-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:bg-x-border-strong"
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.tweetId} className="border-b border-x-border align-top hover:bg-x-hover">
            {columns.map((c) => {
              const text = cellDisplay(r, c);
              return (
                <td key={c.key}
                    className={`overflow-hidden py-2.5 pl-2 pr-3 ${c.numeric ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.key === 'text' ? '' : 'truncate'}`}>
                  {c.key === 'link'
                    ? <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noopener"
                         className="text-x-blue-text hover:underline">원문 ↗</a>
                    : c.key === 'text'
                      // 본문은 2줄 말줄임 — 전문은 카드 보기에서 본다(설계 §C)
                      ? <span className="line-clamp-2 whitespace-pre-wrap">{text}</span>
                      // 칸이 좁아지면 잘림표(…)로 줄고, title로 전체 값을 마우스오버에서 볼 수 있다
                      : <span title={text} className={c.key === 'columns' || c.key === 'saved' ? 'text-x-secondary' : ''}>{text}</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
