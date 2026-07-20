# 컬럼 트윗 개수 배지 + 정렬 방향 토글 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 덱 컬럼 헤더에 정확한 전체 트윗 수 배지를 표시하고, 정렬 기준 옆에 오름/내림차순 토글 버튼을 추가한다.

**Architecture:** DB 계층(`tweetStore.ts`)에 개수 조회 함수와 방향 인자를 추가하고, tweets API 응답을 `{ tweets, total }` 객체로 바꿔 총계를 동봉한다. 프론트(`Column.tsx`)는 `total`/`dir` 상태를 두어 헤더 배지와 방향 토글을 렌더한다. 방향 선택은 기존 `sort`와 동일하게 세션 상태 + config pass-through로 다룬다.

**Tech Stack:** Next.js 16, React 19, TypeScript, postgres.js, node:test(통합 테스트, 실 DB).

## Global Constraints

- 대상 사용자는 비개발 콘텐츠 기획 담당자 — 라벨은 의미를 사용자 언어로, 화살표만으로 모호하지 않게 `title`/`aria-label`에 텍스트 부여 (AGENTS.md 원칙 1·5).
- DB 테스트는 실 DB 통합 테스트다. 테스트 데이터는 `process.pid` 접두사(prefix)로 만들고 `after`에서 반드시 정리한다.
- Next.js는 학습 데이터와 다를 수 있음 — API 코드 수정 전 필요 시 `node_modules/next/dist/docs/` 확인.
- 프론트(`Column.tsx`)·API 라우트는 이 저장소에 단위 테스트 인프라가 없다 — 검증은 `npm run build` + `npm run lint` + 수동 확인으로 한다(정직하게 명시).
- 테스트 실행: 단일 파일은 `node --import tsx --test src/lib/tweetStore.test.ts`. 전체는 `npm test`.
- 커밋 메시지 말미에 붙일 것:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- `src/lib/types.ts` — `SortDir` 타입 추가, `SearchConfig`/`WatchlistConfig`에 `dir?` 추가.
- `src/lib/tweetStore.ts` — `getColumnTweetCount` 신규, `ORDER` → `ORDER_EXPR`(방향 분리), `getColumnTweets`에 `dir` 인자.
- `src/lib/tweetStore.test.ts` — 신규 테스트 파일(개수·방향).
- `src/app/api/columns/[id]/tweets/route.ts` — 응답 `{ tweets, total }`, `dir` 파라미터.
- `src/components/Column.tsx` — `total`/`dir` 상태, load/loadMore 파싱, 헤더 배지, 방향 토글 버튼.
- `src/components/ColumnSettings.tsx` — config에 `dir` pass-through 저장.

---

## Task 1: DB 계층 — 개수 조회 + 정렬 방향

**Files:**
- Modify: `src/lib/types.ts:1` (SortDir 추가), `src/lib/types.ts:8-29` (config에 dir)
- Modify: `src/lib/tweetStore.ts:34-39` (ORDER → ORDER_EXPR), `src/lib/tweetStore.ts:93-121` (getColumnTweets dir), 파일 끝(getColumnTweetCount 추가)
- Test: `src/lib/tweetStore.test.ts` (신규)

**Interfaces:**
- Produces:
  - `type SortDir = 'asc' | 'desc'` (types.ts)
  - `getColumnTweets(sql, columnId, opts: { sort: SortKey; offset?: number; dismissed?: 'exclude' | 'only'; dir?: SortDir }): Promise<StoredTweet[]>` — `dir` 기본 `'desc'`
  - `getColumnTweetCount(sql, columnId, opts?: { dismissed?: 'exclude' | 'only' }): Promise<number>` — 없는 컬럼이면 `0`, `dismissed` 기본 `'exclude'`
- Consumes: `createColumn`(columnStore), `upsertTweets`/`linkColumnTweets`(tweetStore), `createWorkspace`(workspaceStore) — 테스트 세팅용

- [ ] **Step 1: 타입 추가**

`src/lib/types.ts` 1번 라인 아래에 추가:

```ts
export type SortKey = 'views' | 'date' | 'bookmarks' | 'retweets';
export type SortDir = 'asc' | 'desc';
```

`SearchConfig`에 `sort?` 아래 줄(19번 근처)에 추가:

```ts
  sort?: SortKey;              // 기본 'views'
  dir?: SortDir;               // 정렬 방향, 기본 'desc'(높은 순/최신 순)
```

`WatchlistConfig`의 `sort?` 아래(27번 근처)에 추가:

