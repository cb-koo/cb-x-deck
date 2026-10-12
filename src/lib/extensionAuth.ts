// 확장 API의 Bearer 인증 — 계획 §4. 웹의 쿠키 가드(authGuard.ts)와 같은 회사 정책(도메인 + 구글 provider)을 적용하고,
// 담당자는 검증한 identity로 resolveMember가 정한다. body의 actor·이름은 믿지 않는다.
//
// 서명 검증은 auth-js의 getClaims(jwt)에 맡긴다 — 비대칭 키면 JWKS로 로컬 검증, 대칭 키면 Auth 서버 getUser로 확인한다.
// getClaims는 서명·만료만 본다. issuer·audience·subject는 여기서 더 확인한다(다른 프로젝트·다른 용도 토큰 차단).
// 즉시 회수 한계(로그아웃해도 만료까지 유효)는 웹 가드와 같다(authGuard.ts 주석, 2026-08-08 승인).
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSql } from '@/lib/db';
import { resolveMember } from '@/lib/workspaceStore';
import { extError } from '@/lib/extensionApi';
import type { Member } from '@/lib/types';
import { bearerToken, checkClaims, isExpiredJwt, type ExtensionUser } from '@/lib/extensionClaims';

// 쿠키·세션 저장 없는 검증 전용 클라이언트. JWKS 캐시는 auth-js 모듈 전역이라 싱글턴으로 충분하다.
let verifier: SupabaseClient | null = null;
function getVerifier(): SupabaseClient {
  verifier ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifier;
}

const MESSAGE = {
  AUTH_REQUIRED: '회사 계정을 다시 연결해 주세요.',
  TOKEN_EXPIRED: '연결이 만료됐어요. 다시 연결해 주세요.',
  ACCOUNT_NOT_ALLOWED: '회사 Google 계정(@clinicbridge.co.kr)으로 연결해 주세요.',
} as const;

export async function requireExtensionMember(req: Request, requestId: string): Promise<
  { user: ExtensionUser; member: Member; response: null } | { user: null; member: null; response: NextResponse }
> {
  const deny = (code: keyof typeof MESSAGE) =>
    ({ user: null, member: null, response: extError(req, requestId, code, MESSAGE[code]) }) as const;

  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return deny('AUTH_REQUIRED');
  if (isExpiredJwt(token, Math.floor(Date.now() / 1000))) return deny('TOKEN_EXPIRED');

  const { data, error } = await getVerifier().auth.getClaims(token);
  if (error || !data) return deny('AUTH_REQUIRED');

  const checked = checkClaims(data.claims as Record<string, unknown>, process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!checked.ok) return deny(checked.code);

  const member = await resolveMember(getSql(), checked.user);
  return { user: checked.user, member, response: null };
}
