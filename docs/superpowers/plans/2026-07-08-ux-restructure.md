# UX 계층화 (v1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 페이지 구조를 "클라이언트 워크스페이스 → 기능(리서치·덱·보관함)" 계층으로 개편하고, 팀 공유 덱 + 멤버별 저장 레이어 + 뷰포트 자동 봤음을 도입한다.

**Architecture:** 기존 Next.js 앱 내 개편. DB에 workspace/member/tweet_seen 3테이블 추가(마이그레이션 002, 기존 데이터 기본 워크스페이스·기본 멤버로 귀속, 파괴 없음). URL을 `/w/[wsId]/...`로 재편하고 좌측 사이드바 셸 도입. 읽음 버튼 삭제 → IntersectionObserver 자동 봤음(멤버별). 저장(후보)이 멤버별 기록이 되고 팀 관점의 단위가 됨.

**Tech Stack:** 기존과 동일 (Next.js 16 + TS + Tailwind / postgres.js / node:test + tsx). 신규 외부 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-07-08-ux-restructure-design.md`

## Global Constraints

- **자동 폴링 절대 금지** — GetXAPI 호출은 사용자 조작(새로고침 버튼, 컬럼 생성)에서만. tweet_seen 배치 전송은 GetXAPI 호출이 아니므로 무관
- 마이그레이션은 **파괴적 변경 금지**: 기존 컬럼·후보·tweet.seen_at 데이터 전부 보존·귀속. `tweet.seen_at` 컬럼은 유지하되 코드 참조만 제거
- 자동 봤음 기준: **뷰포트 50% 이상 노출 + 1초 체류** (화면보다 긴 카드는 "뷰포트의 60% 이상을 채움"으로 보완). 기록은 멤버별, 서버 전송은 3초 배치
- 기본 뷰 = **전체(내가 본 트윗은 55% 투명 + hover 시 복원)**, "새 트윗만" = 필터 (내 봤음 없음 기준)
- 저장 유니크 = (tweet_id, workspace_id, member_id) — 같은 트윗을 멤버별로 각자 저장 가능
- 읽음 버튼(✓읽음·모두 읽음)과 그 API는 **삭제**
- 멤버 식별은 로그인 없이 localStorage(`cbxdeck-member`) — 인증·권한 없음(v2 범위)
- UI 라벨 한국어. 테스트 = node:test + tsx `--test-concurrency=1`, 실DB 테스트는 `test-` 접두 데이터 + after() 정리 필수
- 로컬 import는 명시적 `.ts`/`.tsx` 확장자(라우트·컴포넌트의 `@/lib/...` 별칭은 확장자 없음 — 기존 코드베이스 관례 그대로)
- `.env` 커밋 금지. 각 태스크 완료 게이트: `npm test` 전건 + `npx tsc --noEmit` + `npm run build` clean
- **confirm()/alert() 등 브라우저 모달 신규 도입 금지** (기존 컬럼 삭제 confirm은 유지)

## 파일 구조 개요

```
migrations/002_workspace_member.sql        신규: workspace/member/tweet_seen + 귀속 마이그레이션
src/lib/types.ts                           수정: Workspace·Member 추가, StoredTweet/ColumnRow/CandidateRow 개편
src/lib/workspaceStore.ts (+test)          신규: 워크스페이스·멤버 CRUD
src/lib/columnStore.ts (+test)             수정: workspaceId 스코프
src/lib/tweetStore.ts (+test)              수정: seenByMe/savedBy 조회, markSeenBatch (markSeen/markAllSeen 삭제)
src/lib/candidateStore.ts (+test)          수정: workspace·member 스코프
src/lib/refreshColumn.test.ts              수정: 워크스페이스 픽스처
src/app/api/workspaces/route.ts            신규: GET/POST
src/app/api/members/route.ts               신규: GET/POST
src/app/api/tweets/seen/route.ts           신규: POST 배치 / 삭제: tweets/[id]/seen, columns/[id]/read-all
src/app/api/columns/route.ts               수정: workspaceId 필수
src/app/api/columns/[id]/tweets/route.ts   수정: memberId 파라미터, mode 제거
src/app/api/candidates/route.ts, tags      수정: workspaceId·memberId
src/lib/memberContext.tsx                  신규: 멤버 선택 컨텍스트(localStorage)
src/components/Sidebar.tsx                 신규: 워크스페이스 스위처 + 기능 내비 + 멤버 선택
src/app/w/[wsId]/layout.tsx                신규: 사이드바 셸
src/app/w/[wsId]/page.tsx                  신규: 덱 (기존 page.tsx 이동·개편)
src/app/w/[wsId]/library/page.tsx          신규: 보관함 이동 (멤버 필터는 Task 7)
src/app/w/[wsId]/research/page.tsx         신규: 리서치 슬롯(빈 페이지)
src/app/page.tsx                           수정: 첫 워크스페이스로 리다이렉트 / 삭제: app/library/page.tsx
src/lib/useSeenTracker.ts                  신규: IntersectionObserver 자동 봤음 훅
src/components/TweetCard.tsx               수정: 읽음 버튼 삭제, 흐림+hover, 저장자 배지
src/components/Column.tsx                  수정: 모두읽음 삭제, 기본 전체 뷰, 봤음 트래커 연결
src/components/CandidateCard.tsx           수정: 저장 멤버 표시, API 파라미터
README.md                                  수정
```

---

### Task 1: 마이그레이션 002 + 타입 개편 + workspaceStore

**Files:**
- Create: `migrations/002_workspace_member.sql`, `src/lib/workspaceStore.ts`, `src/lib/workspaceStore.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces (이후 모든 태스크의 계약):
  - `interface Workspace { id: string; name: string; position: number }`
  - `interface Member { id: string; name: string; color: string }`
  - `StoredTweet`: `seenAt`·`isCandidate` 제거 → `seenByMe: boolean`, `savedBy: Member[]`
  - `ColumnRow` + `workspaceId: string`
  - `CandidateRow` + `member: Member`, `workspaceId: string`
  - `listWorkspaces(sql): Promise<Workspace[]>` / `createWorkspace(sql, name): Promise<Workspace>` / `deleteWorkspace(sql, id): Promise<void>`
  - `listMembers(sql): Promise<Member[]>` / `createMember(sql, name, color): Promise<Member>`
- 주의: 이 태스크의 types.ts 변경으로 **기존 store·컴포넌트가 일시적으로 tsc 실패**한다. 이 태스크의 게이트는 `npm run migrate` 검증 + workspaceStore 테스트 통과까지이며, tsc/build 게이트는 Task 2~4에서 회복된다. 커밋 메시지에 명시할 것.

- [ ] **Step 1: 마이그레이션 작성** — `migrations/002_workspace_member.sql`

```sql
-- v1.5 UX 계층화: 워크스페이스(클라이언트)·멤버·멤버별 봤음. 재실행 안전(idempotent).
create table if not exists workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists member (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#1d9bf0',
  created_at timestamptz not null default now()
);

create table if not exists tweet_seen (
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (tweet_id, member_id)
);
create index if not exists idx_tweet_seen_member on tweet_seen (member_id);

-- 시드: 기본 워크스페이스·기본 멤버 (하나도 없을 때만)
insert into workspace (name) select '기본' where not exists (select 1 from workspace);
insert into member (name, color) select '박구건', '#1d9bf0' where not exists (select 1 from member);

-- deck_column → workspace 귀속
alter table deck_column add column if not exists workspace_id uuid references workspace(id) on delete cascade;
update deck_column set workspace_id = (select id from workspace order by created_at limit 1) where workspace_id is null;
alter table deck_column alter column workspace_id set not null;

-- candidate → workspace·member 귀속
alter table candidate add column if not exists workspace_id uuid references workspace(id) on delete cascade;
alter table candidate add column if not exists member_id uuid references member(id) on delete cascade;
update candidate set workspace_id = (select id from workspace order by created_at limit 1) where workspace_id is null;
update candidate set member_id = (select id from member order by created_at limit 1) where member_id is null;
alter table candidate alter column workspace_id set not null;
alter table candidate alter column member_id set not null;

-- 후보 유니크: 트윗당 1개 → 트윗×워크스페이스×멤버당 1개
alter table candidate drop constraint if exists candidate_tweet_id_key;
create unique index if not exists idx_candidate_tweet_ws_member on candidate (tweet_id, workspace_id, member_id);

-- 기존 읽음(tweet.seen_at) → 기본 멤버의 tweet_seen으로 이관 (tweet.seen_at 컬럼은 유지, 코드 참조만 제거)
insert into tweet_seen (tweet_id, member_id, seen_at)
select t.tweet_id, (select id from member order by created_at limit 1), t.seen_at
  from tweet t where t.seen_at is not null
on conflict do nothing;
```