```ts
  sort?: SortKey;
  dir?: SortDir;               // 정렬 방향, 기본 'desc'
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/tweetStore.test.ts` 신규 생성:

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets, getColumnTweetCount } from './tweetStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { createColumn } from './columnStore.ts';
import { dismiss } from './dismissStore.ts';
import { createMember } from './workspaceStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ts-' + process.pid + '-';

// views 값만 다르게 트윗 생성 — 정렬 방향 검증용
function tw(id: string, views: number): DeckTweet {
  return { tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '', media: [], quoted: null,
    metrics: { views, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: null };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('getColumnTweetCount: 전체·dismissed·없는 컬럼', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const m = await createMember(sql, P + 'm', '#111111');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'c',
    config: { keywords: ['k'] } });
  try {
    await upsertTweets(sql, [tw('a', 30), tw('b', 10), tw('c', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b', P + 'c']);

    assert.equal(await getColumnTweetCount(sql, col.id), 3);
    assert.equal(await getColumnTweetCount(sql, 'no-such-column-id'), 0);

    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'a', memberId: m.id });
    assert.equal(await getColumnTweetCount(sql, col.id), 2);                       // exclude 기본
    assert.equal(await getColumnTweetCount(sql, col.id, { dismissed: 'only' }), 1);
  } finally {
    await deleteColumnAndWs(ws.id, col.id);
  }
});

test('getColumnTweets: dir asc/desc 정렬 반전', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'c2',
    config: { keywords: ['k'] } });
  try {
    await upsertTweets(sql, [tw('d1', 30), tw('d2', 10), tw('d3', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'd1', P + 'd2', P + 'd3']);

    const desc = await getColumnTweets(sql, col.id, { sort: 'views' });            // dir 기본 desc
    assert.deepEqual(desc.map((t) => t.metrics.views), [30, 20, 10]);

    const asc = await getColumnTweets(sql, col.id, { sort: 'views', dir: 'asc' });
    assert.deepEqual(asc.map((t) => t.metrics.views), [10, 20, 30]);
  } finally {
    await deleteColumnAndWs(ws.id, col.id);
  }
});

