'use client';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, type FilterCondition, type FilterField } from '@/lib/tableFilter';
import type { Conflict } from '@/lib/collectionConflict';
import { Button } from './ui';

let seq = 0;
// 개발 환경에서 Fast Refresh 시 seq가 0으로 리셋되지만, 이미 생성된 id들은 부모 상태에 남아 있어 충돌하지 않는다.
const nextId = () => `f${++seq}`;

// 조건 행 — 건 조건만 보이므로 평소엔 자리를 차지하지 않는다(설계 §A).
// 조건은 모두 AND로 묶인다. 논리 연산자를 노출하지 않는다 — 사용자는 비개발 기획 담당자다.
export function FilterRows({ conditions, conflicts, onChange, totalLabel, hasColumnFilter, onClearAll }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
  hasColumnFilter: boolean;   // 열이 좁혀져 있는지 — 조건이 없어도 '필터 지우기'가 보여야 한다
  onClearAll: () => void;     // 조건 + 열 선택을 함께 되돌린다
}) {
  function add() {
    const field: FilterField = 'handle';
    onChange([...conditions, { id: nextId(), field, op: FIELD_SPECS[field].ops[0], value: '' }]);
  }
  function patch(id: string, part: Partial<FilterCondition>) {
    onChange(conditions.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...part };
      // 축이 바뀌면 그 축에 없는 연산자가 남을 수 있다 — 첫 연산자로 되돌린다
      if (part.field && !FIELD_SPECS[part.field].ops.includes(next.op)) next.op = FIELD_SPECS[part.field].ops[0];
      // 축의 형식(text/number/date)이 바뀌면 값을 지운다. 같은 형식 내에서 바꾸면(예: 좋아요→조회수) 값을 유지해야 한다.
      // 형식이 안 맞는 값이 남으면 isComplete()가 조용히 걸러 라벨과 실제가 어긋난다.
      if (part.field && FIELD_SPECS[c.field].kind !== FIELD_SPECS[part.field].kind) next.value = '';
      return next;
    }));
  }
  const sel = 'rounded border border-x-border-strong bg-white px-1.5 py-1 text-ui text-x-text';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button variant="subtle" onClick={add}>+ 필터</Button>
        {(conditions.length > 0 || hasColumnFilter) && (
          <Button variant="ghost" onClick={onClearAll}>필터 지우기</Button>
        )}
      </div>
      {conditions.map((c) => {
        const spec = FIELD_SPECS[c.field];
        // 알려지지 않은 축이 들어오면 이 행은 건너뛴다 (차후 축 정의 변경 시에도 안정적)
        if (!spec) return null;
        const conflict = conflicts.find((x) => x.conditionId === c.id);
        const warningId = conflict ? `filter-warning-${c.id}` : undefined;
        return (
          <div key={c.id} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <select aria-label="필터 항목" aria-describedby={warningId} value={c.field} className={sel}
                      onChange={(e) => patch(c.id, { field: e.target.value as FilterField })}>
                {FILTER_FIELDS.map((f) => <option key={f} value={f}>{FIELD_SPECS[f].label}</option>)}
              </select>
              <select aria-label="조건" aria-describedby={warningId} value={c.op} className={sel}
                      onChange={(e) => patch(c.id, { op: e.target.value as FilterCondition['op'] })}>
                {spec.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select>
              <input aria-label="값" aria-describedby={warningId} value={c.value} className={`${sel} w-44`}
                     inputMode={spec.kind === 'number' ? 'numeric' : undefined}
                     placeholder={spec.kind === 'date' ? '2026-07-01' : ''}
                     onChange={(e) => patch(c.id, { value: e.target.value })} />
              <button aria-label="이 조건 지우기" title="이 조건 지우기"
                      onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
                      className="rounded px-1.5 py-1 text-ui text-x-muted hover:bg-x-hover hover:text-x-text">✕</button>
            </div>
            {conflict && (
              // 항상 0건은 무효보다 위험하다 — 무엇을 해도 안 나오는데 이유를 알 수 없다. 색으로도 구분한다.
              <p id={warningId} className={`pl-1 text-caption ${conflict.kind === 'alwaysEmpty' ? 'text-red-500' : 'text-amber-600'}`}>
                {conflict.message}
              </p>
            )}
          </div>
        );
      })}
      {conditions.length > 0 && (
        <p className="pl-1 text-caption text-x-muted">
          이미 모은 {totalLabel}건 중에서만 걸러요 (새로 가져오지 않아서 무료)
        </p>
      )}
    </div>
  );
}
