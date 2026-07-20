# 멤버를 로그인 사용자로 자동 결정 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** 멤버를 로그인한 구글 사용자로 서버에서 자동 결정하고, 사이드바의 선택 드롭다운·수동 추가를 제거해 읽기전용 본인 표시로 바꾼다. 클라이언트 memberId 위조 경로를 닫는다.

**Architecture:** `member`에 email 추가 → `resolveMember(sql, user)`로 로그인 사용자 매핑/자동생성 → `requireMember()` 가드가 멤버 필요한 API에서 서버측 멤버를 강제. 클라이언트는 `/api/me`로 본인 멤버만 로드.

**Tech Stack:** Next.js 16, Supabase Auth, postgres(직접), node:test.

## Global Constraints

- 멤버 표시 이름 = 구글 표시이름(`user.user_metadata.full_name` → `.name` → 이메일 앞부분 폴백).
- 기존 '박구건' 멤버는 gugeon.park@clinicbridge.co.kr에 연결(데이터 보존). '멤버 2'는 삭제.
- 멤버 필요한 API는 클라이언트 `memberId`를 신뢰하지 말고 `requireMember().member.id` 사용.
- `member.email`은 이메일 기준 유니크; 기존 name 유니크 제거(동명이인 대비).
- 마이그레이션은 재실행 안전(idempotent).
- UI 문구는 비개발자 언어, 낡은 '봤음' 표현 제거.
- 테스트는 node:test, prefix 격리 + cleanup(기존 패턴).
- 커밋은 브랜치 `feat/member-from-login`.

## File Structure

- `migrations/009_member_auth.sql` — email 컬럼·유니크·박구건 연결·멤버2 삭제.
- `src/lib/workspaceStore.ts` — `resolveMember()` 추가.
- `src/lib/authGuard.ts` — `requireMember()` 추가.
- `src/app/api/me/route.ts` — GET 현재 멤버.
- 수정: `src/app/api/candidates/route.ts`, `src/app/api/dismissed/route.ts`, `src/app/api/scouts/route.ts`, `src/app/api/briefings/route.ts`, 후보 메모/태그 라우트 — 서버 멤버 사용.
- `src/lib/memberContext.tsx`, `src/components/Sidebar.tsx`, `src/components/CandidateCard.tsx` — 클라이언트.
- `src/app/api/members/route.ts` — POST(수동 생성) 제거, GET 유지.

---

### Task 1: 마이그레이션 009 + resolveMember + requireMember + /api/me

**Files:**
- Create: `migrations/009_member_auth.sql`, `src/app/api/me/route.ts`, `src/lib/workspaceStore.test.ts`(resolveMember 테스트; 이미 있으면 append)
- Modify: `src/lib/workspaceStore.ts`, `src/lib/authGuard.ts`

**Interfaces:**
- Produces: `resolveMember(sql, user: { email?: string|null; user_metadata?: Record<string,unknown>|null }): Promise<Member>`; `requireMember(): Promise<{ member: Member; user: User; response: null } | { member: null; user: null; response: NextResponse }>`.

- [ ] **Step 1: 마이그레이션 작성**

Create `migrations/009_member_auth.sql`:

```sql
-- v1.7 멤버를 로그인 사용자로 자동 결정. 재실행 안전.
alter table member add column if not exists email text;
-- 동명이인 대비: name 유니크 제거, email 유니크 신설
alter table member drop constraint if exists member_name_key;
create unique index if not exists idx_member_email on member(email) where email is not null;
-- 기존 박구건 → 로그인 연결(후보 등 데이터 보존)
update member set email = 'gugeon.park@clinicbridge.co.kr' where name = '박구건' and email is null;
-- 빈 테스트 멤버 삭제(후보 0개; scout/dismissed/briefing FK는 on delete set null)
delete from member where name = '멤버 2';
```

- [ ] **Step 2: resolveMember 실패 테스트 작성**

`src/lib/workspaceStore.test.ts`에 추가(파일 없으면 생성, 기존 import 스타일 따름 — `import { test, after } from 'node:test'`, `getSql` 등). prefix로 격리:

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { resolveMember, listMembers } from './workspaceStore.ts';

