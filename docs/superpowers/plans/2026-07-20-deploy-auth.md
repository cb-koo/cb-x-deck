# 웹 배포 + 구글 로그인(회사 도메인 자동 허용) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cb-x-deck를 Vercel에 배포하되, 구글 로그인 + @clinicbridge.co.kr 도메인 자동 허용으로 팀 외부 접근·과금을 차단한다.

**Architecture:** Supabase Auth(구글 OAuth)로 인증. `@supabase/ssr`로 쿠키 세션 처리. 페이지는 `proxy.ts`(Next.js 16의 구 middleware)로 게이팅하고, 모든 `/api/*` 라우트는 `requireAllowedUser()`로 서버 재검증(과금 차단의 실질 방어선). 허용 여부는 세션 이메일 도메인만으로 판정(신규 DB 테이블 없음).

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, `@supabase/ssr`, `@supabase/supabase-js`, Vercel, 기존 Supabase Postgres.

## Global Constraints

- **미들웨어 파일명은 `proxy.ts`** (Next.js 16에서 `middleware` deprecated → `proxy`). export 함수명 `proxy`.
- `cookies()`(from `next/headers`)는 **async** — 항상 `await cookies()`.
- 허용 도메인 상수 한 곳: `ALLOWED_EMAIL_DOMAIN = 'clinicbridge.co.kr'` (코드/설정 일치 원칙).
- UI 문구는 비개발 담당자 언어로. 내부 개념어(도메인·OAuth 등) 노출 최소화 (AGENTS.md UX 원칙).
- 클라이언트에서 쓰는 Supabase 값은 `NEXT_PUBLIC_` 접두사 필수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- 테스트는 `node:test`(`import { test } from 'node:test'`, `node --import tsx --test`). 순수 로직만 단위 테스트, OAuth/배포는 실제 브라우저 검증.
- 커밋은 이 브랜치(`feat/deploy-auth`)에.

## File Structure

- `src/lib/auth.ts` — `ALLOWED_EMAIL_DOMAIN`, `isAllowedEmail()` 순수 함수.
- `src/lib/auth.test.ts` — 도메인 판정 테스트.
- `src/lib/supabase/server.ts` — 서버 컴포넌트·라우트 핸들러용 Supabase 클라이언트(쿠키 연동).
- `src/lib/supabase/client.ts` — 브라우저용 Supabase 클라이언트.
- `src/lib/authGuard.ts` — `requireAllowedUser()`: API 라우트 게이트.
- `src/proxy.ts` — 페이지 게이팅 + 세션 갱신.
- `src/app/login/page.tsx` — 구글 로그인 화면.
- `src/app/auth/callback/route.ts` — OAuth 콜백 → 세션 교환.
- `src/app/denied/page.tsx` — 비허용 계정 안내 + 로그아웃.
- `src/lib/apiFetch.ts` — 401 시 로그인으로 유도하는 fetch 래퍼.
- 수정: 모든 `src/app/api/**/route.ts`(가드 삽입), 클라이언트의 `fetch('/api...')` 호출부(apiFetch로 교체).

---

### Task 1: 의존성 + 도메인 판정 헬퍼 + Supabase 클라이언트

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`
- Modify: `package.json`(의존성), `.env`(NEXT_PUBLIC_* 추가)

**Interfaces:**
- Produces: `ALLOWED_EMAIL_DOMAIN: string`, `isAllowedEmail(email: string | null | undefined): boolean` (from `@/lib/auth`); `createClient(): Promise<SupabaseClient>` (server, async); `createClient(): SupabaseClient` (browser).

- [ ] **Step 1: 의존성 설치**

Run: `npm install @supabase/ssr @supabase/supabase-js`
Expected: package.json dependencies에 두 패키지 추가, 설치 성공.

- [ ] **Step 2: 도메인 판정 실패 테스트 작성**

Create `src/lib/auth.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedEmail } from './auth.ts';

