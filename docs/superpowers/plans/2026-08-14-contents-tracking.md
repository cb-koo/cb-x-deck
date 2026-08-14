# 콘텐츠 트래킹 v1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/tracking` 페이지 — X 게시물 링크 등록 → 지표 수집 → 추적 목록(최신 지표·새로고침·원고 연결·추적 중단).

**Architecture:** 장부 2권(`tracked_post` + append-only `post_metric_snapshot`) + 수집기 규격(`postMetrics.ts`: ok/unavailable/error 3분기) + 얇은 라우트 + 클라이언트 페이지. 스펙: `docs/superpowers/specs/2026-08-14-contents-tracking-design.md` (구현 전 필독).

**Tech Stack:** Next.js(App Router) · postgres.js(`getSql()`, `sql.begin`) · node:test 실 DB · getxapi 클라이언트(기존).

## Global Constraints

- **이 리포는 훈련 데이터와 다른 Next.js다** — `node_modules/next/dist/docs/` 가이드 확인 후 작성 (AGENTS.md)
- UX 원칙 6개(AGENTS.md) 준수: 라벨은 이득 언어·행동 전 기대 설정·비용 액션 opt-in 등
- 테스트: `node --import tsx --env-file-if-exists=.env --test src/lib/<file>.test.ts` (실 DB, 파일 단위 수 초). 데이터 접두어 `'ttrk' + process.pid`로 만들고 `after()`에서 정리 (influencerStore.test.ts 관례)
- 린트 기준선 24개 — 새 경고 추가 금지 (`npm run lint`)
- 주석은 한국어, "왜"를 적는 기존 밀도를 따른다. 코드 스타일은 이웃 파일과 동일하게
- 마이그레이션 번호는 **027** (026은 보존 브랜치가 프로덕션 DB에 이미 적용)
- 커밋은 태스크마다: `feat(tracking): ...` / 커밋 푸터 관례는 세션 규칙대로
- **.env가 없으면**: `vercel link` 후 `vercel env pull .env --environment=production` (그 전에 `.vercel/project.json`이 cb-x-deck 프로젝트인지 확인 — 엉뚱한 프로젝트 연결 사고 이력 있음)

---

## Task 0: 환경 준비 + 마이그레이션 (오케스트레이터가 인라인 수행)

**Files:** Create: `migrations/027_tracked_post.sql`

- [ ] **Step 1: .env 확보** — `.vercel/project.json` 확인 → 없거나 다르면 `vercel link` → `vercel env pull .env --environment=production`
- [ ] **Step 2: 마이그레이션 작성**

```sql
-- 027: 콘텐츠 트래킹 — 추적 대상 명부 + 지표 스냅샷(append-only).
-- (026은 cb-koo/influencer-db 브랜치의 026이 프로덕션 DB에 적용돼 있어 건너뜀)
-- 설계: docs/superpowers/specs/2026-08-14-contents-tracking-design.md
create table if not exists tracked_post (
  id             uuid primary key default gen_random_uuid(),
  tweet_id       text not null unique,  -- parseTweetLink 정규화 ID. text = 리포 관례 + JS 정밀도(Snowflake > 2^53)
  author_handle  text,                  -- 작성자 = 인플루언서 (핸들 자연키 — draft.influencer_handle 관례)
  text           text not null default '', -- 등록 시점 본문 스냅샷 — 삭제·수정 후에도 기록 보존
  posted_at      timestamptz,           -- 트윗 게시 시각 — 경과 표기·향후 반응 속도 계산의 기준점
  draft_id       uuid references draft(id) on delete set null, -- 선택 연결(원고 삭제돼도 추적 유지)
  source         text not null default 'manual', -- 'manual' | 'auto'(자동 발견 — 자동화 단계)
  unavailable_at timestamptz,           -- 조회 불가 확인 시각(삭제·비공개·정지). null = 정상.
                                        -- deleted_at이 아닌 이유: 삭제로 단정 못 하는 상태 포함 — 이름도 아는 만큼만
  created_by     uuid references member(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- 지표는 덮어쓰지 않고 측정마다 한 줄 추가(append-only) — v1은 최신만 쓰지만
-- 시계열·바이럴 감지 단계가 이 이력을 그대로 쓴다(스키마 변경 0). 리서치로 통례 검증됨.
create table if not exists post_metric_snapshot (
  id              uuid primary key default gen_random_uuid(),
  tracked_post_id uuid not null references tracked_post(id) on delete cascade,
  views           bigint, -- 전 지표 nullable — 수집기 출처별 결손 허용
  likes int, retweets int, replies int, bookmarks int, quotes int,
  raw             jsonb,  -- 원본 API 응답 — 스키마 진화 시 재수집 없이 재처리(리서치: 통례)
  captured_at     timestamptz not null default now()
);
create index if not exists post_metric_snapshot_latest_idx
  on post_metric_snapshot (tracked_post_id, captured_at desc);
```

