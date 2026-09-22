'use client';
import { useRef, useState, type ReactNode } from 'react';
import {
  nextSort, dateCell, draftCell, costCell, taskPerfExtra, FLOW_SORT_LABEL,
  type FlowRow, type FlowSort, type FlowSortKey,
} from '@/lib/campaignFlowView';
import { flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL, type FlowStage, type TaskType } from '@/lib/campaignJudgment';
import { suggestTaskCost } from '@/lib/campaignCost';
import { num } from '@/lib/campaignTableView';
import { formatPct } from '@/lib/performanceJudgment';
import type { InfluencerOption } from '@/lib/draftTypes';

// 표 6열(단계·유형·인플·원고·게시 예정일·비용) + 조회·좋아요·북마크 3열(koo 09-22: 원래 6열 고정이던 것을
// 깨고 추가 — CampaignTaskItem에 이미 실려 오는 perf 값을 그리기만 한다, TaskTable.tsx와 같은 패턴) +
// 헤더 정렬 + 빈 상태 + 하단 요약(b-task-6-brief.md §2).
// 행 하나 = 한 줄(여러 줄로 쌓지 않는다) — 원고 칸만 truncate + title. 굵은 글씨 없음. 셀 편집기는 여기 없다(값은 글자로만,
// 편집은 행을 눌러 여는 오른쪽 패널이 한다). 성과 3열도 정렬은 없다(COLS의 sort 없음) — 읽기 전용 값이라 굳이 정렬을 안 붙였다.
// 판정·문구는 campaignFlowView·campaignJudgment — 여기는 그리기만 한다.
//
// 열 폭 조절(koo 09-22) — TrackingTable·TweetTable과 같은 방식을 그대로 옮긴다(그쪽 주석 참조):
// 드래그는 <col> DOM 직접 쓰기(React state를 거치면 매 mousemove마다 표 전체가 다시 그려진다), 커밋은
// mouseup에 1회, localStorage 저장(표마다 키 분리 — 표가 다르면 취향도 다르다), role="slider" 접근성.
const WIDTHS_KEY = 'flow-col-widths';
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 720;
const WIDTH_STEP = 24;

