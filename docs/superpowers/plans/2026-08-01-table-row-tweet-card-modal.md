# 표 보기 행 클릭 → 트윗 카드 팝업 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱 &gt; 표 보기에서 행을 클릭하면 X를 열지 않고 그 자리에서 트윗 카드를 팝업으로 보여주고, 거기서 저장·메모·번역까지 할 수 있게 한다.

**Architecture:** 표 API(`/api/tweet-table`)는 그대로 둔다 — CSV가 최대 5,000행을 받는 경로라 카드용 데이터(미디어·인용RT·아바타)를 얹으면 그 페이로드가 무거워진다. 대신 행을 누른 순간 `GET /api/tweets/[id]?workspaceId=`로 그 한 건만 `StoredTweet`으로 받아, 기존 `TweetCard`를 모달 안에 그대로 렌더한다. 저장 결과는 표 전체를 다시 부르지 않고 그 행의 `savedBy`만 로컬에서 갱신한다.

**Tech Stack:** Next.js(App Router) · React 클라이언트 컴포넌트 · postgres.js · node:test(실 DB) · Tailwind

**설계 문서:** `docs/superpowers/specs/2026-08-01-table-row-tweet-card-modal-design.md`

## Global Constraints

- **표 API를 수정하지 않는다.** `/api/tweet-table`, `getWorkspaceTableRows`, `TableRow` 타입은 이 작업에서 건드리지 않는다.
- `**TweetCard`를 수정하지 않는다.** 카드는 X 미러링의 결과물이고, 팝업은 껍데기만 제공한다. 팝업 전용 카드 레이아웃을 새로 만들지 않는다.
- `**react-hooks/set-state-in-effect`는 이 저장소에서 에러다.** `useEffect` 본문에서 **동기적으로** `setState`를 호출하면 안 된다. `await` 뒤의 `setState`는 걸리지 않는다. 초기 상태는 `useState` 초기값으로 준다.
- **린트 기준선을 늘리지 않는다.** 현재 `npm run lint`는 정확히 `✖ 23 problems (12 errors, 11 warnings)`이다. 작업 후에도 같은 숫자여야 한다.
- `**npx tsc --noEmit`은 출력 없이 통과해야 한다.**
- 사용자 대면 문구는 한국어. 내부 개념어(`StoredTweet`, `savedBy` 등)를 화면 문구에 쓰지 않는다(`AGENTS.md`).
- 커밋 메시지는 한국어, 저장소의 기존 형식(`feat(table): …`)을 따른다.

## File Structure


| 파일                                  | 책임                                                                |
| ----------------------------------- | ----------------------------------------------------------------- |
| `src/lib/tweetStore.ts`             | (수정) `getWorkspaceTweet` 추가 — 워크스페이스 범위에서 트윗 한 건을 `StoredTweet`으로 |
| `src/lib/tweetStore.test.ts`        | (수정) 위 함수의 실 DB 테스트                                               |
| `src/app/api/tweets/[id]/route.ts`  | (신규) 그 한 건을 내려주는 GET 라우트                                          |
| `src/components/TweetCardModal.tsx` | (신규) 모달 껍데기 + 조회/로딩/에러 + 저장·메모 배선. 안쪽은 `TweetCard` 그대로            |
| `src/components/TweetTable.tsx`     | (수정) 행 클릭·키보드로 여는 신호만. 모달을 알지 못한다                                 |
| `src/components/TweetTableView.tsx` | (수정) 어느 행이 열렸는지, 번역 상태, 행 `savedBy` 갱신, 포커스 복귀                    |


**의존 방향:** `TweetTableView` → (`TweetTable`, `TweetCardModal`) → `TweetCard`. `TweetTable`은 모달의 존재를 모르고 `onOpenTweet(tweetId)`만 부른다.

---

### Task 1: `getWorkspaceTweet` — 트윗 한 건을 카드용 데이터로

**Files:**

- Modify: `src/lib/tweetStore.ts` (`getTweetsByIds` 바로 뒤, `export const PAGE_SIZE = 200;` 앞)
- Test: `src/lib/tweetStore.test.ts`

**Interfaces:**

- Consumes: 같은 파일의 `isUuidLike`, `toStored`, `TweetRow` 타입 (모두 이미 있음)
- Produces: `getWorkspaceTweet(sql: postgres.Sql, workspaceId: string, tweetId: string): Promise<StoredTweet | null>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/tweetStore.test.ts` 맨 아래에 추가. 같은 파일 위쪽의 `tw()` 헬퍼와 `P` 접두사를 그대로 쓴다(테스트 데이터 정리는 파일 맨 위 `after()`가 접두사로 지운다).

