# 인증 확인을 로컬 JWT 검증으로 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 API 라우트가 지나는 `requireAllowedUser()`에서 Supabase 인증 서버 왕복(실측 37~40ms)을 없애고, JWT 서명을 로컬에서 검증한다.

**Architecture:** `supabase.auth.getClaims()`는 `crypto.subtle.verify`로 서명을 로컬 검증하지만, 그 JWKS 캐시가 **인스턴스 변수**라 요청마다 클라이언트를 새로 만드는 이 저장소에서는 매번 JWKS를 다시 받는다(13ms). `getClaims(jwt, { jwks })`로 키를 직접 넘기면 네트워크를 타지 않으므로, **JWKS를 모듈 레벨에 캐시**한다 — 모듈 스코프는 워밍된 람다 안에서 요청 간에 살아남는다.

**Tech Stack:** TypeScript · `@supabase/ssr` · `@supabase/auth-js` 2.110 · node:test · Next.js(App Router)

**설계 문서:** `docs/superpowers/specs/2026-08-08-auth-local-jwt-verify-design.md`

## Global Constraints

- **사용자에게 보이는 것이 달라지면 안 된다.** 실패는 지금과 같은 401 + 같은 문구(`로그인이 필요합니다`)로 떨어진다.
- **검증을 느슨하게 하지 않는다.** 만료·서명을 모두 확인한다. `allowExpired`를 쓰지 않는다. `getSession()`만으로 통과시키지 않는다.
- **캐시 실패가 인증 실패가 되면 안 된다.** JWKS를 못 받으면 `null`을 돌려주고, 호출부는 `jwks` 없이 `getClaims`를 부른다 — 그때는 라이브러리가 네트워크로 받아온다. 캐시는 **최적화일 뿐**이다.
- `src/lib/supabase/server.ts`, `src/proxy.ts`(미들웨어), `src/lib/auth.ts`의 `isAllowedUser` 판정 로직은 **건드리지 않는다.**
- `npx tsc --noEmit` 무출력. 린트는 정확히 `✖ 25 problems (14 errors, 11 warnings)` 유지. 규칙을 끄지 않는다.
- 테스트는 줄지 않는다(새 테스트로 늘어난다).
- 커밋 메시지 한국어, 저장소 형식. 경로 지정형 커밋(`git commit -F <파일> -- <경로>`), `git add -A` 금지.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/authJwks.ts` | (신규) 모듈 레벨 JWKS 캐시. "지금 쓸 수 있는 JWKS를 준다" 하나 |
| `src/lib/authJwks.test.ts` | (신규) TTL·동시 요청 병합·실패 시 null — fetch 주입으로 네트워크 없이 |
| `src/lib/authGuard.ts` | (수정) `getUser()` → `getClaims(undefined, { jwks })`, 반환 타입 축소 |

**의존 방향:** `authGuard` → `authJwks`. `authJwks`는 아무것도 의존하지 않는다(주입받은 `fetch`만 쓴다).

**확인된 사실 — 반환 타입을 좁혀도 안전하다:** `gate.user`를 `authGuard.ts` 밖에서 쓰는 곳이 없다(전수 grep). 유일한 소비자인 `resolveMember`의 `ResolveUser`는 `{ email?: string | null; user_metadata?: Record<string, unknown> | null }` 구조적 타입이라, 클레임에서 만든 객체가 그대로 들어맞는다. `requireMember` 사용처 18곳은 `member`만 쓴다.

---

### Task 1: JWKS 모듈 캐시

**Files:**
- Create: `src/lib/authJwks.ts`
- Test: `src/lib/authJwks.test.ts`

**Interfaces:**
- Consumes: 없음(주입받은 `fetch`)
- Produces:
  ```ts
  export interface Jwks { keys: JWK[] }              // JWK는 @supabase/auth-js에서 가져온다
  export function getCachedJwks(fetchImpl?: typeof fetch): Promise<Jwks | null>
  export function invalidateJwks(): void             // 키 회전 시 호출부가 부른다
  export function __resetForTest(): void             // 테스트 전용 — 모듈 상태 초기화
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/authJwks.test.ts`:

```ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedJwks, invalidateJwks, __resetForTest } from './authJwks.ts';

const KEYS = { keys: [{ kid: 'k1', kty: 'EC', key_ops: ['verify'] }] };

