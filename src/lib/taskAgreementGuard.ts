// 방문협찬 협찬 동의서의 순수 규칙 — 서버 라우트와 브라우저가 함께 쓴다(브라우저 API를 import하지 않는다).
// taskProofGuard.ts(RT 증빙)와 같은 이유로 경로를 정규식으로 좁힌다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 요청을 보낸다. 업로드 경로의 형식·용량 제한은 PATCH를 거치지 않으므로 여기가 방어선이다.
// 증빙과 파일을 따로 두는 이유: 허용 형식(PDF)·파일명 표시·버킷이 다르다. 모양은 TaskProof에 파일 정보를 더한 것.

import { kstMonthDay } from './datetime.ts';

export interface TaskAgreement {
  url: string;        // 스토리지 경로. task/<작업id>/<파일id>.<확장자> — 절대 URL이 아니다
  name: string;       // 올린 파일의 원래 이름 — PDF는 미리보기가 없어 이름으로 알아본다
  size: number;       // 바이트
  mime: string;       // 허용 형식 중 하나
  by: string | null;  // 올린 member.id. 멤버가 지워지면 null이 될 수 있다
  byName: string;     // 올린 사람 이름 스냅샷(TaskProof와 같은 관례)
  at: string;         // ISO 시각(서버가 넣는다)
}

// 마이그레이션 063 버킷 설정과 반드시 같은 값 — 여기서 통과시킨 파일이 스토리지에서 거절되면 안 된다.
export const MAX_TASK_AGREEMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TASK_AGREEMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const TASK_AGREEMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const;
// 파일명은 표시용일 뿐이지만 jsonb에 그대로 들어간다 — 끝없이 긴 값을 막는다
export const TASK_AGREEMENT_NAME_MAX = 200;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const TASK_AGREEMENT_PATH_RE = new RegExp(`^task/${UUID}/${UUID}\\.(?:${TASK_AGREEMENT_EXTENSIONS.join('|')})$`);

export function isTaskAgreementPath(v: unknown): v is string {
  return typeof v === 'string' && TASK_AGREEMENT_PATH_RE.test(v);
}
// 모양만 맞는 남의 작업 경로를 막는다(isTaskProofPathFor와 같은 이유)
export function isTaskAgreementPathFor(taskId: string, v: unknown): v is string {
  return isTaskAgreementPath(v) && v.startsWith(`task/${taskId}/`);
}

const isAllowedMime = (v: unknown): v is string =>
  typeof v === 'string' && (ALLOWED_TASK_AGREEMENT_MIME as readonly string[]).includes(v);

// 클라이언트가 보내는 값 — 올린 사람·시각은 서버가 채운다(proof와 같은 나눔)
export interface TaskAgreementInput { path: string; name: string; size: number; mime: string }

// 요청 본문의 agreement 값 → 입력값. 모양이 틀리면 null(라우트가 400). 어느 작업 것인지는 게이트가 본다.
export function parseTaskAgreementInput(v: unknown): TaskAgreementInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { path?: unknown; name?: unknown; size?: unknown; mime?: unknown };
  if (!isTaskAgreementPath(o.path)) return null;
  if (typeof o.name !== 'string') return null;
  const name = o.name.trim();
  if (!name || name.length > TASK_AGREEMENT_NAME_MAX) return null;
  if (typeof o.size !== 'number' || !Number.isInteger(o.size) || o.size <= 0 || o.size > MAX_TASK_AGREEMENT_BYTES) return null;
  if (!isAllowedMime(o.mime)) return null;
  return { path: o.path, name, size: o.size, mime: o.mime };
}

// jsonb 모양은 보증되지 않는다 — 검증 통과분만(taskProofOf와 같은 태도)
export function taskAgreementOf(v: unknown): TaskAgreement | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as { url?: unknown; name?: unknown; size?: unknown; mime?: unknown; by?: unknown; byName?: unknown; at?: unknown };
  if (!isTaskAgreementPath(p.url)) return null;
  if (typeof p.name !== 'string' || typeof p.size !== 'number' || !isAllowedMime(p.mime)) return null;
  if (!(p.by === null || typeof p.by === 'string')) return null;
  if (typeof p.byName !== 'string') return null;
  if (typeof p.at !== 'string' || p.at === '') return null;
  return { url: p.url, name: p.name, size: p.size, mime: p.mime, by: p.by, byName: p.byName, at: p.at };
}

// ── 문구 (사용자 언어, AGENTS 원칙 1·3) ──
export const AGREEMENT_VALUE_MESSAGE = '동의서 파일 값이 올바르지 않아요 — 화면을 새로고침하고 다시 올려주세요';
export const AGREEMENT_ONLY_VISIT_MESSAGE = '협찬 동의서는 방문협찬 작업에만 붙일 수 있어요';

// '동의서.pdf · 박구건 · 9/29' — 패널 동의서 칸의 한 줄. 날짜는 kstMonthDay(at은 UTC라 그냥 자르면 하루 밀린다)
export function agreementLine(a: Pick<TaskAgreement, 'name' | 'byName' | 'at'>): string {
  return [a.name, a.byName || null, kstMonthDay(a.at)].filter(Boolean).join(' · ');
}