- [ ] **Step 2: 마이그레이션 적용 + 검증**

```bash
npm run migrate
set -a; source .env; set +a
psql -tAc "select count(*) from deck_column where workspace_id is null"        # 0
psql -tAc "select count(*) from candidate where member_id is null"             # 0
psql -tAc "select (select count(*) from tweet where seen_at is not null) = (select count(*) from tweet_seen)"  # t (이관 완료)
psql -tAc "select name from workspace"                                         # 기본 (기존 데이터가 있던 DB 기준)
```

- [ ] **Step 3: types.ts 개편** — `src/lib/types.ts`에서 아래를 변경 (나머지 타입은 유지)

```ts
// 추가
export interface Workspace { id: string; name: string; position: number }
export interface Member { id: string; name: string; color: string }

// ColumnRow — workspaceId 추가
export interface ColumnRow {
  id: string;
  workspaceId: string;
  kind: ColumnKind;
  title: string;
  position: number;
  config: SearchConfig | WatchlistConfig;
  lastRefreshedAt: string | null; // ISO
}

// StoredTweet — seenAt·isCandidate 제거, seenByMe·savedBy로 대체
export interface StoredTweet extends DeckTweet {
  firstSeenAt: string;   // ISO
  lastFetchedAt: string; // ISO
  seenByMe: boolean;     // 조회한 멤버 기준 (멤버 미선택 시 false)
  savedBy: Member[];     // 이 워크스페이스에서 이 트윗을 저장한 멤버들
}

// CandidateRow — 저장한 멤버·워크스페이스 추가
export interface CandidateRow {
  id: string;
  tweet: StoredTweet;
  memo: string;
  savedAt: string;
  sourceColumnId: string | null;
  tags: Array<{ id: string; name: string }>;
  member: Member;
  workspaceId: string;
}
```

- [ ] **Step 4: workspaceStore 실패 테스트** — `src/lib/workspaceStore.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listWorkspaces, createWorkspace, deleteWorkspace, listMembers, createMember } from './workspaceStore.ts';

const sql = getSql();
const T = 'test-ws-' + process.pid;

after(async () => {
  await sql`delete from workspace where name like ${T + '%'}`;
  await sql`delete from member where name like ${T + '%'}`;
  await sql.end();
});

test('workspace CRUD', async () => {
  const w = await createWorkspace(sql, T);
  assert.equal(w.name, T);
  const all = await listWorkspaces(sql);
  assert.ok(all.some((x) => x.id === w.id));
  await deleteWorkspace(sql, w.id);
  assert.ok(!(await listWorkspaces(sql)).some((x) => x.id === w.id));
});

test('member 생성·목록', async () => {
  const m = await createMember(sql, T + '-m', '#00ba7c');
  assert.equal(m.color, '#00ba7c');
  assert.ok((await listMembers(sql)).some((x) => x.id === m.id));
});

test('마이그레이션 귀속: 기존 컬럼·후보에 workspace/member 채워짐', async () => {
  const [{ c1 }] = await sql`select count(*)::int as c1 from deck_column where workspace_id is null`;
  const [{ c2 }] = await sql`select count(*)::int as c2 from candidate where member_id is null or workspace_id is null`;
  assert.equal(c1, 0);
  assert.equal(c2, 0);
});
```

- [ ] **Step 5: 실행 → 실패 확인**  Run: `node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/workspaceStore.test.ts`  Expected: FAIL (`workspaceStore.ts` 없음)

- [ ] **Step 6: 구현** — `src/lib/workspaceStore.ts`

```ts
import type postgres from 'postgres';
import type { Member, Workspace } from './types.ts';

export async function listWorkspaces(sql: postgres.Sql): Promise<Workspace[]> {
  const rows = await sql<Array<{ id: string; name: string; position: number }>>`
    select id, name, position from workspace order by position, created_at`;
  return rows;
}

export async function createWorkspace(sql: postgres.Sql, name: string): Promise<Workspace> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    insert into workspace (name) values (${name.trim()}) returning id, name, position`;
  return row;
}

export async function deleteWorkspace(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from workspace where id = ${id}`;
}

export async function listMembers(sql: postgres.Sql): Promise<Member[]> {
  const rows = await sql<Array<{ id: string; name: string; color: string }>>`
    select id, name, color from member order by created_at`;
  return rows;
}

export async function createMember(sql: postgres.Sql, name: string, color: string): Promise<Member> {
  const [row] = await sql<Array<{ id: string; name: string; color: string }>>`
    insert into member (name, color) values (${name.trim()}, ${color}) returning id, name, color`;
  return row;
}
```

- [ ] **Step 7: 테스트 통과 확인 + Commit**

Run: `node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/workspaceStore.test.ts`  Expected: PASS (3/3)

```bash
git add -A && git commit -m "feat(v1.5): workspace/member/tweet_seen migration + workspaceStore + type overhaul (breaks tsc until stores updated — Tasks 2-4)"
```

---

### Task 2: columnStore·tweetStore 개편 (workspaceId 스코프, seenByMe/savedBy, markSeenBatch)

**Files:**
- Modify: `src/lib/columnStore.ts`, `src/lib/columnStore.test.ts`, `src/lib/tweetStore.ts`, `src/lib/tweetStore.test.ts`, `src/lib/refreshColumn.test.ts`

**Interfaces:**
- Consumes: Task 1의 타입·workspaceStore
- Produces:
  - `listColumns(sql, workspaceId: string): Promise<ColumnRow[]>`
  - `createColumn(sql, input: { workspaceId: string; kind; title; config; position? }): Promise<ColumnRow>` — getColumn/updateColumn/deleteColumn/touchRefreshed 시그니처 유지(반환에 workspaceId 포함)
  - `getColumnTweets(sql, columnId, opts: { sort: SortKey; memberId: string | null }): Promise<StoredTweet[]>` — mode 파라미터 삭제(표시 필터는 클라이언트)
  - `markSeenBatch(sql, memberId: string, tweetIds: string[]): Promise<number>` — markSeen·markAllSeen 삭제
- refreshColumn.ts 자체는 무변경 (seen을 다루지 않음). 테스트만 워크스페이스 픽스처로 갱신

- [ ] **Step 1: columnStore 수정** — `src/lib/columnStore.ts` 전체를 아래로 교체

```ts
import type postgres from 'postgres';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from './types.ts';

type Row = { id: string; workspace_id: string; kind: ColumnKind; title: string; position: number; config: ColumnRow['config']; last_refreshed_at: Date | null };

function toColumn(r: Row): ColumnRow {
  return { id: r.id, workspaceId: r.workspace_id, kind: r.kind, title: r.title, position: r.position, config: r.config, lastRefreshedAt: r.last_refreshed_at ? r.last_refreshed_at.toISOString() : null };
}

const COLS = 'id, workspace_id, kind, title, position, config, last_refreshed_at';

export async function listColumns(sql: postgres.Sql, workspaceId: string): Promise<ColumnRow[]> {
  const rows = await sql.unsafe<Row[]>(`select ${COLS} from deck_column where workspace_id = $1 order by position, created_at`, [workspaceId]);
  return rows.map(toColumn);
}

export async function getColumn(sql: postgres.Sql, id: string): Promise<ColumnRow | null> {
  const rows = await sql.unsafe<Row[]>(`select ${COLS} from deck_column where id = $1`, [id]);
  return rows[0] ? toColumn(rows[0]) : null;
}

export async function createColumn(
  sql: postgres.Sql,
  input: { workspaceId: string; kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig; position?: number },
): Promise<ColumnRow> {
  const [row] = await sql<Row[]>`
    insert into deck_column (workspace_id, kind, title, position, config)
    values (${input.workspaceId}, ${input.kind}, ${input.title}, ${input.position ?? 0}, ${sql.json(input.config as never)})
    returning id, workspace_id, kind, title, position, config, last_refreshed_at`;
  return toColumn(row);
}

export async function updateColumn(
  sql: postgres.Sql,
  id: string,
  patch: { title?: string; config?: SearchConfig | WatchlistConfig; position?: number },
): Promise<ColumnRow> {
  const [row] = await sql<Row[]>`
    update deck_column set
      title = coalesce(${patch.title ?? null}, title),
      config = coalesce(${patch.config ? sql.json(patch.config as never) : null}, config),
      position = coalesce(${patch.position ?? null}, position)
    where id = ${id}
    returning id, workspace_id, kind, title, position, config, last_refreshed_at`;
  if (!row) throw new Error(`column not found: ${id}`);
  return toColumn(row);
}

export async function deleteColumn(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from deck_column where id = ${id}`;
}

