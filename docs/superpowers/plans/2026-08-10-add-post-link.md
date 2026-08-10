# 링크로 트윗 추가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** X 트윗 링크를 붙여넣어 팀 보관함에 저장하는 기능 — 보관함 페이지와 레퍼런스 선택창 두 진입점, 공용 모달 하나.

**Architecture:** 링크 파서(순수 함수) → 서버 로직(`addTweetByLink`, 모의 클라이언트로 테스트 가능) → 얇은 라우트(`POST /api/library/from-link`) → 공용 모달(`AddByLinkModal`) → 두 진입점 배선. 저장은 기존 보관함 모델(`ensureLibraryItem`+`saveCandidate`) 그대로 재사용.

**Tech Stack:** Next.js (이 repo의 커스텀 버전 — `node_modules/next/dist/docs/` 참조), postgres.js, node:test + tsx, GetXAPI(`getTweetDetail`).

**스펙:** `docs/superpowers/specs/2026-08-10-add-post-link-design.md`

## Global Constraints

- **`src/app/generate/page.tsx`는 절대 수정하지 않는다** — 머지 대기 중인 `cb-koo/generate-workbench` 브랜치와 충돌. /generate 쪽 변경은 `RefPickerSheet.tsx` 내부로만.
- **/generate에는 ToastProvider가 없다** (`w/[wsId]/layout.tsx`에만 마운트, 밖에서는 no-op) — RefPickerSheet의 사용자 피드백은 토스트가 아니라 인라인 문구로.
- 테스트: `npm test`는 실 DB 사용(약 4분). 단일 파일은 `node --import tsx --env-file-if-exists=.env --test <파일>`(수 초). `.env` 필요 — 없으면 `vercel env pull .env --environment=production`.
- 린트 기준선: repo 전체 경고 24개 존재. **새로 만들거나 수정한 파일은 경고 0이어야 한다**: `npx eslint <파일들>`.
- UI 문구는 AGENTS.md UX 원칙 준수: 라벨=이득 언어, 기대 설정 한 줄, 결과는 판단까지 서술.
- 커밋 메시지는 기존 관례(한국어, `feat(add-link): …` 형태 prefix + 요지).
- UI 코드 주석은 기존 컴포넌트 관례(제약·이유만, 서술형 주석 금지).

## 실행 웨이브 (병렬화)

| 웨이브 | 태스크 | 병렬 | 권장 모델 |
|---|---|---|---|
| A | Task 1 파서 | 단독 | sonnet |
| B | Task 2 서버 로직 ∥ Task 4 모달 | 병렬 (둘 다 Task 1의 파서 인터페이스만 소비) | Task 2: opus · Task 4: opus |
| C | Task 3 라우트 ∥ Task 5 보관함 배선 ∥ Task 6 레퍼런스 선택창 배선 | 병렬 (3은 2에, 5·6은 4에 의존, 서로는 독립 — 수정 파일도 겹치지 않음) | Task 3: sonnet · Task 5: sonnet · Task 6: opus |

---

### Task 1: 트윗 링크 파서

**Files:**
- Modify: `src/lib/tweetLink.ts` (기존 파일 — `tweetPermalink` 조립 함수가 이미 있음, 그 아래에 파싱 추가)
- Test: `src/lib/tweetLink.test.ts` (기존 파일 — `tweetPermalink` 테스트가 이미 있음, 아래에 추가)

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces (Task 2·4가 사용):
  ```ts
  export type TweetLinkParseReason = 'empty' | 'notTweet' | 'invalid';
  export type TweetLinkParse = { ok: true; tweetId: string } | { ok: false; reason: TweetLinkParseReason };
  export function parseTweetLink(input: string): TweetLinkParse;
  export function tweetLinkParseMessage(reason: TweetLinkParseReason): string;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tweetLink.test.ts` 하단에 추가 (기존 import에 `parseTweetLink, tweetLinkParseMessage` 추가):