- [ ] **Step 3: 적용** — `npm run migrate` (멱등). 이후 실 DB 테스트가 이 테이블을 전제한다.
- [ ] **Step 4: Commit** — `git add migrations/027_tracked_post.sql && git commit -m "feat(tracking): 추적 명부·지표 스냅샷 테이블 (027)"`

---

## Task 1: trackingStore — 명부·기록장 읽기/쓰기 (Task 0 후, Task 2와 병렬)

**Files:**
- Create: `src/lib/trackingStore.ts`, `src/lib/trackingStore.test.ts`
- 참조(읽을 것): `src/lib/influencerStore.ts`(스토어 스타일), `src/lib/influencerStore.test.ts`(테스트 스타일), `src/lib/db.ts`

**Interfaces (Produces — 라우트·UI가 이 이름/타입에 의존):**

```ts
export interface PostMetrics {
  views: number | null; likes: number | null; retweets: number | null;
  replies: number | null; bookmarks: number | null; quotes: number | null;
}
export interface TrackedPostRow {
  id: string; tweetId: string; authorHandle: string | null; text: string;
  postedAt: string | null;            // ISO or null
  draftId: string | null;
  draftLabel: string | null;          // coalesce(draft.title, draft.ko_title) — 목록 표시용
  source: string;
  unavailableAt: string | null;       // ISO or null
  createdAt: string;                  // ISO
  metrics: PostMetrics | null;        // 최신 스냅샷 (없으면 null — 이론상 등록=첫 측정이라 항상 있음)
  capturedAt: string | null;          // 최신 스냅샷 시각 (ISO)
}
export function listTrackedPosts(sql: postgres.Sql): Promise<TrackedPostRow[]>;            // created_at desc
export function findByTweetId(sql: postgres.Sql, tweetId: string): Promise<TrackedPostRow | null>;
export function findTrackedPostById(sql: postgres.Sql, id: string): Promise<TrackedPostRow | null>;
export function addTrackedPost(sql: postgres.Sql, args: {
  tweetId: string; authorHandle: string | null; text: string; postedAt: string | null;
  createdBy: string | null; metrics: PostMetrics; raw: unknown;
}): Promise<{ created: boolean; row: TrackedPostRow }>;  // 명부+첫 스냅샷을 sql.begin 한 트랜잭션. tweet_id 충돌 시 created:false + 기존 행
export function appendSnapshot(sql: postgres.Sql, trackedPostId: string,
  metrics: PostMetrics, raw: unknown): Promise<void>;    // 스냅샷 추가 + unavailable_at을 null로(복귀 수용 — 스펙)
export function markUnavailable(sql: postgres.Sql, trackedPostId: string): Promise<void>;  // 이미 기록돼 있으면 시각 유지(최초 확인 시각 보존)
export function setDraftLink(sql: postgres.Sql, trackedPostId: string, draftId: string | null): Promise<boolean>; // false = 행 없음
export function deleteTrackedPost(sql: postgres.Sql, trackedPostId: string): Promise<boolean>;
```