export async function touchRefreshed(sql: postgres.Sql, id: string): Promise<void> {
  await sql`update deck_column set last_refreshed_at = now() where id = ${id}`;
}
```

- [ ] **Step 2: tweetStore 수정** — `src/lib/tweetStore.ts`에서 `upsertTweets`·`linkColumnTweets`·`ORDER`는 그대로 두고, 나머지를 아래로 교체 (markSeen·markAllSeen 삭제)

```ts
type TweetRow = {
  tweet_id: string; author_handle: string; author_name: string | null; author_avatar_url: string | null;
  author_followers: string | number | null; text: string; media: StoredTweet['media'];
  quoted: StoredTweet['quoted']; metrics: StoredTweet['metrics']; tweet_url: string | null;
  tweet_created_at: Date | null; first_seen_at: Date; last_fetched_at: Date;
  seen_by_me: boolean; saved_by: StoredTweet['savedBy'];
};

function toStored(r: TweetRow): StoredTweet {
  return {
    tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text, media: r.media ?? [], quoted: r.quoted, metrics: r.metrics,
    tweetUrl: r.tweet_url, tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
    firstSeenAt: r.first_seen_at.toISOString(), lastFetchedAt: r.last_fetched_at.toISOString(),
    seenByMe: r.seen_by_me, savedBy: r.saved_by ?? [],
  };
}

export async function getColumnTweets(
  sql: postgres.Sql, columnId: string, opts: { sort: SortKey; memberId: string | null },
): Promise<StoredTweet[]> {
  const [col] = await sql<Array<{ workspace_id: string }>>`select workspace_id from deck_column where id = ${columnId}`;
  if (!col) return [];
  const rows = await sql.unsafe<TweetRow[]>(
    `select t.*,
            exists(select 1 from tweet_seen ts where ts.tweet_id = t.tweet_id and ts.member_id = $2::uuid) as seen_by_me,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                        from candidate c join member m on m.id = c.member_id
                       where c.tweet_id = t.tweet_id and c.workspace_id = $3), '[]'::json) as saved_by
       from column_tweet ct
       join tweet t on t.tweet_id = ct.tweet_id
      where ct.column_id = $1
      order by ${ORDER[opts.sort] ?? ORDER.views}
      limit 200`,
    [columnId, opts.memberId, col.workspace_id],
  );
  return rows.map(toStored);
}

export async function markSeenBatch(sql: postgres.Sql, memberId: string, tweetIds: string[]): Promise<number> {
  if (tweetIds.length === 0) return 0;
  const rows = await sql`
    insert into tweet_seen (tweet_id, member_id)
    select t.tweet_id, ${memberId} from tweet t where t.tweet_id = any(${tweetIds})
    on conflict do nothing
    returning tweet_id`;
  return rows.length;
}
```

- [ ] **Step 3: tweetStore 테스트 재작성** — `src/lib/tweetStore.test.ts` 전체 교체

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets, markSeenBatch } from './tweetStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ts-' + process.pid + '-';

function tw(id: string, views: number): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: 'T', authorAvatarUrl: null, authorFollowers: 10,
    text: 'hello ' + id, media: [], quoted: null,
    metrics: { views, likes: 1, retweets: 2, replies: 0, quotes: 0, bookmarks: 3 },
    tweetUrl: null, tweetCreatedAt: new Date('2026-07-01T00:00:00Z').toISOString(),
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('upsert 재조회 보존 + 멤버별 seenByMe 독립 + savedBy 집계', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const mA = await createMember(sql, P + 'A', '#111111');
  const mB = await createMember(sql, P + 'B', '#222222');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col', config: { keywords: ['x'] } });
  try {
    const r1 = await upsertTweets(sql, [tw('a', 100), tw('b', 200)]);
    assert.deepEqual(r1, { inserted: 2, updated: 0 });
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b']);

    // A만 a를 봤음 처리
    assert.equal(await markSeenBatch(sql, mA.id, [P + 'a']), 1);
    assert.equal(await markSeenBatch(sql, mA.id, [P + 'a']), 0); // 중복 무시

    const [{ first_seen_at: fs1 }] = await sql`select first_seen_at from tweet where tweet_id = ${P + 'a'}`;
    const r2 = await upsertTweets(sql, [tw('a', 999)]);
    assert.deepEqual(r2, { inserted: 0, updated: 1 });
    const [row] = await sql`select first_seen_at, metrics from tweet where tweet_id = ${P + 'a'}`;
    assert.equal(String(row.first_seen_at), String(fs1)); // first_seen 보존
    assert.equal(row.metrics.views, 999);                  // 지표 갱신

    const forA = await getColumnTweets(sql, col.id, { sort: 'views', memberId: mA.id });
    assert.deepEqual(forA.map((t) => [t.tweetId, t.seenByMe]), [[P + 'a', true], [P + 'b', false]]);
    const forB = await getColumnTweets(sql, col.id, { sort: 'views', memberId: mB.id });
    assert.deepEqual(forB.map((t) => t.seenByMe), [false, false]); // B에겐 둘 다 새 트윗
    const anon = await getColumnTweets(sql, col.id, { sort: 'views', memberId: null });
    assert.deepEqual(anon.map((t) => t.seenByMe), [false, false]); // 멤버 미선택

    // savedBy: A·B가 같은 트윗을 각자 저장 → 두 명 집계
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 'a'}, ${ws.id}, ${mA.id})`;
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 'a'}, ${ws.id}, ${mB.id})`;
    const withSaved = await getColumnTweets(sql, col.id, { sort: 'views', memberId: mA.id });
    assert.deepEqual(withSaved[0].savedBy.map((m) => m.name).sort(), [P + 'A', P + 'B']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('정렬: date는 tweet_created_at desc', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col2', config: { keywords: ['x'] } });
  try {
    const older = { ...tw('c', 5), tweetCreatedAt: new Date('2026-06-01T00:00:00Z').toISOString() };
    const newer = { ...tw('d', 1), tweetCreatedAt: new Date('2026-07-05T00:00:00Z').toISOString() };
    await upsertTweets(sql, [older, newer]);
    await linkColumnTweets(sql, col.id, [P + 'c', P + 'd']);
    const byDate = await getColumnTweets(sql, col.id, { sort: 'date', memberId: null });
    assert.deepEqual(byDate.map((t) => t.tweetId), [P + 'd', P + 'c']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 4: columnStore 테스트 갱신** — `src/lib/columnStore.test.ts` 전체 교체

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listColumns, createColumn, updateColumn, deleteColumn, touchRefreshed, getColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';

const sql = getSql();
const T = 'test-cs-' + process.pid;

after(async () => {
  await sql`delete from workspace where name like ${T + '%'}`;
  await sql.end();
});

test('CRUD + 워크스페이스 스코프 + touchRefreshed', async () => {
  const ws1 = await createWorkspace(sql, T + '-w1');
  const ws2 = await createWorkspace(sql, T + '-w2');
  try {
    const c = await createColumn(sql, { workspaceId: ws1.id, kind: 'watchlist', title: T, config: { handle: 'h', userId: '1' } });
    assert.equal(c.workspaceId, ws1.id);
    assert.equal(c.lastRefreshedAt, null);

    const u = await updateColumn(sql, c.id, { title: T + '2' });
    assert.equal(u.title, T + '2');

    await touchRefreshed(sql, c.id);
    const got = await getColumn(sql, c.id);
    assert.ok(got && got.lastRefreshedAt);

    assert.ok((await listColumns(sql, ws1.id)).some((x) => x.id === c.id));
    assert.ok(!(await listColumns(sql, ws2.id)).some((x) => x.id === c.id)); // 다른 워크스페이스에선 안 보임

    await deleteColumn(sql, c.id);
    assert.equal(await getColumn(sql, c.id), null);
  } finally {
    await deleteWorkspace(sql, ws1.id);
    await deleteWorkspace(sql, ws2.id);
  }
});
```