```ts
test('parseTweetLink: 표준 트윗 링크 — 꼬리·쿼리·서브도메인·스킴 없음 모두 ID로', () => {
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('x.com/hadakan__/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://twitter.com/hadakan__/status/1790123456789012345?s=20&t=abc'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://www.x.com/hadakan__/status/1790123456789012345/photo/1'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('mobile.twitter.com/hadakan__/status/1790123456789012345/video/1'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('  https://x.com/a_b/status/123  '), { ok: true, tweetId: '123' });
});

test('parseTweetLink: X 앱 공유 형태(/i/status, /i/web/status)와 레거시(/statuses)', () => {
  assert.deepEqual(parseTweetLink('https://x.com/i/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://x.com/i/web/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://twitter.com/statuses/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
});

test('parseTweetLink: X 링크지만 트윗이 아니면 notTweet', () => {
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/with_replies'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/search?q=abc'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/status/abc'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/'), { ok: false, reason: 'notTweet' });
});

test('parseTweetLink: X 밖 도메인·형식 오류는 invalid, 빈 입력은 empty', () => {
  assert.deepEqual(parseTweetLink('https://example.com/a/status/123'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink('1790123456789012345'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink('@hadakan__'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseTweetLink('   '), { ok: false, reason: 'empty' });
});

test('tweetLinkParseMessage: 사유별 사용자 문구', () => {
  assert.match(tweetLinkParseMessage('empty'), /링크/);
  assert.match(tweetLinkParseMessage('notTweet'), /공유/);
  assert.match(tweetLinkParseMessage('invalid'), /x\.com/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetLink.test.ts`
Expected: FAIL — `parseTweetLink is not a function` (또는 import 오류)

- [ ] **Step 3: 구현**

`src/lib/tweetLink.ts` 하단에 추가:

```ts
// 역방향: 사용자가 붙여넣은 링크 → 트윗 ID. (조립·파싱 규칙을 이 파일 한 곳에 모은다 — xHandle.ts 관례)
// 클라이언트 인라인 검증과 서버 재검증이 같은 함수를 쓴다.
export type TweetLinkParseReason = 'empty' | 'notTweet' | 'invalid';
export type TweetLinkParse =
  | { ok: true; tweetId: string }
  | { ok: false; reason: TweetLinkParseReason };

const HOSTS = new Set(['x.com', 'twitter.com']);
const SUBDOMAINS = ['www.', 'mobile.', 'm.'];
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ID_RE = /^\d+$/;

export function parseTweetLink(input: string): TweetLinkParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  let host = url.hostname.toLowerCase();
  for (const sub of SUBDOMAINS) if (host.startsWith(sub)) { host = host.slice(sub.length); break; }
  if (!HOSTS.has(host)) return { ok: false, reason: 'invalid' };

  const parts = url.pathname.split('/').filter(Boolean);
  // 표준형 x.com/<계정>/status/<ID> — /photo/1 같은 뒤 꼬리는 무시
  if (parts.length >= 3 && HANDLE_RE.test(parts[0]) && parts[1] === 'status' && ID_RE.test(parts[2]))
    return { ok: true, tweetId: parts[2] };
  // X 앱 "링크 복사"가 주는 형태 두 가지
  if (parts[0] === 'i' && parts[1] === 'status' && parts[2] && ID_RE.test(parts[2]))
    return { ok: true, tweetId: parts[2] };
  if (parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status' && parts[3] && ID_RE.test(parts[3]))
    return { ok: true, tweetId: parts[3] };
  // 레거시 영구링크 x.com/statuses/<ID>
  if (parts[0] === 'statuses' && parts[1] && ID_RE.test(parts[1]))
    return { ok: true, tweetId: parts[1] };
  return { ok: false, reason: 'notTweet' };
}

export function tweetLinkParseMessage(reason: TweetLinkParseReason): string {
  if (reason === 'empty') return '트윗 링크를 넣어주세요';
  if (reason === 'notTweet') return '트윗 주소가 아니에요 — X에서 공유 → 링크 복사한 주소를 붙여넣어주세요 (예: x.com/계정/status/숫자)';
  return 'X 트윗 주소가 아니에요 — x.com 또는 twitter.com 링크를 붙여넣어주세요';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetLink.test.ts`
Expected: PASS (기존 `tweetPermalink` 테스트 포함 전부)

- [ ] **Step 5: 린트 + 커밋**

```bash
npx eslint src/lib/tweetLink.ts src/lib/tweetLink.test.ts
git add src/lib/tweetLink.ts src/lib/tweetLink.test.ts
git commit -m "feat(add-link): 트윗 링크 파서 — 표준·/i/status·레거시 형태를 ID로"
```

---

### Task 2: 서버 로직 `addTweetByLink`

**Files:**
- Create: `src/lib/addByLink.ts`
- Test: `src/lib/addByLink.test.ts`

