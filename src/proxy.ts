import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowedEmail } from '@/lib/auth';

const PUBLIC_PREFIXES = ['/login', '/auth', '/denied'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  // API는 리다이렉트하지 않는다 — 세션만 갱신하고 통과. 인가는 각 라우트의 가드가 JSON 401로 처리.
  if (pathname.startsWith('/api')) return response;

  if (!user) {
    return isPublic ? response : NextResponse.redirect(new URL('/login', request.url));
  }

  if (!isAllowedEmail(user.email)) {
    return pathname === '/denied' ? response : NextResponse.redirect(new URL('/denied', request.url));
  }

  // 허용 사용자가 로그인/거부 화면에 있으면 홈으로
  if (pathname === '/login' || pathname === '/denied') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일·이미지 제외한 모든 경로 (auth 로직이 CSS/JS/이미지를 막지 않도록)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