- [ ] **Step 5: refreshColumn 테스트 갱신** — `src/lib/refreshColumn.test.ts`에서 (a) `createColumn(sql, { kind, ... })` 호출을 전부 `createColumn(sql, { workspaceId: ws.id, kind, ... })`로, (b) `getColumnTweets(sql, col.id, { sort: 'views', mode: 'all' })` 호출을 `getColumnTweets(sql, col.id, { sort: 'views', memberId: null })`로 바꾸고, (c) 테스트 시작 시 `const ws = await createWorkspace(sql, P + 'ws')` 픽스처를 만들고 finally/after에서 `deleteWorkspace` 정리를 추가한다 (import에 workspaceStore 추가). 검증 어서션 자체는 무변경.

- [ ] **Step 6: 실행 → 통과 확인 + Commit**

Run: `npm test`  Expected: PASS 전건 (suggest·getxapi·mappers·queryBuilder·cooccurrence·format 기존 테스트 포함).
주의: 이 시점엔 라우트·컴포넌트가 아직 구 시그니처라 `npx tsc --noEmit`은 실패해도 된다(Task 4에서 회복). node:test는 tsx 변환이라 스토어 테스트는 돌아간다.

```bash
git add -A && git commit -m "feat(v1.5): stores — workspace scope, per-member seenByMe/savedBy, markSeenBatch"
```

---

### Task 3: candidateStore 개편 (워크스페이스·멤버 스코프)

**Files:**
- Modify: `src/lib/candidateStore.ts`, `src/lib/candidateStore.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 2 스토어 (테스트 픽스처용)
- Produces:
  - `saveCandidate(sql, input: { tweetId: string; workspaceId: string; memberId: string; sourceColumnId?: string | null }): Promise<CandidateRow>`
  - `removeCandidate(sql, input: { tweetId: string; workspaceId: string; memberId: string }): Promise<void>` (removeCandidateByTweetId 대체)
  - `listCandidates(sql, workspaceId: string, opts?: { tag?: string; memberId?: string }): Promise<CandidateRow[]>`
  - `listAllTags(sql, workspaceId: string): Promise<Array<{ id: string; name: string; count: number }>>` — count는 해당 워크스페이스의 후보 기준
  - `setMemo`/`addTag`/`removeTag` 시그니처 유지

- [ ] **Step 1: 실패 테스트 재작성** — `src/lib/candidateStore.test.ts` 전체 교체

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets } from './tweetStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { saveCandidate, removeCandidate, setMemo, addTag, removeTag, listCandidates, listAllTags } from './candidateStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-cd-' + process.pid + '-';

function tw(id: string): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: 'saved ' + id, media: [], quoted: null,
    metrics: { views: 10, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql`delete from tag where name like ${P + '%'}`;
  await sql.end();
});

test('멤버별 저장·중복 허용·필터·태그·워크스페이스 격리', async () => {
  const ws1 = await createWorkspace(sql, P + 'w1');
  const ws2 = await createWorkspace(sql, P + 'w2');
  const mA = await createMember(sql, P + 'A', '#111111');
  const mB = await createMember(sql, P + 'B', '#222222');
  try {
    await upsertTweets(sql, [tw('a'), tw('b')]);

    // 같은 트윗을 A·B가 각자 저장 (중복 허용) — 멱등: 같은 멤버 재저장은 기존 반환
    const cA = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    const cA2 = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    assert.equal(cA.id, cA2.id);
    const cB = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mB.id });
    assert.notEqual(cA.id, cB.id);
    assert.equal(cB.member.name, P + 'B');
    await saveCandidate(sql, { tweetId: P + 'b', workspaceId: ws1.id, memberId: mA.id });

    // 목록: 전체 3건 / 멤버 필터 A→2, B→1 / 다른 워크스페이스 0
    assert.equal((await listCandidates(sql, ws1.id)).length, 3);
    assert.equal((await listCandidates(sql, ws1.id, { memberId: mA.id })).length, 2);
    assert.equal((await listCandidates(sql, ws1.id, { memberId: mB.id })).length, 1);
    assert.equal((await listCandidates(sql, ws2.id)).length, 0);

    // 메모·태그
    await setMemo(sql, cA.id, '포맷 참고');
    const tag = await addTag(sql, cA.id, P + 'tag');
    const withTag = await listCandidates(sql, ws1.id, { tag: P + 'tag' });
    assert.equal(withTag.length, 1);
    assert.equal(withTag[0].memo, '포맷 참고');
    const tags = await listAllTags(sql, ws1.id);
    assert.ok(tags.some((t) => t.name === P + 'tag' && t.count === 1));
    await removeTag(sql, cA.id, tag.id);

    // 자기 것만 해제 — B의 저장은 남음
    await removeCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    const remain = await listCandidates(sql, ws1.id);
    assert.deepEqual(remain.map((c) => c.member.name).sort(), [P + 'A', P + 'B'].sort() && remain.length === 2 ? remain.map((c) => c.member.name).sort() : remain.map((c) => c.member.name).sort());
    assert.equal(remain.length, 2); // b(A) + a(B)
  } finally {
    await deleteWorkspace(sql, ws1.id);
    await deleteWorkspace(sql, ws2.id);
  }
});
```

- [ ] **Step 2: 실행 → 실패 확인**  Run: `node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/candidateStore.test.ts`  Expected: FAIL (구 시그니처)

- [ ] **Step 3: 구현** — `src/lib/candidateStore.ts` 전체 교체

