// 확장 API 입력 검증 — 형식이 아니면 DB까지 가지 않는다. 숫자 ID는 문자열 그대로(정밀도 손실 방지, 계획 §6).
import { ExtInputError } from './extensionApi.ts';

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const X_USER_ID_RE = /^\d{1,25}$/;

export interface ObservedPerson { handle: string; observedXUserId?: string }

export function parseObservedPerson(v: unknown): ObservedPerson {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ExtInputError('상대 정보 형식이 올바르지 않아요.');
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'handle' && k !== 'observedXUserId')) throw new ExtInputError('지원하지 않는 항목이 있어요.');
  const m = typeof o.handle === 'string' ? HANDLE_RE.exec(o.handle) : null;
  if (!m) throw new ExtInputError('X 핸들 형식이 올바르지 않아요.');
  if (o.observedXUserId !== undefined && (typeof o.observedXUserId !== 'string' || !X_USER_ID_RE.test(o.observedXUserId))) {
    throw new ExtInputError('X 사용자 ID 형식이 올바르지 않아요.');
  }
  return { handle: m[1], ...(o.observedXUserId ? { observedXUserId: o.observedXUserId as string } : {}) };
}

export function parseBadgePerson(v: unknown): { handle?: string; observedXUserId?: string } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.observedXUserId === 'string' && X_USER_ID_RE.test(o.observedXUserId))
      return { observedXUserId: o.observedXUserId };
  }
  return parseObservedPerson(v);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ExtInputError('요청 본문을 읽지 못했어요.');
  }
}