**Interfaces:**
- Consumes: Task 1의 `parseTweetLink`, 기존 `mapRawTweet`(mappers.ts) · `upsertTweets`(tweetStore.ts) · `enrichQuoted`(quotedEnrich.ts) · `ensureLibraryItem`/`saveCandidate`/`setMemo`(candidateStore.ts)
- Produces (Task 3이 사용):
  ```ts
  export type AddByLinkResult =
    | { ok: true; tweetId: string; alreadyInLibrary: boolean }
    | { ok: false; error: 'parse'; reason: TweetLinkParseReason }
    | { ok: false; error: 'notFound' };
  export async function addTweetByLink(
    sql: postgres.Sql,
    client: Pick<GetxapiClient, 'getTweetDetail'>,
    input: { url: string; workspaceId: string; memberId: string; memo?: string },
  ): Promise<AddByLinkResult>;
  ```
  GetXAPI 장애(재시도 소진·인증 오류)는 잡지 않고 그대로 throw — 라우트가 502로 변환.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/addByLink.test.ts` 신규. 관례: `quotedEnrich.test.ts`의 fakeClient + `candidateStore.test.ts`의 실 DB 픽스처. **트윗 ID는 숫자여야 한다**(파서가 숫자만 통과) — 실존 트윗 ID(스노우플레이크, 1로 시작하는 19자리)와 겹치지 않게 `99` + pid 접두 숫자를 쓴다.

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { addTweetByLink } from './addByLink.ts';
import { createWorkspace, createMember } from './workspaceStore.ts';
import type { RawTweet } from './getxapi.ts';

const sql = getSql();
const P = `99${process.pid}`;              // 숫자 트윗 ID 접두 (실존 ID는 1로 시작하는 19자리 — 충돌 없음)
const NP = 'test-abl-' + process.pid + '-'; // 워크스페이스·멤버 이름 접두

function rawDetail(id: string, extra: Record<string, unknown> = {}): RawTweet {
  return {
    id, text: 'detail body ' + id, createdAt: 'Sun Jul 05 01:00:00 +0000 2026',
    author: { userName: 'abl_user', name: '작성자', profilePicture: 'https://a/p.jpg', followers: 3 },
    media: [], likeCount: 5, viewCount: 100,
    url: `https://x.com/abl_user/status/${id}`,
    ...extra,
  };
}

function fakeClient(behavior: Record<string, RawTweet | null | Error>) {
  const calls: string[] = [];
  return {
    calls,
    getTweetDetail: async (id: string) => {
      calls.push(id);
      const b = behavior[id];
      if (b instanceof Error) throw b;
      return b ?? null;
    },
  };
}

after(async () => {
  await sql`delete from candidate where tweet_id like ${P + '%'}`;
  await sql`delete from library_item where tweet_id like ${P + '%'}`;
  await sql`delete from quoted_tweet where id like ${P + '%'}`;
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${NP + '%'}`;
  await sql`delete from member where name like ${NP + '%'}`;
  await sql.end();
});

test('정상 저장: 트윗 upsert + library_item + candidate(★) 생성, 메모 반영', async () => {
  const ws = await createWorkspace(sql, NP + 'w1');
  const m = await createMember(sql, NP + 'A', '#111111');
  const id = P + '01';
  const c = fakeClient({ [id]: rawDetail(id) });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${id}`, workspaceId: ws.id, memberId: m.id, memo: '톤이 좋다',
  });
  assert.deepEqual(r, { ok: true, tweetId: id, alreadyInLibrary: false });
  assert.deepEqual(c.calls, [id]);

  const [t] = await sql`select text from tweet where tweet_id = ${id}`;
  assert.equal(t.text, 'detail body ' + id);
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id} and tweet_id = ${id}`;
  assert.equal(li.count, 1);
  const [cand] = await sql`select memo from candidate where workspace_id = ${ws.id} and tweet_id = ${id} and member_id = ${m.id}`;
  assert.equal(cand.memo, '톤이 좋다');
});

test('중복 추가: 두 번째 호출은 alreadyInLibrary=true, 행은 늘지 않는다', async () => {
  const ws = await createWorkspace(sql, NP + 'w2');
  const m = await createMember(sql, NP + 'B', '#222222');
  const id = P + '02';
  const c = fakeClient({ [id]: rawDetail(id) });
  const url = `https://x.com/abl_user/status/${id}`;

  const r1 = await addTweetByLink(sql, c, { url, workspaceId: ws.id, memberId: m.id });
  const r2 = await addTweetByLink(sql, c, { url, workspaceId: ws.id, memberId: m.id });
  assert.equal(r1.ok && r1.alreadyInLibrary, false);
  assert.equal(r2.ok && r2.alreadyInLibrary, true);
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id} and tweet_id = ${id}`;
  assert.equal(li.count, 1);
});

test('리포스트 링크: 원본 트윗을 대신 저장한다', async () => {
  const ws = await createWorkspace(sql, NP + 'w3');
  const m = await createMember(sql, NP + 'C', '#333333');
  const rtId = P + '03';       // 사용자가 붙여넣은 RT의 ID
  const origId = P + '04';     // 원본
  const c = fakeClient({ [rtId]: rawDetail(rtId, { retweeted_tweet: rawDetail(origId) }) });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${rtId}`, workspaceId: ws.id, memberId: m.id,
  });
  assert.deepEqual(r, { ok: true, tweetId: origId, alreadyInLibrary: false });
  const li = await sql`select tweet_id from library_item where workspace_id = ${ws.id}`;
  assert.equal(li[0].tweet_id, origId);
});

