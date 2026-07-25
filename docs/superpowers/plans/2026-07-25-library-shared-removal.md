# 보관함 공유 제거 모델 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 보관함의 트윗 소속을 개인 저장과 분리해, 저장 취소가 팀원의 참고 대상을 뺏지 않게 하고, 트윗 제거는 실행취소 가능한 별도 액션으로 만든다.

**Architecture:** 신규 `library_item` 테이블이 "트윗이 팀 보관함에 있음"의 단일 진실이 된다. 저장(candidate)은 개인 참여로 남고, 저장 취소는 candidate만 지운다. 보관함은 이제 library_item 기준으로 로드(저장자 0명 항목 포함)하며, "팀 보관함에서 빼기"는 지연 커밋 + 실행취소 토스트로 트윗과 모든 코멘트를 삭제한다.

**Tech Stack:** Next.js(App Router)·React 클라이언트 컴포넌트, postgres.js(태그드 템플릿 + `sql.unsafe`), node:test(실 DB, prefix 데이터), Tailwind.

## Global Constraints

- 마이그레이션은 재실행 안전(idempotent): `create table if not exists`, `create unique index if not exists`, `on conflict ... do nothing`. (기존 001·002 컨벤션)
- 마이그레이션 적용: `npm run migrate` (모든 `migrations/*.sql`를 순서대로 psql 실행). 테스트: `npm test` (`node --test`, concurrency 1, `.env` 로드).
- API 라우트는 `requireMember()` 가드 사용, 클라이언트가 보낸 memberId는 무시하고 `gate.member.id` 사용(위조 차단). — 기존 `src/app/api/candidates/route.ts` 패턴.
- DB 접근은 `getSql()`(`@/lib/db`). 클라이언트 fetch는 `apiFetch`(`@/lib/apiFetch`).
- 사용자 노출 문구에 내부어(library_item·candidate) 금지. UI 언어: "팀 보관함", "저장", "코멘트".
- 커밋 메시지 접두사 `feat(x-research):` / `test(x-research):`, 본문 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 테스트 데이터는 prefix(`P`)로 격리하고 `after()`에서 정리(기존 `candidateStore.test.ts` 패턴). library_item은 workspace/tweet FK `on delete cascade`라 `deleteWorkspace`로 함께 정리됨.

## 의존성 그래프 (병렬 가능 구간)

```
Task 1 (마이그레이션+store) ─┬─> Task 2 (저장 시 library_item)
                            └─> Task 3 (GET/DELETE /api/library) ─> Task 4 (보관함 로드 전환) ─> Task 5 (CandidateCard) ─> Task 6 (실행취소 토스트)
Task T (Toast 컴포넌트) ── 독립, 언제든 병렬 가능 ────────────────────────────────────────────┘(Task 6에서 소비)
```

- **병렬 가능**: Task 1 완료 후 **Task 2와 Task 3**은 서로 독립(둘 다 store만 소비) → 병렬. **Task T(Toast)**는 아무 의존 없음 → 처음부터 병렬.
- **순차**: Task 3 → 4 → 5 → 6 (UI 사슬, 데이터 형태 의존).

## File Structure

- `migrations/012_library_item.sql` (생성) — 테이블·유니크·backfill.
- `src/lib/candidateStore.ts` (수정) — `mapTweetRow` 추출, `ensureLibraryItem`·`removeLibraryTweet`·`listLibraryTweets` 추가, `LibraryEntry` 타입.
- `src/lib/candidateStore.test.ts` (수정) — library 헬퍼 테스트 추가.
- `src/app/api/candidates/route.ts` (수정) — POST에서 `ensureLibraryItem` 호출.
- `src/app/api/library/route.ts` (생성) — GET(listLibraryTweets)·DELETE(removeLibraryTweet).
- `src/lib/candidateGroups.ts` (수정) — LibraryEntry 기반 필터로 어댑트.
- `src/app/w/[wsId]/library/page.tsx` (수정) — 로드 소스를 `/api/library`로 전환, 실행취소 토스트 상태.
- `src/components/CandidateCard.tsx` (수정) — 저장자 0명 상태, 저장취소 확인 간소화, "팀에서 빼기" 트리거.
- `src/components/Toast.tsx` (생성) — 최소 단일 토스트(실행취소 액션).

---

### Task 1: 마이그레이션 + library_item store 헬퍼

**Files:**
- Create: `migrations/012_library_item.sql`
- Modify: `src/lib/candidateStore.ts`
- Test: `src/lib/candidateStore.test.ts`

