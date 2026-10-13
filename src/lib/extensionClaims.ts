// 확장 Bearer 토큰의 순수 판정 — 네트워크·DB 없음(extensionAuth.ts가 서명 검증 뒤 호출한다).
import { isAllowedUser } from './auth.ts';
import type { GateIdentity } from './authGuard.ts';

export interface ExtensionUser extends GateIdentity { id: string }

type ClaimCheck =
  | { ok: true; user: ExtensionUser }
  | { ok: false; code: 'AUTH_REQUIRED' | 'TOKEN_EXPIRED' | 'ACCOUNT_NOT_ALLOWED' };

// 'Bearer <jwt>'만 받는다. 쿠키·query의 토큰은 보지 않는다.
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/.exec(header ?? '');
  return m ? m[1] : null;
}

// 서명 검증 전에 만료만 먼저 본다 — 만료는 확장이 refresh 1회로 복구할 수 있는 별도 코드(TOKEN_EXPIRED)다.
export function isExpiredJwt(token: string, nowSec: number): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' && payload.exp <= nowSec;
  } catch {
    return false;   // 형식 오류는 아래 서명 검증이 AUTH_REQUIRED로 거른다
  }
}

// 서명이 확인된 claims에 대한 순수 판정. supabaseUrl은 'https://<ref>.supabase.co'(끝 슬래시 무관).
export function checkClaims(claims: Record<string, unknown>, supabaseUrl: string): ClaimCheck {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const aud = claims.aud;
  const audOk = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
  if (claims.iss !== issuer || !audOk || typeof claims.sub !== 'string' || !claims.sub) {
    return { ok: false, code: 'AUTH_REQUIRED' };
  }
  const user: ExtensionUser = {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    app_metadata: (claims.app_metadata ?? null) as GateIdentity['app_metadata'],
    user_metadata: (claims.user_metadata ?? null) as GateIdentity['user_metadata'],
  };
  if (!isAllowedUser(user)) return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' };
  return { ok: true, user };
}