```ts
import type postgres from 'postgres';
import type { CandidateRow } from './types.ts';

async function loadCandidates(
  sql: postgres.Sql,
  where: { id?: string; workspaceId?: string; tag?: string; memberId?: string },
): Promise<CandidateRow[]> {
  const conds: string[] = [];
  const params: string[] = [];
  const add = (fragment: string, value: string) => { params.push(value); conds.push(fragment.replace('?', `$${params.length}`)); };
  if (where.id) add('c.id = ?', where.id);
  if (where.workspaceId) add('c.workspace_id = ?', where.workspaceId);
  if (where.memberId) add('c.member_id = ?', where.memberId);
  if (where.tag) add('exists (select 1 from candidate_tag x join tag g on g.id = x.tag_id where x.candidate_id = c.id and g.name = ?)', where.tag);

  const rows = await sql.unsafe<Array<Record<string, unknown>>>(
    `select c.id, c.memo, c.saved_at, c.source_column_id, c.workspace_id,
            m.id as member_id, m.name as member_name, m.color as member_color,
            t.*,
            coalesce(json_agg(json_build_object('id', tg.id, 'name', tg.name) order by tg.name)
                     filter (where tg.id is not null), '[]') as tags
       from candidate c
       join member m on m.id = c.member_id
       join tweet t on t.tweet_id = c.tweet_id
       left join candidate_tag ctg on ctg.candidate_id = c.id
       left join tag tg on tg.id = ctg.tag_id
      ${conds.length ? 'where ' + conds.join(' and ') : ''}
      group by c.id, m.id, t.tweet_id
      order by c.saved_at desc`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    memo: r.memo as string,
    savedAt: (r.saved_at as Date).toISOString(),
    sourceColumnId: r.source_column_id as string | null,
    workspaceId: r.workspace_id as string,
    member: { id: r.member_id as string, name: r.member_name as string, color: r.member_color as string },
    tags: r.tags as CandidateRow['tags'],
    tweet: {
      tweetId: r.tweet_id as string, authorHandle: r.author_handle as string,
      authorName: r.author_name as string | null, authorAvatarUrl: r.author_avatar_url as string | null,
      authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
      text: r.text as string, media: (r.media ?? []) as CandidateRow['tweet']['media'],
      quoted: r.quoted as CandidateRow['tweet']['quoted'], metrics: r.metrics as CandidateRow['tweet']['metrics'],
      tweetUrl: r.tweet_url as string | null,
      tweetCreatedAt: (r.tweet_created_at as Date | null)?.toISOString() ?? null,
      firstSeenAt: (r.first_seen_at as Date).toISOString(),
      lastFetchedAt: (r.last_fetched_at as Date).toISOString(),
      seenByMe: false,
      savedBy: [{ id: r.member_id as string, name: r.member_name as string, color: r.member_color as string }],
    },
  }));
}

export async function saveCandidate(
  sql: postgres.Sql,
  input: { tweetId: string; workspaceId: string; memberId: string; sourceColumnId?: string | null },
): Promise<CandidateRow> {
  const [row] = await sql<Array<{ id: string }>>`
    insert into candidate (tweet_id, workspace_id, member_id, source_column_id)
    values (${input.tweetId}, ${input.workspaceId}, ${input.memberId}, ${input.sourceColumnId ?? null})
    on conflict (tweet_id, workspace_id, member_id) do update set tweet_id = excluded.tweet_id
    returning id`;
  return (await loadCandidates(sql, { id: row.id }))[0];
}

export async function removeCandidate(
  sql: postgres.Sql,
  input: { tweetId: string; workspaceId: string; memberId: string },
): Promise<void> {
  await sql`delete from candidate where tweet_id = ${input.tweetId} and workspace_id = ${input.workspaceId} and member_id = ${input.memberId}`;
}

export async function setMemo(sql: postgres.Sql, candidateId: string, memo: string): Promise<void> {
  await sql`update candidate set memo = ${memo} where id = ${candidateId}`;
}

export async function addTag(sql: postgres.Sql, candidateId: string, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  const [tag] = await sql<Array<{ id: string; name: string }>>`
    insert into tag (name) values (${trimmed})
    on conflict (name) do update set name = excluded.name
    returning id, name`;
  await sql`insert into candidate_tag (candidate_id, tag_id) values (${candidateId}, ${tag.id}) on conflict do nothing`;
  return tag;
}

export async function removeTag(sql: postgres.Sql, candidateId: string, tagId: string): Promise<void> {
  await sql`delete from candidate_tag where candidate_id = ${candidateId} and tag_id = ${tagId}`;
}

export async function listCandidates(
  sql: postgres.Sql, workspaceId: string, opts?: { tag?: string; memberId?: string },
): Promise<CandidateRow[]> {
  return loadCandidates(sql, { workspaceId, tag: opts?.tag, memberId: opts?.memberId });
}

export async function listAllTags(
  sql: postgres.Sql, workspaceId: string,
): Promise<Array<{ id: string; name: string; count: number }>> {
  const rows = await sql<Array<{ id: string; name: string; count: string }>>`
    select tg.id, tg.name, count(c.id)::text as count
      from tag tg
      left join candidate_tag ctg on ctg.tag_id = tg.id
      left join candidate c on c.id = ctg.candidate_id and c.workspace_id = ${workspaceId}
     group by tg.id order by tg.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
}
```

- [ ] **Step 4: 통과 확인 + Commit**

Run: `npm test`  Expected: PASS 전건

```bash
git add -A && git commit -m "feat(v1.5): candidateStore — workspace/member scope, per-member save & remove"
```

---

### Task 4: API 라우트 개편

**Files:**
- Create: `src/app/api/workspaces/route.ts`, `src/app/api/members/route.ts`, `src/app/api/tweets/seen/route.ts`
- Modify: `src/app/api/columns/route.ts`, `src/app/api/columns/[id]/tweets/route.ts`, `src/app/api/candidates/route.ts`, `src/app/api/tags/route.ts`
- Delete: `src/app/api/columns/[id]/read-all/route.ts`, `src/app/api/tweets/[id]/seen/route.ts`
- 무변경: `columns/[id]/route.ts`(PATCH/DELETE), `columns/[id]/refresh`, `candidates/[id]/*`, `suggest-keywords`, `translate-keyword`, `translate-tags`

**Interfaces:**
- Consumes: Task 1~3 스토어 시그니처
- Produces (HTTP 계약 — Task 5~7 UI가 사용):
  - `GET /api/workspaces` → `Workspace[]` / `POST {name}` → 201 Workspace
  - `GET /api/members` → `Member[]` / `POST {name, color}` → 201 Member
  - `POST /api/tweets/seen {memberId, tweetIds: string[]}` → `{marked: number}`
  - `GET /api/columns?workspaceId=` (필수, 없으면 400) / `POST {workspaceId, kind, title, config}` (workspaceId 필수)
  - `GET /api/columns/:id/tweets?sort=views&memberId=<uuid|생략>` (mode 파라미터 제거)
  - `GET /api/candidates?workspaceId=&tag=&memberId=` (workspaceId 필수) / `POST {tweetId, workspaceId, memberId, sourceColumnId?}` / `DELETE ?tweetId=&workspaceId=&memberId=` (모두 필수)
  - `GET /api/tags?workspaceId=` (필수)

- [ ] **Step 1: 신규 라우트 3종 작성**

`src/app/api/workspaces/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listWorkspaces, createWorkspace } from '@/lib/workspaceStore';

export async function GET() {
  return NextResponse.json(await listWorkspaces(getSql()));
}

export async function POST(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  return NextResponse.json(await createWorkspace(getSql(), name), { status: 201 });
}
```

`src/app/api/members/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listMembers, createMember } from '@/lib/workspaceStore';

export async function GET() {
  return NextResponse.json(await listMembers(getSql()));
}

export async function POST(req: Request) {
  const { name, color } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  try {
    return NextResponse.json(await createMember(getSql(), name, typeof color === 'string' && color ? color : '#1d9bf0'), { status: 201 });
  } catch {
    return NextResponse.json({ error: '이미 있는 이름입니다' }, { status: 409 });
  }
}
```

`src/app/api/tweets/seen/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { markSeenBatch } from '@/lib/tweetStore';

export async function POST(req: Request) {
  const { memberId, tweetIds } = await req.json().catch(() => ({}));
  if (typeof memberId !== 'string' || !Array.isArray(tweetIds) || tweetIds.some((t) => typeof t !== 'string')) {
    return NextResponse.json({ error: 'memberId·tweetIds(string[]) 필수' }, { status: 400 });
  }
  const marked = await markSeenBatch(getSql(), memberId, tweetIds.slice(0, 500));
  return NextResponse.json({ marked });
}
```

- [ ] **Step 2: 기존 라우트 수정**

`src/app/api/columns/route.ts` — GET에 workspaceId 필수, POST 바디에 workspaceId 필수 추가. 기존 kind 검증·watchlist userId 해석 로직은 유지하고, `listColumns(sql)` → `listColumns(sql, workspaceId)`, `createColumn(sql, { kind, ... })` → `createColumn(sql, { workspaceId, kind, ... })`로 바꾼다. GET:
```ts
export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listColumns(getSql(), workspaceId));
}
```
POST 검증 추가(kind 검증 아래):
```ts
if (typeof workspaceId !== 'string' || !workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
```

`src/app/api/columns/[id]/tweets/route.ts` — mode 제거, memberId 추가:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumnTweets } from '@/lib/tweetStore';
import type { SortKey } from '@/lib/types';

const SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets'];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const sort = (SORTS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'views') as SortKey;
  const memberId = sp.get('memberId');
  return NextResponse.json(await getColumnTweets(getSql(), id, { sort, memberId }));
}
```

`src/app/api/candidates/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { saveCandidate, removeCandidate, listCandidates } from '@/lib/candidateStore';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listCandidates(getSql(), workspaceId, {
    tag: sp.get('tag') ?? undefined,
    memberId: sp.get('memberId') ?? undefined,
  }));
}

export async function POST(req: Request) {
  const { tweetId, workspaceId, memberId, sourceColumnId } = await req.json().catch(() => ({}));
  if (!tweetId || !workspaceId || !memberId) return NextResponse.json({ error: 'tweetId·workspaceId·memberId 필수' }, { status: 400 });
  return NextResponse.json(await saveCandidate(getSql(), { tweetId, workspaceId, memberId, sourceColumnId }), { status: 201 });
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tweetId = sp.get('tweetId'), workspaceId = sp.get('workspaceId'), memberId = sp.get('memberId');
  if (!tweetId || !workspaceId || !memberId) return NextResponse.json({ error: 'tweetId·workspaceId·memberId 필수' }, { status: 400 });
  await removeCandidate(getSql(), { tweetId, workspaceId, memberId });
  return NextResponse.json({ ok: true });
}
```

`src/app/api/tags/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listAllTags } from '@/lib/candidateStore';

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listAllTags(getSql(), workspaceId));
}
```

- [ ] **Step 3: 구 라우트 삭제**

```bash
rm src/app/api/columns/[id]/read-all/route.ts src/app/api/tweets/[id]/seen/route.ts
rmdir src/app/api/tweets/[id] 2>/dev/null || true
```

- [ ] **Step 4: 게이트 — 이 시점 tsc는 아직 실패해도 된다 (컴포넌트가 구 타입 사용, Task 5·6에서 회복). 단 라우트 파일 자체의 타입 오류는 없어야 한다.**

Run: `npx tsc --noEmit 2>&1 | grep -v "src/app/page.tsx\|src/app/library\|src/components/" | grep "error" | head`
Expected: 출력 없음 (라우트·lib 오류 0). `npm test` Expected: PASS 전건.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(v1.5): API — workspaces/members/seen-batch routes, workspace-scoped columns/candidates/tags"
```

---

### Task 5: 앱 셸 — 사이드바 · /w/[wsId] 라우팅 · 멤버 컨텍스트

**Files:**
- Create: `src/lib/memberContext.tsx`, `src/components/Sidebar.tsx`, `src/app/w/[wsId]/layout.tsx`, `src/app/w/[wsId]/page.tsx`, `src/app/w/[wsId]/library/page.tsx`, `src/app/w/[wsId]/research/page.tsx`
- Modify: `src/app/page.tsx` (리다이렉트로 교체)
- Delete: `src/app/library/page.tsx`

**Interfaces:**
- Consumes: Task 4 HTTP 계약
- Produces:
  - `useMember(): { member: Member | null; members: Member[]; selectMember(id: string): void; reloadMembers(): Promise<void> }` — Task 6·7 컴포넌트가 사용
  - `<Sidebar wsId={string} />`
  - 이 태스크의 덱·보관함 페이지는 기존 컴포넌트(Column·CandidateCard)를 새 API 계약으로 연결한다. Column·TweetCard·CandidateCard의 내부 개편은 Task 6·7 소관이지만, **이 태스크에서 컴파일이 되도록 최소 수정**(아래 Step 5)을 포함한다.

- [ ] **Step 1: 멤버 컨텍스트** — `src/lib/memberContext.tsx`

```tsx
'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Member } from './types';

interface MemberCtx {
  member: Member | null;
  members: Member[];
  selectMember: (id: string) => void;
  reloadMembers: () => Promise<void>;
}

const Ctx = createContext<MemberCtx>({ member: null, members: [], selectMember: () => {}, reloadMembers: async () => {} });

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);

  const reloadMembers = useCallback(async () => {
    const r = await fetch('/api/members');
    if (r.ok) setMembers(await r.json());
  }, []);

  useEffect(() => {
    reloadMembers();
    setMemberId(localStorage.getItem('cbxdeck-member'));
  }, [reloadMembers]);

  const selectMember = (id: string) => {
    localStorage.setItem('cbxdeck-member', id);
    setMemberId(id);
  };

  const member = members.find((m) => m.id === memberId) ?? null;
  return <Ctx.Provider value={{ member, members, selectMember, reloadMembers }}>{children}</Ctx.Provider>;
}

export const useMember = () => useContext(Ctx);
```

- [ ] **Step 2: 사이드바** — `src/components/Sidebar.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { useMember } from '@/lib/memberContext';

const MEMBER_COLORS = ['#1d9bf0', '#00ba7c', '#f91880', '#7856ff', '#ff7a00', '#ffd400'];

export function Sidebar({ wsId }: { wsId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { member, members, selectMember, reloadMembers } = useMember();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [newWs, setNewWs] = useState('');
  const [newMember, setNewMember] = useState('');
  const [addingWs, setAddingWs] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  useEffect(() => {
    fetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces);
  }, []);

  async function createWs() {
    const name = newWs.trim();
    if (!name) return;
    const r = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.ok) {
      const w = (await r.json()) as Workspace;
      setWorkspaces([...workspaces, w]);
      setNewWs(''); setAddingWs(false);
      router.push(`/w/${w.id}`);
    }
  }

  async function createNewMember() {
    const name = newMember.trim();
    if (!name) return;
    const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
    const r = await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) });
    if (r.ok) {
      const m = await r.json();
      await reloadMembers();
      selectMember(m.id);
      setNewMember(''); setAddingMember(false);
    }
  }

  const nav = [
    { href: `/w/${wsId}/research`, label: '🔍 리서치' },
    { href: `/w/${wsId}`, label: '📊 덱' },
    { href: `/w/${wsId}/library`, label: '📁 보관함' },
  ];
  const item = 'block rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800';

  return (
    <aside className="flex h-screen w-52 shrink-0 flex-col border-r border-gray-200 p-3 dark:border-gray-800">
      <p className="mb-1 px-1 text-[11px] text-gray-400">워크스페이스 (클라이언트)</p>
      <select value={wsId} onChange={(e) => router.push(`/w/${e.target.value}`)}
              className="mb-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {addingWs ? (
        <div className="mb-2 flex gap-1">
          <input value={newWs} onChange={(e) => setNewWs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createWs(); }}
                 placeholder="클라이언트명" autoFocus className="w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-600" />
          <button onClick={createWs} className="text-xs">✓</button>
        </div>
      ) : (
        <button onClick={() => setAddingWs(true)} className="mb-2 px-1 text-left text-xs text-gray-400 hover:text-gray-600">+ 워크스페이스 추가</button>
      )}

      <nav className="mt-2 flex-1">
        {nav.map((n) => (
          <a key={n.href} href={n.href}
             className={`${item} ${pathname === n.href ? 'bg-gray-100 font-bold dark:bg-gray-800' : 'text-gray-600 dark:text-gray-300'}`}>
            {n.label}
          </a>
        ))}
      </nav>

      <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
        <p className="mb-1 px-1 text-[11px] text-gray-400">멤버 (내가 누구인지)</p>
        {!member && <p className="mb-1 px-1 text-[11px] text-amber-600">멤버를 선택해야 저장·봤음이 기록됩니다</p>}
        <select value={member?.id ?? ''} onChange={(e) => e.target.value && selectMember(e.target.value)}
                className="mb-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
          <option value="">— 선택 —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {addingMember ? (
          <div className="flex gap-1">
            <input value={newMember} onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createNewMember(); }}
                   placeholder="이름" autoFocus className="w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-600" />
            <button onClick={createNewMember} className="text-xs">✓</button>
          </div>
        ) : (
          <button onClick={() => setAddingMember(true)} className="px-1 text-left text-xs text-gray-400 hover:text-gray-600">+ 멤버 추가</button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: 셸 레이아웃 + 리서치 슬롯 + 루트 리다이렉트**

`src/app/w/[wsId]/layout.tsx`:
```tsx
'use client';
import { useParams } from 'next/navigation';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  return (
    <MemberProvider>
      <div className="flex h-screen">
        <Sidebar wsId={wsId} />
        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </MemberProvider>
  );
}
```

`src/app/w/[wsId]/research/page.tsx`:
```tsx
export default function ResearchPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-gray-400">
        <p className="text-lg">🔍 리서치</p>
        <p className="mt-2 text-sm">브랜드·경쟁사·분야 리서치로 키워드를 발굴하는 기능이 여기에 들어갑니다 (준비 중)</p>
      </div>
    </div>
  );
}
```

`src/app/page.tsx` 전체 교체:
```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';

export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    fetch('/api/workspaces').then((r) => r.json()).then((ws: Workspace[]) => {
      if (ws[0]) router.replace(`/w/${ws[0].id}`);
    });
  }, [router]);
  return <p className="p-8 text-sm text-gray-400">워크스페이스로 이동 중…</p>;
}
```

- [ ] **Step 4: 덱 페이지 이동** — `src/app/w/[wsId]/page.tsx` (기존 `src/app/page.tsx` 덱 코드를 이관·개편: 상단 nav 제거[사이드바가 대체], workspaceId 연결)

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';

export default function DeckPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);
  const [autoRefreshId, setAutoRefreshId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns?workspaceId=${wsId}`);
    if (r.ok) setColumns(await r.json());
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await fetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { title: v.title, config: v.config } : { ...v, workspaceId: wsId }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    if (!isEdit) setAutoRefreshId(((await r.json()) as ColumnRow).id);
    await load();
  }

  async function remove(col: ColumnRow) {
    if (!confirm(`컬럼 "${col.title}" 삭제? (보관함의 후보는 유지됩니다)`)) return;
    await fetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <button onClick={() => setModal({ mode: 'create' })}
                className="rounded-full border border-gray-300 px-3 py-0.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
          + 컬럼
        </button>
      </div>
      <main className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-sm text-gray-400">컬럼이 없습니다 — “+ 컬럼”으로 검색/워치리스트 컬럼을 만드세요</p>
        )}
        {columns.map((c) => (
          <Column key={c.id} column={c}
                  autoRefresh={c.id === autoRefreshId}
                  onEdit={() => setModal({ mode: 'edit', column: c })}
                  onDelete={() => remove(c)}
                  onPickTag={(tag) => setModal({ mode: 'create', presetKeyword: tag })} />
        ))}
      </main>
      {modal && (
        <ColumnSettings initial={modal.mode === 'edit' ? modal.column : undefined}
                        presetKeyword={modal.presetKeyword}
                        onSubmit={submit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 컴파일 회복을 위한 최소 수정** (본격 개편은 Task 6·7)

1. `src/components/Column.tsx`: `load`의 fetch를 `/api/columns/${column.id}/tweets?sort=${s}` 로(mode 파라미터 제거), `readAll`·`markSeen` 함수와 그 버튼(모두 읽음)·`onMarkSeen` 전달 제거, `visible` 필터를 `tweets.filter((t) => !t.seenByMe)`로.
2. `src/components/TweetCard.tsx`: `t.seenAt` → `t.seenByMe` (dim 조건), `t.isCandidate` → `t.savedBy.length > 0`, `onMarkSeen` prop과 ✓읽음 버튼 제거.
3. `src/components/CandidateCard.tsx`: `{ ...c.tweet, seenAt: null }` → `{ ...c.tweet, seenByMe: false }`, unsave의 DELETE 쿼리에 `&workspaceId=${c.workspaceId}&memberId=${c.member.id}` 추가.
4. `src/app/w/[wsId]/library/page.tsx` 생성 — 기존 `src/app/library/page.tsx` 코드를 복사하되: `useParams`로 wsId를 얻고 fetch를 `/api/candidates?workspaceId=${wsId}...`·`/api/tags?workspaceId=${wsId}`로, 상단 nav(← 덱)는 제거(사이드바 대체). 그 후 `rm src/app/library/page.tsx`.
5. Column의 save/unsave: `useMember()`의 member를 읽어 `POST /api/candidates` 바디에 `workspaceId: column.workspaceId, memberId: member.id` 포함, member 없으면 `setErr('사이드바에서 멤버를 선택하세요')` 후 중단. unsave도 동일 파라미터.

- [ ] **Step 6: 게이트 + Commit**

```bash
npx tsc --noEmit && npm run build && npm test   # 전부 clean/green이어야 함
git add -A && git commit -m "feat(v1.5): app shell — sidebar, /w/[wsId] routing, member context, root redirect"
```

- [ ] **Step 7: 스모크 (dev 서버)**

```bash
# dev 서버 임시 기동 후:
curl -s localhost:3000/ | grep -q "이동 중" && echo ROOT_OK
WS=$(curl -s localhost:3000/api/workspaces | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
curl -s "localhost:3000/w/$WS" -o /dev/null -w "%{http_code}\n"          # 200
curl -s "localhost:3000/w/$WS/library" -o /dev/null -w "%{http_code}\n"  # 200
curl -s "localhost:3000/w/$WS/research" -o /dev/null -w "%{http_code}\n" # 200
```

---

### Task 6: 뷰포트 자동 봤음 + TweetCard/Column 본격 개편

**Files:**
- Create: `src/lib/useSeenTracker.ts`
- Modify: `src/components/TweetCard.tsx`, `src/components/Column.tsx`

**Interfaces:**
- Consumes: `POST /api/tweets/seen`(Task 4), `useMember`(Task 5), `StoredTweet.seenByMe/savedBy`(Task 1)
- Produces:
  - `useSeenTracker(memberId: string | null): { observe: (el: HTMLElement | null) => void }` — data-tweet-id 속성이 있는 요소를 관찰
  - `TweetCardProps`: `{ tweet: StoredTweet; meId?: string | null; observe?: (el: HTMLElement | null) => void; onSave?: (tweetId: string) => void; onUnsave?: (tweetId: string) => void }`

- [ ] **Step 1: 자동 봤음 훅** — `src/lib/useSeenTracker.ts`

```ts
'use client';
import { useEffect, useRef } from 'react';

// 뷰포트 자동 봤음: 50% 이상 노출(긴 카드는 뷰포트 60% 이상 점유)로 1초 체류 → 큐 적재 → 3초마다 배치 전송.
// 이미 봤음(seenByMe)인 카드는 호출부에서 observe하지 않는다.
export function useSeenTracker(memberId: string | null): { observe: (el: HTMLElement | null) => void } {
  const queue = useRef<Set<string>>(new Set());
  const timers = useRef<Map<Element, ReturnType<typeof setTimeout>>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const memberRef = useRef(memberId);
  memberRef.current = memberId;

  useEffect(() => {
    if (!memberId) return; // 멤버 미선택 시 추적 없음
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.tweetId;
        if (!id) continue;
        const visibleEnough = e.intersectionRatio >= 0.5
          || (e.isIntersecting && e.intersectionRect.height >= window.innerHeight * 0.6);
        if (visibleEnough) {
          if (!timers.current.has(e.target)) {
            timers.current.set(e.target, setTimeout(() => {
              queue.current.add(id);
              observer.unobserve(e.target); // 한 번 봤으면 더 관찰 안 함
              timers.current.delete(e.target);
            }, 1000));
          }
        } else {
          const t = timers.current.get(e.target);
          if (t) { clearTimeout(t); timers.current.delete(e.target); }
        }
      }
    }, { threshold: [0, 0.5] });
    observerRef.current = observer;

    const flush = () => {
      if (queue.current.size === 0 || !memberRef.current) return;
      const tweetIds = [...queue.current];
      queue.current.clear();
      fetch('/api/tweets/seen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberRef.current, tweetIds }),
        keepalive: true, // 페이지 이탈 직전 전송도 최대한 보장
      }).catch(() => { tweetIds.forEach((i) => queue.current.add(i)); }); // 실패 시 재큐
    };
    const interval = setInterval(flush, 3000);
    window.addEventListener('beforeunload', flush);

    return () => {
      flush();
      clearInterval(interval);
      window.removeEventListener('beforeunload', flush);
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
      observer.disconnect();
      observerRef.current = null;
    };
  }, [memberId]);

  return {
    observe: (el: HTMLElement | null) => { if (el && observerRef.current) observerRef.current.observe(el); },
  };
}
```

- [ ] **Step 2: TweetCard 개편** — `src/components/TweetCard.tsx`에서 아래 3곳 변경 (X 스타일·지표 바·미디어는 무변경)

1. Props와 article:
```tsx
export interface TweetCardProps {
  tweet: StoredTweet;
  meId?: string | null;
  observe?: (el: HTMLElement | null) => void;
  onSave?: (tweetId: string) => void;
  onUnsave?: (tweetId: string) => void;
}

export function TweetCard({ tweet: t, meId, observe, onSave, onUnsave }: TweetCardProps) {
  const savedByMe = !!meId && t.savedBy.some((m) => m.id === meId);
  return (
    <article
      ref={t.seenByMe ? undefined : observe}
      data-tweet-id={t.tweetId}
      className={`border-b border-[#eff3f4] bg-white px-4 py-3 text-[15px] leading-5 text-[#0f1419] transition-opacity [font-family:-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] ${t.seenByMe ? 'opacity-55 hover:opacity-100' : ''}`}
    >
```
(기존 `hover:bg-[rgba(0,0,0,0.03)]`는 `opacity` hover와 겹치므로 제거하고 위 클래스로 교체)

2. 하단 액션 줄 — ✓읽음 버튼 블록을 삭제하고 저장자 배지 추가:
```tsx
          <div className="mt-2 flex items-center gap-2 text-xs text-[#8b98a5]">
            <span>수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}</span>
            <span className="flex items-center gap-0.5">
              {t.savedBy.map((m) => (
                <span key={m.id} title={`${m.name} 저장`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: m.color }}>
                  {m.name.slice(0, 1)}
                </span>
              ))}
            </span>
            <span className="ml-auto flex gap-1">
              {t.tweetUrl && <a href={t.tweetUrl} target="_blank" className="rounded px-1.5 py-0.5 hover:bg-[#eff3f4]">원문↗</a>}
              {savedByMe
                ? <button onClick={() => onUnsave?.(t.tweetId)} className="rounded px-1.5 py-0.5 text-amber-500 hover:bg-[#eff3f4]">★ 저장됨</button>
                : <button onClick={() => onSave?.(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-[#eff3f4]">☆ 저장</button>}
            </span>
          </div>
```

- [ ] **Step 3: Column 개편** — `src/components/Column.tsx` 변경점

1. import에 `useMember`·`useSeenTracker` 추가, 컴포넌트 상단:
```tsx
  const { member } = useMember();
  const { observe } = useSeenTracker(member?.id ?? null);
```
2. `load`에 memberId 반영 + member 변경 시 재조회:
```tsx
  const load = useCallback(async (s: SortKey) => {
    const r = await fetch(`/api/columns/${column.id}/tweets?sort=${s}${member ? `&memberId=${member.id}` : ''}`);
    if (r.ok) setTweets(await r.json());
  }, [column.id, member]);
```
3. 기본 뷰 = 전체: `useState<ViewMode>('new')` → `useState<ViewMode>('all')`. `visible = mode === 'new' ? tweets.filter((t) => !t.seenByMe) : tweets;` (Task 5에서 이미 seenByMe로 바꿨다면 mode 초기값만 변경)
4. save/unsave에 워크스페이스·멤버 파라미터 (Task 5 Step 5와 동일 — 이미 반영됐으면 유지):
```tsx
  async function save(tweetId: string) {
    if (!member) { setErr('사이드바에서 멤버를 선택하세요'); return; }
    await fetch('/api/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, workspaceId: column.workspaceId, memberId: member.id, sourceColumnId: column.id }) });
    await load(sort);
  }
  async function unsave(tweetId: string) {
    if (!member) return;
    await fetch(`/api/candidates?tweetId=${tweetId}&workspaceId=${column.workspaceId}&memberId=${member.id}`, { method: 'DELETE' });
    await load(sort);
  }
```
5. 카드 렌더:
```tsx
            : visible.map((t) => (
                <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null} observe={observe}
                           onSave={save} onUnsave={unsave} />
              ))}
```

- [ ] **Step 4: 게이트 + Commit**

```bash
npx tsc --noEmit && npm run build && npm test
git add -A && git commit -m "feat(v1.5): viewport auto-seen (50%+1s, batched), dim+hover for seen, saver badges, default all-view"
```

- [ ] **Step 5: 수동 검증 (dev 서버 + 브라우저)** — 아래 3가지 확인 후 결과를 리포트에 기록

1. 멤버 선택 후 덱에서 카드 몇 장이 보이는 상태로 3~5초 대기 → 네트워크에 `POST /api/tweets/seen` 발생, DB `tweet_seen`에 해당 멤버 행 추가
2. 스크롤로 지나치기만 한(1초 미만) 카드와 화면 밖 카드는 기록되지 않음
3. 새로고침 후 본 카드가 흐리게 + hover 시 선명, "새 트윗만" 필터에서 사라짐. 멤버를 다른 사람으로 바꾸면 그 사람 기준으론 여전히 새 트윗

---

### Task 7: 보관함 멤버 필터 + README + 최종 검증

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx`, `src/components/CandidateCard.tsx`, `README.md`

**Interfaces:**
- Consumes: `GET /api/candidates?workspaceId=&memberId=&tag=`, `useMember`, `CandidateRow.member`

- [ ] **Step 1: 보관함에 멤버 필터 추가** — `src/app/w/[wsId]/library/page.tsx` 전체 교체

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CandidateRow } from '@/lib/types';
import { CandidateCard } from '@/components/CandidateCard';
import { useMember } from '@/lib/memberContext';

export default function LibraryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { members } = useMember();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<string | null>(null); // null = 전체

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ workspaceId: wsId });
    if (activeTag) qs.set('tag', activeTag);
    if (activeMember) qs.set('memberId', activeMember);
    const [cr, tr] = await Promise.all([
      fetch(`/api/candidates?${qs}`),
      fetch(`/api/tags?workspaceId=${wsId}`),
    ]);
    if (cr.ok) setCandidates(await cr.json());
    if (tr.ok) setTags(await tr.json());
  }, [wsId, activeTag, activeMember]);
  useEffect(() => { load(); }, [load]);

  const chip = 'rounded-full border px-2 py-0.5 text-xs';
  const on = 'border-gray-900 font-bold dark:border-gray-100';
  const off = 'border-gray-300 text-gray-500 dark:border-gray-700';
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h1 className="font-bold">📁 보관함 <span className="text-sm font-normal text-gray-400">{candidates.length}건</span></h1>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <span className="mr-1 text-[11px] text-gray-400">멤버</span>
        <button onClick={() => setActiveMember(null)} className={`${chip} ${activeMember === null ? on : off}`}>전체</button>
        {members.map((m) => (
          <button key={m.id} onClick={() => setActiveMember(m.id)} className={`${chip} ${activeMember === m.id ? on : off}`}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />{m.name}
          </button>
        ))}
        <span className="ml-3 mr-1 text-[11px] text-gray-400">태그</span>
        <button onClick={() => setActiveTag(null)} className={`${chip} ${activeTag === null ? on : off}`}>전체</button>
        {tags.filter((t) => t.count > 0).map((t) => (
          <button key={t.id} onClick={() => setActiveTag(t.name)} className={`${chip} ${activeTag === t.name ? on : off}`}>
            #{t.name} {t.count}
          </button>
        ))}
      </div>
      <main className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {candidates.length === 0 && <p className="text-sm text-gray-400">저장된 후보가 없습니다 — 덱에서 ☆저장을 누르세요</p>}
        {candidates.map((c) => <CandidateCard key={c.id} c={c} onChanged={load} />)}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: CandidateCard에 저장 멤버 표시** — `src/components/CandidateCard.tsx`의 저장일 줄을 교체 (그 외 무변경 — unsave 파라미터는 Task 5에서 반영됨)

```tsx
        <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ backgroundColor: c.member.color }}>{c.member.name.slice(0, 1)}</span>
          {c.member.name} · 저장 {new Date(c.savedAt).toLocaleDateString('ko-KR')}
        </p>
```
TweetCard 호출부도 새 props로: `<TweetCard tweet={{ ...c.tweet, seenByMe: false }} meId={c.member.id} onUnsave={unsave} />`

- [ ] **Step 3: README 갱신** — 구조 변경 반영: URL 체계(`/w/[wsId]`), 워크스페이스·멤버 개념, 자동 봤음 동작(50%+1초, 멤버별), 저장이 멤버별이라는 것, 마이그레이션 실행법(`npm run migrate`). 기존 실행·비용 섹션 유지.

- [ ] **Step 4: 최종 검증 게이트**

```bash
npm test              # 전건 PASS
npx tsc --noEmit      # clean
npm run build         # clean
```

- [ ] **Step 5: 수동 E2E 체크리스트** (dev 서버)

1. `/` → 기본 워크스페이스 덱으로 리다이렉트, 사이드바 표시
2. 워크스페이스 추가 → 전환 → 빈 덱 확인, 기존 워크스페이스로 돌아오면 기존 컬럼 그대로
3. 멤버 2명 등록(A·B) → A 선택 → 덱 스크롤 → 잠시 후 새로고침하면 본 카드 흐림 → B로 전환하면 같은 카드가 선명(B 기준 새 트윗)
4. A로 트윗 저장 → 카드에 A 색상 배지 → B로 전환해 같은 트윗 저장 → 배지 2개
5. 보관함: 멤버 필터 A/B/전체 동작, 태그 필터 병행 동작, B가 A의 메모 열람 가능
6. A가 자기 저장 해제 → B의 저장은 유지
7. 리서치 메뉴 → 준비 중 페이지 200
8. 컬럼 새로고침(GetXAPI 실호출 1회) → 신규 트윗이 "새 트윗만" 필터에 표시

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(v1.5): library member filter, saver badge, README — UX restructure complete"
```

---

## Self-Review 결과 (계획 작성 후 점검)

- **Spec 커버리지**: §2 IA/사이드바/URL(T5) · §3.1 공유 레이어(T1·T2) · §3.2 멤버별 저장+읽음 버튼 삭제(T3·T5·T6) · §3.3 멤버 식별(T5) · §4 자동 봤음+흐림+기본 전체 뷰(T6) · §5 팀 관점(T6 배지·T7 필터) · §6 마이그레이션(T1) · §8 검증(각 태스크+T7 E2E) — 전부 매핑됨. §7 제외 항목은 어느 태스크에도 없음(의도대로)
- **타입 일관성**: `Member`·`Workspace`(T1) ↔ workspaceStore 반환(T1) ↔ savedBy/CandidateRow.member(T2·T3) ↔ TweetCardProps.meId/observe(T6) ↔ Sidebar/MemberContext(T5) 서명 상호 확인 완료. `getColumnTweets`의 `{sort, memberId}`는 T2 정의·T4 라우트·T5/T6 fetch 모두 동일
- **의도된 중간 상태**: T1~T4 동안 tsc 실패 허용 구간을 각 태스크 게이트에 명시(T5에서 회복). node:test는 tsx 변환이라 스토어 테스트는 태스크별로 green 유지
- **알려진 리스크**: ①클라이언트 컴포넌트에서 useParams 제네릭은 Next 16 문서 확인 필요(AGENTS.md 지침) — 구현자는 `node_modules/next/dist/docs/` 참조 ②IntersectionObserver는 단위테스트 불가 → T6 Step 5 수동 검증으로 게이트 ③기존 로컬 localStorage 태그 번역 캐시(cbxdeck-tag-ko)는 무관하게 유지됨
