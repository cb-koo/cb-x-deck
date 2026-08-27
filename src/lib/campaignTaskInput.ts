// 작업 API 입력 검증 — 순수(DB 없음). 라우트 4곳(작업 생성·패치, 원고 PATCH·POST의 taskId)이 같은 규칙을 쓴다.
import type { Parsed } from './campaignCost.ts';
import { isUuidLike } from './uuid.ts';

export const TASK_ID_MESSAGE = '작업 값이 올바르지 않아요';
export const TASK_NOT_FOUND_MESSAGE = '작업을 찾을 수 없어요 — 삭제됐을 수 있어요. 화면을 새로고침해 주세요';
export const DRAFT_ATTACHED_MESSAGE = '이 원고는 이미 다른 작업에 붙어 있어요 — 먼저 그 작업에서 떼어 주세요';
export const TASK_HAS_DRAFT_MESSAGE = '이 작업엔 이미 원고가 있어요 — 작업 하나에 원고는 하나만 붙어요';

// undefined = 키 없음(건드리지 않음) · null = 떼기 · uuid = 붙이기
export function parseTaskIdPatch(v: unknown): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'string' && isUuidLike(v)) return { ok: true, value: v };
  return { ok: false, message: TASK_ID_MESSAGE };
}