test('인용 트윗 포함: 인용 원문을 quoted_tweet 캐시에 보강한다', async () => {
  const ws = await createWorkspace(sql, NP + 'w4');
  const m = await createMember(sql, NP + 'D', '#444444');
  const id = P + '05';
  const qId = P + '06';
  const c = fakeClient({
    [id]: rawDetail(id, { quoted_tweet: { id: qId, text: 'quoted', user: { name: '인용작성자', screen_name: 'qq' } } }),
    [qId]: rawDetail(qId),
  });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${id}`, workspaceId: ws.id, memberId: m.id,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(c.calls, [id, qId]); // 본체 1콜 + 인용 보강 1콜
  const q = await sql`select 1 from quoted_tweet where id = ${qId} and status = 'ok'`;
  assert.equal(q.count, 1);
});

test('삭제·비공개(detail null)와 파싱 실패는 저장 없이 오류 반환', async () => {
  const ws = await createWorkspace(sql, NP + 'w5');
  const m = await createMember(sql, NP + 'E', '#555555');
  const gone = P + '07';
  const c = fakeClient({}); // 모든 ID에 null

  assert.deepEqual(
    await addTweetByLink(sql, c, { url: `https://x.com/abl_user/status/${gone}`, workspaceId: ws.id, memberId: m.id }),
    { ok: false, error: 'notFound' });
  assert.deepEqual(
    await addTweetByLink(sql, c, { url: 'https://x.com/abl_user', workspaceId: ws.id, memberId: m.id }),
    { ok: false, error: 'parse', reason: 'notTweet' });
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id}`;
  assert.equal(li.count, 0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/addByLink.test.ts`
Expected: FAIL — `Cannot find module './addByLink.ts'`

- [ ] **Step 3: 구현**

`src/lib/addByLink.ts` 신규:

