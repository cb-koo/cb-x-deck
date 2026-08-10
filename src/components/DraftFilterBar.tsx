'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftListFilter } from '@/lib/draftUi';

// 상태 탭 + 클라이언트 필터 (스펙 3-1) — 작업 세션용 렌즈라 저장하지 않는다
export function DraftFilterBar({ counts, total, filter, clients, onChange }: {
  counts: Record<DraftStatus, number>; total: number;
  filter: DraftListFilter; clients: Array<{ id: string; name: string }>;
  onChange: (f: DraftListFilter) => void;
}) {
  const tab = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-[13px]">
      <button onClick={() => onChange({ ...filter, status: 'all' })} className={tab(filter.status === 'all')}>
        전체 {total}
      </button>
      {DRAFT_STATUSES.map((s) => (
        <button key={s} onClick={() => onChange({ ...filter, status: filter.status === s ? 'all' : s })}
                className={tab(filter.status === s)}>
          {STATUS_LABEL[s]} {counts[s]}
        </button>
      ))}
      <select value={filter.clientId} onChange={(e) => onChange({ ...filter, clientId: e.target.value })}
              aria-label="클라이언트로 거르기"
              className="ml-auto rounded-md border border-x-border-strong bg-white px-2 py-1 text-caption outline-none focus:border-x-blue">
        <option value="">모든 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">클라이언트 없음</option>
      </select>
    </div>
  );
}