구현 노트:
- 목록 쿼리는 lateral join 또는 `distinct on`으로 최신 스냅샷 1건을 붙인다. 예:
  ```sql
  select tp.*, d.title as draft_title, d.ko_title as draft_ko_title,
         s.views, s.likes, s.retweets, s.replies, s.bookmarks, s.quotes, s.captured_at
  from tracked_post tp
  left join draft d on d.id = tp.draft_id
  left join lateral (
    select * from post_metric_snapshot where tracked_post_id = tp.id
    order by captured_at desc limit 1
  ) s on true
  order by tp.created_at desc
  ```
- `addTrackedPost`: `insert ... on conflict (tweet_id) do nothing returning id` → 빈 결과면 기존 행을 조회해 `created:false` (동시 등록 경합의 최후 방어). 성공 시 같은 트랜잭션에서 스냅샷 insert.
- `markUnavailable`: `set unavailable_at = coalesce(unavailable_at, now())`.
- row 매핑에서 timestamptz → ISO 문자열 변환은 influencerStore의 방식을 따른다.

- [ ] **Step 1: 실패하는 테스트 작성** — `trackingStore.test.ts` (접두어 `const P = 'ttrk' + process.pid`, tweet_id는 `P + '1'` 식 문자열이면 됨 — DB는 형식 검증 안 함):

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  addTrackedPost, listTrackedPosts, findByTweetId, findTrackedPostById,
  appendSnapshot, markUnavailable, setDraftLink, deleteTrackedPost,
} from './trackingStore.ts';

const sql = getSql();
const P = 'ttrk' + process.pid;
const M = { views: 100, likes: 5, retweets: 2, replies: 1, bookmarks: 3, quotes: 0 };

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`; // 스냅샷은 cascade
  await sql.end();
});

test('1) 등록 = 명부+첫 스냅샷, 목록에 최신 지표가 붙는다', async () => {
  const { created, row } = await addTrackedPost(sql, {
    tweetId: P + '1', authorHandle: 'someone', text: '본문', postedAt: new Date().toISOString(),
    createdBy: null, metrics: M, raw: { viewCount: 100 },
  });
  assert.equal(created, true);
  assert.equal(row.metrics!.views, 100);
  const listed = (await listTrackedPosts(sql)).find((r) => r.tweetId === P + '1');
  assert.ok(listed);
  assert.equal(listed!.metrics!.likes, 5);
  assert.equal(listed!.unavailableAt, null);
});

test('2) 같은 tweet_id 재등록은 created:false + 기존 행', async () => {
  await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  const again = await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.equal(again.created, false);
  const snaps = await sql`select id from post_metric_snapshot
    where tracked_post_id = ${again.row.id}`;
  assert.equal(snaps.length, 1); // 중복 등록이 스냅샷을 또 만들지 않는다
});

test('3) 스냅샷 추가 → 최신값 갱신, 볼 수 없음 기록·복귀', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '3', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  await markUnavailable(sql, row.id);
  const dead = await findTrackedPostById(sql, row.id);
  assert.ok(dead!.unavailableAt);
  await markUnavailable(sql, row.id); // 두 번째 호출이 시각을 덮어쓰지 않는다
  assert.equal((await findTrackedPostById(sql, row.id))!.unavailableAt, dead!.unavailableAt);
  await appendSnapshot(sql, row.id, { ...M, views: 999 }, null); // 복귀
  const back = await findTrackedPostById(sql, row.id);
  assert.equal(back!.metrics!.views, 999);
  assert.equal(back!.unavailableAt, null);
});

test('4) 원고 연결·해제, findByTweetId, 삭제 cascade', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '4', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.ok(await findByTweetId(sql, P + '4'));
  assert.equal(await setDraftLink(sql, row.id, null), true);
  assert.equal(await deleteTrackedPost(sql, row.id), true);
  assert.equal(await findByTweetId(sql, P + '4'), null);
  const snaps = await sql`select id from post_metric_snapshot where tracked_post_id = ${row.id}`;
  assert.equal(snaps.length, 0);
  assert.equal(await deleteTrackedPost(sql, row.id), false);
});
```