// 호출 횟수를 세는 가짜 fetch. 응답 본문은 JWKS 모양이면 충분하다.
function fakeFetch(body: unknown, ok = true) {
  const calls = { n: 0 };
  const impl = (async () => {
    calls.n += 1;
    return { ok, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => { __resetForTest(); });

test('처음 부르면 받아오고, 두 번째부터는 캐시를 쓴다', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.equal(calls.n, 1, '캐시가 살아 있으면 네트워크를 다시 타지 않는다');
});

test('동시에 여러 번 불러도 fetch는 한 번만 — 콜드 스타트 직후 요청이 몰릴 때', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  const [a, b, c] = await Promise.all([getCachedJwks(impl), getCachedJwks(impl), getCachedJwks(impl)]);
  assert.deepEqual([a, b, c], [KEYS, KEYS, KEYS]);
  assert.equal(calls.n, 1, '진행 중인 요청을 공유해야 한다');
});

test('무효화하면 다음 호출에서 다시 받는다 — 키 회전 대비', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  await getCachedJwks(impl);
  invalidateJwks();
  await getCachedJwks(impl);
  assert.equal(calls.n, 2);
});

test('실패하면 null — 던지지 않는다(인증이 죽으면 안 된다)', async () => {
  const bad = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.equal(await getCachedJwks(bad), null);
  // 실패를 캐시하지 않는다 — 다음 요청에서 다시 시도해야 한다
  const { impl, calls } = fakeFetch(KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.equal(calls.n, 1);
});

test('키가 비어 있으면 null — 쓸 수 없는 응답을 캐시하지 않는다', async () => {
  const { impl } = fakeFetch({ keys: [] });
  assert.equal(await getCachedJwks(impl), null);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/authJwks.test.ts
```

Expected: FAIL — `Cannot find module './authJwks.ts'`.

- [ ] **Step 3: 구현한다**

`src/lib/authJwks.ts`:

```ts
import type { JWK } from '@supabase/auth-js';

export interface Jwks { keys: JWK[] }

// JWKS를 모듈 레벨에 들고 있는 이유: supabase-js의 JWKS 캐시는 클라이언트 인스턴스에 붙어 있는데
// (GoTrueClient의 this.jwks), 이 저장소는 요청 쿠키에 묶이므로 요청마다 클라이언트를 새로 만든다.
// 그래서 그냥 두면 요청마다 /.well-known/jwks.json을 다시 받는다(실측 13ms).
// 모듈 스코프는 워밍된 서버리스 인스턴스 안에서 요청 간에 살아남으므로, 여기 담아 두고
// getClaims(jwt, { jwks })로 넘기면 그 왕복이 사라진다.
const TTL_MS = 10 * 60 * 1000;

let cached: Jwks | null = null;
let cachedAt = 0;
// 진행 중인 조회. 콜드 스타트 직후 요청이 여러 개면 같은 fetch가 N번 나가는 것을 막는다.
let inFlight: Promise<Jwks | null> | null = null;

function jwksUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/auth/v1/.well-known/jwks.json`;
}

/**
 * 지금 쓸 수 있는 JWKS. 없거나 받아오지 못하면 null —
 * 호출부는 그때 jwks 없이 getClaims를 불러 라이브러리가 직접 받아오게 한다.
 * 즉 이 캐시는 최적화일 뿐이고, 실패해도 인증이 죽지 않는다.
 */
export async function getCachedJwks(fetchImpl: typeof fetch = fetch): Promise<Jwks | null> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<Jwks | null> => {
    try {
      const res = await fetchImpl(jwksUrl());
      if (!res.ok) return null;
      const body = await res.json() as Jwks;
      if (!body?.keys?.length) return null;   // 쓸 수 없는 응답은 캐시하지 않는다
      cached = body;
      cachedAt = Date.now();
      return cached;
    } catch {
      return null;   // 실패는 캐시하지 않는다 — 다음 요청에서 다시 시도한다
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** 키 회전으로 우리가 든 키가 쓸모없어졌을 때. 다음 호출에서 다시 받아온다. */
export function invalidateJwks(): void {
  cached = null;
  cachedAt = 0;
}

/** 테스트 전용 — 모듈 상태를 초기화한다. */
export function __resetForTest(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/authJwks.test.ts
npx tsc --noEmit
npx eslint src/lib/authJwks.ts src/lib/authJwks.test.ts
```

Expected: `# fail 0`, tsc 무출력, eslint 무출력.

- [ ] **Step 5: 커밋**

```
feat(auth): JWKS 모듈 캐시 — 요청마다 키를 다시 받지 않도록

supabase-js의 JWKS 캐시는 클라이언트 인스턴스에 붙어 있는데, 이 저장소는 요청
쿠키에 묶이므로 요청마다 클라이언트를 새로 만든다. 그대로 두면 로컬 검증으로
바꿔도 요청마다 /.well-known/jwks.json을 다시 받는다(실측 13ms).

모듈 스코프는 워밍된 인스턴스 안에서 요청 간에 살아남는다. 받아오지 못하면
null을 돌려주고 호출부가 라이브러리 기본 경로로 떨어지므로, 캐시 실패가
인증 실패가 되지 않는다.

아직 아무도 이 모듈을 쓰지 않는다 — 동작 변화 없음.
```

---

### Task 2: `requireAllowedUser`를 로컬 검증으로

**Files:**
- Modify: `src/lib/authGuard.ts`

**Interfaces:**
- Consumes: `getCachedJwks`, `invalidateJwks` (Task 1)
- Produces: `requireAllowedUser()`의 반환이 `{ user: User }`에서 아래로 좁아진다. `gate.user`를 밖에서 쓰는 곳이 없고, `resolveMember`가 구조적으로 이 모양을 받으므로 호출부 변경은 없다.
  ```ts
  export interface GateIdentity {
    email: string | null;
    app_metadata: { provider?: string | null; providers?: string[] | null } | null;
    user_metadata: Record<string, unknown> | null;
  }
  ```

- [ ] **Step 1: 파일을 아래로 바꾼다**

`src/lib/authGuard.ts` 전체:

```ts
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
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit
npx eslint src/lib/authGuard.ts
```

Expected: 둘 다 무출력. **tsc가 다른 파일에서 에러를 내면 `gate.user`를 쓰는 곳이 더 있다는 뜻이다** — 그 자리를 보고하고 멈춘다(계획의 전제가 틀린 것이다).

- [ ] **Step 3: 전체 테스트와 빌드**

```bash
npm test 2>&1 | tail -6
npx next build 2>&1 | tail -3
```

Expected: `fail 0`, 빌드 성공.

- [ ] **Step 4: 커밋**

```
perf(auth): 인증 확인을 로컬 JWT 검증으로 — 라우트마다 붙던 왕복 제거

모든 API가 지나는 requireAllowedUser가 호출마다 Supabase 인증 서버로 물어보고
있었다(실측 37~40ms). getClaims는 서명을 crypto.subtle로 검증하므로 그 왕복이
필요 없다. JWKS는 모듈 캐시에서 넘겨 그쪽 네트워크도 타지 않는다.

검증은 느슨해지지 않는다 — 만료와 서명을 모두 확인하고, 실패는 지금과 같은
401에 같은 문구로 떨어진다. 판정 로직(도메인 + 구글 provider)도 그대로다.

반환 타입을 GateIdentity로 좁혔다. gate.user를 쓰는 곳은 resolveMember 하나뿐이고
그 함수는 email·user_metadata만 본다.

맞바꿈은 설계 문서에 적었다: 서버에서 무효화된 세션을 토큰 만료(1시간)까지 모른다.
```

---

## 완료 후 — 배포와 확인

라우트 게이트는 테스트 하네스가 없다. **배포 후 프로덕션에서 아래를 확인하고, 하나라도 어긋나면 즉시 되돌린다.**

1. **비로그인 API가 여전히 401인가** — 가장 중요하다. 검증이 느슨해졌는지 보는 항목이다.
   ```
   /api/tweet-table?workspaceId=x   → 401
   /api/drafts?workspaceId=x        → 401
   /api/tweets/123?workspaceId=x    → 401
   ```
2. **`/` → 307 `/login`, `/login` → 200**
3. **로그인 상태에서 화면이 정상 동작하는가** (사용자 확인 — OAuth 게이팅)
4. **응답 시간이 실제로 줄었는가** — 로그인 상태에서 아무 API의 응답 시간을 배포 전후로 비교. 웜 인스턴스에서 30~40ms가 빠져야 한다.

되돌리는 법: 이 두 커밋을 revert 하면 `getUser()` 경로로 즉시 복귀한다. 스키마 변경이 없어 되돌림이 안전하다.
