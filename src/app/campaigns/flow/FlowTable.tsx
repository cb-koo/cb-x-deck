'use client';
import type { ReactNode } from 'react';
import {
  nextSort, dateCell, draftCell, costCell, FLOW_SORT_LABEL,
  type FlowRow, type FlowSort, type FlowSortKey,
} from '@/lib/campaignFlowView';
import { flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL, type FlowStage, type TaskType } from '@/lib/campaignJudgment';
import { suggestTaskCost } from '@/lib/campaignCost';
import type { InfluencerOption } from '@/lib/draftTypes';

// 표 6열(단계·유형·인플·원고·게시 예정일·비용) + 헤더 정렬 + 빈 상태 + 하단 요약(b-task-6-brief.md §2).
// 행 하나 = 한 줄(여러 줄로 쌓지 않는다) — 원고 칸만 truncate + title. 굵은 글씨 없음. 셀 편집기는 여기 없다(값은 글자로만,
// 편집은 행을 눌러 여는 오른쪽 패널이 한다). 판정·문구는 campaignFlowView·campaignJudgment — 여기는 그리기만 한다.
const SORT_KEYS: readonly FlowSortKey[] = ['stage', 'type', 'influencer', 'draft', 'date', 'cost'];
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
      <table className="w-full min-w-[960px] table-fixed text-content">
        <colgroup>
          <col style={{ width: 84 }} /><col style={{ width: 104 }} /><col style={{ width: 200 }} /><col />
          <col style={{ width: 170 }} /><col style={{ width: 120 }} /><col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr className="border-b border-x-border">
            {SORT_KEYS.map((key) => (
              // aria-sort는 정렬 가능한 th에 둔다(TweetTable·LibraryTable·DraftTable 관례) — button에 두면
              // jsx-a11y/role-supports-aria-props가 걸린다(button 역할은 aria-sort를 지원하지 않는다).
              <th key={key} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  className={`px-3 py-2 text-ui font-normal text-x-muted ${key === 'cost' ? 'text-right' : 'text-left'}`}>
                <button type="button" onClick={() => onSortChange(nextSort(sort, key))}
                        className="inline-flex items-center gap-1 hover:text-x-text">
                  {FLOW_SORT_LABEL[key]}
                  <span aria-hidden className="text-caption">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
                </button>
              </th>
            ))}
            <th className="px-3 py-2" />
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
            return (
              <tr key={t.id} onClick={() => onRowClick(t)}
                  className={`h-11 cursor-pointer border-b border-x-border whitespace-nowrap hover:bg-x-hover ${t.id === selectedId ? 'bg-x-blue/5' : ''} ${cancelled ? 'opacity-60' : ''}`}>
                <td className="px-3"><span className={`rounded-full px-2 py-0.5 text-ui ${STAGE_CHIP[stage]}`}>{FLOW_STAGE_LABEL[stage]}</span></td>
                <td className="px-3"><span className={`inline-block min-w-[56px] rounded-full px-2 py-0.5 text-center text-ui ${TYPE_CHIP[t.type]}`}>{TASK_TYPE_LABEL[t.type]}</span></td>
                <td className="px-3">{t.influencerHandle ? `@${t.influencerHandle}` : <span className="text-x-muted">미정</span>}</td>
                <td className="px-3 truncate" title={d.title}><span className={d.muted ? 'text-x-muted' : ''}>{d.text}</span></td>
                <td className={`px-3 ${DATE_TONE[dc.tone]}`}>{dc.text}</td>
                <td className={`px-3 text-right ${COST_TONE[cc.tone]}`} title={cc.title}>{cc.text}</td>
                <td className="px-3" onClick={(e) => e.stopPropagation()}>{renderMenu(t)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7} className="px-3 py-2 text-ui text-x-secondary">{footer}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