async function deleteColumnAndWs(wsId: string, colId: string) {
  await sql`delete from deck_column where id = ${colId}`;
  await deleteWorkspace(sql, wsId);
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: FAIL — `getColumnTweetCount` is not exported / `dir` 미지원으로 asc 결과가 desc와 동일.

- [ ] **Step 4: ORDER_EXPR로 교체 + getColumnTweets에 dir 추가**

`src/lib/tweetStore.ts` 34-39번 라인의 `ORDER`를 방향 없는 식으로 교체:

```ts
const ORDER_EXPR: Record<SortKey, string> = {
  views: `(t.metrics->>'views')::bigint`,
  date: `t.tweet_created_at`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint`,
  retweets: `(t.metrics->>'retweets')::bigint`,
};
```

`getColumnTweets` 시그니처(94번 라인)의 opts에 `dir` 추가, 본문에서 order by 절 변경:

```ts
export async function getColumnTweets(
  sql: postgres.Sql, columnId: string,
  opts: { sort: SortKey; offset?: number; dismissed?: 'exclude' | 'only'; dir?: SortDir },
): Promise<StoredTweet[]> {
  const [col] = await sql<Array<{ workspace_id: string }>>`select workspace_id from deck_column where id = ${columnId}`;
  if (!col) return [];
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const orderExpr = ORDER_EXPR[opts.sort] ?? ORDER_EXPR.views;
  const orderDir = opts.dir === 'asc' ? 'asc nulls first' : 'desc nulls last';
  const rows = await sql.unsafe<TweetRow[]>(
```

그리고 116번 라인의 `order by ${ORDER[opts.sort] ?? ORDER.views}, t.tweet_id`를 다음으로 교체:

```
      order by ${orderExpr} ${orderDir}, t.tweet_id
```

`SortDir`를 import에 추가 (파일 상단 types import 줄):

```ts
import type { SortKey, SortDir, StoredTweet, DeckTweet } from './types';
```
(기존 import 목록에 맞춰 `SortDir`만 추가 — 실제 줄의 다른 심볼은 그대로 둘 것.)

- [ ] **Step 5: getColumnTweetCount 추가**

`src/lib/tweetStore.ts` 파일 끝(getColumnTweets 함수 뒤)에 추가. `getColumnTweets`와 동일한 조인·dismissed 조건, count만 수행:

```ts
export async function getColumnTweetCount(
  sql: postgres.Sql, columnId: string, opts: { dismissed?: 'exclude' | 'only' } = {},
): Promise<number> {
  const [col] = await sql<Array<{ workspace_id: string }>>`select workspace_id from deck_column where id = ${columnId}`;
  if (!col) return 0;
  const [row] = await sql.unsafe<Array<{ n: string }>>(
    `select count(*)::text as n
       from column_tweet ct
       join tweet t on t.tweet_id = ct.tweet_id
      where ct.column_id = $1
        and ${opts.dismissed === 'only'
              ? `exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`
              : `not exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`}`,
    [columnId, col.workspace_id],
  );
  return Number(row?.n ?? 0);
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/types.ts src/lib/tweetStore.ts src/lib/tweetStore.test.ts
git commit -m "feat(x-research): 컬럼 트윗 개수 조회·정렬 방향 인자 추가 (DB 계층)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: API 라우트 — total 동봉 + dir 파라미터

**Files:**
- Modify: `src/app/api/columns/[id]/tweets/route.ts` (전체)

**Interfaces:**
- Consumes: `getColumnTweets`, `getColumnTweetCount` (Task 1)
- Produces: `GET /api/columns/[id]/tweets?sort=&offset=&dismissed=&dir=` → JSON `{ tweets: StoredTweet[]; total: number }`. `dir`은 `'asc'`만 asc, 그 외/누락은 `'desc'`.

- [ ] **Step 1: 라우트 수정**

`src/app/api/columns/[id]/tweets/route.ts` 전체를 교체:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumnTweets, getColumnTweetCount } from '@/lib/tweetStore';
import type { SortKey } from '@/lib/types';

import { requireAllowedUser } from '@/lib/authGuard';
const SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets'];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const sort = (SORTS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'views') as SortKey;
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  const dismissed = sp.get('dismissed') === 'only' ? 'only' : 'exclude';
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const sql = getSql();
  const [tweets, total] = await Promise.all([
    getColumnTweets(sql, id, { sort, offset, dismissed, dir }),
    getColumnTweetCount(sql, id, { dismissed }),
  ]);
  return NextResponse.json({ tweets, total });
}
```

- [ ] **Step 2: 타입체크 + 빌드 (라우트 단위 테스트 인프라 없음 — build로 검증)**

Run: `npm run lint && npm run build`
Expected: 에러 없이 완료. (라우트 응답 형태는 Task 3의 프론트 수동 확인에서 최종 검증.)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/columns/[id]/tweets/route.ts
git commit -m "feat(x-research): tweets API에 total 동봉·dir 파라미터 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 프론트 — 개수 배지 + 방향 토글 + config 저장

**Files:**
- Modify: `src/components/Column.tsx` (36-37 상태, 97-117 load/loadMore, 182 헤더 배지, 190-197 방향 버튼)
- Modify: `src/components/ColumnSettings.tsx:106,111` (config에 dir pass-through)

**Interfaces:**
- Consumes: `{ tweets, total }` 응답(Task 2), `SortDir`·config `dir`(Task 1)

- [ ] **Step 1: SortDir import + 상태 추가**

`src/components/Column.tsx` 상단 types import에 `SortDir` 추가(기존 import 줄에 심볼만 추가). 그리고 37번 라인(`const [sort, ...]`) 아래에 추가:

```tsx
  const [sort, setSort] = useState<SortKey>(column.config.sort ?? 'views');
  const [dir, setDir] = useState<SortDir>(column.config.dir ?? 'desc');
  const [total, setTotal] = useState(0);
```

- [ ] **Step 2: load/loadMore 파싱을 `{ tweets, total }`로 변경 + dir 반영**

`load` (97-104번 라인)를 교체:

```tsx
  const load = useCallback(async (s: SortKey) => {
    const r = await apiFetch(`/api/columns/${column.id}/tweets?sort=${s}&dir=${dir}${showDismissed ? '&dismissed=only' : ''}`);
    if (r.ok) {
      const res = (await r.json()) as { tweets: StoredTweet[]; total: number };
      setTweets(res.tweets);
      setTotal(res.total);
      setHasMore(res.tweets.length === PAGE); // 꽉 찬 페이지면 뒤에 더 있을 가능성
    }
  }, [column.id, showDismissed, dir]);
```

`loadMore` (107-117번 라인)를 교체:

```tsx
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await apiFetch(`/api/columns/${column.id}/tweets?sort=${sort}&dir=${dir}&offset=${tweets.length}${showDismissed ? '&dismissed=only' : ''}`);
      if (r.ok) {
        const res = (await r.json()) as { tweets: StoredTweet[]; total: number };
        setTweets((prev) => [...prev, ...res.tweets]);
        setTotal(res.total);
        setHasMore(res.tweets.length === PAGE);
      }
    } finally { setLoadingMore(false); }
  }
