import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAllowedUser } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { resolveMember } from '@/lib/workspaceStore';
import { getCachedJwks, invalidateJwks } from '@/lib/authJwks';
import type { Member } from '@/lib/types';

// 라우트 게이트가 실제로 쓰는 것만 담는다. 예전엔 Supabase의 User를 통째로 들고 다녔지만
// 소비자는 resolveMember 하나뿐이고 그 함수는 email·user_metadata만 본다.
export interface GateIdentity {
  email: string | null;
  app_metadata: { provider?: string | null; providers?: string[] | null } | null;
  user_metadata: Record<string, unknown> | null;
}

function unauthorized() {
  // 문구를 바꾸지 않는다 — 검증 방식이 달라졌다고 사용자에게 보이는 것이 달라질 이유가 없다.
  return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
}

/**
 * 액세스 토큰을 로컬에서 검증한다(서명 + 만료). 예전엔 호출마다 인증 서버로 물었고
 * 그게 모든 API에 37~40ms씩 붙었다(설계 문서 참조).
 *
 * 맞바꿈: 서버에서 무효화된 세션(로그아웃·계정 삭제)을 토큰이 만료될 때까지 모른다.
 * 사내 구글 도메인으로 게이팅된 소수 사용자이고 강제 로그아웃 기능이 없어 감수한 것이다
 * (2026-08-08 사용자 승인). 외부 사용자를 받거나 강제 로그아웃이 생기면 재검토할 것.
 */
export async function requireAllowedUser(): Promise<
  { user: GateIdentity; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  // 우리가 든 키를 넘기면 네트워크를 타지 않는다. null이면 라이브러리가 알아서 받아온다.
  const jwks = await getCachedJwks();
  const { data, error } = await supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined);

  if (error) {
    // 키 회전 직후라면 우리가 든 키로는 검증할 수 없다 — 버려서 다음 요청이 새로 받게 한다.
    // (라이브러리는 모르는 kid를 만나면 스스로 받아오지만, 우리 캐시가 낡은 채로 남으면
    //  매 요청이 그 우회 경로를 타게 된다.)
    if (jwks) invalidateJwks();
    return { user: null, response: unauthorized() };
  }
  if (!data) return { user: null, response: unauthorized() };   // 세션 없음

  const c = data.claims;
  const identity: GateIdentity = {
    email: typeof c.email === 'string' ? c.email : null,
    app_metadata: (c.app_metadata ?? null) as GateIdentity['app_metadata'],
    user_metadata: (c.user_metadata ?? null) as GateIdentity['user_metadata'],
  };
  // 판정 로직은 그대로 — 도메인 + 구글 provider 이중 확인(auth.ts).
  if (!isAllowedUser(identity)) return { user: null, response: unauthorized() };

  return { user: identity, response: null };
}

export async function requireMember(): Promise<
  { member: Member; user: GateIdentity; response: null } | { member: null; user: null; response: NextResponse }
> {
  const gate = await requireAllowedUser();
  if (gate.response) return { member: null, user: null, response: gate.response };
  const member = await resolveMember(getSql(), gate.user);
  return { member, user: gate.user, response: null };
}