```ts
test('getWorkspaceTweet: 카드에 필요한 전체 데이터 + 워크스페이스 격리 + savedBy', async () => {
  const { upsertQuoted } = await import('./quotedStore.ts');
  const ws = await createWorkspace(sql, P + 'ws-one');
  const other = await createWorkspace(sql, P + 'ws-one-other');
  const m = await createMember(sql, P + 'One', '#555555');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'one', config: { keywords: ['x'] } });
  try {
    // 표 행(TableRow)에는 없어서 카드를 그릴 수 없던 것들을 일부러 다 채운다
    const base = tw('one', 42);
    base.authorAvatarUrl = 'https://example.test/a.png';
    base.media = [{ type: 'photo', url: 'https://example.test/p.jpg', videoUrl: null }];
    base.quoted = { id: P + 'one-inner', text: 'inner text', userName: '이름', screenName: 'handle9' };
    base.tweetUrl = 'https://x.com/tester/status/' + P + 'one';
    await upsertTweets(sql, [base]);
    await linkColumnTweets(sql, col.id, [base.tweetId]);
    await upsertQuoted(sql, P + 'one-inner', { ...tw('one-inner', 5), tweetId: P + 'one-inner' });

    const got = await getWorkspaceTweet(sql, ws.id, P + 'one');
    assert.ok(got, '이 워크스페이스의 컬럼에 걸린 트윗은 조회된다');
    assert.equal(got.authorAvatarUrl, 'https://example.test/a.png');
    assert.deepEqual(got.media, [{ type: 'photo', url: 'https://example.test/p.jpg', videoUrl: null }]);
    assert.equal(got.quoted!.userName, '이름');
    assert.equal(got.quoted!.enriched!.text, 'hello one-inner', '인용RT 캐시가 enriched로 실려야 카드가 완전해진다');
    assert.ok(got.firstSeenAt && got.lastFetchedAt, '카드 하단 수집·갱신 시각');
    assert.equal(got.isNew, false, 'NEW는 컬럼 개념 — 표에서는 항상 false');
    assert.deepEqual(got.savedBy, [], '아직 아무도 저장하지 않음');

    // savedBy는 워크스페이스 범위 집계
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 'one'}, ${ws.id}, ${m.id})`;
    const saved = await getWorkspaceTweet(sql, ws.id, P + 'one');
    assert.deepEqual(saved!.savedBy.map((x) => x.name), [P + 'One']);

    // 격리·부재 갈래
    assert.equal(await getWorkspaceTweet(sql, other.id, P + 'one'), null, '다른 워크스페이스에서는 안 보인다');
    assert.equal(await getWorkspaceTweet(sql, ws.id, P + 'no-such'), null, '없는 트윗은 null');
    assert.equal(await getWorkspaceTweet(sql, 'not-a-uuid', P + 'one'), null, 'uuid가 아니면 조회 없이 null (22P02 방지)');
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
    await deleteWorkspace(sql, other.id);
    await sql`delete from quoted_tweet where id like ${P + '%'}`;
  }
});
```

같은 파일 4번째 줄의 import에 `getWorkspaceTweet`를 더한다:

```ts
import { upsertTweets, linkColumnTweets, getColumnTweets, getColumnTweetCount, getTweetsByIds, getWorkspaceTweet, getWorkspaceTableRows, getWorkspaceTableCount, getWorkspaceColumnCounts } from './tweetStore.ts';
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 \
  --test-name-pattern='getWorkspaceTweet' src/lib/tweetStore.test.ts
