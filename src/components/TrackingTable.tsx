'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';
import { formatFull } from '@/lib/format';
import { kstDateTime, kstMonthDayKo, kstShort } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';
import type { TrackedPostRow, MetricSnapshotRow } from '@/lib/trackingStore';
import type { PostMetrics } from '@/lib/postMetrics';
import { POST_ROLES, type PostRole } from '@/lib/postRole';

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

// 모달 목록의 원고 표현 = 제목 + 보조줄(생성일·배정 핸들) — 동명 원고는 번호가 아니라 맥락으로
// 구분한다(koo 결정 08-15: 번호는 고유하지만 의미를 실어 나르지 않아 판단에 못 쓴다. 일련번호는 보류).
export interface DraftOption { id: string; label: string; createdAt: string; influencerHandle: string | null }
export type DraftsState = 'idle' | 'loading' | 'ready' | 'error';
export type HistoryState = 'loading' | 'ready' | 'error';

// 정렬 키 — 정렬은 페이지가 소유한다(DraftTable·TweetTable 관례). 이 표는 받은 순서를 그대로 그린다.
export type TrackSortKey = 'created' | 'posted' | 'captured' | keyof PostMetrics;
export type TrackSortDir = 'asc' | 'desc';

const SORT_LABEL: Record<TrackSortKey, string> = {
  created: '등록순', posted: '게시 시각', captured: '측정 시각',
  views: '조회', likes: '좋아요', retweets: '리포스트', replies: '답글', bookmarks: '북마크', quotes: '인용',
};

const ROLE_LABEL: Record<PostRole, string> = { main: '본문', thread: '이어지는 본문', link: '링크 댓글' };

// ── 열 정의 · 폭 조절 — 전부 TweetTable에서 옮겨온 방식(드래그는 <col> DOM 직접 쓰기,
//    커밋은 mouseup에 1회, localStorage 저장, role="slider" 접근성) ─────────────────
const WIDTHS_KEY = 'tracking-col-widths';  // TweetTable(table-col-widths)과 키 분리 — 표가 다르면 취향도 다르다
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 720;
const WIDTH_STEP = 24;

type ColKey = 'select' | 'expand' | 'account' | 'post' | 'draft' | 'posted' | keyof PostMetrics | 'captured' | 'actions';
interface ColDef { key: ColKey; label: string; sort?: TrackSortKey; numeric?: boolean; resizable: boolean; width: number }

// 열 순서 = 읽기 동선: 정체(계정·게시물·원고) → 맥락(게시) → 숫자(지표) → 신선도(측정) → 행동.
// 원고는 시간·숫자 축이 아니라 "무엇" 축이라 게시물 옆이 제자리고, 측정·동작을 인접시켜
// "오래됐네 → 새로고침"의 동선을 끊지 않는다(koo 결정 08-15).
// 게시물 열의 정렬 키는 '등록순' — 목록의 기본 순서라 이 열이 그 자리를 맡는다.
const COLS: ColDef[] = [
  { key: 'select', label: '', resizable: false, width: 40 },
  { key: 'expand', label: '', resizable: false, width: 32 },
  { key: 'account', label: '계정', resizable: true, width: 150 },
  { key: 'post', label: '게시물', sort: 'created', resizable: true, width: 340 },
  { key: 'draft', label: '원고', resizable: true, width: 120 },
  { key: 'posted', label: '게시', sort: 'posted', resizable: true, width: 150 },
  ...METRICS.map((m): ColDef => ({ key: m.key, label: m.label, sort: m.key, numeric: true, resizable: true, width: 92 })),
  { key: 'captured', label: '측정', sort: 'captured', resizable: true, width: 150 },
  { key: 'actions', label: '동작', resizable: false, width: 84 },
];
const DEFAULT_WIDTH: Record<string, number> = Object.fromEntries(COLS.map((c) => [c.key, c.width]));

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
function resolveWidth(map: Record<string, number>, key: string): number {
  const v = map[key];
  return typeof v === 'number' && v > 0 ? v : (DEFAULT_WIDTH[key] ?? 120);
}

