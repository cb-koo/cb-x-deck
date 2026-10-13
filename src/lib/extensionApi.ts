// 확장 API(/api/extension/v1) 공통 응답 — 계획 docs/superpowers/plans/2026-10-04-extension-product-api-implementation.md §6·§9.
// 새 확장 경로만 {data, meta} / {error, meta} envelope를 쓴다. 기존 웹 API 응답 모양은 건드리지 않는다.
// 에러 details·로그에 JWT·고객 원문·개인 키를 싣지 않는다.
import { NextResponse } from 'next/server';
import { ProductError } from './productCommand.ts';

export const EXTENSION_API_VERSION = 'v1' as const;
export const EXTENSION_API_PREFIX = '/api/extension/v1';

export type ExtensionErrorCode =
  | 'INVALID_INPUT'
  | 'AUTH_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_NOT_ALLOWED'
  | 'RESOURCE_NOT_FOUND'
  | 'SERVER_NOT_READY'
  | 'INTERNAL_ERROR';

const STATUS: Record<ExtensionErrorCode, number> = {
  INVALID_INPUT: 400,
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  ACCOUNT_NOT_ALLOWED: 403,
  RESOURCE_NOT_FOUND: 404,
  SERVER_NOT_READY: 503,
  INTERNAL_ERROR: 500,
};

// 개발 확장 ID(cb_x_extension/manifest.json의 공개 key로 고정). 운영·staging ID는 EXTENSION_ORIGINS(쉼표 구분)로 더한다.
// Origin은 인증 수단이 아니다 — 응답 헤더를 어느 확장 화면에 열어 줄지만 정한다. 인증은 언제나 Bearer JWT.
const DEV_EXTENSION_ORIGIN = 'chrome-extension://naopbhcnpgofjmhaagpijcjcbijacacb';
export function allowedExtensionOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.EXTENSION_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [DEV_EXTENSION_ORIGIN, ...extra];
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const base: Record<string, string> = { 'cache-control': 'no-store', vary: 'Origin' };
  if (!origin || !allowedExtensionOrigins().includes(origin)) return base;
  return {
    ...base,
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match, Idempotency-Key, X-Client-Version',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '600',
    'access-control-expose-headers': 'ETag',
  };
}

const meta = (requestId: string) => ({ apiVersion: EXTENSION_API_VERSION, serverNow: new Date().toISOString(), requestId });

export function extOk<T>(req: Request, requestId: string, data: T, status = 200): NextResponse {
  return NextResponse.json({ data, meta: meta(requestId) }, { status, headers: corsHeaders(req) });
}

export function extError(
  req: Request, requestId: string, code: string, message: string, details?: Record<string, unknown>, status?: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) }, meta: { requestId } },
    { status: status ?? STATUS[code as ExtensionErrorCode] ?? 400, headers: corsHeaders(req) },
  );
}

// 업무 조회 없이 응답한다(계획 §4 CORS).
export function extPreflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// 064(방문 예약)가 아직 적용되지 않은 DB(예약 테이블·campaign_task 새 컬럼 없음)에서는 500 대신 원인을 알 수 있는 503으로 답한다.
// 42P01 = undefined_table, 42703 = undefined_column.
export function isSchemaNotReady(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42P01' || code === '42703';
}

export class ExtInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtInputError';
  }
}

// 라우트 본문의 예외를 envelope로 바꾼다. 일반 로그에는 route·code·requestId만 남긴다(계획 §11 관측).
export async function extHandle(
  req: Request, run: (requestId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    return await run(requestId);
  } catch (error) {
    if (error instanceof ProductError) return extError(req, requestId, error.code, error.message, undefined, error.status);
    if (error instanceof ExtInputError) return extError(req, requestId, 'INVALID_INPUT', error.message);
    const route = new URL(req.url).pathname;
    if (isSchemaNotReady(error)) {
      console.error(`[extension-api] ${route} SERVER_NOT_READY requestId=${requestId}`);
      return extError(req, requestId, 'SERVER_NOT_READY', '서버에 예약 기능 준비가 끝나지 않았어요. 관리자에게 알려 주세요.');
    }
    console.error(`[extension-api] ${route} INTERNAL_ERROR requestId=${requestId}`);
    return extError(req, requestId, 'INTERNAL_ERROR', '요청을 완료하지 못했어요. 입력은 유지하고 잠시 후 다시 시도해 주세요.');
  }
}