```

Expected: FAIL — `getWorkspaceTweet is not a function` (또는 tsx의 import 오류). 통과하면 안 된다.

- [ ] **Step 3: 구현한다**

`src/lib/tweetStore.ts`의 `getTweetsByIds` 함수가 끝나는 `}` 다음, `export const PAGE_SIZE = 200;` 앞에 넣는다.

```ts
// 표 보기의 카드 팝업 — 행 하나를 눌렀을 때 그 트윗만 카드에 필요한 형태로 준다.
// TableRow에 없는 것(아바타·미디어·인용RT·tweetUrl·firstSeenAt) 때문에 필요하다.
// getColumnTweets와 같은 조인(인용RT 캐시·savedBy)을 쓰되 컬럼 조인만 없다 — 표의 행은
// 특정 컬럼에서 온 게 아니라 워크스페이스 전체에서 온 것이다(TableRow와 같은 범위).
// is_new는 "직전 새로고침 이후 이 컬럼에 새로 들어옴"이라 컬럼이 없는 여기선 의미가 없어 항상 false다.
// 버림 트윗을 굳이 빼지 않는다 — 표가 이미 버림을 제외하므로 눌릴 일이 거의 없고,
// 목록을 다시 부르기 직전의 찰나에 눌렀다면 방금 누른 그 글을 보여주는 쪽이 맞다.
export async function getWorkspaceTweet(
  sql: postgres.Sql, workspaceId: string, tweetId: string,
): Promise<StoredTweet | null> {
  // workspace_id는 uuid 컬럼이라 형식이 안 맞는 문자열은 "없음"이 아니라 캐스팅 오류(22P02)가 된다
  if (!isUuidLike(workspaceId) || !tweetId) return null;
  const [row] = await sql<TweetRow[]>`
    select t.*,
           qt.data as quoted_enriched,
           false as is_new,
           coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                       from candidate c join member m on m.id = c.member_id
                      where c.tweet_id = t.tweet_id and c.workspace_id = ${workspaceId}), '[]'::json) as saved_by
      from tweet t
      left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'
     where t.tweet_id = ${tweetId}
       and exists (select 1
                     from column_tweet ct
                     join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${workspaceId}
                    where ct.tweet_id = t.tweet_id)`;
  return row ? toStored(row) : null;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 \
  --test-name-pattern='getWorkspaceTweet' src/lib/tweetStore.test.ts
```

Expected: `# pass 1` / `# fail 0`

- [ ] **Step 5: 같은 파일의 다른 테스트를 깨지 않았는지 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/tweetStore.test.ts
```

Expected: `# fail 0`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/tweetStore.ts src/lib/tweetStore.test.ts
git commit -m "feat(table): 워크스페이스 범위로 트윗 한 건을 카드용 데이터로 조회

표 행(TableRow)엔 아바타·미디어·인용RT가 없어 카드를 그릴 수 없다.
표 API에 얹으면 CSV 5,000행 페이로드가 무거워지므로, 누른 한 건만
따로 받을 수 있게 한다. 조인은 getColumnTweets와 같고 컬럼만 없다."
```

---

### Task 2: `GET /api/tweets/[id]` — 그 한 건을 내려주는 라우트

**Files:**

- Create: `src/app/api/tweets/[id]/route.ts`

**Interfaces:**

- Consumes: `getWorkspaceTweet` (Task 1), `requireAllowedUser`, `getSql`
- Produces: `GET /api/tweets/{tweetId}?workspaceId={uuid}` → `200 { tweet: StoredTweet }` / `400 { error }` / `404 { error }`

> 이 저장소에는 라우트 테스트 하네스가 없다. 검증은 타입 체크·린트와, 라우트를 실제로 쓰는 Task 5 이후의 화면 확인으로 한다. 하네스를 새로 만들지 않는다(이 작업의 범위가 아니다).

- [ ] **Step 1: 라우트를 만든다**

기존 `src/app/api/tweets/[id]/[kind]/route.ts`와 같은 게이트·컨텍스트 형태를 따른다. 세그먼트 깊이가 달라 두 파일은 공존한다.

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceTweet } from '@/lib/tweetStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 표 보기에서 행을 눌렀을 때 카드에 필요한 한 건. 표 목록 API(/api/tweet-table)는 CSV가
// 최대 5,000행을 받는 경로라 카드용 데이터를 싣지 않는다 — 그래서 여기서 따로 받는다.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  const tweet = await getWorkspaceTweet(getSql(), workspaceId, id);
  if (!tweet) return NextResponse.json({ error: `tweet not found: ${id}` }, { status: 404 });
  return NextResponse.json({ tweet });
}
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -2
```

Expected: `tsc`는 출력 없음, 린트 마지막 줄은 `✖ 23 problems (12 errors, 11 warnings)` 그대로.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/tweets/\[id\]/route.ts
git commit -m "feat(table): 트윗 한 건 조회 라우트 (GET /api/tweets/[id])

표 행을 눌렀을 때 카드에 필요한 데이터만 워크스페이스 범위로 내려준다."
```

---

### Task 3: `TweetCardModal` — 팝업 껍데기 + 조회 + 저장·메모

**Files:**

- Create: `src/components/TweetCardModal.tsx`

**Interfaces:**

- Consumes: `GET /api/tweets/[id]?workspaceId=` (Task 2), `TweetCard`, `useMember`, `useToast`, `apiFetch`, `tweetPermalink`
- Produces:
  ```ts
  export function TweetCardModal(props: {
    wsId: string;
    tweetId: string;
    onClose: () => void;
    onSavedByChange: (tweetId: string, savedBy: Member[]) => void;
    translation: TweetTranslation | null;
    translating: boolean;
    onTranslate: (tweetId: string) => void;
  }): React.JSX.Element
  ```

  호출부는 `key={tweetId}`로 렌더해 트윗이 바뀌면 새로 마운트되게 한다(Task 5).

- [ ] **Step 1: 컴포넌트를 만든다**

주의할 점 셋:

1. `useEffect` 본문에서 동기 `setState`를 하지 않는다 — 초기 상태는 `useState` 초기값(`{ kind: 'loading' }`)이고, 상태 변경은 전부 `await` 뒤에서 일어난다. (`react-hooks/set-state-in-effect`가 에러)
2. 저장은 낙관적으로 반영하고 실패 시 되돌린다 — 표 전체를 다시 부르지 않기 위해서다.
3. `savedBy` 정렬은 서버(`order by m.name`)와 같게 맞춘다 — 안 맞추면 저장 직후와 재조회 후 배지 순서가 달라진다.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useMember } from '@/lib/memberContext';
import { useToast } from '@/lib/toastContext';
import { tweetPermalink } from '@/lib/tweetLink';
import type { Member, StoredTweet, TweetTranslation } from '@/lib/types';
import { TweetCard } from './TweetCard';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; tweet: StoredTweet }
  | { kind: 'missing' }        // 404 — 그 사이 삭제됐거나 컬럼에서 빠짐
  | { kind: 'error' };

// 표 보기에서 행을 누르면 뜨는 트윗 카드.
// 카드 자체는 TweetCard 그대로다(= X 미러링). 이 파일은 껍데기·조회·저장 배선만 한다.
// 모달 틀(배경·Esc·✕)은 ColumnSettings와 같은 패턴을 쓴다 — 두 모달의 조작감이 갈리지 않게.
export function TweetCardModal({ wsId, tweetId, onClose, onSavedByChange, translation, translating, onTranslate }: {
  wsId: string;
  tweetId: string;
  onClose: () => void;
  onSavedByChange: (tweetId: string, savedBy: Member[]) => void;
  translation: TweetTranslation | null;
  translating: boolean;
  onTranslate: (tweetId: string) => void;
}) {
  // 초기값이 'loading' — 이펙트 안에서 동기적으로 setState 하지 않기 위해서다(react-hooks/set-state-in-effect).
  // 호출부가 key={tweetId}로 렌더하므로 다른 행을 열면 이 컴포넌트가 새로 마운트되어 자연히 loading부터 시작한다.
  const [state, setState] = useState[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3CState%3E]]({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const { member } = useMember();
  const { show } = useToast();
  const closeRef = useRef[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3CHTMLButtonElement%3E]](null);
  // 저장으로 만들어진 내 candidate.id — 저장 직후 메모 PATCH 배선용 (Column.tsx와 같은 방식)
  const savedIdRef = useRef[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cstring%20%7C%20null%3E]](null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/tweets/${encodeURIComponent(tweetId)}?workspaceId=${encodeURIComponent(wsId)}`);
        if (!alive) return;
        if (r.status === 404) { setState({ kind: 'missing' }); return; }
        if (!r.ok) { setState({ kind: 'error' }); return; }
        const d = await r.json() as { tweet: StoredTweet };
        if (!alive) return;
        setState({ kind: 'ok', tweet: d.tweet });
      } catch {
        if (alive) setState({ kind: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [wsId, tweetId, retry]);

  // Esc로 닫기 — ColumnSettings와 같은 처리. IME 조합 중 Esc는 글자 조합 취소라 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 열릴 때 포커스를 모달 안으로 — 그래야 Tab이 표 행이 아니라 카드를 돈다.
  // 닫을 때 눌렀던 행으로 되돌리는 것은 호출부(TweetTableView)가 한다.
  useEffect(() => { closeRef.current?.focus(); }, []);

  // 저장 상태를 카드와 표 행에 동시에 반영한다 — 한쪽만 바꾸면 팝업을 닫았을 때 표가 거짓말을 한다.
  function applySavedBy(savedBy: Member[]) {
    setState((cur) => (cur.kind === 'ok' ? { kind: 'ok', tweet: { ...cur.tweet, savedBy } } : cur));
    onSavedByChange(tweetId, savedBy);
  }

  async function save() {
    if (state.kind !== 'ok') return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = state.tweet.savedBy;
    if (before.some((m) => m.id === member.id)) return;   // 이미 저장됨 — 중복 추가 방지
    // 서버는 order by m.name으로 준다 — 같은 순서로 맞춰야 저장 직후와 재조회 후 배지 순서가 같다
    applySavedBy([...before, member].sort((a, b) => a.name.localeCompare(b.name)));
    try {
      // sourceColumnId를 보내지 않는다 — 표의 글은 특정 컬럼에서 온 게 아니다(서버에서 optional)
      const r = await apiFetch('/api/candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetId, workspaceId: wsId }),
      });
      if (!r.ok) { applySavedBy(before); show('저장하지 못했어요 — 잠시 후 다시 시도해주세요'); return; }
      const created = await r.json().catch(() => null) as { id?: string } | null;
      savedIdRef.current = created?.id ?? null;
    } catch {
      applySavedBy(before);
      show('저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  async function unsave() {
    if (state.kind !== 'ok') return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = state.tweet.savedBy;
    applySavedBy(before.filter((m) => m.id !== member.id));
    savedIdRef.current = null;
    try {
      const r = await apiFetch(`/api/candidates?tweetId=${encodeURIComponent(tweetId)}&workspaceId=${encodeURIComponent(wsId)}`, { method: 'DELETE' });
      if (!r.ok) { applySavedBy(before); show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요'); }
    } catch {
      applySavedBy(before);
      show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  // 저장 시점 인라인 메모 — 방금 만든 candidate 행에 PATCH (Column.tsx의 saveMemo와 같다).
  // false를 돌려주면 카드가 입력을 보존하고 재시도 버튼을 보여준다.
  async function saveMemo(_tweetId: string, memo: string): Promise[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cboolean%3E]] {
    const id = savedIdRef.current;
    if (!id) return false;
    try {
      const r = await apiFetch(`/api/candidates/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
      });
      return r.ok;
    } catch { return false; }
  }

  return (
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%3Cdiv%20className%3D%22fixed%20inset-0%20z-50%20flex%20items-center%20justify-center%20bg-black%2F40%20p-4%22%20onClick%3D%7BonClose%7D%3E]]
      {/* 카드 위에 별도 테두리·여백을 얹지 않는다 — 카드([[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Carticle%3E]])가 이미 자기 배경·여백을 들고 있고
          그게 X 미러링의 결과물이다. 껍데기는 위치·모서리·세로 넘침만 담당한다. */}
      [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cdiv%20role%3D%22dialog%22%20aria-modal%3D%22true%22%20aria-label%3D%22%ED%8A%B8%EC%9C%97%20%EC%B9%B4%EB%93%9C%22%0A%20%20%20%20%20%20%20%20%20%20%20className%3D%22max-h-%5B90vh%5D%20w-%5B560px%5D%20max-w-%5B92vw%5D%20overflow-y-auto%20overflow-x-hidden%20rounded-2xl%20bg-white%22%0A%20%20%20%20%20%20%20%20%20%20%20onClick%3D%7B(e)%20%3D%3E]] e.stopPropagation()}>
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%3Cdiv%20className%3D%22flex%20justify-end%20px-2%20pt-2%22%3E]]
          [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cbutton%20ref%3D%7BcloseRef%7D%20onClick%3D%7BonClose%7D%20aria-label%3D%22%EB%8B%AB%EA%B8%B0%22%20title%3D%22%EB%8B%AB%EA%B8%B0%22%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20className%3D%22rounded-full%20p-2%20text-x-secondary%20hover%3Abg-x-hover%22%3E]]✕[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3C%2Fbutton%3E]]
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%3C%2Fdiv%3E]]
        {state.kind === 'loading' && [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cp%20className%3D%22px-4%20pb-4%20text-ui%20text-x-muted%22%3E]]불러오는 중…[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3C%2Fp%3E]]}
        {state.kind === 'error' && (
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%20%20%3Cp%20className%3D%22px-4%20pb-4%20text-ui%20text-red-500%22%3E]]
            글을 불러오지 못했어요. [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cbutton%20onClick%3D%7B()%20%3D%3E]] setRetry((n) => n + 1)} className="underline">다시 시도[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3C%2Fbutton%3E]]
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%20%20%3C%2Fp%3E]]
        )}
        {state.kind === 'missing' && (
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%20%20%3Cp%20className%3D%22px-4%20pb-4%20text-ui%20text-x-muted%22%3E]]
            이 글을 찾을 수 없어요 —{' '}
            [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Ca%20href%3D%7BtweetPermalink(null%2C%20tweetId)%7D%20target%3D%22_blank%22%20rel%3D%22noopener%22%20className%3D%22text-x-blue-text%20hover%3Aunderline%22%3E]]원문 보기 ↗[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3C%2Fa%3E]]
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%20%20%3C%2Fp%3E]]
        )}
        {state.kind === 'ok' && (
          [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3CTweetCard%20tweet%3D%7Bstate.tweet%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20meId%3D%7Bmember%3F.id%20%3F%3F%20null%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20onSave%3D%7Bsave%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20onUnsave%3D%7Bunsave%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20onSaveMemo%3D%7BsaveMemo%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20libraryHref%3D%7B%60%2Fw%2F%24%7BwsId%7D%2Flibrary%60%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20translation%3D%7Btranslation%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20translating%3D%7Btranslating%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20onTranslate%3D%7BonTranslate%7D%20%2F%3E]]
        )}
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%3C%2Fdiv%3E]]
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%3C%2Fdiv%3E]]
  );
}
```

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -2
```

Expected: `tsc`는 출력 없음, 린트는 `✖ 23 problems (12 errors, 11 warnings)`.

린트에 `set-state-in-effect`가 **새로** 뜬다면 이펙트 본문에서 동기 `setState`를 한 것이다 — `await` 뒤로 옮긴다.

- [ ] **Step 3: 커밋**

```bash
git add src/components/TweetCardModal.tsx
git commit -m "feat(table): 트윗 카드 팝업 컴포넌트

껍데기·조회·저장/메모 배선만 한다. 카드는 TweetCard 그대로 — 팝업 전용
레이아웃을 만들지 않는다. 저장은 낙관적으로 반영하고 실패 시 되돌린다:
표 200행을 다시 부르면 스크롤이 튀기 때문이다."
```

---

### Task 4: `TweetTable` — 행을 클릭·키보드로 열 수 있게

**Files:**

- Modify: `src/components/TweetTable.tsx` (props 시그니처, `<tbody>`의 `<tr>`)

**Interfaces:**

- Consumes: 없음(순수 UI)
- Produces: `TweetTable`에 필수 prop `onOpenTweet: (tweetId: string) => void` 추가. 각 `<tr>`에 `data-tweet-id={r.tweetId}` (Task 5의 포커스 복귀가 이 속성으로 행을 찾는다)

- [ ] **Step 1: 클릭 판정 헬퍼를 추가한다**

`src/components/TweetTable.tsx`의 `resolveWidth` 함수 바로 아래(= `export function TweetTable` 위)에 넣는다.

```ts
// 행을 눌렀을 때 카드를 열어야 하는 클릭인지. 두 가지는 카드를 열지 않는다:
// (1) 셀 안의 링크·버튼 — '원문 ↗'를 눌렀는데 팝업까지 뜨면 두 일이 동시에 일어난 것처럼 보인다.
// (2) 글자를 드래그해 선택한 경우 — 값을 복사하려던 동작이 팝업으로 끝나면 안 된다.
//     판정 시점이 mouseup 이후인 click이라, 드래그가 끝난 뒤의 선택 상태를 본다.
function opensCard(e: React.MouseEvent): boolean {
  if (e.target instanceof Element && e.target.closest('a, button')) return false;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return false;
  return true;
}
```

- [ ] **Step 2: props에 `onOpenTweet`을 더한다**

```ts
export function TweetTable({ rows, columns, sort, dir, onSort, onOpenTweet }: {
  rows: TableRow[]; columns: TableColumn[]; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
  onOpenTweet: (tweetId: string) => void;
}) {
```

- [ ] **Step 3: `<tr>`에 클릭·키보드를 건다**

`<tbody>` 안의 기존 줄

```tsx
          <tr key={r.tweetId} className="border-b border-x-border align-top hover:bg-x-hover">
```

을 아래로 바꾼다.

```tsx
          // 행 전체가 카드를 여는 손잡이다. role="button"으로 덮어쓰지 않는다 — 행을 버튼이라고
          // 말하면 보조기술에서 표의 행·칸 구조가 사라진다. 행은 행으로 두고 조작만 얹는다.
          // data-tweet-id: 팝업을 닫을 때 이 행으로 포커스를 되돌리기 위한 표식(TweetTableView).
          [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Ctr%20key%3D%7Br.tweetId%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20data-tweet-id%3D%7Br.tweetId%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20tabIndex%3D%7B0%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20onClick%3D%7B(e)%20%3D%3E]] { if (opensCard(e)) onOpenTweet(r.tweetId); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target !== e.currentTarget) return;   // 셀 안 링크에 포커스가 있으면 그쪽 몫
                e.preventDefault();                          // 스페이스로 페이지가 스크롤되는 것을 막는다
                onOpenTweet(r.tweetId);
              }}
              className="cursor-pointer border-b border-x-border align-top hover:bg-x-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
```

- [ ] **Step 4: 타입·린트 확인**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -2
```

Expected: `tsc`는 **에러가 난다** — `TweetTableView.tsx:247`에서 `onOpenTweet`을 안 넘기고 있기 때문이다(`Property 'onOpenTweet' is missing`). 이 에러 하나만 나야 하고, Task 5에서 사라진다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/TweetTable.tsx
git commit -m "feat(table): 행을 클릭·Enter로 열 수 있게 (여는 신호만)

'원문 ↗' 링크와 드래그 선택은 예외로 둔다 — 링크를 눌렀는데 팝업까지 뜨거나,
값을 복사하려던 드래그가 팝업으로 끝나면 안 된다.
표는 모달의 존재를 모른다. onOpenTweet(tweetId)만 부른다."
```

> 이 커밋 하나만으로는 타입이 맞지 않는다(호출부가 아직 prop을 안 넘긴다). Task 5와 짝이며, 두 커밋을 함께 올린다.

---

### Task 5: `TweetTableView` — 상태 배선, 포커스 복귀, 안내 문구

**Files:**

- Modify: `src/components/TweetTableView.tsx`

**Interfaces:**

- Consumes: `TweetTable`의 `onOpenTweet` (Task 4), `TweetCardModal` (Task 3), `useTranslations`
- Produces: 없음(최상위 배선)

- [ ] **Step 1: import를 더한다**

파일 상단의 import 블록에 추가한다.

```ts
import type { ColumnRow, Member, SortDir, SortKey, TableRow } from '@/lib/types';
import { TweetCardModal } from './TweetCardModal';
import { useTranslations } from './useTranslations';
```

(첫 줄은 기존 `import type { ColumnRow, SortDir, SortKey, TableRow } from '@/lib/types';`를 `Member`가 들어간 형태로 바꾸는 것이다.)

- [ ] **Step 2: 상태와 핸들러를 더한다**

`const [busy, setBusy] = useState(false);` 아래에 넣는다.

```tsx
  // 카드 팝업으로 열려 있는 행. null이면 닫힘.
  const [openTweetId, setOpenTweetId] = useState[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3Cstring%20%7C%20null%3E]](null);
  // 번역 상태·동작은 덱·보관함과 같은 훅을 쓴다 — 캐시는 tweet_id 단위 전역이라
  // 덱에서 이미 번역해 둔 글이면 팝업을 여는 순간 번역이 함께 보인다.
  const { translations, translatingIds, loadCached, translateOne } = useTranslations();
```

`load` 콜백 정의 아래에 넣는다.

```tsx
  // 팝업을 열면 캐시에 있는 번역만 조용히 가져온다 — LLM 호출이 없어 과금이 없다.
  useEffect(() => { if (openTweetId) void loadCached([openTweetId]); }, [openTweetId, loadCached]);

  // 팝업을 닫을 때 포커스를 눌렀던 행으로 되돌린다. 안 그러면 포커스가 body로 튕겨
  // 200행 중 어디를 보고 있었는지 잃는다(useDismissible이 <details>에서 다루는 것과 같은 문제).
  // 모달이 사라진 다음 프레임에 옮긴다 — 아직 떠 있는 동안 옮기면 언마운트가 도로 가져간다.
  const closeCard = useCallback(() => {
    const id = openTweetId;
    setOpenTweetId(null);
    if (!id) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLTableRowElement>(`tr[data-tweet-id="${CSS.escape(id)}"]`)?.focus();
    });
  }, [openTweetId]);

  // 팝업에서 저장·저장취소가 일어나면 그 행의 '저장' 칸만 갱신한다.
  // 덱은 저장할 때마다 목록을 다시 부르지만(Column.tsx), 여기서 그러면 200행 + 총계를
  // 다시 받고 스크롤이 튄다.
  const applySavedBy = useCallback((tweetId: string, savedBy: Member[]) => {
    setRows((cur) => cur.map((r) => (r.tweetId === tweetId ? { ...r, savedBy } : r)));
  }, []);
```

- [ ] **Step 3: 안내 문구에 한 줄을 더한다**

기존

```tsx
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%3Cp%20className%3D%22border-b%20border-x-border%20px-4%20py-1%20text-caption%20text-x-muted%22%3E]]
        지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 컬럼을 새로고침하면 갱신됩니다
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%3C%2Fp%3E]]
```

를 아래로 바꾼다. hover 신호만으로는 "여기 누르면 뭐가 나온다"를 미리 알 수 없다 — 행동 전에 기대를 설정한다(`AGENTS.md` 원칙 2).

```tsx
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%3Cp%20className%3D%22border-b%20border-x-border%20px-4%20py-1%20text-caption%20text-x-muted%22%3E]]
        행을 클릭하면 글 전체를 카드로 볼 수 있어요 · 지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 컬럼을 새로고침하면 갱신됩니다
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%3C%2Fp%3E]]
```

- [ ] **Step 4: 표에 prop을 넘기고 모달을 렌더한다**

기존

```tsx
[[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:block-html:%20%20%20%20%20%20%20%20%20%20%3CTweetTable%20rows%3D%7Brows%7D%20columns%3D%7Bcols%7D%20sort%3D%7Bsort%7D%20dir%3D%7Bdir%7D%20onSort%3D%7BonSort%7D%20%2F%3E]]
```

를 바꾼다.

```tsx
          [[ORCA_RICH_MD:b693312cbf54141ac5daef51e5fd017f:inline-html:%3CTweetTable%20rows%3D%7Brows%7D%20columns%3D%7Bcols%7D%20sort%3D%7Bsort%7D%20dir%3D%7Bdir%7D%20onSort%3D%7BonSort%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20onOpenTweet%3D%7BsetOpenTweetId%7D%20%2F%3E]]
