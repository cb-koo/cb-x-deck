import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowedUser } from '@/lib/auth';

const PUBLIC_PREFIXES = ['/login', '/auth', '/denied'];

// 경계-안전 접두사 매칭: '/login' 은 '/login', '/login/x' 에는 매치하되 '/loginXYZ' 에는 매치하지 않는다.
const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export async function proxy(request: NextRequest) {
  // 브릿지 서버의 이벤트 push — 세션 쿠키가 없어 갱신할 것도 없고, 인가는 라우트가 시크릿으로 한다.
  // 아래 getUser()는 요청마다 인증 서버 왕복이라 이벤트 1건마다 붙일 이유가 없다(스펙 §수집 API).
  if (request.nextUrl.pathname === '/api/landing-events') return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  // 리다이렉트 응답에도 setAll 로 갱신된(회전된) 인증 쿠키를 그대로 실어 보낸다.
  // 그렇지 않으면 새로 만든 NextResponse.redirect(...) 는 response 의 쿠키를 갖지 않아
  // Supabase refresh-token 회전 시 간헐적 강제 로그아웃이 발생한다.
  const withCookies = <T extends NextResponse>(target: T): T => {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } catch (error) {
    // Supabase 장애/네트워크 오류 시 fail-closed: 인증되지 않은 것으로 간주하고
    // 아래의 no-user 로직(보호 경로는 /login 리다이렉트, 공개 경로는 통과)을 그대로 태운다.
    console.error('[proxy] supabase.auth.getUser() failed', error);
    user = null;
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => matchesPrefix(pathname, p));

  // API는 리다이렉트하지 않는다 — 세션만 갱신하고 통과. 인가는 각 라우트의 가드가 JSON 401로 처리.
  if (matchesPrefix(pathname, '/api')) return response;

  if (!user) {
    return isPublic ? response : withCookies(NextResponse.redirect(new URL('/login', request.url)));
  }

  if (!isAllowedUser(user)) {
    return pathname === '/denied'
      ? response
      : withCookies(NextResponse.redirect(new URL('/denied', request.url)));
  }

  // 허용 사용자가 로그인/거부 화면에 있으면 홈으로
  if (pathname === '/login' || pathname === '/denied') {
    return withCookies(NextResponse.redirect(new URL('/', request.url)));
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일·이미지 제외한 모든 경로 (auth 로직이 CSS/JS/이미지를 막지 않도록)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