```ts
import type postgres from 'postgres';
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';
import { upsertTweets } from './tweetStore.ts';
import { enrichQuoted } from './quotedEnrich.ts';
import { ensureLibraryItem, saveCandidate, setMemo } from './candidateStore.ts';
import { parseTweetLink, type TweetLinkParseReason } from './tweetLink.ts';

// 링크로 트윗 추가 — 덱 수집을 거치지 않고 보관함에 직접 넣는 유일한 경로 (스펙 2026-08-10).
// 저장은 기존 ☆ 저장과 같은 순서(ensureLibraryItem → saveCandidate)라 보관함·레퍼런스 화면에 그대로 잡힌다.
export type AddByLinkResult =
  | { ok: true; tweetId: string; alreadyInLibrary: boolean }
  | { ok: false; error: 'parse'; reason: TweetLinkParseReason }
  | { ok: false; error: 'notFound' };

export async function addTweetByLink(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'getTweetDetail'>,
  input: { url: string; workspaceId: string; memberId: string; memo?: string },
): Promise<AddByLinkResult> {
  const parsed = parseTweetLink(input.url);
  if (!parsed.ok) return { ok: false, error: 'parse', reason: parsed.reason };

  const raw = await client.getTweetDetail(parsed.tweetId); // 삭제·비공개는 null (getxapi.ts)
  if (!raw) return { ok: false, error: 'notFound' };
  // 리포스트 링크는 원본으로 — mapRawTweet이 순수 RT를 버리는 정책(mappers.ts)과 일관
  const effective = (raw.retweeted_tweet as RawTweet | undefined) ?? raw;
  const tweet = mapRawTweet(effective);
  if (!tweet) return { ok: false, error: 'notFound' };

  await upsertTweets(sql, [tweet]); // 이미 있으면 최신 지표로 갱신
  if (tweet.quoted) await enrichQuoted(sql, client, [tweet.quoted.id], { cap: 1 }); // 베스트 에포트(내부에서 실패 삼킴)

  const dup = await sql`select 1 from library_item where workspace_id = ${input.workspaceId} and tweet_id = ${tweet.tweetId}`;
  await ensureLibraryItem(sql, { workspaceId: input.workspaceId, tweetId: tweet.tweetId, addedBy: input.memberId });
  const cand = await saveCandidate(sql, {
    tweetId: tweet.tweetId, workspaceId: input.workspaceId, memberId: input.memberId, sourceColumnId: null,
  });
  const memo = input.memo?.trim();
  if (memo) await setMemo(sql, cand.id, memo, input.memberId);
  return { ok: true, tweetId: tweet.tweetId, alreadyInLibrary: dup.count > 0 };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/addByLink.test.ts`
Expected: PASS (5개 테스트)

- [ ] **Step 5: 린트 + 커밋**

```bash
npx eslint src/lib/addByLink.ts src/lib/addByLink.test.ts
git add src/lib/addByLink.ts src/lib/addByLink.test.ts
git commit -m "feat(add-link): addTweetByLink 서버 로직 — 단건 조회→보관함 저장, RT 원본 대체·인용 보강·메모"
```

---

### Task 3: 라우트 `POST /api/library/from-link`

**Files:**
- Create: `src/app/api/library/from-link/route.ts`
- 참고(수정 아님): `src/app/api/candidates/route.ts` (requireMember 관례), `src/app/api/library/route.ts`

**Interfaces:**
- Consumes: Task 2의 `addTweetByLink`, 기존 `makeClient`(getxapi.ts) · `requireMember`(authGuard.ts) · `tweetLinkParseMessage`(tweetLink.ts)
- Produces (Task 4가 호출하는 HTTP 계약):
  - `POST /api/library/from-link` body `{ url: string; workspaceId: string; memo?: string }`
  - 201 `{ tweetId: string; alreadyInLibrary: boolean }`
  - 400 `{ error: string }` (형식 오류·파싱 실패, 문구는 사용자 언어)
  - 404 `{ error: '삭제됐거나 볼 수 없는 트윗이에요 — 링크를 확인해주세요' }`
  - 502 `{ error: 'X에서 트윗을 가져오지 못했어요 — 잠시 후 다시 시도해주세요' }`