```

그리고 컴포넌트 최상위 `</div>` 바로 앞(= '더보기' 블록 다음)에 모달을 넣는다.

```tsx
      {/* key={openTweetId}: 다른 행을 열면 새로 마운트되어 항상 '불러오는 중'부터 시작한다 —
          이전 트윗의 카드가 한 프레임 남아 있는 일이 없다. */}
      {openTweetId && (
        <TweetCardModal key={openTweetId}
                        wsId={wsId}
                        tweetId={openTweetId}
                        onClose={closeCard}
                        onSavedByChange={applySavedBy}
                        translation={translations[openTweetId] ?? null}
                        translating={translatingIds.has(openTweetId)}
                        onTranslate={translateOne} />
      )}
```

- [ ] **Step 5: 타입·린트 확인**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -2
```

Expected: `tsc`는 출력 없음(Task 4에서 났던 에러가 사라진다), 린트는 `✖ 23 problems (12 errors, 11 warnings)`.

- [ ] **Step 6: 전체 테스트**

```bash
npm test 2>&1 | tail -15
```

Expected: `# fail 0` (실 DB를 쓰므로 4분 안팎 걸린다)

- [ ] **Step 7: 커밋**

```bash
git add src/components/TweetTableView.tsx
git commit -m "feat(table): 행을 클릭하면 트윗 카드 팝업

표에서 글 하나를 읽으려면 '원문 ↗'로 X에 나갔다 와야 했다. 이제 그 자리에서
카드로 보고 저장·번역까지 한다.

저장은 그 행의 '저장' 칸만 갱신한다 — 200행을 다시 부르면 스크롤이 튄다.
닫을 때 포커스는 눌렀던 행으로 돌려준다 — 안 그러면 body로 튕겨 보던 자리를 잃는다."
```