(원고 연결에 실제 draft가 필요한 케이스는 `insertDraft`(draftStore.ts) 사용 — influencerStore.test.ts가 예시. setDraftLink로 draftId 연결 후 `draftLabel`이 목록에 나오는지 한 케이스 추가.)

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file-if-exists=.env --test src/lib/trackingStore.test.ts` → 모듈 없음 FAIL
- [ ] **Step 3: trackingStore.ts 구현** (위 Interfaces + 구현 노트대로)
- [ ] **Step 4: 통과 확인** — 같은 명령 → 전체 PASS
- [ ] **Step 5: Commit** — `feat(tracking): 추적 명부·기록장 스토어`

---

## Task 2: postMetrics — 수집기 규격 + getxapi 구현 (Task 0 후, Task 1과 병렬)

**Files:**
- Create: `src/lib/postMetrics.ts`, `src/lib/postMetrics.test.ts`
- 참조: `src/lib/getxapi.ts`(클라이언트·fetchImpl 주입), `src/lib/mappers.ts`(num/str·지표 키)

**Interfaces (Produces):**

```ts
import type { RawTweet, GetxapiClient } from './getxapi.ts';
import type { PostMetrics } from './trackingStore.ts';

export interface FetchedPost {
  tweetId: string; authorHandle: string | null; text: string;
  postedAt: string | null;  // ISO
  metrics: PostMetrics; raw: RawTweet;
}
export type FetchPostResult =
  | { kind: 'ok'; post: FetchedPost }
  | { kind: 'unavailable' }              // X가 명시적으로 "없음"(404/400) — 삭제·비공개·정지
  | { kind: 'error' };                   // 통신 실패·5xx 소진 — 판단 불가, 아무것도 저장하지 말 것
export function fetchPost(tweetId: string, client?: GetxapiClient): Promise<FetchPostResult>;
```

구현 노트:
- `client ?? makeClient()`의 `getTweetDetail(tweetId)` 호출.
  - `null` 반환 → `unavailable` (getxapi.ts:82 주석대로 404/400 = 삭제·비공개, 재시도 없음)
  - 예외(GetxapiAuthError 포함) → `console.error` 로그 후 `error` — **unavailable로 절대 격하하지 않는다**
- RawTweet → 지표: mapRawTweet(mappers.ts:50)과 같은 키(`viewCount likeCount retweetCount replyCount quoteCount bookmarkCount`)를 `num()`으로. **mapRawTweet를 통째로 재사용하지 않는다** — 그 함수는 리트윗 제외·핸들 필수 등 덱 정책이 섞여 있음. 필드 추출만 같은 방식으로.
- `authorHandle`: `raw.author.userName`(str), `text`: `str(raw.text) ?? ''`, `postedAt`: `raw.createdAt`을 Date.parse → ISO (mappers.ts toIso 방식).
- 응답이 왔는데 `id`가 없는 기형이면 `error`(판단 불가 쪽 — 스펙: 애매하면 error).

- [ ] **Step 1: 실패하는 테스트 작성** — 가짜 fetch 주입(`new GetxapiClient({ apiKey: 'k', fetchImpl, maxRetries: 0, sleep: async () => {} })`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetxapiClient } from './getxapi.ts';
import { fetchPost } from './postMetrics.ts';

const RAW = {
  id: '123', text: '테스트 본문', createdAt: 'Mon Jul 06 12:00:00 +0000 2026',
  author: { userName: 'someone' },
  viewCount: 1000, likeCount: 10, retweetCount: 2, replyCount: 1, quoteCount: 0, bookmarkCount: 5,
};
const mk = (fn: (u: string) => Promise<Response>) =>
  new GetxapiClient({ apiKey: 'k', maxRetries: 0, sleep: async () => {}, fetchImpl: fn as typeof fetch });

test('ok: 지표 6종·핸들·본문·게시시각 매핑', async () => {
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: RAW }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.post.metrics, { views: 1000, likes: 10, retweets: 2, replies: 1, bookmarks: 5, quotes: 0 });
  assert.equal(r.post.authorHandle, 'someone');
  assert.equal(r.post.postedAt, '2026-07-06T12:00:00.000Z');
});

test('unavailable: 404는 삭제·비공개 — error와 절대 섞이지 않는다', async () => {
  const r = await fetchPost('123', mk(async () => new Response('nf', { status: 404 })));
  assert.equal(r.kind, 'unavailable');
});

test('error: 네트워크 실패는 판단 불가', async () => {
  const r = await fetchPost('123', mk(async () => { throw new Error('conn reset'); }));
  assert.equal(r.kind, 'error');
});

test('error: 5xx 재시도 소진도 판단 불가 — unavailable 아님', async () => {
  const r = await fetchPost('123', mk(async () => new Response('boom', { status: 500 })));
  assert.equal(r.kind, 'error');
});

test('지표 결손은 null로 흡수(ok 유지)', async () => {
  const raw = { ...RAW, viewCount: undefined };
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: raw }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.metrics.views, null);
});
```

