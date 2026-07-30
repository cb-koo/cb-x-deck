'use client';
import type { SortDir, SortKey, TableRow } from '@/lib/types';
import { cellDisplay, type TableColumn } from '@/lib/tableColumns';
import { dirLabel, SORT_LABEL } from '@/lib/sortKeys';
import { tweetPermalink } from '@/lib/tweetLink';

export function TweetTable({ rows, columns, sort, dir, onSort }: {
  rows: TableRow[]; columns: TableColumn[]; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  return (
    // 넓은 표는 화면을 밀지 않고 자기 안에서 가로 스크롤한다
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui">
        <thead className="sticky top-0 z-10 bg-x-surface">
          <tr className="border-b border-x-border-strong text-left">
            {columns.map((c) => {
              const active = !!c.sort && c.sort === sort;
              return (
                <th key={c.key} scope="col"
                    // aria-sort는 정렬 가능한 칸에만. 없으면 스크린리더가 현재 정렬을 알 수 없다.
                    aria-sort={c.sort ? (active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
                    className={`whitespace-nowrap px-2 py-2 font-medium ${c.numeric ? 'text-right' : 'text-left'} ${active ? 'text-x-text' : 'text-x-secondary'}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => onSort(c.sort!)}
                            aria-label={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                            title={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                            className="rounded px-1 py-0.5 hover:bg-x-text/5">
                      {c.label}{active && <span aria-hidden> {dir === 'desc' ? '↓' : '↑'}</span>}
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tweetId} className="border-b border-x-border align-top hover:bg-x-hover">
              {columns.map((c) => (
                <td key={c.key}
                    className={`px-2 py-2 ${c.numeric ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.key === 'text' ? 'min-w-[18rem] max-w-[28rem]' : ''}`}>
                  {c.key === 'link'
                    ? <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noopener"
                         className="text-x-blue-text hover:underline">원문 ↗</a>
                    : c.key === 'text'
                      // 본문은 2줄 말줄임 — 전문은 카드 보기에서 본다(설계 §C)
                      ? <span className="line-clamp-2 whitespace-pre-wrap">{cellDisplay(r, c)}</span>
                      : <span className={c.key === 'columns' || c.key === 'saved' ? 'text-x-secondary' : ''}>{cellDisplay(r, c)}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