**Interfaces:**
- Consumes: 기존 `saveCandidate`, `removeCandidate`, `listCandidates`, 테스트 헬퍼 `createWorkspace/createMember/upsertTweets/deleteWorkspace`.
- Produces:
  - `ensureLibraryItem(sql, {workspaceId, tweetId, addedBy}): Promise<void>`
  - `removeLibraryTweet(sql, {workspaceId, tweetId}): Promise<void>`
  - `listLibraryTweets(sql, workspaceId): Promise<LibraryEntry[]>`
  - `interface LibraryEntry { tweet: CandidateRow['tweet']; addedBy: { id: string; name: string; color: string } | null; addedAt: string; candidates: CandidateRow[] }`

- [ ] **Step 1: 마이그레이션 파일 작성**

Create `migrations/012_library_item.sql`:

```sql
-- 012: 팀 보관함 소속(library_item)을 개인 저장(candidate)과 분리. 재실행 안전.
create table if not exists library_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  added_by uuid references member(id) on delete set null,
  added_at timestamptz not null default now()
);
create unique index if not exists idx_library_item_ws_tweet on library_item (workspace_id, tweet_id);

-- backfill: candidate가 있는 모든 (workspace, tweet)에 library_item 생성
-- added_by = 가장 먼저 저장한 멤버, added_at = 최소 saved_at
insert into library_item (workspace_id, tweet_id, added_by, added_at)
select distinct on (c.workspace_id, c.tweet_id)
       c.workspace_id, c.tweet_id, c.member_id, c.saved_at
  from candidate c
  order by c.workspace_id, c.tweet_id, c.saved_at asc
on conflict (workspace_id, tweet_id) do nothing;
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `npm run migrate`
Expected: `== applying migrations/012_library_item.sql` 후 `== done`, 에러 없음.

- [ ] **Step 3: `mapTweetRow` 추출 (기존 동작 보존 리팩터)**

In `src/lib/candidateStore.ts`, `loadCandidates`의 tweet 매핑을 함수로 추출. 파일 상단(import 아래)에 추가:

```ts
type TweetShape = CandidateRow['tweet'];
type Member = { id: string; name: string; color: string };

function mapTweetRow(r: Record<string, unknown>, savedBy: Member[]): TweetShape {
  return {
    tweetId: r.tweet_id as string, authorHandle: r.author_handle as string,
    authorName: r.author_name as string | null, authorAvatarUrl: r.author_avatar_url as string | null,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text as string, media: (r.media ?? []) as TweetShape['media'],
    quoted: r.quoted
      ? { ...(r.quoted as DeckQuoted), enriched: (r.quoted_enriched ?? null) as DeckTweet | null }
      : null,
    metrics: r.metrics as TweetShape['metrics'],
    tweetUrl: r.tweet_url as string | null,
    tweetCreatedAt: (r.tweet_created_at as Date | null)?.toISOString() ?? null,
    firstSeenAt: (r.first_seen_at as Date).toISOString(),
    lastFetchedAt: (r.last_fetched_at as Date).toISOString(),
    isNew: false,
    savedBy,
  };
}
```

그리고 `loadCandidates`의 `return rows.map(...)` 안의 `tweet: { ... }` 블록을 아래로 교체:

```ts
    tweet: mapTweetRow(r, [{ id: r.member_id as string, name: r.member_name as string, color: r.member_color as string }]),
```

- [ ] **Step 4: 기존 테스트로 리팩터 무해 확인**

Run: `npm test -- --test-name-pattern="멤버별 저장"`
Expected: 기존 candidateStore 테스트 PASS (동작 불변).

- [ ] **Step 5: library 헬퍼 실패 테스트 작성**

In `src/lib/candidateStore.test.ts`, import에 헬퍼 추가:

```ts
import { saveCandidate, removeCandidate, setMemo, addTag, removeTag, listCandidates, listAllTags,
         ensureLibraryItem, removeLibraryTweet, listLibraryTweets } from './candidateStore.ts';
