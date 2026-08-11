'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';

// 색은 여기(UI)에만, 키·라벨은 lib에. 채움은 옅게 유지하되 같은 계열 테두리를 함께 둔다 —
// 채움만 있으면 옆의 읽기용 메타 글자와 구분이 안 돼 "누르는 것"으로 안 읽힌다(11px 시절의 실패 원인).
const STATUS_STYLE: Record<DraftStatus, string> = {
  draft: 'border-x-border-strong bg-white text-x-secondary',
  review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  delivered: 'border-green-300 bg-green-100 text-green-800',
  unused: 'border-x-border-strong bg-x-border/40 text-x-muted',
};

// 칩처럼 보이는 select — 클릭 시 5개 상태 중 선택, 즉시 저장은 부모 몫.
// 크기(13px·높이 32px·테두리)는 InfluencerChip과 같은 규격이다: 이 줄에서 '내가 정하는 것'은
// 같은 덩치로 보이고, 옆의 읽기용 메타(11px 회색)와는 대비돼야 한다.
export function DraftStatusChip({ status, onChange }: {
  status: DraftStatus; onChange: (s: DraftStatus) => void;
}) {
  return (
    <label className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-ui font-bold focus-within:ring-2 focus-within:ring-x-blue ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]} <span aria-hidden className="opacity-60">⌄</span>
      <select value={status} onChange={(e) => onChange(e.target.value as DraftStatus)}
              aria-label="초안 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
        {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </label>
  );
}
