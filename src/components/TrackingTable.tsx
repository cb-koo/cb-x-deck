'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { formatFull } from '@/lib/format';
import { kstDateTime, kstMonthDayKo } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';
import type { TrackedPostRow } from '@/lib/trackingStore';
import type { PostMetrics } from '@/lib/postMetrics';

// 표는 숫자를 나란히 놓고 비교하는 화면이라 축약(23.7M)하지 않는다 — format.ts의 formatFull 주석 참조.
// 열 이름은 X 화면과 같은 말로 둔다: 'RT' 같은 줄임말 대신 우리 사용자가 X에서 보는 단어(리포스트).
const METRICS: Array<{ key: keyof PostMetrics; label: string }> = [
  { key: 'views', label: '조회' },
  { key: 'likes', label: '좋아요' },
  { key: 'retweets', label: '리포스트' },
  { key: 'replies', label: '답글' },
  { key: 'bookmarks', label: '북마크' },
  { key: 'quotes', label: '인용' },
];

export interface DraftOption { id: string; label: string }
export type DraftsState = 'idle' | 'loading' | 'ready' | 'error';

// 정렬 키 — 정렬은 페이지가 소유한다(DraftTable·TweetTable 관례). 이 표는 받은 순서를 그대로 그린다.
export type TrackSortKey = 'created' | 'posted' | 'captured' | keyof PostMetrics;
export type TrackSortDir = 'asc' | 'desc';

const SORT_LABEL: Record<TrackSortKey, string> = {
  created: '등록순', posted: '게시 시각', captured: '측정 시각',
  views: '조회', likes: '좋아요', retweets: '리포스트', replies: '답글', bookmarks: '북마크', quotes: '인용',
};