```

파일 끝에 새 테스트 추가:

```ts
test('library_item: 소속 분리 · 저장취소 후 잔존 · 팀에서 빼기 · 0명 항목', async () => {
  const ws = await createWorkspace(sql, P + 'lw');
  const mA = await createMember(sql, P + 'LA', '#111111');
  const mB = await createMember(sql, P + 'LB', '#222222');
  try {
    await upsertTweets(sql, [tw('x'), tw('y')]);

    // 저장 = candidate + library_item
    const cA = await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id });
    await ensureLibraryItem(sql, { workspaceId: ws.id, tweetId: P + 'x', addedBy: mA.id });
    await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mB.id });
    await ensureLibraryItem(sql, { workspaceId: ws.id, tweetId: P + 'x', addedBy: mB.id }); // idempotent

    let lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);
    assert.equal(lib[0].tweet.tweetId, P + 'x');
    assert.equal(lib[0].candidates.length, 2);
    assert.equal(lib[0].addedBy?.name, P + 'LA'); // 최초 저장자

    // 저장 취소(내 것만): candidate는 줄지만 library_item·트윗은 남음
    await removeCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);              // 트윗 잔존
    assert.equal(lib[0].candidates.length, 1); // B만 남음

    // 저장자 0명 항목: B도 취소 → candidate 0, 그래도 library_item 유지 → 카드 남음
    await removeCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mB.id });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);
    assert.equal(lib[0].candidates.length, 0); // 저장자 0명
    assert.equal(lib[0].tweet.tweetId, P + 'x');

    // 팀에서 빼기: library_item + 모든 candidate 삭제
    await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id }); // 코멘트 하나 다시
    await removeLibraryTweet(sql, { workspaceId: ws.id, tweetId: P + 'x' });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 0); // 완전 삭제
    assert.equal((await listCandidates(sql, ws.id)).length, 0);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npm test -- --test-name-pattern="library_item"`
Expected: FAIL — `ensureLibraryItem`/`removeLibraryTweet`/`listLibraryTweets` is not a function.

- [ ] **Step 7: 헬퍼 구현**

In `src/lib/candidateStore.ts` 끝에 추가:

```ts
export async function ensureLibraryItem(
  sql: postgres.Sql, input: { workspaceId: string; tweetId: string; addedBy: string },
): Promise<void> {
  await sql`
    insert into library_item (workspace_id, tweet_id, added_by)
    values (${input.workspaceId}, ${input.tweetId}, ${input.addedBy})
    on conflict (workspace_id, tweet_id) do nothing`;
}

export async function removeLibraryTweet(
  sql: postgres.Sql, input: { workspaceId: string; tweetId: string },
): Promise<void> {
  // candidate는 tweet FK on delete cascade가 아니라 명시 삭제(다른 워크스페이스 candidate 보호 위해 ws 스코프)
  await sql`delete from candidate where workspace_id = ${input.workspaceId} and tweet_id = ${input.tweetId}`;
  await sql`delete from library_item where workspace_id = ${input.workspaceId} and tweet_id = ${input.tweetId}`;
}

export interface LibraryEntry {
  tweet: CandidateRow['tweet'];
  addedBy: { id: string; name: string; color: string } | null;
  addedAt: string;
  candidates: CandidateRow[];
}

