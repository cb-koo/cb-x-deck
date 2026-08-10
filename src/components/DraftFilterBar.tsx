'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftListFilter } from '@/lib/draftUi';

// 상태 탭 + 클라이언트 필터 (스펙 3-1) — 작업 세션용 렌즈라 저장하지 않는다
// showStatusTabs=false: 칸반 뷰는 열 위치가 곧 상태라 탭이 중복 — 클라이언트 셀렉트만 노출(T4)
export function DraftFilterBar({ counts, total, filter, clients, onChange, showStatusTabs = true }: {
  counts: Record<DraftStatus, number>; total: number;
  filter: DraftListFilter; clients: Array<{ id: string; name: string }>;
  onChange: (f: DraftListFilter) => void;
  showStatusTabs?: boolean;
}) {
  const tab = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-[13px]">
      {showStatusTabs && (
        <>
          <button onClick={() => onChange({ ...filter, status: 'all' })} className={tab(filter.status === 'all')}>
            전체 {total}
          </button>
          {DRAFT_STATUSES.map((s) => (
            <button key={s} onClick={() => onChange({ ...filter, status: filter.status === s ? 'all' : s })}
                    className={tab(filter.status === s)}>
              {STATUS_LABEL[s]} {counts[s]}
            </button>
          ))}
        </>
      )}
      <select value={filter.clientId} onChange={(e) => onChange({ ...filter, clientId: e.target.value })}
              aria-label="클라이언트로 거르기"
              className="ml-auto h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue">
        <option value="">모든 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">클라이언트 없음</option>
      </select>
    </div>
  );
}
