'use client';
import { columnSelectionLabel, describeCondition, isComplete, type FilterCondition } from '@/lib/tableFilter';
import { summarizeConflicts, type Conflict } from '@/lib/collectionConflict';

// 걸린 필터를 패널을 열지 않아도 읽을 수 있게 하는 줄.
// 패널 안에 상태가 있고, 트리거에 개수 배지가 있고, 여기에 요약이 있다 — 세 겹으로 두는 것이
// 의도된 중복이다. 어느 하나만 두면 "뭐가 걸렸는지 열어봐야 아는" 상태가 된다.
export function FilterChips({
  conditions, conflicts, columnNames,
  onRemoveCondition, onClearColumns, onClearAll, onOpenCondition,
}: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  columnNames: string[];
  onRemoveCondition: (id: string) => void;
  onClearColumns: () => void;
  onClearAll: () => void;
  onOpenCondition: (id: string) => void;
}) {
  // 미완성 조건은 쿼리에 안 가므로 칩으로도 보이면 안 된다 — 라벨과 실제가 어긋난다.
  const ready = conditions.filter(isComplete);
  const hasColumns = columnNames.length > 0;
  if (ready.length === 0 && !hasColumns) return null;

  const summary = summarizeConflicts(conflicts);
  const byCondition = new Map(conflicts.map((c) => [c.conditionId, c]));

  const chip = 'inline-flex items-center gap-1.5 rounded-full border bg-x-hover py-0.5 pl-2.5 pr-0.5 text-ui text-x-text';
  const del = 'inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center rounded-full text-caption text-x-muted hover:bg-x-border hover:text-x-text';

  return (
    <div className="flex flex-col gap-0.5 border-b border-x-border px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {hasColumns && (
          <span className={`${chip} border-x-border-strong`}>
            열 {columnSelectionLabel(columnNames)}
            <button aria-label="열 선택 지우기" title="열 선택 지우기" onClick={onClearColumns} className={del}>✕</button>
          </span>
        )}
        {ready.map((c) => {
          const conflict = byCondition.get(c.id);
          // 경고를 색으로만 구분하지 않는다 — 점을 함께 둔다(색을 구분 못 해도 읽힌다).
          const border = conflict?.kind === 'alwaysEmpty' ? 'border-red-400'
            : conflict ? 'border-amber-400' : 'border-x-border-strong';
          return (
            <span key={c.id} className={`${chip} ${border}`}>
              {conflict && (
                <span aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${conflict.kind === 'alwaysEmpty' ? 'bg-red-500' : 'bg-amber-600'}`} />
              )}
              <button onClick={() => onOpenCondition(c.id)} className="hover:underline">
                {describeCondition(c)}
              </button>
              <button aria-label="이 조건 지우기" title="이 조건 지우기"
                      onClick={() => onRemoveCondition(c.id)} className={del}>✕</button>
            </span>
          );
        })}
        <button onClick={onClearAll} className="ml-0.5 text-ui text-x-blue-text underline hover:no-underline">
          필터 지우기
        </button>
      </div>
      {summary && (
        <p className={`text-caption ${summary.primary.kind === 'alwaysEmpty' ? 'text-red-500' : 'text-amber-600'}`}>
          {summary.primary.message}
          {summary.extra > 0 && <span className="text-x-muted"> · 경고 {summary.extra}개 더</span>}
        </p>
      )}
    </div>
  );
}
