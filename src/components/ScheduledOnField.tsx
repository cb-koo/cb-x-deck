'use client';
import { useId } from 'react';
import { formatDateKo } from '@/lib/campaignJudgment';
import { NO_SCHEDULE_LABEL, overdueSuffix } from '@/lib/campaignTableView';

// 예정일 한 칸 — '8/26 수 · 1일 지남'을 보여주고, 누르면 그 자리에서 날짜를 고른다. DraftStatusChip의 '보이는 칩 + 투명 select'와
// 같은 골격으로 네이티브 date 입력을 투명하게 덮어 클릭 한 번에 달력이 뜬다. 지움은 옆의 ✕(null 저장, 스펙 §2-3 null=지움).
// 밀림(overdueDays)·기간 밖(outOfRange) 판정은 호출부가 campaignJudgment로 계산해 넘긴다 — 이 칸은 게시됨 여부를 모른다.
export function ScheduledOnField({ value, overdueDays, outOfRange, onChange, compact }: {
  value: string | null;          // 'YYYY-MM-DD' | null
  overdueDays: number | null;    // isOverdue면 daysBetweenDates(value, today), 아니면 null
  outOfRange: boolean;           // 캠페인 기간 밖 — 경고 표시만, 저장 차단 없음(§2-4)
  onChange: (next: string | null) => void;
  compact?: boolean;             // 표 셀 = 글자(15px), 카드 도구층 = 칩(32px, 13px)
}) {
  const id = useId();
  const tone = overdueDays !== null ? 'font-bold text-red-700' : value ? 'text-x-text' : 'text-x-muted';
  // 표 셀 안(compact)의 트리거는 행 높이 48px가 이미 터치 타깃을 보장하므로 h-10 규칙에서 예외로 둔다 — 나머지(카드 도구층 등)는 h-10.
  const box = compact
    ? `text-content ${tone}`
    : `h-10 rounded-lg border bg-white px-2.5 text-ui ${value ? 'border-x-border-strong' : 'border-dashed border-x-border-strong'} ${tone}`;
  return (
    <span className="inline-flex items-center gap-1">
      {/* 실제 입력(date)은 opacity-0로 숨어 있어 자체 포커스 링이 안 보인다 — focus-within으로 label에 대신 링을 그린다 */}
      <label htmlFor={id} title={value ? '게시 예정일 — 눌러서 바꾸기' : '게시 예정일을 정하면 밀림 여부를 알려줘요'}
             className={`relative inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 hover:bg-x-hover focus-within:outline-none focus-within:ring-2 focus-within:ring-x-blue ${box}`}>
        <span className="tabular-nums">{value ? formatDateKo(value) : (compact ? NO_SCHEDULE_LABEL : '+ 예정일')}</span>
        {overdueDays !== null ? <span className="font-normal">· {overdueSuffix(overdueDays)}</span> : null}
        {outOfRange && <span className="rounded bg-amber-100 px-1 text-ui font-normal text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>}
        <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
               aria-label="게시 예정일" className="absolute inset-0 w-full cursor-pointer opacity-0" />
      </label>
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="예정일 지우기"
                title="예정일 지우기 — 달력의 '예정일 없음' 열로 가요"
                className="rounded-full p-1 text-x-muted hover:bg-red-50 hover:text-red-600">✕</button>
      )}
    </span>
  );
}
