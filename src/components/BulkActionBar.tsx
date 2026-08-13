'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';

// 표 뷰에서 여러 건을 고르면 뜨는 바. 결과 패널 스크롤 컨테이너 하단에 sticky로 붙는다 —
// 50행을 내려가 고른 뒤 액션을 찾아 다시 올라오는 일이 없도록.
// 표시 전용이다: 판단(형제 시안 경고)과 저장(낙관적 갱신·롤백)은 전부 페이지가 한다.
// 칩 규격(13px·높이 32px·테두리)은 DraftStatusChip·InfluencerChip과 같다 — 같은 성격의
// "내가 정하는 것"이 화면마다 다른 덩치로 보이지 않게.
export function BulkActionBar({ count, options, onStatus, onInfluencer, onDelete, onClear }: {
  count: number;
  options: InfluencerOption[];
  onStatus: (s: DraftStatus) => void;
  onInfluencer: (handle: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-x-border bg-white px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-ui font-bold">{count}개 선택됨</span>

      <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary focus-within:ring-2 focus-within:ring-x-blue">
        상태 변경 <span aria-hidden className="opacity-60">⌄</span>
        <select value="" onChange={(e) => { if (e.target.value) onStatus(e.target.value as DraftStatus); }}
                aria-label="선택한 원고의 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">상태 고르기</option>
          {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>

      {/* 일괄 배정은 이미 배정된 적 있는 후보에서만 고른다 — 새 핸들을 여기서 타이핑하게 하면
          오타 하나가 여러 건에 한꺼번에 박힌다. 새 핸들은 카드에서 한 건 배정하면 후보에 들어온다. */}
      <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary focus-within:ring-2 focus-within:ring-x-blue">
        인플루언서 <span aria-hidden className="opacity-60">⌄</span>
        <select value="" onChange={(e) => { if (e.target.value) onInfluencer(e.target.value === '__clear__' ? null : e.target.value); }}
                aria-label="선택한 원고의 인플루언서 배정" className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">인플루언서 고르기</option>
          {options.map((o) => <option key={o.handle} value={o.handle}>{o.name ? `${o.name} (@${o.handle})` : `@${o.handle}`}</option>)}
          <option value="__clear__">배정 해제</option>
        </select>
      </label>

      <button onClick={onDelete}
              className="h-8 rounded-lg border border-red-200 px-2.5 text-ui font-bold text-red-600 hover:bg-red-50">
        삭제
      </button>

      <button onClick={onClear} className="ml-auto text-ui text-x-secondary hover:underline">선택 해제</button>
    </div>
  );
}
