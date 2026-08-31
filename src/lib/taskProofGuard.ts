// RT 작업 증빙 스크린샷의 순수 규칙 — 서버 라우트와 브라우저가 함께 쓴다(브라우저 API를 import하지 않는다).
// 스펙 2026-08-31-rt-proof-screenshot-design.md §4-2·§5-1.
//
// 경로 정규식으로 좁히는 이유는 draftMediaGuard와 같다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 업로드 경로의 MIME·용량
// 제한은 PATCH 경로를 통과하지 않으므로, 여기가 유일한 방어선이다.

import { kstMonthDay } from './datetime.ts';

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

// 모양만 맞으면 남의 작업(혹은 없는 객체)을 가리키는 경로도 통과한다 — 어느 작업 것인지까지 본다.
// 'task/' 접두어 리터럴을 라우트에 다시 박지 않기 위해 경로 규칙의 소유자인 이 파일에 둔다.
export function isTaskProofPathFor(taskId: string, v: unknown): v is string {
  return isTaskProofPath(v) && v.startsWith(`task/${taskId}/`);
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

// 주격 조사 이/가 — 받침이 있으면 '이'. 한국 이름은 대부분 받침으로 끝나서 '가'로 고정하면
// '박구건가 올림'처럼 틀린 말이 화면에 나온다. 한글 음절이 아니면(로마자 이름 등) '가'로 둔다.
function subjectParticle(name: string): string {
  const last = name.at(-1) ?? '';
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '가';
  return (code - 0xac00) % 28 === 0 ? '가' : '이';   // 나머지 0 = 받침 없음
}

// '박구건이 8/31 올림' — 캠페인 표·게시 확인 팝오버·정산 요청 상세 세 화면이 같은 한 줄을 쓴다(리뷰 수정 5).
// 날짜는 datetime.ts의 kstMonthDay를 그대로 쓴다 — proof.at은 서버가 넣은 UTC라 자정~오전 9시 사이에
// 올린 증빙을 그냥 자르면 하루 전으로 보인다(리뷰 수정 2와 같은 함정).
export function proofUploadedLine(byName: string, at: string): string {
  const name = byName || '누군가';
  return `${name}${subjectParticle(name)} ${kstMonthDay(at)} 올림`;
}
