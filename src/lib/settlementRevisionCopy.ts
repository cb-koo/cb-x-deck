// 제자리 수정 실패 사유 → 사용자 말(스펙 2026-09-07 §6). 라우트·화면이 같은 표를 쓴다. 순수 모듈.
import type { RevisionFailure } from './settlementStore.ts';
type StringFailure = Exclude<RevisionFailure, { kind: 'blocked' }>;
export const REVISION_FAILURE_MESSAGE: Record<StringFailure, string> = {
  'not-enabled': '아직 정산 쪽과 전환 전이에요 — 지금은 취소하고 새로 요청해 주세요',
  'not-found': '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요',
  'cancelled': '취소된 요청은 고칠 수 없어요 — 검토 대기에서 새로 요청해 주세요',
  'paid-locked': '이미 지급 완료돼 고칠 수 없어요 — 금액 정정은 정산 쪽에 요청해요',
  'revision-mismatch': '그 사이 다른 사람이 이 요청을 고쳤어요 — 화면을 새로고침하고 다시 확인해 주세요',
  'task-gone': '작업이 삭제된 요청이라 다시 계산할 수 없어요 — 취소하고 새로 요청해 주세요',
  'influencer-changed': '인플루언서가 바뀐 작업이에요 — 이 요청을 취소하고 새로 요청해야 해요',
  'not-candidate': '작업이 정산 조건을 잃었어요(게시 취소·비용 없음) — 캠페인에서 확인해 주세요',
  'confirm-required': '정산 쪽이 처리한 요청이에요 — 슬랙으로 정산 담당자에게 확인한 뒤 체크하고 반영해 주세요',
};