- [ ] **Step 1: 구현** (라우트 테스트 하네스는 이 repo에 없음 — 기존 검증 실무. 로직은 Task 2 테스트가 커버, 라우트는 얇게)

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { makeClient } from '@/lib/getxapi';
import { addTweetByLink } from '@/lib/addByLink';
import { tweetLinkParseMessage } from '@/lib/tweetLink';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { url, workspaceId, memo } = await req.json().catch(() => ({}));
  if (typeof url !== 'string' || typeof workspaceId !== 'string' || !workspaceId)
    return NextResponse.json({ error: 'url·workspaceId 필수' }, { status: 400 });
  try {
    const r = await addTweetByLink(getSql(), makeClient(), {
      url, workspaceId, memberId: gate.member.id, // memberId는 서버 해석 — 클라이언트 body 무시(위조 차단, 저장 API 관례)
      memo: typeof memo === 'string' ? memo : undefined,
    });
    if (!r.ok) {
      if (r.error === 'parse') return NextResponse.json({ error: tweetLinkParseMessage(r.reason) }, { status: 400 });
      return NextResponse.json({ error: '삭제됐거나 볼 수 없는 트윗이에요 — 링크를 확인해주세요' }, { status: 404 });
    }
    return NextResponse.json({ tweetId: r.tweetId, alreadyInLibrary: r.alreadyInLibrary }, { status: 201 });
  } catch {
    // GetXAPI 장애(재시도 소진·키 문제) — 사용자에겐 재시도 안내, 입력은 클라이언트가 보존
    return NextResponse.json({ error: 'X에서 트윗을 가져오지 못했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/app/api/library/from-link/route.ts
```
Expected: 오류 0 (tsc는 repo 기존 오류가 있다면 이 파일 관련 오류만 0인지 확인)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/library/from-link/route.ts
git commit -m "feat(add-link): POST /api/library/from-link — 얇은 라우트, 오류를 사용자 문구로"
```

---

### Task 4: 공용 모달 `AddByLinkModal`

**Files:**
- Create: `src/components/AddByLinkModal.tsx`
- 참고(수정 아님): `src/components/ColumnSettings.tsx` (모달 셸·인라인 검증 선례), `src/components/TweetCard.tsx:203-239` (메모 캡처 선례), `src/components/ui.tsx` (Button)

**Interfaces:**
- Consumes: Task 1의 `parseTweetLink`/`tweetLinkParseMessage`, Task 3의 HTTP 계약, 기존 `apiFetch` · `Button` · `GET /api/workspaces`(→ `[{ id, name, … }]` 배열)
- Produces (Task 5·6이 사용):
  ```tsx
  export interface AddedByLink { tweetId: string; alreadyInLibrary: boolean; workspaceId: string }
  export function AddByLinkModal(props: {
    open: boolean; onClose: () => void;
    fixedWsId?: string;            // 보관함 진입: 워크스페이스 고정(드롭다운 없음)
    defaultWsId?: string | null;   // 레퍼런스 선택창 진입: 드롭다운 기본값(최근 방문)
    onAdded: (r: AddedByLink) => void;  // 성공 시 호출 — 모달은 스스로 닫힌다
  }): React.ReactNode;
  ```

- [ ] **Step 1: 구현**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';

export interface AddedByLink { tweetId: string; alreadyInLibrary: boolean; workspaceId: string }

// 링크로 트윗 추가 — 보관함 페이지·레퍼런스 선택창 공용 (스펙 2026-08-10 §③).
// z-50: RefPickerSheet(z-40) 위에 뜨는 진입점이 있다.
export function AddByLinkModal({ open, onClose, fixedWsId, defaultWsId, onAdded }: {
  open: boolean; onClose: () => void;
  fixedWsId?: string; defaultWsId?: string | null;
  onAdded: (r: AddedByLink) => void;
}) {
  const [url, setUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [wsId, setWsId] = useState(fixedWsId ?? defaultWsId ?? '');
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때마다 초기화(모달 재사용, ColumnSettings 관례)
  useEffect(() => { if (open) { setUrl(''); setMemo(''); setServerErr(null); setWsId(fixedWsId ?? defaultWsId ?? ''); } }, [open, fixedWsId, defaultWsId]);
  useEffect(() => {
    if (!open || fixedWsId) return; // 드롭다운은 레퍼런스 선택창 진입에서만
    apiFetch('/api/workspaces').then((r) => r.json()).then((list: Array<{ id: string; name: string }>) => {
      setWorkspaces(list);
      setWsId((cur) => (cur && list.some((w) => w.id === cur) ? cur : (list[0]?.id ?? '')));
    });
  }, [open, fixedWsId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const parsed = parseTweetLink(url);
  const showParseErr = url.trim().length > 0 && !parsed.ok && parsed.reason !== 'empty';

  async function submit() {
    if (!parsed.ok || !wsId || busy) return;
    setBusy(true); setServerErr(null);
    try {
      const res = await apiFetch('/api/library/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, workspaceId: wsId, ...(memo.trim() ? { memo: memo.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setServerErr(data.error ?? '추가하지 못했어요 — 잠시 후 다시 시도해주세요'); return; } // 실패 시 입력 보존
      onAdded({ tweetId: data.tweetId, alreadyInLibrary: data.alreadyInLibrary, workspaceId: wsId });
      onClose();
    } catch {
      setServerErr('추가하지 못했어요 — 네트워크를 확인하고 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="링크로 트윗 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">링크로 트윗 추가</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        <label htmlFor="add-link-url" className="mt-3 block text-caption text-x-muted">트윗 링크</label>
        <input id="add-link-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…"
               className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
        <p className="mt-1 text-caption text-x-muted">X에서 공유 → 링크 복사한 주소를 붙여넣으면 팀 보관함에 저장돼요</p>
        {showParseErr && <p className="mt-1 text-caption text-red-600">{tweetLinkParseMessage(parsed.ok ? 'invalid' : parsed.reason)}</p>}

        {!fixedWsId && (
          <>
            <label htmlFor="add-link-ws" className="mt-3 block text-caption text-x-muted">저장할 워크스페이스</label>
            <select id="add-link-ws" value={wsId} onChange={(e) => setWsId(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue">
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}

        <label htmlFor="add-link-memo" className="mt-3 block text-caption text-x-muted">
          메모 남기기 <span className="text-x-muted">(선택 · 이 트윗의 어떤 점이 좋았는지 — 원고 생성 때 참고돼요)</span>
        </label>
        <input id="add-link-memo" value={memo} onChange={(e) => setMemo(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="예: 후킹 문장 구조가 좋음"
               className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />

        {serverErr && <p className="mt-2 text-caption text-red-600">{serverErr}</p>}

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!parsed.ok || !wsId || busy}>
            {busy ? '가져오는 중…' : '보관함에 추가'}
          </Button>
          <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}
```

참고: `Button`(ui.tsx)은 `ButtonHTMLAttributes`를 스프레드로 받아 `disabled`를 지원하며 `disabled:opacity-50` 스타일이 이미 있다 — 그대로 쓰면 된다.

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/components/AddByLinkModal.tsx
```
Expected: 이 파일 관련 오류·경고 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/AddByLinkModal.tsx
git commit -m "feat(add-link): 링크로 트윗 추가 공용 모달 — 인라인 검증·선택 메모·워크스페이스 드롭다운"
```

---

### Task 5: 보관함 페이지 배선

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx` (헤더는 104-110행 부근 — `📁 보관함` h1과 뷰 토글이 있는 행)

**Interfaces:**
- Consumes: Task 4의 `AddByLinkModal`/`AddedByLink`, 기존 `useToast`(이 페이지는 ToastProvider 범위 안), 기존 `load()` 콜백
- Produces: 없음 (말단 UI)

- [ ] **Step 1: 구현**

1. import 추가:
```tsx
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
```
2. 상태 추가 (기존 state 선언부에):
```tsx
const [addOpen, setAddOpen] = useState(false);
```
3. 성공 핸들러 (컴포넌트 본문, `load` 아래):
```tsx
// 링크 추가 성공 — 결과를 판단까지 서술(UX 원칙 3): 중복이면 ★ 표시만 갱신됐음을 알린다
const handleAdded = useCallback((r: AddedByLink) => {
  void load();
  show(r.alreadyInLibrary ? '이미 보관함에 있어요 — 내 저장(★)으로 표시했어요' : '보관함에 추가했어요');
}, [load, show]);
```
4. 헤더 우측(뷰 토글 버튼 그룹 앞)에 버튼 추가 — 기존 헤더 구조:
```tsx
<div className="flex gap-1">
  <button onClick={() => setAddOpen(true)} className={`${chip} ${off}`}>🔗 링크로 추가</button>
  <button onClick={() => setView('tweets')} …기존…>트윗</button>
  <button onClick={() => setView('scouts')} …기존…>섭외 후보</button>
</div>
```
5. 페이지 JSX 최하단(닫는 태그 직전)에 모달 마운트:
```tsx
<AddByLinkModal open={addOpen} onClose={() => setAddOpen(false)} fixedWsId={wsId} onAdded={handleAdded} />
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint "src/app/w/[wsId]/library/page.tsx"
```
Expected: 이 파일 관련 오류·경고 0

- [ ] **Step 3: 커밋**

```bash
git add "src/app/w/[wsId]/library/page.tsx"
git commit -m "feat(add-link): 보관함 헤더에 링크로 추가 — 성공 시 목록 갱신+결과 토스트"
```

---

### Task 6: 레퍼런스 선택창(RefPickerSheet) 배선

**Files:**
- Modify: `src/components/RefPickerSheet.tsx`
- **금지: `src/app/generate/page.tsx` 수정** (워크벤치 브랜치 충돌 — Global Constraints)

**Interfaces:**
- Consumes: Task 4의 `AddByLinkModal`/`AddedByLink`, 기존 `MAX_REFS_UI` · `cacheRef` · `sel`/`setSel` · reload effect
- Produces: 없음 (말단 UI)

**설계 메모:** /generate에는 ToastProvider가 없다 — 피드백은 시트 하단 바의 **인라인 문구**로. 자동 선택은 즉시(setSel), 목록 갱신은 reloadKey로 재조회. 재조회 완료 전에 "적용"을 누르면 새 트윗 row가 아직 캐시에 없어 그 건만 빠질 수 있는데, 추가 직후 즉시 적용은 드물고 다음 재조회로 자연 회복되는 허용 트레이드오프.

- [ ] **Step 1: 구현**

1. import 추가:
```tsx
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
```
2. 상태 추가 (기존 state 선언부에):
```tsx
const [addOpen, setAddOpen] = useState(false);
const [reloadKey, setReloadKey] = useState(0);
const [addNotice, setAddNotice] = useState<string | null>(null); // /generate엔 토스트가 없다 — 인라인 안내
```
3. 목록 재조회 effect(38-49행)의 deps에 `reloadKey` 추가:
```tsx
  }, [open, scope, lastWsId, loadCached, reloadKey]);
```
4. 시트 열 때 초기화하는 effect(34행)에 안내 초기화 추가:
```tsx
useEffect(() => { if (open) { setSel(selectedIds); setQuery(''); setSortKey('default'); setAddNotice(null); } }, [open, selectedIds]);
```
5. 성공 핸들러 (컴포넌트 본문 `toggle` 아래):
```tsx
// 링크 추가 성공 — 선택은 즉시, 목록은 재조회로. 결과는 판단까지 서술(UX 원칙 3).
function handleAdded(r: AddedByLink) {
  const saved = r.alreadyInLibrary ? '이미 보관함에 있어요' : '보관함에 추가했어요';
  if (sel.includes(r.tweetId)) setAddNotice(`${saved} — 이미 선택돼 있어요`);
  else if (sel.length >= MAX_REFS_UI) setAddNotice(`${saved} — 선택이 ${MAX_REFS_UI}건이라 자동 선택은 안 했어요. 목록에서 직접 조정해주세요`);
  else { setSel((cur) => [...cur, r.tweetId]); setAddNotice(`${saved} — 레퍼런스로 선택했어요`); }
  setReloadKey((k) => k + 1);
}
```
6. 하단 고정 바(191-201행)의 버튼 행에 추가 — `취소` 버튼 뒤:
```tsx
<button onClick={() => { setAddNotice(null); setAddOpen(true); }} className="text-ui text-x-blue-text hover:underline">🔗 링크로 추가</button>
```
7. 하단 바의 안내문 영역 — `addNotice`가 있으면 기존 amber 문구 위에 표시:
```tsx
{addNotice && <p className="mb-2 text-caption text-x-blue-text">{addNotice}</p>}
```
8. **루트를 fragment로 감싸고** 모달을 시트 오버레이의 **형제**로 마운트 (시트 배경 div 안에 넣으면 모달 클릭이 시트의 `requestClose`로 버블링됨):
```tsx
return (
  <>
    <div className="fixed inset-0 z-40 …기존 시트 전체…">…</div>
    <AddByLinkModal open={addOpen} onClose={() => setAddOpen(false)} defaultWsId={lastWsId} onAdded={handleAdded} />
  </>
);
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/components/RefPickerSheet.tsx
git diff --stat main -- src/app/generate/page.tsx   # 반드시 변경 0이어야 함
```
Expected: 오류·경고 0, `generate/page.tsx` 변경 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/RefPickerSheet.tsx
git commit -m "feat(add-link): 레퍼런스 선택창에서 링크로 추가 — 자동 선택+인라인 안내(토스트 없는 /generate)"
```

---

### 마무리 검증 (전체 웨이브 완료 후, 메인 세션에서)

- [ ] 전체 테스트: `npm test` — 기존 포함 전부 통과 (약 4분, 실 DB)
- [ ] 린트: `npx eslint src/` — 기준선 24개 초과 경고 없음 (새 파일들 경고 0)
- [ ] `git diff --stat main -- src/app/generate/page.tsx` — 변경 0 재확인
- [ ] 화면 검수는 OAuth 게이팅으로 사용자만 가능 — 사용자에게 검수 요청: ① 보관함에서 링크 추가(성공·중복·잘못된 링크·메모), ② /generate 레퍼런스 선택창에서 추가+자동 선택, ③ 추가한 트윗이 원고 생성 레퍼런스로 정상 사용되는지
