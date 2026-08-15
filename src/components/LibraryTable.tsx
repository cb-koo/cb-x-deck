'use client';
import type { LibraryEntry } from '@/lib/candidateStore';
import { LIBRARY_TABLE_COLUMNS, commentSummary, savedByLabel, type LibrarySort, type LibrarySortKey } from '@/lib/libraryTable';
import { formatFull } from '@/lib/format';
import { kstDate, kstShort } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';

// 훑기 전용 표 — 조작(코멘트·빼기·번역)은 행 클릭으로 여는 카드 팝업에서 (spec 2026-08-15-library-table).
// 받은 순서를 그대로 그린다 — 정렬은 페이지 소유(DraftTable과 같은 규칙).
export function LibraryTable({ entries, sort, onSortChange, onOpenTweet }: {
  entries: LibraryEntry[];
  sort: LibrarySort;
  onSortChange: (next: LibrarySort) => void;
  onOpenTweet: (tweetId: string) => void;
}) {
  // 셀 안의 링크 클릭·글자 드래그 선택은 팝업을 열지 않는다 (DraftTable과 동일)
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button')) return false;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return false;
    return true;
  }

  const sortBtn = (key: LibrarySortKey, label: string) => (
    <button onClick={() => onSortChange({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );

  const num = (v: number | null) => (v === null || v === undefined ? '–' : formatFull(v));

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            {LIBRARY_TABLE_COLUMNS.map((c) => (
              <th key={c.key}
                  aria-sort={c.sort && sort.key === c.sort ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
                  className={`whitespace-nowrap px-3 py-2 font-normal ${c.numeric ? 'text-right' : ''}`}>
                {c.sort ? <span className={c.numeric ? 'flex justify-end' : ''}>{sortBtn(c.sort, c.label)}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const t = e.tweet;
            const m = t.metrics;
            return (
              <tr key={t.tweetId}
                  data-tweet-id={t.tweetId}
                  tabIndex={0}
                  onClick={(ev) => { if (opensCard(ev)) onOpenTweet(t.tweetId); }}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    if (ev.target !== ev.currentTarget) return;
                    ev.preventDefault();
                    onOpenTweet(t.tweetId);
                  }}
                  className="relative cursor-pointer border-b border-x-border hover:bg-x-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
                <td className="max-w-[360px] truncate px-3 py-2" title={t.text}>{t.text}</td>
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary" title={t.authorName ?? undefined}>@{t.authorHandle}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(t.authorFollowers)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{t.tweetCreatedAt ? kstDate(t.tweetCreatedAt) : '–'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.views)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.likes)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.retweets)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.bookmarks)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.replies)}</td>
                <td className="max-w-[160px] truncate whitespace-nowrap px-3 py-2 text-x-secondary" title={savedByLabel(e)}>{savedByLabel(e)}</td>
                <td className="max-w-[240px] truncate px-3 py-2" title={commentSummary(e)}>{commentSummary(e)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">{kstShort(e.addedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <a href={tweetPermalink(t.authorHandle, t.tweetId)} target="_blank" rel="noopener"
                     className="text-x-blue-text hover:underline" onClick={(ev) => ev.stopPropagation()}>원문 ↗</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