type ColKey = FlowSortKey | 'views' | 'likes' | 'bookmarks' | 'menu';
interface ColDef { key: ColKey; label: string; sort?: FlowSortKey; numeric?: boolean; resizable: boolean; width: number }
const COLS: ColDef[] = [
  { key: 'stage', label: FLOW_SORT_LABEL.stage, sort: 'stage', resizable: true, width: 84 },
  { key: 'type', label: FLOW_SORT_LABEL.type, sort: 'type', resizable: true, width: 104 },
  { key: 'influencer', label: FLOW_SORT_LABEL.influencer, sort: 'influencer', resizable: true, width: 200 },
  { key: 'draft', label: FLOW_SORT_LABEL.draft, sort: 'draft', resizable: true, width: 260 },
  { key: 'date', label: FLOW_SORT_LABEL.date, sort: 'date', resizable: true, width: 170 },
  { key: 'cost', label: FLOW_SORT_LABEL.cost, sort: 'cost', numeric: true, resizable: true, width: 120 },
  { key: 'views', label: '조회(CPV)', numeric: true, resizable: true, width: 120 },
  { key: 'likes', label: '좋아요(좋아요율)', numeric: true, resizable: true, width: 120 },
  { key: 'bookmarks', label: '북마크(북마크율)', numeric: true, resizable: true, width: 120 },
  { key: 'menu', label: '', resizable: false, width: 40 },
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

const STAGE_CHIP: Record<FlowStage, string> = {
  prep: 'bg-x-surface text-x-secondary', handed: 'bg-[#e8f0fe] text-[#1d4ed8]', posted: 'bg-[#e6f6ee] text-[#15803d]',
  settle: 'bg-[#f3e8ff] text-[#7e22ce]', done: 'bg-x-text text-white', canc: 'bg-slate-50 text-slate-400 line-through',
};
// TaskTable.tsx의 TYPE_CHIP과 같은 값 — 그 파일의 비공개 상수라 복사한다(import하지 않는다, b-task-6-brief.md §2).
const TYPE_CHIP: Record<TaskType, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
// 날짜·비용 칸의 색 — 색만으로 구분한다(행 배경·막대·'오늘' 강조는 두지 않는다)
const DATE_TONE: Record<'late' | 'posted' | 'plain' | 'muted', string> = { late: 'text-red-600', posted: 'text-x-blue-text', plain: '', muted: 'text-x-muted' };
const COST_TONE: Record<'plain' | 'muted' | 'struck' | 'suggested', string> = { plain: 'tabular-nums', muted: 'text-x-muted', struck: 'text-x-muted line-through', suggested: 'text-x-muted' };

export function FlowTable({ rows, total, today, influencerOptions, sort, onSortChange, footer, selectedId, onRowClick, renderMenu }: {
  rows: FlowRow[];
  total: number;
  today: string;
  influencerOptions: InfluencerOption[];
  sort: FlowSort;
  onSortChange: (s: FlowSort) => void;
  footer: string;
  selectedId: string | null;
  onRowClick: (t: FlowRow) => void;
  renderMenu: (t: FlowRow) => ReactNode;
}) {
  const optionFor = (handle: string | null) => (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);

  // 마운트 시 1회만 읽는다(lazy initializer, TrackingTable과 동일 — 이펙트 불필요)
  const [widths, setWidths] = useState<Record<string, number>>(() => loadStoredWidths());
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
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthFor(key);
    let w = startW;
    let raf: number | null = null;
    const col = colRefs.current[key];
    const writeWidth = () => { raf = null; if (col) col.style.width = `${w}px`; };
    const move = (ev: MouseEvent) => {
      w = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX));
      if (raf === null) raf = requestAnimationFrame(writeWidth);
    };
    const up = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (col) col.style.width = `${w}px`;
      if (w !== startW) commitWidth(key, w);
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  const totalWidth = COLS.reduce((sum, c) => sum + widthFor(c.key), 0);

  if (total === 0) {
    return <p className="rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가] 또는 [한 번에 만들기]로 시작해요.</p>;
  }
  if (rows.length === 0) {
    // 걸리는 게 없어도 캠페인 전체 현황(하단 줄)은 계속 보인다 — 필터를 좁힌 순간 진행 상황이 사라지면
    // 사용자는 '작업이 없어진 것'과 '지금 조건에 없는 것'을 구분할 수 없다.
    return (
      <div>
        <p className="rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">조건에 맞는 작업이 없어요 — 필터를 지우면 전체가 보여요.</p>
        <p className="px-3 py-2 text-ui text-x-secondary">{footer}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed text-content" style={{ width: `max(${totalWidth}px, 100%)` }}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} ref={(el) => { colRefs.current[c.key] = el; }} style={{ width: widthFor(c.key) }} />
          ))}
          {/* 채움 칸 — 폭 미지정이라 표의 남는 공간을 전부 떠안는다(TrackingTable과 동일) */}
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-x-border">
            {COLS.map((c) => {
              const active = !!c.sort && c.sort === sort.key;
              const w = widthFor(c.key);
              return (
                // aria-sort는 정렬 가능한 th에 둔다(TweetTable·LibraryTable·DraftTable 관례) — button에 두면
                // jsx-a11y/role-supports-aria-props가 걸린다(button 역할은 aria-sort를 지원하지 않는다).
                <th key={c.key} aria-sort={c.sort ? (active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') : undefined}
                    className={`relative overflow-hidden whitespace-nowrap px-3 py-2 text-ui font-normal text-x-muted ${c.numeric ? 'text-right' : 'text-left'}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => onSortChange(nextSort(sort, c.sort!))}
                            className="inline-flex items-center gap-1 hover:text-x-text">
                      {c.label}
                      <span aria-hidden className="text-caption">{active ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
                    </button>
                  ) : <span>{c.label}</span>}
                  {c.resizable && (
                    // 폭 조절 손잡이 — 접근성·시각 처리 전부 TrackingTable의 것 그대로(그쪽 주석 참조)
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
                        else if (e.key === ' ') e.preventDefault();
                      }}
                      className="absolute right-0 top-0 z-10 h-full w-1.5 touch-none cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-x-border-strong after:content-[''] hover:bg-x-hover hover:after:bg-x-secondary focus-visible:bg-x-hover focus-visible:after:bg-x-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:bg-x-hover active:after:bg-x-secondary"
                    />
                  )}
                </th>
              );
            })}
            {/* colgroup의 채움 칸과 짝을 이루는 빈 헤더 칸 */}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const stage = flowStage(t, t.settlement);
            const cancelled = stage === 'canc';
            const dc = dateCell(t, today);
            const d = draftCell(t);
            const suggestion = suggestTaskCost(optionFor(t.influencerHandle)?.pricing, t.type);
            const cc = costCell(t, suggestion);
            const pe = taskPerfExtra(t); // 성과 3열 괄호 값(그 작업만의 CPV·좋아요율·북마크율)
            return (
              <tr key={t.id} data-flow-row onClick={() => onRowClick(t)}
                  className={`h-11 cursor-pointer border-b border-x-border whitespace-nowrap hover:bg-x-hover ${t.id === selectedId ? 'bg-x-blue/5' : ''} ${cancelled ? 'opacity-60' : ''}`}>
                <td className="px-3"><span className={`rounded-full px-2 py-0.5 text-ui ${STAGE_CHIP[stage]}`}>{FLOW_STAGE_LABEL[stage]}</span></td>
                <td className="px-3"><span className={`inline-block min-w-[56px] rounded-full px-2 py-0.5 text-center text-ui ${TYPE_CHIP[t.type]}`}>{TASK_TYPE_LABEL[t.type]}</span></td>
                <td className="px-3">{t.influencerHandle ? `@${t.influencerHandle}` : <span className="text-x-muted">미정</span>}</td>
                <td className="px-3 truncate" title={d.title}><span className={d.muted ? 'text-x-muted' : ''}>{d.text}</span></td>
                <td className={`px-3 ${DATE_TONE[dc.tone]}`}>{dc.text}</td>
                <td className={`px-3 text-right ${COST_TONE[cc.tone]}`} title={cc.title}>{cc.text}</td>
                <td className="px-3 text-right tabular-nums">
                  {num(t.perf?.views ?? null)}{pe.cpvKrw !== null && <span className="text-x-muted">({pe.cpvKrw.toFixed(1)}원)</span>}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {num(t.perf?.likes ?? null)}{pe.likeRate !== null && <span className="text-x-muted">({formatPct(pe.likeRate, 1)})</span>}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {num(t.perf?.bookmarks ?? null)}{pe.bookmarkRate !== null && <span className="text-x-muted">({formatPct(pe.bookmarkRate, 1)})</span>}
                </td>
                <td className="px-3" onClick={(e) => e.stopPropagation()}>{renderMenu(t)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={COLS.length + 1} className="px-3 py-2 text-ui text-x-secondary">{footer}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
