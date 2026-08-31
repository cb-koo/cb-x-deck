// RT 작업 증빙 스크린샷의 순수 규칙 — 서버 라우트와 브라우저가 함께 쓴다(브라우저 API를 import하지 않는다).
// 스펙 2026-08-31-rt-proof-screenshot-design.md §4-2·§5-1.
//
// 경로 정규식으로 좁히는 이유는 draftMediaGuard와 같다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 업로드 경로의 MIME·용량
// 제한은 PATCH 경로를 통과하지 않으므로, 여기가 유일한 방어선이다.

export interface TaskProof {
  url: string;        // 스토리지 경로. task/<작업id>/<파일id>.<확장자> — 절대 URL이 아니다
  by: string | null;  // 올린 member.id. 멤버가 지워지면 null이 될 수 있다
  byName: string;     // 올린 사람 이름 스냅샷 — 표시할 때마다 member를 조인하지 않기 위해(payment_request 관례)
  at: string;         // ISO 시각
}

export const TASK_PROOF_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// 줄 전체를 고정한다(^…$) — 앞뒤에 뭘 붙여 우회하지 못하게. 개행이 섞인 값도 통과하지 않는다.
export const TASK_PROOF_PATH_RE = new RegExp(`^task/${UUID}/${UUID}\\.(?:${TASK_PROOF_EXTENSIONS.join('|')})$`);

export function isTaskProofPath(v: unknown): v is string {
  return typeof v === 'string' && TASK_PROOF_PATH_RE.test(v);
}

// jsonb 컬럼의 모양은 보증되지 않는다 — 검증 통과분만 돌려준다(campaignTaskStore.costOf와 같은 태도).
export function taskProofOf(v: unknown): TaskProof | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as { url?: unknown; by?: unknown; byName?: unknown; at?: unknown };
  if (!isTaskProofPath(p.url)) return null;
  if (!(p.by === null || typeof p.by === 'string')) return null;
  if (typeof p.byName !== 'string') return null;
  if (typeof p.at !== 'string' || p.at === '') return null;
  return { url: p.url, by: p.by, byName: p.byName, at: p.at };
}

// ── 문구 (사용자 언어, AGENTS 원칙 1·3) ──
export const PROOF_VALUE_MESSAGE = '증빙 스크린샷 값이 올바르지 않아요 — 화면을 새로고침하고 다시 올려주세요';
export const PROOF_ONLY_RT_MESSAGE = '증빙 스크린샷은 RT 작업에만 붙일 수 있어요';
export const PROOF_REQUIRED_MESSAGE = '증빙 스크린샷을 넣어야 게시됨으로 표시할 수 있어요';
export const PROOF_KEEP_MESSAGE = '게시됨인 RT 작업은 증빙을 뗄 수 없어요 — 다른 스크린샷으로 바꿔 주세요';