주의: `PostMetrics` 타입이 Task 1 소유(trackingStore.ts)라 병렬 작업 중 파일이 아직 없을 수 있다 — 그 경우 postMetrics.ts에 동일 정의를 두고 trackingStore가 완성되면 import로 교체하지 말고, **Task 1이 postMetrics의 것을 import**하도록 조정해도 된다(순환 없음: trackingStore → postMetrics 방향만). 최종 상태: `PostMetrics`는 **postMetrics.ts가 정의·export**, trackingStore가 import.

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file-if-exists=.env --test src/lib/postMetrics.test.ts` → FAIL
- [ ] **Step 3: 구현** (구현 노트대로)
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(tracking): 게시물 지표 수집기 — ok/볼수없음/판단불가 3분기`

---

## Task 3: API 라우트 (Task 1·2 완료 후)

**Files:**
- Create: `src/app/api/tracking/route.ts`, `src/app/api/tracking/[id]/route.ts`, `src/app/api/tracking/[id]/refresh/route.ts`
- 참조: `src/app/api/influencers/route.ts`(게이트·오류 응답 스타일), `src/app/api/drafts/[id]/`(id 라우트 파라미터 처리 — **이 리포의 Next.js는 params가 Promise일 수 있음, 이웃 라우트 방식을 그대로**)

**Interfaces:**
- Consumes: Task 1 스토어 함수 전부, Task 2 `fetchPost`, `parseTweetLink`/`tweetLinkParseMessage`(tweetLink.ts), `requireAllowedUser`/`requireMember`(authGuard.ts), `getSql`(db.ts)
- Produces (UI가 의존):
  - `GET /api/tracking` → `TrackedPostRow[]`
  - `POST /api/tracking` body `{ url: string }` → 200 `{ created: boolean, row: TrackedPostRow }` | 400 `{ error }` (링크 형식) | 404 `{ error: '볼 수 없는 게시물이에요 — 삭제됐거나 비공개일 수 있어요' }` | 502 `{ error: '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요' }`
  - `POST /api/tracking/[id]/refresh` → 200 `{ row: TrackedPostRow }` (ok든 unavailable이든 갱신된 행 반환) | 404 (행 없음) | 502 (error 분기 — **저장 없음**)
  - `PATCH /api/tracking/[id]` body `{ draftId: string | null }` → 200 `{ row }` | 404
  - `DELETE /api/tracking/[id]` → 200 `{ ok: true }` | 404

라우트 코드 (완성형 — route.ts):

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { fetchPost } from '@/lib/postMetrics';
import { addTrackedPost, findByTweetId, listTrackedPosts } from '@/lib/trackingStore';

const UNAVAILABLE = '볼 수 없는 게시물이에요 — 삭제됐거나 비공개일 수 있어요';
const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listTrackedPosts(getSql()));
}

