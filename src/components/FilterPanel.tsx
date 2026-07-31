'use client';
import type { RefObject } from 'react';
import type { FilterCondition } from '@/lib/tableFilter';
import type { Conflict } from '@/lib/collectionConflict';
import { useDismissible } from '@/lib/useDismissible';
import { FilterRows } from './FilterRows';
import { ChevronDownIcon } from './XIcons';

// 조건을 만드는 자리 — 표 위에 떠서 열린다. 조건이 늘어도 표가 밀리지 않는다(시안 2026-07-31).
// 걸린 조건을 읽는 자리는 여기가 아니라 FilterChips다.
export function FilterPanel({ conditions, conflicts, onChange, totalLabel, countsLoaded, focusRequest, panelRef }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
  countsLoaded: boolean;
  focusRequest: { id: string; n: number } | null;
  panelRef: RefObject<HTMLDetailsElement | null>;
}) {
  useDismissible(panelRef);
  const n = conditions.length;

  return (
    <details ref={panelRef} className="relative shrink-0">
      <summary className={`flex cursor-pointer list-none items-center gap-1 rounded-full border px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover [&::-webkit-details-marker]:hidden ${n > 0 ? 'border-x-blue' : 'border-x-border-strong'}`}>
        필터
        {n > 0 && (
          // 개수는 배지로 — '필터'만 있으면 걸려 있는지 알 수 없다(AGENTS.md 원칙 4)
          <span className="ml-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-x-blue px-1 text-caption font-bold tabular-nums text-white">
            {n}
          </span>
        )}
        <ChevronDownIcon className="h-3 w-3" />
      </summary>
      {/* left-0: 트리거가 툴바 왼쪽이다 — ColumnPicker와 같은 이유 */}
      <div className="absolute left-0 z-20 mt-1 max-h-[26rem] w-[25rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-x-border bg-white p-2 shadow-lg">
        <FilterRows conditions={conditions} conflicts={conflicts} onChange={onChange}
                    totalLabel={totalLabel} countsLoaded={countsLoaded} focusRequest={focusRequest} />
      </div>
    </details>
  );
}