const sql = getSql();
const P = 'test-rm-' + process.pid + '-';
after(async () => {
  await sql`delete from member where email like ${P + '%'} or name like ${P + '%'}`;
  await sql.end();
});

test('resolveMember: 신규 생성 + 재조회 반환 + 이름 폴백', async () => {
  const email = P + 'a@x.com';
  const u1 = { email, user_metadata: { full_name: P + 'Alice' } };
  const m1 = await resolveMember(sql, u1);
  assert.equal(m1.name, P + 'Alice');
  // 재조회는 같은 멤버(중복 생성 안 함)
  const m2 = await resolveMember(sql, u1);
  assert.equal(m2.id, m1.id);
  // 이름 없으면 이메일 앞부분 폴백
  const email2 = P + 'bob@x.com';
  const m3 = await resolveMember(sql, { email: email2, user_metadata: {} });
  assert.equal(m3.name, P + 'bob');
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: FAIL — `resolveMember` export 없음.

- [ ] **Step 4: resolveMember 구현**

`src/lib/workspaceStore.ts`에 추가(기존 `MEMBER 색` 팔레트가 없으면 간단히 기본색 사용):

```ts
const MEMBER_COLORS = ['#1d9bf0', '#00ba7c', '#f91880', '#7856ff', '#ff7a00', '#ffd400'];

type ResolveUser = { email?: string | null; user_metadata?: Record<string, unknown> | null };

export async function resolveMember(sql: postgres.Sql, user: ResolveUser): Promise<Member> {
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) throw new Error('이메일 없는 사용자');
  const found = await sql<Member[]>`select id, name, color from member where email = ${email}`;
  if (found[0]) return found[0];
  const meta = user.user_metadata ?? {};
  const rawName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    email.split('@')[0];
  const name = String(rawName).trim() || email.split('@')[0];
  const color = MEMBER_COLORS[Math.abs(hashStr(email)) % MEMBER_COLORS.length];
  const inserted = await sql<Member[]>`
    insert into member (name, color, email) values (${name}, ${color}, ${email})
    on conflict (email) do update set email = excluded.email
    returning id, name, color`;
  return inserted[0];
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
```

(파일 상단에 `import postgres from 'postgres';` 및 `Member` import가 이미 있음 — 확인만.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 6: requireMember 가드 추가**

`src/lib/authGuard.ts`에 추가:

```ts
import { getSql } from '@/lib/db';
import { resolveMember } from '@/lib/workspaceStore';
import type { Member } from '@/lib/types';

export async function requireMember(): Promise<
  { member: Member; user: User; response: null } | { member: null; user: null; response: NextResponse }
> {
  const gate = await requireAllowedUser();
  if (gate.response) return { member: null, user: null, response: gate.response };
  const member = await resolveMember(getSql(), gate.user);
  return { member, user: gate.user, response: null };
}
```

- [ ] **Step 7: /api/me 라우트**

Create `src/app/api/me/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/authGuard';

export async function GET() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  return NextResponse.json(gate.member);
}
```

- [ ] **Step 8: 타입/빌드 확인 + 커밋**

Run: `npx tsc --noEmit` (clean), `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts` (pass)

```bash
git add migrations/009_member_auth.sql src/lib/workspaceStore.ts src/lib/workspaceStore.test.ts src/lib/authGuard.ts src/app/api/me
git commit -m "feat(member): resolveMember+requireMember+/api/me+마이그레이션(로그인→멤버)"
```

---

### Task 2: 멤버 필요한 API를 서버 해석 멤버로 전환(위조 차단)

**Files:**
- Modify: `src/app/api/candidates/route.ts`, `src/app/api/dismissed/route.ts`, `src/app/api/scouts/route.ts`, `src/app/api/briefings/route.ts`, 그리고 후보 메모/태그 라우트(`src/app/api/candidates/[id]/route.ts`, `src/app/api/candidates/[id]/tags/route.ts`, `.../tags/[tagId]/route.ts`) 중 memberId를 쓰는 곳.

**Interfaces:**
- Consumes: `requireMember` from `@/lib/authGuard`.

- [ ] **Step 1: 대상 라우트에서 client memberId 사용처 찾기**

Run: `grep -rn "memberId\|member_id\|dismissed_by\|saved_by\|created_by" src/app/api`
각 라우트가 요청에서 memberId를 받아 쓰는 지점을 파악.

- [ ] **Step 2: 각 라우트를 requireMember로 전환**

각 대상 라우트에서 `requireAllowedUser()` → `requireMember()`로 바꾸고, **요청 본문/쿼리의 memberId 대신 `gate.member.id` 사용**. 예 — `src/app/api/candidates/route.ts` POST:

```ts
import { requireMember } from '@/lib/authGuard';
// ...
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => ({}));
  const { tweetId, sourceColumnId, workspaceId } = body;
  const memberId = gate.member.id; // 클라이언트 body.memberId 무시(위조 차단)
  if (!tweetId || !workspaceId) return NextResponse.json({ error: '필수값 누락' }, { status: 400 });
  // ...기존 saveCandidate(sql, {..., memberId}) 그대로...
}
```

DELETE도 동일하게 `gate.member.id`로 스코프. `dismissed`(dismissed_by), `scouts`(saved_by), `briefings`(created_by), 후보 메모/태그의 "작성자" 판정도 `gate.member.id` 사용. GET 필터에서 "내 것"을 쓰는 경우도 `gate.member.id`.

주의: memberId가 nullable였던 라우트(dismissed/scouts)도 이제 항상 로그인 멤버로 채움.

- [ ] **Step 3: 위조 차단 회귀 테스트(있으면 candidateStore.test.ts에 append, 아니면 라우트 단위 대신 스토어 레벨로)**

핵심 불변식: 저장은 항상 로그인 멤버로 귀속. 라우트 통합 테스트가 어려우면(인증 목킹 필요), 이 Task는 서버 로직 검증으로 갈음하고 Step 4의 tsc/build + Task 최종 브라우저 검증으로 확인. (테스트 추가가 가능하면 candidate 저장이 전달된 memberId를 그대로 쓰는지 확인하는 기존 candidateStore 테스트로 충분 — 라우트가 body.memberId를 무시하는지는 코드 리뷰로 확인.)

- [ ] **Step 4: 확인 + 커밋**

Run: `npx tsc --noEmit` (clean), `npm run build` (성공)
Run: `grep -rn "body.memberId\|\\.memberId ??" src/app/api` → 멤버 필요한 라우트에서 클라이언트 memberId를 신뢰하는 잔재가 없는지 확인.

```bash
git add src/app/api
git commit -m "fix(member): 멤버 필요한 API를 서버 해석 멤버로(클라이언트 memberId 위조 차단)"
```

---

### Task 3: 클라이언트 — memberContext·Sidebar·CandidateCard

**Files:**
- Modify: `src/lib/memberContext.tsx`, `src/components/Sidebar.tsx`, `src/components/CandidateCard.tsx`

- [ ] **Step 1: memberContext를 /api/me 기반으로**

`src/lib/memberContext.tsx` 교체:

```tsx
'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './apiFetch';
import type { Member } from './types';

interface MemberCtx {
  member: Member | null;   // 로그인 본인
  members: Member[];       // 필터용 전체 목록
  reloadMembers: () => Promise<void>;
}

const Ctx = createContext<MemberCtx>({ member: null, members: [], reloadMembers: async () => {} });

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);

  const reloadMembers = useCallback(async () => {
    const r = await apiFetch('/api/members');
    if (r.ok) setMembers(await r.json());
  }, []);

  useEffect(() => {
    reloadMembers();
    apiFetch('/api/me').then((r) => r.ok ? r.json() : null).then((m) => m && setMember(m)).catch(() => {});
  }, [reloadMembers]);

  return <Ctx.Provider value={{ member, members, reloadMembers }}>{children}</Ctx.Provider>;
}

export const useMember = () => useContext(Ctx);
```

(주의: `selectMember`를 제거하므로, 이를 쓰던 곳은 Step 2에서 정리.)

- [ ] **Step 2: Sidebar 읽기전용 본인 표시**

`src/components/Sidebar.tsx` 하단 멤버 블록(현 131-148줄)을 교체: 드롭다운·"+ 멤버 추가"·`selectMember`/`createNewMember` 제거. 대신:

```tsx
<div className="border-t border-x-border pt-2">
  <p className="mb-1 px-1 text-caption text-x-muted">나</p>
  {member ? (
    <div className="flex items-center gap-2 px-1 py-1 text-sm">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: member.color }} />
      <span>{member.name}</span>
    </div>
  ) : (
    <p className="px-1 text-caption text-x-muted">불러오는 중…</p>
  )}
</div>
```

Sidebar에서 더 이상 안 쓰는 import·상태(MEMBER_COLORS, 새 멤버 입력 state, selectMember 사용)를 제거. `useMember()`에서 `member`만 사용.

- [ ] **Step 3: CandidateCard 정리**

`src/components/CandidateCard.tsx`: `meId = member?.id`는 그대로 유지(이제 로그인 본인이라 신뢰 가능). `selectMember` 등 제거된 API를 참조하지 않는지 확인. 변경 없으면 그대로 둠.

- [ ] **Step 4: 낡은 문구·잔재 제거 확인**

Run: `grep -rn "봤음\|selectMember\|cbxdeck-member\|멤버를 선택\|내가 누구인지" src`
Expected: 위 잔재가 남아있지 않음(문구·localStorage 키·제거된 함수). 남아있으면 정리.

- [ ] **Step 5: 타입/빌드 + 커밋**

Run: `npx tsc --noEmit` (clean), `npm run build` (성공)

```bash
git add src/lib/memberContext.tsx src/components/Sidebar.tsx src/components/CandidateCard.tsx
git commit -m "feat(member): 사이드바 선택기 제거→로그인 본인 자동 표시, /api/me 기반 컨텍스트"
```

---

### Task 4: 수동 멤버 생성 제거 + 잔재 정리

**Files:**
- Modify: `src/app/api/members/route.ts`

- [ ] **Step 1: POST 핸들러 제거(수동 멤버 추가 폐기), GET 유지**

`src/app/api/members/route.ts`에서 `export async function POST(...)` 전체 제거. `GET`은 유지(가드 포함). 남는 GET이 `requireAllowedUser` 가드를 그대로 갖는지 확인.

- [ ] **Step 2: createMember 참조 확인**

Run: `grep -rn "createMember" src`
Expected: 테스트 외 프로덕션 코드에서 참조 없음(있으면 정리). 테스트가 createMember를 쓰면 그대로 둠(스토어 함수는 남겨도 무방).

- [ ] **Step 3: 빌드 + 전체 테스트 + 커밋**

Run: `npx tsc --noEmit` (clean), `npm run build` (성공), `npm test` (전체 통과)

```bash
git add src/app/api/members
git commit -m "chore(member): 수동 멤버 추가 API(POST /api/members) 제거"
```

---

### (컨트롤러) 배포 전 검증 · 마이그레이션 적용 · 재배포

> 코드가 아니라 운영. 실행자(컨트롤러)가 진행하되 prod 적용은 사용자 확인 후.

- [ ] **A. 로컬 게이팅/멤버 스모크**: dev 재시작 후 로그인 상태에서 `/api/me`가 본인 멤버 반환, 저장이 본인 귀속인지 확인.
- [ ] **B. 마이그레이션 prod 적용**: `npm run migrate`(psql 필요) 또는 009만 적용하는 스크립트. **사용자 확인 후 실행.** 적용 후 박구건 후보 4개 유지·멤버2 삭제 확인.
- [ ] **C. 재배포**: `npx vercel --prod --yes` → 배포본에서 본인 로그인 시 이름 자동 세팅·후보 보존 확인.

## Self-Review

- 스펙 항목 매핑: email 컬럼·유니크·박구건 연결·멤버2 삭제(Task1 마이그레이션) / resolveMember·requireMember·/api/me(Task1) / 위조 차단(Task2) / 사이드바·컨텍스트(Task3) / 수동추가 제거·문구 정리(Task3 Step4, Task4). ✅
- 타입 일관성: `resolveMember(sql, user)→Member`, `requireMember()→{member,user,response}`, memberContext `{member, members, reloadMembers}`(selectMember 제거) — 모든 소비처 일치 확인 필요(Sidebar/CandidateCard가 selectMember 미참조).
- 잔재: `봤음`·`cbxdeck-member`·`selectMember`·`내가 누구인지` grep으로 0 확인(Task3 Step4).