test('회사 도메인만 허용', () => {
  assert.equal(isAllowedEmail('a@clinicbridge.co.kr'), true);
  assert.equal(isAllowedEmail('A.B@Clinicbridge.CO.KR'), true); // 대소문자 무시
  assert.equal(isAllowedEmail('a@gmail.com'), false);
  assert.equal(isAllowedEmail('a@sub.clinicbridge.co.kr'), false); // 서브도메인 불허
  assert.equal(isAllowedEmail('clinicbridge.co.kr'), false); // @ 없음
  assert.equal(isAllowedEmail(null), false);
  assert.equal(isAllowedEmail(undefined), false);
  assert.equal(isAllowedEmail(''), false);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- --test-name-pattern="회사 도메인만 허용"` (또는 `node --import tsx --test src/lib/auth.test.ts`)
Expected: FAIL — `Cannot find module './auth.ts'`.

- [ ] **Step 4: 헬퍼 구현**

Create `src/lib/auth.ts`:

```ts
export const ALLOWED_EMAIL_DOMAIN = 'clinicbridge.co.kr';

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --import tsx --test src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: 서버/브라우저 Supabase 클라이언트 작성**

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출 시 set 불가 — 세션 갱신은 proxy가 담당하므로 무시
          }
        },
      },
    },
  );
}
```

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 7: .env에 NEXT_PUBLIC 값 추가**

`.env`에 기존 `SUPABASE_URL`·`SUPABASE_ANON_KEY`와 동일 값으로 추가:

```
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_URL과 동일>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY와 동일>
```

Run: `grep -c NEXT_PUBLIC_SUPABASE .env`
Expected: `2`.

- [ ] **Step 8: 커밋**

```bash
git add package.json package-lock.json src/lib/auth.ts src/lib/auth.test.ts src/lib/supabase/
git commit -m "feat(auth): Supabase 클라이언트 + 회사 도메인 판정 헬퍼"
```

---

### Task 2: API 라우트 가드 `requireAllowedUser()`

**Files:**
- Create: `src/lib/authGuard.ts`
- Modify: 모든 `src/app/api/**/route.ts` (가드 삽입)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `isAllowedEmail` from `@/lib/auth`.
- Produces: `requireAllowedUser(): Promise<{ user: User; response: null } | { user: null; response: NextResponse }>`.

- [ ] **Step 1: 가드 구현**

Create `src/lib/authGuard.ts`:

```ts
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isAllowedEmail } from '@/lib/auth';

export async function requireAllowedUser(): Promise<
  { user: User; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) {
    return {
      user: null,
      response: NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 }),
    };
  }
  return { user, response: null };
}
```

- [ ] **Step 2: 대상 API 라우트 목록 확인**

Run: `find src/app/api -name route.ts | sort`
Expected: 아래 라우트들(전부 가드 대상):
`candidates`, `candidates/[id]`, `candidates/[id]/tags`, `candidates/[id]/tags/[tagId]`, `columns`, `columns/[id]`, `columns/[id]/refresh`, `columns/[id]/trend`, `columns/[id]/pillar`, `columns/[id]/tweets`, `dismissed`, `members`, `research/density`, `research/search`, `research/extract`, `scouts`, `tags`, `translate-tags`, `translate-keyword`, `suggest-keywords`, `tweets/[id]/[kind]`, `workspaces`, `workspaces/[id]`, `briefings`, `briefings/[id]`.

- [ ] **Step 3: 각 라우트의 모든 export 핸들러 최상단에 가드 삽입**

각 `route.ts`의 모든 export된 HTTP 핸들러(`GET`/`POST`/`PATCH`/`PUT`/`DELETE`) 함수 본문 **첫 줄**에 삽입:

```ts
import { requireAllowedUser } from '@/lib/authGuard';
// ...핸들러 안 첫 줄:
const gate = await requireAllowedUser();
if (gate.response) return gate.response;
```

예시 — `src/app/api/research/search/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { makeExaClient } from '@/lib/exa';
import { translateKeyword } from '@/lib/suggest';
import { requireAllowedUser } from '@/lib/authGuard';

const hasHangul = (s: string) => /[가-힣]/.test(s);

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { query } = await req.json().catch(() => ({}));
  // ...기존 로직 그대로...
}
```

동적 라우트(`[id]` 등)도 동일 — 시그니처(`ctx: { params: Promise<...> }`)는 건드리지 말고 첫 줄에만 삽입.

- [ ] **Step 4: 누락 없이 삽입됐는지 확인**

Run: `for f in $(find src/app/api -name route.ts); do grep -Lq requireAllowedUser "$f" && echo "MISSING: $f"; done`
Expected: 출력 없음(모든 파일이 가드 import 포함).

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authGuard.ts src/app/api
git commit -m "feat(auth): 모든 API 라우트에 requireAllowedUser 가드(과금 차단)"
```

---

### Task 3: 페이지 게이팅 `proxy.ts` + 세션 갱신

**Files:**
- Create: `src/proxy.ts`

**Interfaces:**
- Consumes: `isAllowedEmail` from `@/lib/auth`, `createServerClient` from `@supabase/ssr`.

- [ ] **Step 1: proxy.ts 작성**

Create `src/proxy.ts`:

```ts
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
```

