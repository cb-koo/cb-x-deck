'use client';
import type { ColumnRow } from '@/lib/types';
import { formatFull } from '@/lib/format';
import { ChevronDownIcon } from './XIcons';

// 열 선택 — 여러 개 고를 수 있다. 빈 배열 = 전체.
// 칩(단일 선택)을 대체한다: 열이 12개면 칩이 툴바 두 줄을 먹고, 열이 늘어나면 계속 늘어난다.
export function ColumnPicker({ columns, counts, selected, onChange }: {
  columns: ColumnRow[];
  counts: Record<string, number>;
  selected: string[];               // 빈 배열 = 전체
  onChange: (ids: string[]) => void;
}) {
  // 트리거가 현재 값을 말한다 — '3개'로만 쓰면 무엇이 걸렸는지 열어봐야 안다(AGENTS.md 원칙 4)
  const names = selected.map((id) => columns.find((c) => c.id === id)?.title).filter(Boolean) as string[];
  const label = names.length === 0 ? '전체'
    : names.length === 1 ? names[0]
    : `${names[0]} +${names.length - 1}`;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <details className="relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-x-border-strong px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover [&::-webkit-details-marker]:hidden">
        열: <span className="font-medium text-x-text">{label}</span> <ChevronDownIcon className="h-3 w-3" />
      </summary>
      {/* left-0: 트리거가 툴바 왼쪽이라(칩을 대체한 자리) — Column.tsx의 '보기: 전체' 드롭다운은
          ml-auto로 오른쪽에 붙어 있어 right-0이 맞지만, 이 트리거는 반대쪽이라 잘림을 피하려면 left-0이어야 한다 */}
      <div className="absolute left-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-x-border bg-white p-1 shadow-lg">
        <button onClick={() => onChange([])} aria-pressed={selected.length === 0}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-ui hover:bg-x-hover ${selected.length === 0 ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
          전체
        </button>
        {columns.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-ui hover:bg-x-hover">
            {/* 체크 상태를 아이콘으로만 표현하지 않는다 — 스크린리더가 읽어야 한다 */}
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-x-text">{c.title}</span>
            <span className="shrink-0 text-caption text-x-muted">{formatFull(counts[c.id] ?? 0)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
