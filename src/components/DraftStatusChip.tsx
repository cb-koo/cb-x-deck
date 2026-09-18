'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { TaskStage } from '@/lib/campaignJudgment';

// 색은 여기(UI)에만, 키·라벨은 lib에. 채움은 옅게 유지하되 같은 계열 테두리를 함께 둔다 —
// 채움만 있으면 옆의 읽기용 메타 글자와 구분이 안 돼 "누르는 것"으로 안 읽힌다(11px 시절의 실패 원인).
// export: 표(TaskTable)와 달력(WeekCalendar)이 같은 단계를 각자 색을 베껴 쓰면 하나만 고쳤을 때 어긋난다 —
// 단일 소스를 여기 두고 양쪽이 그대로 가져다 쓴다.
export const STATUS_STYLE: Record<DraftStatus, string> = {
  draft: 'border-x-border-strong bg-white text-x-secondary',
  review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  delivered: 'border-green-300 bg-green-100 text-green-800',
  unused: 'border-x-border-strong bg-x-border/40 text-x-muted',
};

// '게시됨'은 DraftStatus가 아니라 파생 단계(taskStage)라 위 맵에 없다 — 색은 하나만 정해 표·달력이 같이 쓴다.
export const PUBLISHED_STYLE = 'border-green-300 bg-green-100 text-green-800';

// 달력 카드의 좌측 4px 색 바 + 범례 점이 쓰는 단계색(HEX) — 위 칩 색과 같은 계열의 '진한 쪽' 한 톤이다.
// 칩은 옅은 채움+테두리 조합이라 4px 막대로 쓰면 거의 안 보인다 → 같은 단계에 대해 '막대용 한 색'을 여기서 함께 정한다.
// 클래스 문자열이 아니라 HEX인 이유: 카드가 style로 borderLeftColor·배경에 직접 넣어야 하고(동적 값),
// 범례 점과 카드 바가 같은 상수를 쓰면 색이 갈라질 수 없다.
export const STAGE_BAR_HEX: Record<DraftStatus | 'published', string> = {
  draft: '#94a3ab',
  review: '#f59e0b',
  approved: '#1d9bf0',
  delivered: '#34c759',
  unused: '#cfd9de',
  published: '#15803d',
};
// 작업 단계 칩(작업 스펙 §4-1) — 원고 상태 5종은 STATUS_STYLE 그대로 쓰고, 작업에만 있는 단계 4종을 여기서 정한다.
// 표(TaskTable·PostedCell)와 달력이 같은 맵을 쓰는 색의 단일 소스 — 한쪽만 고치면 같은 단계가 화면마다 달라진다.
export const TASK_STAGE_STYLE: Record<TaskStage, string> = {
  ...STATUS_STYLE,
  published: PUBLISHED_STYLE,
  planned: 'border-x-border-strong bg-x-surface text-x-secondary',
  visitPending: 'border-amber-300 bg-amber-50 text-amber-800',
  visited: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  removed: 'border-slate-300 bg-slate-100 text-slate-600',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-400 line-through',   // 취소(055) — 흐리게, 취소선
};
// 달력 바·범례용 HEX(위 칩 색의 '진한 쪽' 한 톤) — STAGE_BAR_HEX 위에 작업 고유 단계를 얹는다.
export const TASK_STAGE_BAR_HEX: Record<TaskStage, string> = {
  ...STAGE_BAR_HEX, planned: '#94a3ab', visitPending: '#f59e0b', visited: '#1d9bf0', removed: '#64748b', cancelled: '#cbd5e1',
};

// 밀림은 단계가 아니라 상태 위에 얹히는 경고다(isTaskOverdue) — 단계색을 덮어쓴다. 표의 빨간 신호와 같은 색.
export const OVERDUE_BAR_HEX = '#dc2626';

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