export async function listLibraryTweets(sql: postgres.Sql, workspaceId: string): Promise<LibraryEntry[]> {
  // 1) library_item + 트윗 스냅샷 + 담은 사람 (저장자 0명 항목 포함)
  const rows = await sql.unsafe<Array<Record<string, unknown>>>(
    `select li.added_at, t.*, qt.data as quoted_enriched,
            ab.id as added_by_id, ab.name as added_by_name, ab.color as added_by_color
       from library_item li
       join tweet t on t.tweet_id = li.tweet_id
       left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'
       left join member ab on ab.id = li.added_by
      where li.workspace_id = $1
      order by li.added_at desc`,
    [workspaceId],
  );
  // 2) 이 워크스페이스의 모든 candidate를 트윗별로 그룹
  const cands = await listCandidates(sql, workspaceId);
  const byTweet = new Map<string, CandidateRow[]>();
  for (const c of cands) {
    const list = byTweet.get(c.tweet.tweetId);
    if (list) list.push(c); else byTweet.set(c.tweet.tweetId, [c]);
  }
  // 3) 병합: 트윗 savedBy = 그 트윗 candidate들의 멤버 합집합
  return rows.map((r) => {
    const tweetId = r.tweet_id as string;
    const candidates = byTweet.get(tweetId) ?? [];
    const savedBy = candidates.map((c) => c.member);
    return {
      tweet: mapTweetRow(r, savedBy),
      addedBy: r.added_by_id
        ? { id: r.added_by_id as string, name: r.added_by_name as string, color: r.added_by_color as string }
        : null,
      addedAt: (r.added_at as Date).toISOString(),
      candidates,
    };
  });
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test -- --test-name-pattern="library_item"`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add migrations/012_library_item.sql src/lib/candidateStore.ts src/lib/candidateStore.test.ts
git commit -m "feat(x-research): library_item 도입 — 팀 보관함 소속을 개인 저장과 분리

마이그레이션 012(테이블+유니크+backfill), ensureLibraryItem/removeLibraryTweet/listLibraryTweets 헬퍼.
저장 취소해도 트윗 잔존, 팀에서 빼기는 candidate+library_item 전부 삭제. 단위 테스트 동반.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 저장 시 library_item 자동 생성

**Files:**
- Modify: `src/app/api/candidates/route.ts:19-26` (POST)

**Interfaces:**
- Consumes: `ensureLibraryItem` (Task 1).
- Produces: 없음(엔드포인트 동작 변경).

- [ ] **Step 1: POST 핸들러에 ensureLibraryItem 추가**

`src/app/api/candidates/route.ts` 상단 import 수정:

```ts
import { saveCandidate, removeCandidate, listCandidates, ensureLibraryItem } from '@/lib/candidateStore';
```

POST 핸들러의 `return NextResponse.json(await saveCandidate(...), ...)` 직전에 library_item 보장 추가:

```ts
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { tweetId, workspaceId, sourceColumnId } = await req.json().catch(() => ({}));
  const memberId = gate.member.id;
  if (!tweetId || !workspaceId) return NextResponse.json({ error: 'tweetId·workspaceId 필수' }, { status: 400 });
  await ensureLibraryItem(getSql(), { workspaceId, tweetId, addedBy: memberId });
  return NextResponse.json(await saveCandidate(getSql(), { tweetId, workspaceId, memberId, sourceColumnId }), { status: 201 });
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: 수동 통합 확인**

Run: `npm run dev` 후 덱에서 트윗 저장 → DB에서 `select count(*) from library_item` 증가 확인(또는 저장 후 `GET /api/library?workspaceId=<ws>`에 해당 트윗 포함). 확인 후 dev 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/candidates/route.ts
git commit -m "feat(x-research): 저장 시 library_item 자동 생성(덱·보관함 공통)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 신규 API — GET/DELETE /api/library

**Files:**
- Create: `src/app/api/library/route.ts`

**Interfaces:**
- Consumes: `listLibraryTweets`, `removeLibraryTweet` (Task 1), `requireMember`, `getSql`.
- Produces:
  - `GET /api/library?workspaceId` → `LibraryEntry[]`
  - `DELETE /api/library?workspaceId&tweetId` → `{ ok: true }`

- [ ] **Step 1: 라우트 작성**

Create `src/app/api/library/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listLibraryTweets, removeLibraryTweet } from '@/lib/candidateStore';
import { requireMember } from '@/lib/authGuard';

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listLibraryTweets(getSql(), workspaceId));
}

// 팀 보관함에서 빼기: 트윗의 library_item + 모든 코멘트 삭제(워크스페이스 범위). 허용 멤버 누구나.
export async function DELETE(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'), tweetId = sp.get('tweetId');
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await removeLibraryTweet(getSql(), { workspaceId, tweetId });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 타입체크 + 빌드 라우트 인식**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: 수동 확인**

Run: `npm run dev` → `GET /api/library?workspaceId=<ws>`가 저장자 있는/없는 트윗 모두 배열로 반환하는지 확인. dev 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/library/route.ts
git commit -m "feat(x-research): /api/library GET(목록)·DELETE(팀에서 빼기)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task T: Toast 컴포넌트 (독립 · 병렬 가능)

**Files:**
- Create: `src/components/Toast.tsx`

**Interfaces:**
- Produces: `Toast({ message, actionLabel, onAction, onDismiss })` — 하단 중앙 고정, `onAction` 클릭 시 실행취소, 없으면 자동 소멸은 호출자가 타이머로 제어(컴포넌트는 표시만).

- [ ] **Step 1: 컴포넌트 작성**

Create `src/components/Toast.tsx`:

```tsx
'use client';

export function Toast({ message, actionLabel, onAction, onDismiss }: {
  message: string; actionLabel?: string; onAction?: () => void; onDismiss?: () => void;
}) {
  return (
    <div role="status" aria-live="polite"
         className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-x-text px-4 py-2.5 text-ui text-x-surface shadow-lg">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button onClick={onAction} className="font-bold text-x-blue-text underline-offset-2 hover:underline">{actionLabel}</button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} aria-label="닫기" className="text-x-surface/70 hover:text-x-surface">✕</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add src/components/Toast.tsx
git commit -m "feat(x-research): 최소 Toast 컴포넌트(실행취소 액션)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 보관함 로드 전환 (library 기준) + 필터 어댑트

**Files:**
- Modify: `src/lib/candidateGroups.ts`
- Modify: `src/app/w/[wsId]/library/page.tsx`

**Interfaces:**
- Consumes: `GET /api/library` → `LibraryEntry[]` (Task 3), `CandidateCard` (Task 5에서 prop 확장 예정 — 이 태스크에선 기존 시그니처 유지하고 group만 전달).
- Produces: `filterLibrary(entries, {memberId, tag}): LibraryEntry[]`.

- [ ] **Step 1: 필터 함수 실패 테스트**

In `src/lib/candidateGroups.test.ts` (없으면 생성) 추가:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLibrary } from './candidateGroups.ts';

const entry = (tweetId: string, members: Array<{ id: string; tags?: string[] }>) => ({
  tweet: { tweetId } as never,
  addedBy: null, addedAt: '2026-07-25T00:00:00.000Z',
  candidates: members.map((m, i) => ({
    id: tweetId + i, memo: '', savedAt: '2026-07-25T00:00:00.000Z', sourceColumnId: null, workspaceId: 'w',
    member: { id: m.id, name: m.id, color: '#000' },
    tags: (m.tags ?? []).map((n) => ({ id: n, name: n })),
    tweet: { tweetId } as never,
  })),
});

test('filterLibrary: 멤버/태그 필터, 저장자 0명은 필터 시 제외', () => {
  const entries = [
    entry('t1', [{ id: 'A', tags: ['red'] }, { id: 'B' }]),
    entry('t2', [{ id: 'B' }]),
    entry('t0', []), // 저장자 0명
  ] as never[];
  assert.equal(filterLibrary(entries, {}).length, 3);                    // 무필터: 전부(0명 포함)
  assert.equal(filterLibrary(entries, { memberId: 'A' }).length, 1);     // A 참여: t1만
  assert.equal(filterLibrary(entries, { tag: 'red' }).length, 1);        // red 태그: t1만
  assert.equal(filterLibrary(entries, { memberId: 'B' }).map((e) => e.tweet.tweetId).sort().join(','), 't1,t2');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --test-name-pattern="filterLibrary"`
Expected: FAIL — `filterLibrary` is not exported.

- [ ] **Step 3: filterLibrary 구현**

In `src/lib/candidateGroups.ts`, 파일 끝에 추가(기존 `groupCandidates`/`filterGroups`는 다른 소비자 위해 유지):

```ts
import type { LibraryEntry } from './candidateStore.ts';

export function filterLibrary(
  entries: LibraryEntry[],
  where: { memberId?: string | null; tag?: string | null },
): LibraryEntry[] {
  if (!where.memberId && !where.tag) return entries;
  return entries.filter((e) =>
    (!where.memberId || e.candidates.some((c) => c.member.id === where.memberId)) &&
    (!where.tag || e.candidates.some((c) => c.tags.some((t) => t.name === where.tag))));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- --test-name-pattern="filterLibrary"`
Expected: PASS.

- [ ] **Step 5: 보관함 페이지를 /api/library로 전환**

`src/app/w/[wsId]/library/page.tsx` 수정 — import·state·load·groups·렌더를 LibraryEntry 기준으로.

import 교체:

```ts
import type { LibraryEntry } from '@/lib/candidateStore';
import { filterLibrary } from '@/lib/candidateGroups';
```
(기존 `import type { CandidateRow }`·`groupCandidates, filterGroups`는 제거)

state 교체: `candidates`→`entries`:

```ts
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
```
(태그 필터용 태그 목록은 기존대로 `/api/tags` 유지)

load 교체:

```ts
  const load = useCallback(async () => {
    setError(false);
    try {
      const [lr, tr] = await Promise.all([
        apiFetch(`/api/library?workspaceId=${wsId}`),
        apiFetch(`/api/tags?workspaceId=${wsId}`),
      ]);
      if (!lr.ok) { setError(true); return; }
      setEntries(await lr.json());
      if (tr.ok) setTags(await tr.json());
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [wsId]);
```

groups 교체:

```ts
  const groups = useMemo(
    () => filterLibrary(entries, { memberId: activeMember, tag: activeTag }),
    [entries, activeMember, activeTag],
  );
```

번역 캐시용 savedIds 교체(candidates → entries):

```ts
  const savedIds = useMemo(() => entries.map((e) => e.tweet.tweetId), [entries]);
```

빈/정상 렌더의 조건과 카드 map 교체 — `candidates.length === 0` 는 `entries.length === 0` 로, 카드 map은 LibraryEntry를 전달:

```tsx
          ) : entries.length === 0 ? (
            <p className="p-4 text-ui text-x-muted">아직 저장한 트윗이 없어요 — 덱에서 트윗의 ☆를 누르면 여기에 모입니다</p>
          ) : groups.length === 0 ? (
            <p className="p-4 text-ui text-x-muted">
              조건에 맞는 저장물이 없어요 — 필터를 바꾸거나{' '}
              <button onClick={() => { setActiveMember(null); setActiveTag(null); }} className="underline">필터 초기화</button>
            </p>
          ) : (
            <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => (
                <CandidateCard key={g.tweet.tweetId} entry={g} meId={meId} onChanged={load}
                               translation={translations[g.tweet.tweetId] ?? null}
                               showTranslation={showTranslations}
                               onTranslate={translateOne}
                               translating={translatingIds.has(g.tweet.tweetId)} />
              ))}
            </main>
          )}
```

주: `CandidateCard`가 아직 `group` prop을 받으므로 이 태스크만으로는 타입 에러가 난다 → Task 5에서 `entry` prop으로 전환하며 해소. **이 태스크의 커밋은 Task 5와 함께**(아래 Step 7에서 커밋 보류) 하거나, 순서상 Task 5를 이어서 수행 후 함께 커밋한다.

- [ ] **Step 6: 순수함수 테스트만 통과 확인(페이지는 Task 5 후 검증)**

Run: `npm test -- --test-name-pattern="filterLibrary"`
Expected: PASS. (tsc 전체는 Task 5 완료 후 통과)

- [ ] **Step 7: 커밋 보류**

이 태스크는 Task 5와 타입 의존이 얽혀 있어, **Task 5 완료 후 함께 커밋**한다(“Task 5 Step 마지막”). candidateGroups 변경만 먼저 커밋해도 무방:

```bash
git add src/lib/candidateGroups.ts src/lib/candidateGroups.test.ts
git commit -m "feat(x-research): 보관함 필터를 LibraryEntry 기준 filterLibrary로 확장

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CandidateCard — 0명 상태·저장취소 간소화·팀에서 빼기 트리거

**Files:**
- Modify: `src/components/CandidateCard.tsx`

**Interfaces:**
- Consumes: `LibraryEntry`(Task 1), 페이지가 넘기는 `entry`·`onRemoveTeam`(Task 6에서 실제 구현되지만 이 태스크에서 prop 시그니처 확정).
- Produces: `CandidateCard({ entry, meId, onChanged, onRemoveTeam, translation?, showTranslation?, onTranslate?, translating? })`.

- [ ] **Step 1: 컴포넌트 시그니처·상단 로직 교체**

`src/components/CandidateCard.tsx`에서 `group: CandidateGroup` 기반을 `entry: LibraryEntry` 기반으로 교체. import 조정:

```ts
import type { CandidateRow } from '@/lib/types';
import type { LibraryEntry } from '@/lib/candidateStore';
```
(기존 `import type { CandidateGroup }` 제거)

시그니처·상단:

```tsx
export function CandidateCard({ entry, meId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating }: {
  entry: LibraryEntry; meId: string | null; onChanged: () => void; onRemoveTeam: (tweetId: string) => void;
  translation?: import('@/lib/types').TweetTranslation | null; showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void; translating?: boolean;
}) {
  const mine = entry.candidates.find((e) => e.member.id === meId) ?? null;
  const hasMyNote = !!mine && (!!mine.memo?.trim() || mine.tags.length > 0);
  const [confirming, setConfirming] = useState(false);         // 저장 취소 확인(메모 있을 때만)
  const [removingTeam, setRemovingTeam] = useState(false);      // 팀에서 빼기 확인

  const requestUnsave = () => { if (mine) { hasMyNote ? setConfirming(true) : doUnsave(); } };
  async function doUnsave() {
    if (!mine) return;
    await apiFetch(`/api/candidates?tweetId=${entry.tweet.tweetId}&workspaceId=${mine.workspaceId}`, { method: 'DELETE' });
    onChanged();
  }
```

주: 저장 취소 API는 memberId를 서버가 gate로 넣으므로 쿼리에서 제거. `entry.candidates[0]?.workspaceId`가 없을 수 있으니(0명) workspaceId 확보는 `mine.workspaceId`(mine 있을 때만 저장취소 가능하므로 안전).

- [ ] **Step 2: 렌더 — TweetCard·저장취소 확인·0명 안내·팀에서 빼기**

`return (...)` 교체:

```tsx
  return (
    <div className="overflow-hidden rounded-xl border border-x-border">
      <TweetCard tweet={{ ...entry.tweet, isNew: false }} meId={meId} onUnsave={requestUnsave}
                 translation={translation} showTranslation={showTranslation}
                 onTranslate={onTranslate} translating={translating} />

      {confirming && (
        <div className="border-t border-red-300 bg-red-50 p-2 text-caption">
          <p className="mb-1 text-red-600">저장을 취소할까요? 내 메모·태그도 함께 삭제돼요. (다른 멤버 코멘트는 유지)</p>
          <div className="flex gap-1">
            <button onClick={() => { setConfirming(false); doUnsave(); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">저장 취소</button>
            <button onClick={() => setConfirming(false)} className="rounded border border-x-border-strong px-2 py-0.5">그대로 두기</button>
          </div>
        </div>
      )}

      {removingTeam && (
        <div className="border-t border-red-300 bg-red-50 p-2 text-caption">
          <p className="mb-1 text-red-600">
            이 트윗을 팀 보관함에서 뺄까요?{entry.candidates.length > 0 ? ` 팀원 ${entry.candidates.length}명의 코멘트도 함께 삭제됩니다.` : ''} (실행취소 가능)
          </p>
          <div className="flex gap-1">
            <button onClick={() => { setRemovingTeam(false); onRemoveTeam(entry.tweet.tweetId); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">팀에서 빼기</button>
            <button onClick={() => setRemovingTeam(false)} className="rounded border border-x-border-strong px-2 py-0.5">그대로 두기</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-x-border border-t border-x-border">
        {entry.candidates.map((e) =>
          e.member.id === meId
            ? <MyComment key={e.id} entry={e} onChanged={onChanged} onUnsave={requestUnsave} />
            : <TheirComment key={e.id} entry={e} />)}
        {!mine && meId && (
          <AddComment tweetId={entry.tweet.tweetId} workspaceId={workspaceIdFor(entry, meId)} meId={meId} onChanged={onChanged} />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-x-border px-2 py-1 text-caption text-x-muted">
        <span>{entry.candidates.length === 0 ? `${entry.addedBy?.name ?? '팀'}이 담음 · 저장한 사람 없음` : ''}</span>
        <button onClick={() => setRemovingTeam(true)} className="hover:text-red-500">팀 보관함에서 빼기</button>
      </div>
    </div>
  );
}
```

`AddComment`의 workspaceId 확보 — 기존엔 `group.entries[0].workspaceId`였으나 0명일 수 있으므로 헬퍼로. 컴포넌트 위에 추가:

```tsx
// AddComment에 넘길 workspaceId: candidate가 있으면 거기서, 없으면 URL의 wsId를 페이지가 넘겨야 하지만
// 여기선 candidate 존재 시에만 mine이 없고 타인 candidate가 있는 경우를 다루고, 0명일 땐 페이지 wsId가 필요.
function workspaceIdFor(entry: LibraryEntry, _meId: string): string {
  return entry.candidates[0]?.workspaceId ?? '';
}
```

주: 0명 카드에서 "코멘트 달기"의 workspaceId가 비게 되는 엣지가 있다. 이를 확실히 하려면 페이지가 `wsId`를 CandidateCard에 prop으로 넘기는 게 정석 → **Step 3에서 `wsId` prop 추가**.

- [ ] **Step 3: wsId prop 추가로 0명 카드의 코멘트 달기 보정**

시그니처에 `wsId: string` 추가하고 `workspaceIdFor` 대신 `entry.candidates[0]?.workspaceId ?? wsId` 사용:

```tsx
export function CandidateCard({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating }: {
  entry: LibraryEntry; meId: string | null; wsId: string; onChanged: () => void; onRemoveTeam: (tweetId: string) => void;
  translation?: import('@/lib/types').TweetTranslation | null; showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void; translating?: boolean;
}) {
```

AddComment 호출:

```tsx
        {!mine && meId && (
          <AddComment tweetId={entry.tweet.tweetId} workspaceId={entry.candidates[0]?.workspaceId ?? wsId} meId={meId} onChanged={onChanged} />
        )}
```

`workspaceIdFor` 헬퍼는 제거.

- [ ] **Step 4: 페이지에서 CandidateCard 호출에 wsId·onRemoveTeam 연결(임시 stub)**

`src/app/w/[wsId]/library/page.tsx`의 카드 map에 prop 추가(onRemoveTeam은 Task 6에서 실제 구현, 여기선 임시로 load 재호출 stub):

```tsx
              {groups.map((g) => (
                <CandidateCard key={g.tweet.tweetId} entry={g} meId={meId} wsId={wsId} onChanged={load}
                               onRemoveTeam={async (tweetId) => {
                                 await apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${tweetId}`, { method: 'DELETE' });
                                 load();
                               }}
                               translation={translations[g.tweet.tweetId] ?? null}
                               showTranslation={showTranslations}
                               onTranslate={translateOne}
                               translating={translatingIds.has(g.tweet.tweetId)} />
              ))}