- [ ] **Step 2: 빌드로 proxy 인식 확인**

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/proxy.ts
git commit -m "feat(auth): proxy.ts 페이지 게이팅 + 세션 갱신(Next 16 middleware 대체)"
```

---

### Task 4: 로그인·콜백·거부 화면

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/denied/page.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`(브라우저), `@/lib/supabase/server`(콜백).

- [ ] **Step 1: 로그인 화면**

Create `src/app/login/page.tsx`:

```tsx
'use client';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const signIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'clinicbridge.co.kr' }, // 구글 계정 선택 시 회사 도메인 힌트
      },
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-lg font-semibold">cb-x-deck</h1>
        <p className="mt-1 text-sm text-x-muted">회사 구글 계정으로 로그인하세요</p>
      </div>
      <button
        onClick={signIn}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
      >
        구글로 로그인
      </button>
    </main>
  );
}
```

- [ ] **Step 2: OAuth 콜백 라우트**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
```

- [ ] **Step 3: 거부 화면(로그아웃 포함)**

Create `src/app/denied/page.tsx`:

```tsx
'use client';

import { createClient } from '@/lib/supabase/client';

export default function DeniedPage() {
  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">접근할 수 없어요</h1>
        <p className="mt-2 text-sm text-x-muted">
          cb-x-deck는 회사 계정(@clinicbridge.co.kr)으로만 사용할 수 있어요.
          다른 계정으로 로그인하려면 아래에서 로그아웃하세요.
        </p>
      </div>
      <button
        onClick={signOut}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
      >
        로그아웃
      </button>
    </main>
  );
}
```

- [ ] **Step 4: 타입/빌드 확인**

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/app/login src/app/auth src/app/denied
git commit -m "feat(auth): 로그인·OAuth 콜백·거부 화면"
```

---

### Task 5: 프론트엔드 401 처리(세션 만료 대응)

**Files:**
- Create: `src/lib/apiFetch.ts`
- Modify: 클라이언트의 `fetch('/api...')` 호출부 전부

**Interfaces:**
- Produces: `apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>` — 401이면 `/login`으로 이동.

- [ ] **Step 1: apiFetch 래퍼 작성**

Create `src/lib/apiFetch.ts`:

```ts
// 클라이언트 전용. 세션 만료 등으로 API가 401을 주면 로그인 화면으로 유도한다.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('unauthorized');
  }
  return res;
}
```

- [ ] **Step 2: 대상 호출부 확인**

Run: `grep -rln "fetch('/api\|fetch(\`/api\|fetch(\"/api" src/app src/components`
Expected: `page.tsx`, `research/page.tsx`, `TweetExpansion.tsx` 등 클라이언트 컴포넌트 목록.

- [ ] **Step 3: 각 호출부를 apiFetch로 교체**

각 파일에서 `import { apiFetch } from '@/lib/apiFetch';` 추가 후, `fetch('/api...')` → `apiFetch('/api...')`로 치환(인자·옵션 동일). 서버 컴포넌트/라우트 내부 fetch는 대상 아님(클라이언트 컴포넌트만).

- [ ] **Step 4: 잔여 직접 fetch 없나 확인 + 빌드**

Run: `grep -rn "[^p]fetch('/api\|[^p]fetch(\`/api" src/app src/components | grep -v apiFetch`
Expected: 출력 없음(모두 교체됨).

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/apiFetch.ts src/app src/components
git commit -m "feat(auth): 클라이언트 401 시 로그인 유도(apiFetch 래퍼)"
```

---

### Task 6: 로컬 인증 검증(배포 전 최종 확인)

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test && npm run build`
Expected: 테스트 PASS, 빌드 성공(proxy·auth 페이지 포함).

- [ ] **Step 2: 로컬 구글 로그인 사전 조건**

로컬에서 OAuth를 끝까지 돌리려면 Supabase 대시보드의 Redirect URL에 `http://localhost:3000/auth/callback`이 등록돼 있어야 함(Task 7에서 함께 등록). 미등록이면 이 스텝은 배포 후 검증(Task 8)으로 대체.

- [ ] **Step 3: 게이팅 스모크(세션 없이)**