// 등록 = 첫 측정. 링크는 서버에서 재검증한다 — 클라이언트 인라인 검증만 믿지 않는다(같은 파서).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };

  const parsed = parseTweetLink(String(body.url ?? ''));
  if (!parsed.ok) return NextResponse.json({ error: tweetLinkParseMessage(parsed.reason) }, { status: 400 });

  // 이미 추적 중이면 오류가 아니라 정보 — 기존 행을 돌려주고 API 콜도 아낀다(influencers POST 관례).
  const existing = await findByTweetId(sql, parsed.tweetId);
  if (existing) return NextResponse.json({ created: false, row: existing });

  const result = await fetchPost(parsed.tweetId);
  if (result.kind === 'unavailable') return NextResponse.json({ error: UNAVAILABLE }, { status: 404 });
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });

  const { created, row } = await addTrackedPost(sql, {
    tweetId: result.post.tweetId, authorHandle: result.post.authorHandle,
    text: result.post.text, postedAt: result.post.postedAt,
    createdBy: gate.member.id, metrics: result.post.metrics, raw: result.post.raw,
  });
  return NextResponse.json({ created, row });
}
```

refresh 라우트 (완성형 — 분기 규칙이 이 기능의 핵심):

```ts
// ok → 스냅샷 추가(+복귀 수용은 appendSnapshot이 처리) / unavailable → 시각 기록 /
// error → 아무것도 저장하지 않는다. 틀린 기록보다 빈 기록(스펙 §수집 레이어).
export async function POST(req: Request, ctx: /* 이웃 [id] 라우트와 동일 시그니처 */) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const id = /* 이웃 라우트 방식으로 params에서 추출 */;
  const row = await findTrackedPostById(sql, id);
  if (!row) return NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });

  const result = await fetchPost(row.tweetId);
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (result.kind === 'unavailable') await markUnavailable(sql, id);
  else await appendSnapshot(sql, id, result.post.metrics, result.post.raw);
  return NextResponse.json({ row: await findTrackedPostById(sql, id) });
}
```

PATCH/DELETE는 setDraftLink/deleteTrackedPost 위임 + 404 처리 (influencers [id] 라우트 스타일). PATCH의 draftId는 `body.draftId === null` 허용, string이면 uuid 형식 검증은 DB FK에 맡기되 FK 위반은 400으로 변환.

- [ ] **Step 1: 세 라우트 파일 작성** (로직은 전부 lib에 있음 — 라우트는 얇게. 이 리포는 라우트 하네스가 없어 라우트 자체 테스트는 없음: 분기 로직이 전부 Task 1·2에서 테스트됨)
- [ ] **Step 2: 타입·린트 확인** — `npx tsc --noEmit 2>&1 | head`, `npm run lint` (기준선 24 유지)
- [ ] **Step 3: Commit** — `feat(tracking): 등록·목록·새로고침·연결·중단 API`

---

## Task 4: 페이지 UI (Task 3 완료 후)

**Files:**
- Create: `src/app/tracking/layout.tsx`(influencers/layout.tsx와 동일 — GlobalShell), `src/app/tracking/page.tsx`, `src/components/TrackingTable.tsx`, `src/components/TrackAddForm.tsx`
- Modify: `src/components/Sidebar.tsx` — 도구 그룹(인플루언서 다음)에 `{ href: '/tracking', label: '트래킹', Ic: <기존 아이콘 중 선택 또는 이웃 스타일로 신규> }`
- 참조(필독): `src/app/influencers/page.tsx`(목록 페이지 골격·apiFetch·useToast), `src/app/w/[wsId]/library/page.tsx:55-70`(지연 삭제+실행취소 토스트 패턴), `src/components/AddByLinkModal.tsx`(parseTweetLink 인라인 검증 UX), `docs/ui-ux-principles-checklist.md`, `src/lib/format.ts`(숫자 축약 표기가 있으면 재사용), `src/lib/relTime.ts`

**동작 명세 (스펙 §화면 그대로):**
1. **등록 폼**: 입력 + [추적 시작] + 도움말 한 줄 "X 게시물 링크를 붙여넣으면 현재 지표를 가져와 아래 목록에 추가해요". 입력 변화마다 `parseTweetLink` — 실패면 버튼 disabled + `tweetLinkParseMessage` 인라인 표시(AddByLinkModal 방식). 제출: `POST /api/tracking` → `created:false`면 토스트 "이미 추적 중이에요" + 해당 행 하이라이트(행 id로 scrollIntoView + 배경 강조 2초) / 오류면 서버 `error` 문구 토스트 / 성공이면 목록 맨 위 삽입 + 입력 비움.
2. **테이블 열**: 게시물(핸들 + 본문 1줄 말줄임, 클릭 → `tweetPermalink(authorHandle, tweetId)` 새 탭) / 게시(relTime(postedAt, '게시')) / 지표 6종(조회·좋아요·RT·답글·북마크·인용 — null은 '–') / 측정(relTime(capturedAt, '측정')) / 원고(draftLabel 또는 '연결 안 됨' → 클릭 시 연결 UI) / 동작([새로고침] [추적 중단]).
3. **볼 수 없음**: `unavailableAt` 있으면 행에 배지 "볼 수 없음(삭제·비공개 등) · {날짜} 확인" + 지표는 마지막 측정값 유지(흐리게).
4. **행 새로고침**: 버튼 → 스피너 → 응답 row로 교체. 502면 토스트 "지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요"(행 변화 없음 — 영구 딱지 금지).
5. **전체 새로고침**: 툴바 버튼 "전체 새로고침 (N건 — API 호출 N회)" — 볼 수 없음 행 포함(복귀 감지). 순차 호출, 진행 "3/12", 실패 건수는 끝나고 토스트로 집계.
6. **원고 연결**: 행에서 열리는 간단한 선택 UI — `GET /api/drafts`로 목록(제목 라벨), 선택 → PATCH. 해제 버튼 포함. (드롭다운/시트 등 형태는 기존 컴포넌트 관례 중 가장 단순한 것)
7. **추적 중단**: 즉시 DELETE하지 않고 낙관적 숨김 + 실행취소 토스트 ~5초 — library/page.tsx:55의 패턴(레이스 주석 포함)을 그대로 이식. 커밋 시작 순간 토스트 내림.
8. **빈 목록**: "전달한 원고가 게시되면, 게시물 링크를 등록해 반응을 추적하세요. 링크는 X의 공유 → 링크 복사로 얻을 수 있어요."
9. 기본 정렬 최신 등록순(서버가 이미 정렬). 필터·검색 없음.

- [ ] **Step 1: layout.tsx + page.tsx + 컴포넌트 작성** (참조 파일의 마크업·클래스 관례를 그대로 따를 것 — 이 앱은 X 미러링 디자인이 제품 가치)
- [ ] **Step 2: Sidebar 항목 추가**
- [ ] **Step 3: 타입·린트** — `npx tsc --noEmit`, `npm run lint` 기준선 유지
- [ ] **Step 4: Commit** — `feat(tracking): /tracking 페이지 — 등록·목록·새로고침·원고 연결`

---

## Task 5: 통합 검증 (오케스트레이터 인라인)

- [ ] **Step 1: 스모크 (스펙 '열린 검증' 2건)** — `scripts/smoke-getxapi.ts` 관례로 실 트윗 1건·삭제 트윗 1건에 `fetchPost` 호출, ok/unavailable 분기 확인. 경계(200인데 data 없음)가 관찰되면 unavailable→error로 조정
- [ ] **Step 2: 전체 테스트** — `npm test` (~4분)
- [ ] **Step 3: 빌드+로컬 확인** — `npm run build && npm run start -- -p 3001` → `127.0.0.1:3001/tracking` (next dev 금지 — 하이드레이션 조용히 실패 이력)
- [ ] **Step 4: 린트 기준선 24 확인**
- [ ] **Step 5: 사용자 QA 안내** — 화면 확인은 OAuth 게이팅으로 사용자만 가능. 배포는 QA 후 별도 진행

## Self-Review 결과

- 스펙 커버리지: 데이터 모델(T0)·수집(T2)·화면(T4)·API(T3)·테스트(T1·T2·T5)·열린 검증(T5) — 전부 매핑됨
- 타입 일관성: `PostMetrics`는 postMetrics.ts 정의·trackingStore import로 단방향 확정. `TrackedPostRow` 필드명이 라우트·UI 명세와 일치 확인
- 남긴 유연성(의도적): refresh 라우트의 params 추출과 UI 마크업은 "이웃 파일 방식 그대로"로 지정 — 이 리포의 Next.js가 훈련 데이터와 달라, 정확한 시그니처는 이웃 코드가 유일한 진실이기 때문