```

- [ ] **Step 5: 타입체크 + 로컬 시각 확인**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run dev` → 보관함에서 ①저장 취소(메모 없으면 즉시, 있으면 확인) ②나만 저장 취소 후 트윗 잔존(0명 카드 "○○이 담음 · 저장한 사람 없음") ③"팀 보관함에서 빼기" 확인창 코멘트 수 문구 확인. dev 종료.

- [ ] **Step 6: 커밋 (Task 4 페이지 변경과 함께)**

```bash
git add src/components/CandidateCard.tsx "src/app/w/[wsId]/library/page.tsx"
git commit -m "feat(x-research): 보관함 카드 LibraryEntry 전환 — 0명 카드·저장취소 간소화·팀에서 빼기

저장 취소는 내 참여만(메모 있을 때만 확인), 트윗은 팀 보관함에 잔존.
저장자 0명 카드는 '○○이 담음' 표시. 팀 보관함에서 빼기 트리거+강한 확인(코멘트 수 명시).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 실행취소 토스트 (지연 커밋)

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx`

**Interfaces:**
- Consumes: `Toast`(Task T), `DELETE /api/library`(Task 3), `CandidateCard`의 `onRemoveTeam`(Task 5).
- Produces: 없음.

- [ ] **Step 1: 지연 커밋 + 토스트 상태 추가**

