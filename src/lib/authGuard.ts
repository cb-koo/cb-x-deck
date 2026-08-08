import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAllowedUser } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { resolveMember } from '@/lib/workspaceStore';
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
 *
 * 서명키(JWKS)는 우리가 따로 캐시하지 않는다 — auth-js가 모듈 전역(GLOBAL_JWKS, storageKey별)에
 * 10분 TTL로 들고 있어 요청마다 클라이언트를 새로 만들어도 살아남는다. this.jwks가 그 전역을
 * 읽고 쓰는 게터라, 인스턴스 상태로 오해하기 쉽다(실제로 한 번 오판했다).
 */
export async function requireAllowedUser(): Promise<
  { user: GateIdentity; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  // 세 갈래를 모두 막아야 한다: 오류 / 세션 없음({data:null,error:null} — error가 null이라
  // 오류 검사만으로는 안 걸린다) / 허용되지 않은 사용자.
  if (error) return { user: null, response: unauthorized() };
  if (!data) return { user: null, response: unauthorized() };

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