// 정렬 가능한 헤더 칸 — TweetTable의 헤더 버튼 마크업을 이 표에 맞게 줄인 것(aria-sort·방향 화살표 동일)
function SortTh({ k, label, sort, dir, onSort, numeric }: {
  k: TrackSortKey; label: string; sort: TrackSortKey; dir: TrackSortDir;
  onSort: (k: TrackSortKey) => void; numeric?: boolean;
}) {
  const active = k === sort;
  return (
    <th scope="col"
        aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
        className={`whitespace-nowrap px-2 py-2 font-normal ${numeric ? 'text-right' : 'text-left'} ${active ? 'text-x-text' : ''}`}>
      <button type="button" onClick={() => onSort(k)}
              title={active ? `${SORT_LABEL[k]} ${dir === 'desc' ? '내림차순' : '오름차순'} — 다시 누르면 순서가 바뀝니다`
                            : `${SORT_LABEL[k]} 기준으로 정렬`}
              className="rounded px-1 py-0.5 hover:bg-x-text/5">
        {label}{active && <span aria-hidden> {dir === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  );
}

export function TrackingTable({
  rows, highlightId, refreshingIds,
  selectedIds, onToggleSelect, allSelected, onToggleAll,
  sort, dir, onSort,
  drafts, draftsState, onLoadDrafts,
  pickerFor, onOpenPicker, onLinkDraft,
  onRefresh, onRemove,
}: {
  rows: TrackedPostRow[];          // 이미 정렬·절단이 끝난 배열 — 여기서 순서를 바꾸지 않는다
  highlightId: string | null;      // 방금 등록/이미 추적 중이던 행 — 2초 강조(페이지가 타이머를 소유)
  refreshingIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>; // 표시 전용 — 판단(확인·실행취소)과 삭제는 전부 페이지가 한다(BulkActionBar 관례)
  onToggleSelect: (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  sort: TrackSortKey;
  dir: TrackSortDir;
  onSort: (k: TrackSortKey) => void;
  drafts: DraftOption[];
  draftsState: DraftsState;
  onLoadDrafts: () => void;
  pickerFor: string | null;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
  onRefresh: (row: TrackedPostRow) => void;
  onRemove: (row: TrackedPostRow) => void;
}) {
  return (
    // 가로·세로 스크롤을 담당하는 컨테이너는 이 하나뿐이다 — sticky thead는 이 div를 기준으로 고정된다
    // (TweetTableView와 같은 구조). '더 보기'는 표 스크롤과 무관하게 항상 보이도록 페이지가 이 밖에 둔다.
    <div className="max-h-[70vh] w-full overflow-auto">
      <table className="w-full text-ui">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            <th className="w-8 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                     aria-label="표시된 게시물 전체 선택" className="align-middle accent-x-blue" />
            </th>
            {/* 게시물 열의 정렬 키는 '등록순' — 목록의 기본 순서라 이 열이 그 자리를 맡는다 */}
            <SortTh k="created" label="게시물" sort={sort} dir={dir} onSort={onSort} />
            <SortTh k="posted" label="게시" sort={sort} dir={dir} onSort={onSort} />
            {METRICS.map((m) => (
              <SortTh key={m.key} k={m.key} label={m.label} sort={sort} dir={dir} onSort={onSort} numeric />
            ))}
            <SortTh k="captured" label="측정" sort={sort} dir={dir} onSort={onSort} />
            <th className="whitespace-nowrap px-3 py-2 font-normal">원고</th>
            <th className="whitespace-nowrap px-3 py-2 font-normal">동작</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const busy = refreshingIds.has(r.id);
            const gone = r.unavailableAt !== null;
            const line = (r.text.split('\n')[0] ?? '').trim();
            return (
              // id: 등록 직후 그 행으로 스크롤하기 위한 손잡이(페이지의 flash) — 행 자체는 클릭 대상이 아니다.
              // 이 표의 행에는 '열기'가 없다: 게시물은 X로, 원고는 연결 UI로 각각 자기 셀에서 간다.
              <tr key={r.id} id={`tracked-${r.id}`}
                  className={`border-b border-x-border transition-colors ${
                    r.id === highlightId ? 'bg-x-blue/10' : 'hover:bg-x-hover'
                  }`}>
                <td className="w-8 px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => onToggleSelect(r.id)}
                         aria-label={`${r.authorHandle ? `@${r.authorHandle} ` : ''}게시물 선택`}
                         className="align-middle accent-x-blue" />
                </td>
                <td className="max-w-[320px] px-3 py-2">
                  <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noreferrer"
                     className="block min-w-0 hover:underline">
                    <span className="block text-caption text-x-muted">
                      {r.authorHandle ? `@${r.authorHandle}` : '작성자 미확인'}
                    </span>
                    <span className="block truncate">{line || '(본문 없음)'}</span>
                  </a>
                  {/* 볼 수 없음은 색이 아니라 글자로 말한다 — 왜(삭제·비공개)와 언제 확인했는지까지 (I축) */}
                  {gone && (
                    <span className="mt-1 inline-block rounded-full bg-x-surface px-2 py-0.5 text-caption text-x-secondary">
                      볼 수 없음(삭제·비공개 등) · {kstMonthDayKo(r.unavailableAt)} 확인
                    </span>
                  )}
                </td>
                {/* 시각은 '4달 전' 같은 상대 표기 대신 정확한 값을 표 안에 그대로(사용자 결정 08-15).
                    서울 기준, kstDateTime은 '최종 수집 시간' 표기의 기존 관례다(datetime.ts).
                    글자 규격은 지표 숫자와 동일(text-ui·tabular-nums) — 시각도 데이터 값이라 caption으로
                    줄이면 같은 행 안에서 크기가 어긋난다(QA 08-15). 색만 secondary로 한 단계 옅게 —
                    행의 주인공(지표)과의 위계는 크기가 아니라 색이 나른다 */}
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary tabular-nums">
                  {r.postedAt ? kstDateTime(r.postedAt) : '–'}
                </td>
                {/* 볼 수 없는 게시물의 지표는 지우지 않고 마지막 측정값을 흐리게 남긴다 — 지운 값이 0으로 보이면 거짓말이 된다 */}
                {METRICS.map((m) => (
                  <td key={m.key}
                      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${gone ? 'text-x-muted opacity-60' : 'text-x-text'}`}>
                    {formatFull(r.metrics?.[m.key] ?? null)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary tabular-nums">
                  {r.capturedAt ? kstDateTime(r.capturedAt) : '–'}
                </td>
                {/* nowrap: 표가 좁아지면 '연결 안 됨'이 글자 단위로 세로로 꺾인다(QA 08-15) — 상태 글자는 한 줄이 정체성 */}
                <td className="whitespace-nowrap px-3 py-2">
                  <DraftCell row={r} open={pickerFor === r.id} drafts={drafts} draftsState={draftsState}
                             onLoadDrafts={onLoadDrafts} onOpenPicker={onOpenPicker} onLinkDraft={onLinkDraft} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Button onClick={() => onRefresh(r)} disabled={busy} className="whitespace-nowrap"
                            title="지금 지표를 다시 가져와요 (API 호출 1회)">
                      {busy ? '가져오는 중…' : '새로고침'}
                    </Button>
                    <Button variant="ghost" onClick={() => onRemove(r)} className="whitespace-nowrap"
                            title="목록에서 빼고 쌓인 측정 기록도 지워요">
                      추적 중단
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 원고 연결 — 처음엔 셀 안 네이티브 select였으나, 원고 수십 건이 OS 팝업으로 통째로 쏟아져
// 검색도 미리보기도 없는 경험이었다(QA 08-15). 이 앱의 '많은 것 중 하나 고르기' 관례인
// 검색 달린 모달(RefPickerSheet·AddByLinkModal 골격)로 교체.
// 목록은 열 때 처음 한 번만 불러온다(onLoadDrafts) — 표를 그릴 때마다 원고 전량을 받아오지 않기 위해서다.
function DraftCell({ row, open, drafts, draftsState, onLoadDrafts, onOpenPicker, onLinkDraft }: {
  row: TrackedPostRow; open: boolean;
  drafts: DraftOption[]; draftsState: DraftsState; onLoadDrafts: () => void;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
}) {
  if (open) {
    return (
      <DraftPickerModal row={row} drafts={drafts} draftsState={draftsState}
                        onLoadDrafts={onLoadDrafts} onLinkDraft={onLinkDraft}
                        onClose={() => onOpenPicker(null)} />
    );
  }
  if (row.draftId) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => onOpenPicker(row.id)} title="다른 원고로 바꾸기"
                className="max-w-[180px] truncate text-x-blue-text hover:underline">
          {row.draftLabel ?? '제목 없는 원고'}
        </button>
        <button onClick={() => onLinkDraft(row, null)} className="shrink-0 text-caption text-x-muted hover:text-x-secondary">
          해제
        </button>
      </div>
    );
  }
  // '연결 안 됨'은 상태라서 그것만으로는 눌러도 되는지 알 수 없다 — 상태(글자)와 행동(버튼)을 나눠 둔다
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-x-muted">연결 안 됨</span>
      <button onClick={() => onOpenPicker(row.id)} className="text-x-blue-text hover:underline">연결</button>
    </div>
  );
}

// 검색 달린 원고 선택 모달 — 골격은 AddByLinkModal(백드롭 클릭·Esc 닫기·dialog 시맨틱)과 동일.
// '연결 해제'는 이미 연결된 행에서만 보인다 — 미연결 행에 '고르지 않음'을 두면 눌러도 아무 일도
// 없는 데드엔드가 된다(최종 리뷰 지적).
function DraftPickerModal({ row, drafts, draftsState, onLoadDrafts, onLinkDraft, onClose }: {
  row: TrackedPostRow;
  drafts: DraftOption[]; draftsState: DraftsState; onLoadDrafts: () => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = q ? drafts.filter((d) => d.label.toLowerCase().includes(q)) : drafts;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="flex max-h-[70vh] w-full max-w-[480px] flex-col rounded-2xl bg-white p-4"
           role="dialog" aria-modal="true" aria-label="원고 연결" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-ui font-medium">원고 연결</p>
          <button onClick={onClose} className="text-caption text-x-muted hover:text-x-secondary">취소</button>
        </div>
        <p className="mb-2 text-caption text-x-muted">
          {row.authorHandle ? `@${row.authorHandle}` : '이'} 게시물에 연결할 원고를 고르세요
        </p>

        {/* idle도 '불러오는 중'으로 — 여는 순간 페이지가 조회를 시작하므로 사용자에게 둘은 같은 시점이다 */}
        {(draftsState === 'idle' || draftsState === 'loading') && (
          <p className="py-6 text-center text-ui text-x-muted">원고 목록 불러오는 중…</p>
        )}
        {draftsState === 'error' && (
          <p className="py-6 text-center text-ui text-x-secondary">
            원고 목록을 불러오지 못했어요{' '}
            <button onClick={onLoadDrafts} className="text-x-blue-text hover:underline">다시 시도</button>
          </p>
        )}
        {draftsState === 'ready' && (
          <>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="원고 제목 검색"
                   aria-label="원고 제목 검색"
                   className="mb-2 w-full rounded-md border border-x-border-strong px-3 py-1.5 text-ui outline-none focus:border-x-blue" />
            {row.draftId && (
              <button onClick={() => onLinkDraft(row, null)}
                      className="mb-1 w-full rounded-md px-3 py-1.5 text-left text-ui text-x-secondary hover:bg-x-hover">
                연결 해제
              </button>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="py-6 text-center text-ui text-x-muted">검색과 일치하는 원고가 없어요</p>
              )}
              {filtered.map((d) => (
                <button key={d.id} onClick={() => onLinkDraft(row, d.id)}
                        className={`block w-full truncate rounded-md px-3 py-1.5 text-left text-ui hover:bg-x-hover ${
                          d.id === row.draftId ? 'font-bold text-x-text' : 'text-x-text'
                        }`}>
                  {d.label}{d.id === row.draftId ? ' · 연결됨' : ''}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
