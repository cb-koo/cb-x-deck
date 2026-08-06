// 초안 상태 축 — "결정 진행도" 라벨 (스펙 §2). 저장은 영문 키, 표시는 한국어.
// 전이 제약 없음: 어느 상태에서 어느 상태로든 바로 변경한다 (검수 생략·직접 사용 등 모든 경로 수용).
export const DRAFT_STATUSES = ['draft', 'review', 'approved', 'delivered', 'unused'] as const;
export type DraftStatus = typeof DRAFT_STATUSES[number];

export const STATUS_LABEL: Record<DraftStatus, string> = {
  draft: '초안', review: '검수 대기', approved: '사용 확정', delivered: '전달됨', unused: '미사용',
};

export function isDraftStatus(v: unknown): v is DraftStatus {
  return typeof v === 'string' && (DRAFT_STATUSES as readonly string[]).includes(v);
}