```

> `load`가 `dir`을 deps에 포함하므로 `useEffect(() => { load(sort); }, [load, sort])`(119번)가 `dir` 변경 시 자동 재조회한다 — 별도 수정 불필요.

- [ ] **Step 3: 헤더에 개수 배지**

`src/components/Column.tsx` 182번 라인 `<h2>` 바로 뒤에 배지 추가:

```tsx
          <h2 className="truncate text-content font-bold">{column.title}</h2>
          {total > 0 && (
            <span className="shrink-0 rounded-full bg-x-text/5 px-1.5 py-0.5 text-caption text-x-muted"
                  title="이 컬럼에 조회된 전체 트윗 수">{total.toLocaleString()}</span>
          )}
```

- [ ] **Step 4: 정렬 방향 토글 버튼**

`src/components/Column.tsx` 197번 라인(정렬 기준 map의 닫는 `))}`) 바로 뒤, 198번 spacer 앞에 방향 토글 추가:

```tsx
          ))}
          <button
            onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            className="rounded px-2 py-1.5 text-ui text-x-secondary hover:bg-x-text/5"
            aria-label={dirLabel(sort, dir)}
            title={dirLabel(sort, dir)}>
            {dir === 'desc' ? '↓' : '↑'}
          </button>
```

그리고 컴포넌트 함수 바깥(파일 내 `SORT_LABEL` 정의 근처, 23번 라인 부근)에 라벨 헬퍼 추가:

```tsx
function dirLabel(sort: SortKey, dir: SortDir): string {
  if (sort === 'date') return dir === 'desc' ? '최신 순 (내림차순)' : '오래된 순 (오름차순)';
  return dir === 'desc' ? '높은 순 (내림차순)' : '낮은 순 (오름차순)';
}
```

- [ ] **Step 5: ColumnSettings에서 dir pass-through 저장**

`src/components/ColumnSettings.tsx` 106번 라인(search config 저장)에서 `sort: init.sort ?? 'views'` 뒤에 `dir` 추가:

```tsx
                    imagesOnly, maxPages: maxPages || 3, sort: init.sort ?? 'views', dir: init.dir ?? 'desc', width: init.width ?? null },
```

111번 라인(watchlist config 저장)도 동일하게 `sort: init.sort ?? 'views'` 뒤에 `dir: init.dir ?? 'desc',` 추가:

```tsx
          config: { handle: handle.replace(/^@/, ''), userId: init.userId ?? '', maxPages: maxPages || 3, sort: init.sort ?? 'views', dir: init.dir ?? 'desc', width: init.width ?? null } });
```

> 참고: `init`은 `column.config` 타입이어야 `init.dir`을 읽을 수 있다. ColumnSettings의 `init` 타입이 `SearchConfig & WatchlistConfig` 병합/부분 타입인지 확인하고, `dir`이 없어 타입 에러가 나면 해당 타입에 `dir` 접근이 가능하도록 맞춘다(Task 1에서 두 config에 `dir?`를 이미 추가했으므로 통상 문제 없음).

- [ ] **Step 6: 빌드 + 린트 (프론트 단위 테스트 인프라 없음)**

Run: `npm run lint && npm run build`
Expected: 에러 없이 완료.

- [ ] **Step 7: 수동 확인 (실제 앱)**

`npm run dev`로 앱을 띄우고 확인:
- 컬럼 헤더 제목 옆에 숫자 배지가 뜨고, 더 불러오기/새로고침 후에도 총계가 유지된다(로드된 수가 아니라 전체 수).
- 정렬 기준 옆 `↓`/`↑` 버튼 클릭 시 목록 순서가 반전되고, 버튼에 마우스를 올리면 "높은 순/낮은 순"(날짜는 "최신/오래된 순") 툴팁이 뜬다.
- 버림(dismissed) 뷰에서 배지 수가 버림 집합 기준으로 바뀐다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/Column.tsx src/components/ColumnSettings.tsx
git commit -m "feat(x-research): 컬럼 헤더 트윗 개수 배지·정렬 방향 토글 UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review 결과

- **Spec 커버리지:** 기능1(개수 배지)=Task1(count)+Task2(total)+Task3(배지); 기능2(방향)=Task1(dir)+Task2(param)+Task3(토글·저장). 에지 케이스(미조회 total=0 → 배지 숨김, dismissed 일관, asc nulls first) 모두 반영. 갭 없음.
- **Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. TODO/TBD 없음. 라우트·프론트 테스트는 저장소에 인프라가 없어 build+lint+수동으로 정직하게 대체(Global Constraints에 명시).
- **타입 일관성:** `SortDir`, `getColumnTweetCount`, `getColumnTweets` opts, `{ tweets, total }` 응답 형태가 Task 1→2→3에서 동일 시그니처로 사용됨.
