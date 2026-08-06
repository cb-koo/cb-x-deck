'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';

// 도구층 톤의 은은한 칩 (스펙 3-2) — 색은 여기(UI)에만, 키·라벨은 lib에
const STATUS_STYLE: Record<DraftStatus, string> = {
  draft: 'bg-x-border/60 text-x-secondary',
  review: 'bg-amber-100 text-amber-800',
  approved: 'bg-x-blue/10 text-x-blue-text',
  delivered: 'bg-green-100 text-green-800',
  unused: 'bg-x-border/40 text-x-muted',
};

// 칩처럼 보이는 select — 클릭 시 5개 상태 중 선택, 즉시 저장은 부모 몫
export function DraftStatusChip({ status, onChange }: {
  status: DraftStatus; onChange: (s: DraftStatus) => void;
}) {
  return (
    <label className={`relative inline-flex cursor-pointer items-center rounded-full px-2.5 py-0.5 text-caption font-bold focus-within:ring-2 focus-within:ring-x-blue ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]} <span aria-hidden className="ml-0.5">⌄</span>
      <select value={status} onChange={(e) => onChange(e.target.value as DraftStatus)}
              aria-label="초안 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
        {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </label>
  );
}