export function TrackingTable({
  rows, highlightId, refreshingIds,
  selectedIds, onToggleSelect, allSelected, onToggleAll,
  sort, dir, onSort,
  expandedId, onToggleExpand, history, historyState,
  drafts, draftsState, onLoadDrafts,
  pickerFor, onOpenPicker, onLinkDraft, onSetRole,
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
  expandedId: string | null;             // 펼친 행 — 한 번에 하나(표 안의 표가 여럿이면 되레 못 읽는다)
  onToggleExpand: (id: string) => void;
  history: MetricSnapshotRow[];          // 펼친 행의 측정 이력(페이지가 소유·조회)
  historyState: HistoryState;
  drafts: DraftOption[];
  draftsState: DraftsState;
  onLoadDrafts: () => void;
  pickerFor: string | null;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
  onSetRole: (row: TrackedPostRow, role: PostRole | null) => void;
  onRefresh: (row: TrackedPostRow) => void;
  onRemove: (row: TrackedPostRow) => void;
}) {
  // 마운트 시 1회만 읽는다 — 이 컴포넌트는 목록이 실제로 그려질 때만 나타나(페이지의 로딩 갈래)
  // 서버 렌더를 탄 적이 없다. lazy initializer라 이펙트도 필요 없다(TweetTable과 동일).
  const [widths, setWidths] = useState<Record<string, number>>(() => loadStoredWidths());
  // 드래그 중 <col>에 직접 쓰기 위한 DOM 참조 — React state를 거치면 표 전체가 매 mousemove마다
  // 다시 렌더링된다(TweetTable에서 실제로 겪은 문제, 그쪽 startResize 주석 참조).
  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({});

  const widthFor = (key: string) => resolveWidth(widths, key);

  function commitWidth(key: string, w: number) {
    setWidths((cur) => { const next = { ...cur, [key]: w }; saveWidths(next); return next; });
  }
  function resetWidth(key: string) {
    setWidths((cur) => { const next = { ...cur }; delete next[key]; saveWidths(next); return next; });
  }
  function nudgeWidth(key: string, delta: number) {
    setWidths((cur) => {
      const w = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, resolveWidth(cur, key) + delta));
      const next = { ...cur, [key]: w };
      saveWidths(next);
      return next;
    });
  }
  function startResize(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();   // 정렬 버튼은 형제 요소라 원래도 안 타지만, 방어적으로 한 번 더 막는다
    const startX = e.clientX;
    const startW = widthFor(key);
    let w = startW;
    let raf: number | null = null;
    const col = colRefs.current[key];
    const writeWidth = () => { raf = null; if (col) col.style.width = `${w}px`; };
    const move = (ev: MouseEvent) => {
      w = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX));
      if (raf === null) raf = requestAnimationFrame(writeWidth);   // 프레임당 최대 1회만 DOM에 쓴다
    };
    const up = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (col) col.style.width = `${w}px`;   // 마지막 rAF 미실행분까지 확실히 반영(TweetTable과 동일)
      if (w !== startW) commitWidth(key, w);
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // table-fixed는 표 자신의 width가 auto가 아닐 때만 적용된다(TweetTable 주석 참조) — colgroup으로
  // 칸 폭을 명시하고 표에도 width를 준다. 남는 폭은 맨 끝 이름 없는 채움 칸이 전부 가져가 —
  // 사용자가 좁혀둔 칸이 넓은 화면에서 도로 넓어지지 않는다.
  const totalWidth = COLS.reduce((sum, c) => sum + widthFor(c.key), 0);

  return (
    // 가로·세로 스크롤을 담당하는 컨테이너는 이 하나뿐이다 — sticky thead는 이 div를 기준으로 고정된다
    // (TweetTableView와 같은 구조). '더 보기'는 표 스크롤과 무관하게 항상 보이도록 페이지가 이 밖에 둔다.
    <div className="max-h-[70vh] w-full overflow-auto">
      <table className="table-fixed border-collapse text-ui" style={{ width: `max(${totalWidth}px, 100%)` }}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} ref={(el) => { colRefs.current[c.key] = el; }} style={{ width: widthFor(c.key) }} />
          ))}
          {/* 채움 칸 — 폭 미지정이라 표의 남는 공간을 전부 떠안는다(TweetTable과 동일) */}
          <col />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            {COLS.map((c) => {
              if (c.key === 'select') {
                return (
                  <th key={c.key} className="px-3 py-2">
                    <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                           aria-label="표시된 게시물 전체 선택" className="align-middle accent-x-blue" />
                  </th>
                );
              }
              if (c.key === 'expand') return <th key={c.key} aria-hidden="true" />;
              const active = !!c.sort && c.sort === sort;
              const w = widthFor(c.key);
              return (
                <th key={c.key} scope="col"
                    aria-sort={c.sort ? (active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
                    className={`relative overflow-hidden whitespace-nowrap px-2 py-2 font-normal ${
                      c.numeric ? 'text-right' : 'text-left'} ${active ? 'text-x-text' : ''}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => onSort(c.sort!)}
                            title={active ? `${SORT_LABEL[c.sort]} ${dir === 'desc' ? '내림차순' : '오름차순'} — 다시 누르면 순서가 바뀝니다`
                                          : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                            className="rounded px-1 py-0.5 hover:bg-x-text/5">
                      {c.label}{active && <span aria-hidden> {dir === 'desc' ? '↓' : '↑'}</span>}
                    </button>
                  ) : <span className="px-1 py-0.5">{c.label}</span>}
                  {c.resizable && (
                    // 폭 조절 손잡이 — 접근성·시각 처리 전부 TweetTable의 것 그대로(그쪽 주석 참조)
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
                      className="absolute right-0 top-0 z-10 h-full w-1.5 touch-none cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-x-border-strong after:content-[''] hover:bg-x-hover hover:after:bg-x-secondary focus-visible:bg-x-hover focus-visible:after:bg-x-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:bg-x-hover active:after:bg-x-secondary"
                    />
                  )}
                </th>
              );
            })}
            {/* colgroup의 채움 칸과 짝을 이루는 빈 헤더 칸 — 데이터가 없어 보조기술 트리에서 뺀다 */}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const busy = refreshingIds.has(r.id);
            const gone = r.unavailableAt !== null;
            const line = (r.text.split('\n')[0] ?? '').trim();
            const open = expandedId === r.id;
            return (
              <Fragment key={r.id}>
              {/* id: 등록 직후 그 행으로 스크롤하기 위한 손잡이(페이지의 flash) — 행 자체는 클릭 대상이 아니다.
                  이 표의 행에는 '열기'가 없다: 게시물은 X로, 원고는 연결 UI로, 측정 이력은 펼침으로 간다. */}
              <tr id={`tracked-${r.id}`}
                  className={`border-b border-x-border transition-colors ${
                    r.id === highlightId ? 'bg-x-blue/10' : 'hover:bg-x-hover'
                  }`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => onToggleSelect(r.id)}
                         aria-label={`${r.authorHandle ? `@${r.authorHandle} ` : ''}게시물 선택`}
                         className="align-middle accent-x-blue" />
                </td>
                {/* 펼침 — 이 게시물의 측정 이력을 바로 아래 행에 연다. 표를 떠나지 않고 과거 값을 본다 */}
                <td className="px-1 py-2">
                  <button onClick={() => onToggleExpand(r.id)} aria-expanded={open}
                          title={open ? '측정 이력 접기' : '측정 이력 보기 — 그동안 쌓인 값들'}
                          aria-label={open ? '측정 이력 접기' : '측정 이력 보기'}
                          className="rounded p-1 text-x-muted hover:bg-x-text/5 hover:text-x-secondary">
                    <span aria-hidden className="inline-block text-[11px] leading-none">{open ? '▼' : '▶'}</span>
                  </button>
                </td>
                {/* 계정(누가)과 게시물(무엇)은 다른 속성이라 열을 나눈다(QA 08-15) — 계정 열을 훑으면
                    누구 게시물들이 있는지 세로로 보인다 */}
                <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary">
                  {r.authorHandle ? `@${r.authorHandle}` : '미확인'}
                </td>
                <td className="overflow-hidden px-3 py-2">
                  <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noreferrer"
                     className="block min-w-0 truncate hover:underline">
                    {line || '(본문 없음)'}
                  </a>
                  {/* 볼 수 없음은 색이 아니라 글자로 말한다 — 왜(삭제·비공개)와 언제 확인했는지까지 (I축) */}
                  {gone && (
                    <span className="mt-1 inline-block max-w-full truncate rounded-full bg-x-surface px-2 py-0.5 text-caption text-x-secondary">
                      볼 수 없음(삭제·비공개 등) · {kstMonthDayKo(r.unavailableAt)} 확인
                    </span>
                  )}
                </td>
                {/* nowrap: 표가 좁아지면 '연결 안 됨'이 글자 단위로 세로로 꺾인다(QA 08-15) — 상태 글자는 한 줄이 정체성 */}
                <td className="overflow-hidden whitespace-nowrap px-3 py-2">
                  <DraftCell row={r} open={pickerFor === r.id} drafts={drafts} draftsState={draftsState}
                             onLoadDrafts={onLoadDrafts} onOpenPicker={onOpenPicker} onLinkDraft={onLinkDraft}
                             onSetRole={onSetRole} />
                </td>
                {/* 시각은 '4달 전' 같은 상대 표기 대신 정확한 값을 표 안에 그대로(사용자 결정 08-15).
                    서울 기준, kstDateTime은 '최종 수집 시간' 표기의 기존 관례다(datetime.ts).
                    글자 규격은 지표 숫자와 동일(text-ui·tabular-nums) — 시각도 데이터 값이라 caption으로
                    줄이면 같은 행 안에서 크기가 어긋난다(QA 08-15). 색만 secondary로 한 단계 옅게 —
                    행의 주인공(지표)과의 위계는 크기가 아니라 색이 나른다 */}
                <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary tabular-nums">
                  {r.postedAt ? kstDateTime(r.postedAt) : '–'}
                </td>
                {/* 볼 수 없는 게시물의 지표는 지우지 않고 마지막 측정값을 흐리게 남긴다 — 지운 값이 0으로 보이면 거짓말이 된다 */}
                {METRICS.map((m) => (
                  <td key={m.key}
                      className={`truncate whitespace-nowrap px-3 py-2 text-right tabular-nums ${gone ? 'text-x-muted opacity-60' : 'text-x-text'}`}>
                    {formatFull(r.metrics?.[m.key] ?? null)}
                  </td>
                ))}
                <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary tabular-nums">
                  {r.capturedAt ? kstDateTime(r.capturedAt) : '–'}
                </td>
                {/* 행마다 반복되는 액션은 글자 대신 아이콘(QA 08-15) — 새로고침은 덱 컬럼과 같은
                    회전 문법(Column.tsx), 중단은 데이터를 지우므로 ✕가 아니라 휴지통이 정직하다.
                    뜻은 title이 지금까지의 문구 그대로 나른다 */}
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex items-center gap-0.5">
                    <Button variant="icon" onClick={() => onRefresh(r)} disabled={busy}
                            title="지금 지표를 다시 가져와요 (API 호출 1회)" aria-label="새로고침">
                      <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button variant="icon" onClick={() => onRemove(r)}
                            title="추적 중단 — 목록에서 빼고 쌓인 측정 기록도 지워요" aria-label="추적 중단">
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
                <td aria-hidden="true" />
              </tr>
              {open && <MetricHistory rows={history} state={historyState} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 측정 이력 — 펼친 행 바로 아래에 부모 표의 열 그대로 이어 그린다(최신이 위).
// 부모와 같은 <tr>/<td> 구조를 쓰는 이유(QA 08-16): 지표가 부모 열 바로 아래 세로로 정렬돼야
// "이 숫자가 어떻게 변해왔나"가 읽힌다. table-fixed + colgroup 덕에 폭 조절도 자동으로 따라온다.
// 왼쪽(계정·게시물·원고·게시)은 비운다 — 부모와 같은 값을 반복하면 표가 두 벌로 보인다.
// 헤더도 없다: 부모 헤더가 위에 고정돼 있어 그 자리가 곧 이 값의 이름이다.
// 그래프가 아니라 숫자인 이유: 수동 새로고침이라 간격이 불규칙해 점 두세 개짜리 곡선은 오해를 부른다.
function MetricHistory({ rows, state }: { rows: MetricSnapshotRow[]; state: HistoryState }) {
  const note = (text: string) => (
    <tr className="border-b border-x-border bg-x-surface/60">
      <td colSpan={COLS.length + 1} className="py-2 pl-14 text-caption text-x-muted">{text}</td>
    </tr>
  );
  if (state === 'loading') return note('측정 이력 불러오는 중…');
  if (state === 'error') return note('측정 이력을 불러오지 못했어요 — 접었다 다시 열어보세요');
  if (rows.length === 0) return note('아직 측정 기록이 없어요');

  return (
    <>
      {rows.map((s, i) => {
        // 증감(+N)은 넣었다가 뺐다(koo 08-16) — 값이 세로로 정렬돼 있으면 변화는 눈이 직접 읽는다.
        const last = i === rows.length - 1;
        return (
          <tr key={s.capturedAt} className={`bg-x-surface/60 ${last ? 'border-b border-x-border' : ''}`}>
            <td /><td />
            {/* 계정 자리: 이 줄들이 위 행의 이력임을 말하는 표시 — 첫 줄에만 적어 반복을 줄인다 */}
            <td className="whitespace-nowrap py-1 pl-3 text-caption text-x-muted">
              {i === 0 && `측정 이력 ${rows.length}건${rows.length >= 50 ? ' (최근 50)' : ''}`}
            </td>
            <td /><td /><td />
            {METRICS.map((m) => (
              <td key={m.key} className="whitespace-nowrap px-3 py-1 text-right text-x-secondary tabular-nums">
                {formatFull(s.metrics[m.key])}
              </td>
            ))}
            <td className="whitespace-nowrap px-3 py-1 text-x-secondary tabular-nums">{kstDateTime(s.capturedAt)}</td>
            <td /><td />
          </tr>
        );
      })}
    </>
  );
}

// 원고 연결 — 처음엔 셀 안 네이티브 select였으나, 원고 수십 건이 OS 팝업으로 통째로 쏟아져
// 검색도 미리보기도 없는 경험이었다(QA 08-15). 이 앱의 '많은 것 중 하나 고르기' 관례인
// 검색 달린 모달(RefPickerSheet·AddByLinkModal 골격)로 교체.
// 목록은 열 때 처음 한 번만 불러온다(onLoadDrafts) — 표를 그릴 때마다 원고 전량을 받아오지 않기 위해서다.
function DraftCell({ row, open, drafts, draftsState, onLoadDrafts, onOpenPicker, onLinkDraft, onSetRole }: {
  row: TrackedPostRow; open: boolean;
  drafts: DraftOption[]; draftsState: DraftsState; onLoadDrafts: () => void;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
  onSetRole: (row: TrackedPostRow, role: PostRole | null) => void;
}) {
  if (open) {
    return (
      <DraftPickerModal row={row} drafts={drafts} draftsState={draftsState}
                        onLoadDrafts={onLoadDrafts} onLinkDraft={onLinkDraft}
                        onClose={() => onOpenPicker(null)} />
    );
  }
  // 셀은 두 상태 모두 요소 하나만 둔다(QA 08-15 — 행마다 2요소 조합이 반복되면 열 전체가 복잡해 보인다).
  // 바꾸기·해제는 전부 클릭이 여는 연결 모달 안에 있어 기능 손실이 없다.
  if (row.draftId) {
    const label = row.draftLabel ?? '제목 없는 원고';
    const shown = row.role ?? row.derivedRole;
    return (
      <div className="min-w-0">
        <button onClick={() => onOpenPicker(row.id)} title={`${label} — 원고 연결 바꾸기·해제`}
                className="block max-w-full truncate text-x-blue-text hover:underline">
          {label}
        </button>
        {/* 역할 — 성과 화면의 '조회'가 어느 게시물인지 정한다. 자동 판정(role null)은 흐리게, 사람이 고치면 진하게.
            선택지 4개라 네이티브 select로 충분하다(원고 고르기와 달리 목록이 길지 않다). */}
        <select value={row.role ?? ''} onChange={(e) => onSetRole(row, (e.target.value || null) as PostRole | null)}
                aria-label="게시물 역할"
                title={row.role ? '사람이 정한 역할이에요 — 자동으로 되돌릴 수 있어요' : `자동으로 판정했어요(${ROLE_LABEL[shown ?? 'main']}) — 눌러서 바꿀 수 있어요`}
                className={`mt-0.5 max-w-full rounded border border-transparent bg-transparent text-ui hover:border-x-border-strong ${row.role ? 'text-x-secondary' : 'text-x-muted'}`}>
          <option value="">{shown ? `자동 · ${ROLE_LABEL[shown]}` : '자동'}</option>
          {POST_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>
    );
  }
  return (
    <button onClick={() => onOpenPicker(row.id)} className="whitespace-nowrap text-x-blue-text hover:underline">
      + 연결
    </button>
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
  // 핸들도 검색 대상 — "mochi에게 준 원고"처럼 사람 기준으로 찾는 경우가 실제 사용 패턴이다
  const filtered = q
    ? drafts.filter((d) => d.label.toLowerCase().includes(q) || (d.influencerHandle ?? '').toLowerCase().includes(q))
    : drafts;

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
                   placeholder="원고 제목·인플루언서 핸들 검색"
                   aria-label="원고 제목·인플루언서 핸들 검색"
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
                        className="block w-full rounded-md px-3 py-1.5 text-left text-ui hover:bg-x-hover">
                  <span className={`block truncate ${d.id === row.draftId ? 'font-bold' : ''}`}>
                    {d.label}{d.id === row.draftId ? ' · 연결됨' : ''}
                  </span>
                  {/* 보조줄: 생성일 · 배정 핸들 — 동명 원고를 사람이 판단할 수 있는 맥락으로 구분 */}
                  <span className="block truncate text-caption text-x-muted">
                    {kstShort(d.createdAt)}{d.influencerHandle ? ` · @${d.influencerHandle}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