---

## 완료 후 — 사용자 확인이 필요한 것

이 저장소에는 라우트·컴포넌트 테스트 하네스가 없고, 화면은 OAuth 게이팅이라 구현자가 직접 볼 수 없다. 아래는 배포 후 사용자가 확인해야 하는 목록이며, 완료 보고에 그대로 적는다.

1. 표에서 아무 행이나 클릭 → 카드가 뜨고 본문 전문·미디어·인용RT가 보인다
2. '원문 ↗'를 클릭 → 팝업이 뜨지 않고 X 새 탭만 열린다
3. 셀 값을 드래그해 선택 → 팝업이 뜨지 않는다
4. 카드에서 ☆저장 → 표의 '저장' 칸이 바로 바뀐다. 팝업을 닫고 다시 열어도 ★ 상태가 유지된다
5. 저장 직후 메모 입력 → 등록되고 '보관함' 링크가 뜬다
6. 🌐 번역 → 번역이 뜬다. 덱에서 이미 번역한 글이면 팝업을 여는 순간 번역 보기 버튼이 이미 있다
7. Esc·배경 클릭·✕ 셋 다 닫힌다
8. 행에 Tab으로 포커스 → Enter로 열리고, Esc로 닫으면 포커스가 그 행으로 돌아온다
9. 하단 '답글/스레드/리포스터'는 누르기 전엔 호출되지 않는다(누르면 $0.001 과금)