`src/app/w/[wsId]/library/page.tsx` 상단 import:

```ts
import { Toast } from '@/components/Toast';
import { useRef } from 'react';
```

state·ref 추가(다른 state 근처):

```ts
  const [pendingRemove, setPendingRemove] = useState<string | null>(null); // 빼는 중인 tweetId
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

지연 커밋 로직 함수 추가(load 아래):

```ts
  // 팀에서 빼기: 즉시 서버 삭제하지 않고 낙관적으로 숨긴 뒤 ~5초 실행취소 토스트. 타임아웃/이탈 시 커밋.
  const commitRemove = useCallback(async (tweetId: string) => {
    await apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${tweetId}`, { method: 'DELETE' });
    setPendingRemove((cur) => (cur === tweetId ? null : cur));
    load();
  }, [wsId, load]);

  const requestRemoveTeam = useCallback((tweetId: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current); // 대기 중 다른 요청 → 앞의 것 즉시 커밋
    setPendingRemove((prev) => { if (prev && prev !== tweetId) void commitRemove(prev); return tweetId; });
    removeTimer.current = setTimeout(() => { void commitRemove(tweetId); }, 5000);
  }, [commitRemove]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setPendingRemove(null); // 아무것도 삭제 안 함(지연 커밋이라 데이터 온전)
  }, []);

  // 페이지 이탈/언마운트 시 대기 중 삭제 커밋
  useEffect(() => () => {
    if (removeTimer.current) { clearTimeout(removeTimer.current); if (pendingRemove) void commitRemove(pendingRemove); }
  }, [pendingRemove, commitRemove]);
```

- [ ] **Step 2: 낙관적 숨김 + 카드에 requestRemoveTeam 연결**

groups에서 pendingRemove 트윗을 낙관적으로 제외:

```ts
  const groups = useMemo(
    () => filterLibrary(entries, { memberId: activeMember, tag: activeTag }).filter((e) => e.tweet.tweetId !== pendingRemove),
    [entries, activeMember, activeTag, pendingRemove],
  );
```

카드 map의 `onRemoveTeam`을 stub에서 `requestRemoveTeam`으로 교체:

```tsx
                               onRemoveTeam={requestRemoveTeam}
```

- [ ] **Step 3: 토스트 렌더**

`{view === 'scouts' && <ScoutList wsId={wsId} />}` 아래(컴포넌트 최상위 div 닫기 직전)에 추가:

```tsx
      {pendingRemove && (
        <Toast message="팀 보관함에서 뺐어요" actionLabel="실행취소" onAction={undoRemove} />
      )}
```

- [ ] **Step 4: 타입체크 + 로컬 검증**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run dev` → "팀에서 빼기" 확인 → 카드 사라지고 하단 토스트 "실행취소" → ①실행취소 클릭 시 카드 복원(서버 미삭제) ②가만두면 ~5초 후 실제 삭제(새로고침해도 없음). dev 종료.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/w/[wsId]/library/page.tsx"
git commit -m "feat(x-research): 팀에서 빼기 실행취소 토스트(지연 커밋)

확인 후 즉시 삭제하지 않고 낙관적으로 숨긴 뒤 5초 실행취소 제공, 타임아웃/이탈 시 커밋.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 통합 검증 & (선택) 배포

- [ ] **Step 1: 전체 테스트·타입·린트**

Run: `npm test` → 전부 PASS. `npx tsc --noEmit` → exit 0. `npm run lint`(변경 파일 신규 문제 없음 확인).

- [ ] **Step 2: 프로덕션 빌드**

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: 시나리오 수동 검증(로컬)**

- 나만 저장→취소→트윗 잔존(0명 카드), 새로고침 후에도 존재
- 팀원 2명 저장한 트윗에서 내 취소→팀원 코멘트·카드 유지
- 팀에서 빼기→토스트 실행취소로 복원 / 방치 시 완전 삭제
- 덱에서 저장→보관함에 등장, 덱에서 취소해도 보관함 잔존
- 멤버/태그 필터에서 0명 카드는 전체에서만 노출

- [ ] **Step 4: (선택) 배포**

사용자 승인 시: `git push origin cb-koo/ux-ux:main` + `vercel --prod`. (마이그레이션은 프로덕션 DB에 `npm run migrate`로 먼저 적용해야 함 — 배포 전 실행.)

## Self-Review 체크

- **Spec 커버리지**: library_item(Task1)·저장 시 생성(Task2)·GET/DELETE(Task3)·0명 카드/필터(Task4)·저장취소 간소화+팀에서 빼기(Task5)·실행취소(Task6)·검증(Task7). 마이그레이션 backfill·권한(requireMember)·되돌리기(옵션B) 모두 포함.
- **미결/주의**: (a) 프로덕션 배포 시 마이그레이션 선적용 필수(Task7 Step4 명시). (b) tweet prune 로직이 도입되면 library_item 참조 트윗 보존 필요(현재 prune 없음). (c) 저장취소 API는 memberId를 서버 gate로 처리하므로 클라 쿼리에서 제거함(Task5 Step1).