Run: `npm run dev` 후 별도 셸에서
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/workspaces`
Expected: `401`(세션 쿠키 없음 → 가드 작동).

`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/w/anything`
Expected: `307`/`308` + `/login`(프록시 리다이렉트).

- [ ] **Step 4: 결과 기록(커밋 불필요)**

위 스모크 결과를 실행자 리포트에 남긴다. 실패 시 해당 Task로 되돌아가 수정.

---

### Task 7: 콘솔 설정 — Google · Supabase (박구건 직접, 실행자는 안내·대기)

> 이 Task는 코드가 아니라 **박구건님이 웹 콘솔에서 클릭**해야 하는 부분. 실행자는 값을 수집·정리해 안내하고, 완료를 확인한 뒤 다음 Task로 진행.

- [ ] **Step 1: Google Cloud Console — OAuth 클라이언트 생성**

  1. console.cloud.google.com → 프로젝트 선택/생성 → "API 및 서비스" → "사용자 인증 정보".
  2. "사용자 인증 정보 만들기" → "OAuth 클라이언트 ID" → 유형 "웹 애플리케이션".
  3. **승인된 리다이렉트 URI**에 추가: `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`
     (`<SUPABASE_PROJECT_REF>`는 `.env`의 `SUPABASE_URL`에서 확인).
  4. 생성된 **client ID / client secret** 복사.

- [ ] **Step 2: Supabase 대시보드 — Google provider 켜기**

  1. Supabase 프로젝트 → Authentication → Providers → Google → Enable.
  2. Step 1의 client ID/secret 입력, 저장.
  3. Authentication → URL Configuration:
     - **Site URL**: (배포 도메인 확정 후 Task 8에서) `https://<vercel-domain>`
     - **Redirect URLs**에 추가: `http://localhost:3000/auth/callback`, `https://<vercel-domain>/auth/callback`
     (배포 도메인은 Task 8에서 확정되므로, 이 스텝은 Task 8과 왕복하며 채운다.)

- [ ] **Step 3: 완료 확인**

박구건님이 "Google provider 켜짐 + client ID/secret 저장됨"을 확인하면 다음 Task로.

---

### Task 8: Vercel 배포 + 배포본 검증

**Files:** 없음(운영)

- [ ] **Step 1: Vercel 로그인(박구건 직접)**

프롬프트에 `! npx vercel login` 입력해 브라우저로 로그인. (실행자가 대신 못 하는 인터랙티브 단계)

- [ ] **Step 2: 프로젝트 연결 + 환경변수 등록**

Run: `npx vercel link` (프로젝트 생성/연결)
그 후 아래 환경변수를 Production/Preview에 등록(대시보드 또는 `npx vercel env add <NAME> production`). `.env` 값과 동일:
`ANTHROPIC_API_KEY`, `EXA_API_KEY`, `GETXAPI_KEY`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 3: 배포**

Run: `npx vercel --prod`
Expected: 배포 성공 + 배포 도메인(`https://<...>.vercel.app`) 출력. 이 도메인을 기록.

- [ ] **Step 4: 배포 도메인을 콘솔에 반영(Task 7 왕복)**

  - Supabase URL Configuration의 Site URL = 배포 도메인, Redirect URLs에 `https://<domain>/auth/callback` 추가.
  - (Google 리다이렉트 URI는 Supabase 콜백이라 도메인 무관 — 변경 불필요.)

- [ ] **Step 5: 배포본 인증 플로우 실제 검증(브라우저)**

  claude-in-chrome 또는 수동으로:
  1. 시크릿 창에서 배포 도메인 접속 → `/login`으로 리다이렉트 확인.
  2. 회사 구글 계정으로 로그인 → 앱(`/w/...`) 진입 성공, 데이터 로드됨.
  3. 로그아웃 후 개인 gmail로 로그인 → `/denied` 표시 확인.
  4. 로그인 없이 `https://<domain>/api/workspaces` 직접 호출 → 401 확인.

- [ ] **Step 6: 검증 결과 리포트**

위 4가지 결과를 스크린샷/응답코드와 함께 보고. 하나라도 실패면 원인 Task로 복귀.

---

## Self-Review

**Spec coverage:**
- 구글 로그인 → Task 1(클라이언트)·4(화면). ✅
- 도메인 자동 허용 → Task 1(`isAllowedEmail`)·2·3. ✅
- 비허용 차단(`/denied`) → Task 3·4. ✅
- 미들웨어 게이팅 → Task 3(`proxy.ts`). ✅
- 모든 API 재검증 → Task 2. ✅
- 401 클라이언트 처리 → Task 5. ✅
- Vercel 배포 + env + 콘솔 설정 순서 → Task 7·8. ✅
- 배포본 검증(회사/비회사/무세션) → Task 8 Step 5. ✅
- 신규 DB 테이블 없음 → 계획에 마이그레이션 없음. ✅
- 백로그(어드민/외부승인) → 스펙에 기록됨, 계획 범위 밖(의도적). ✅

**Placeholder scan:** 실코드·실명령 포함. 콘솔 값(client ID 등)은 사용자 계정 고유라 플레이스홀더 표기가 불가피(Task 7/8은 운영 절차).

**Type consistency:** `isAllowedEmail`·`requireAllowedUser`·`createClient`(server async / browser sync)·`apiFetch` 시그니처가 Task 간 일치.
