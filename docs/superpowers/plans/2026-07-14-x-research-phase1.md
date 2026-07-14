# X 리서치 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱 검색 컬럼을 지표 기반 벤치마크 발굴 도구로 강화(min_retweets/min_replies·밀도 제안), 노이즈를 치우는 버림(dismiss) 신호, 薬機法 경고 배지를 추가한다.

**Architecture:** 기존 검색 파이프라인(SearchConfig → queryBuilder → getxapi searchTweets(Top) → tweetStore) 위의 확장. 순수 함수(densityProbe·complianceFlags)는 분리해 단위 테스트, 신규 상태(dismissed_tweet)는 기존 DB 위에 얹음. X 리서치 본체는 덱이며 리서치 페이지는 건드리지 않는다.

**Tech Stack:** Next.js(App Router) + TS + Tailwind v4 + postgres.js + node:test(tsx). 테스트: `node --import tsx --env-file=.env --test <file>` (실DB는 .env 필요), 전체 `npm test`, 빌드 `npm run build`, 마이그레이션 `npm run migrate`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-14-x-research-phase1-design.md`. 상위 로드맵: `2026-07-14-x-research-roadmap.md`.
- **OR 그룹은 반드시 괄호** — `buildSearchQuery`는 이미 `kws.length > 1 ? \`(${kws.join(' OR ')})\``. 회귀 테스트로 잠근다. 안 그러면 min_faves가 첫 키워드에만 걸림(실측 확인).
- **엔게이지먼트 임계는 type=Top에서만 유효** — `searchTweets`가 이미 `type: 'Top'` 하드코딩. 밀도 프로브도 이 경로 사용.
- 새 hex/스타일 금지 — 기존 X 토큰(`x-text/secondary/muted/border/border-strong/blue/hover` 등, `globals.css`) 사용. `dark:` 금지(라이트 고정).
- 실DB 테스트는 기존 패턴 따름: `getSql()`, prefix로 테스트 데이터 격리, `after()`에서 삭제 + `sql.end()`.
- getxapi 호출은 서버(route)에서 `makeClient()`로. 응답 필드: likeCount·retweetCount·replyCount·viewCount, tweets 배열은 `{tweets, has_more, next_cursor}`.
- 커밋은 작업 파일만 명시 stage. 작업 브랜치 `feat/x-research-phase1`.
- 인용 역탐색·계정 필러·트렌드는 범위 밖(다음 Phase).

---

### Task 1: 엔게이지먼트 연산자 (types + queryBuilder + 회귀 테스트)

**Files:**
- Modify: `src/lib/types.ts`(SearchConfig), `src/lib/queryBuilder.ts`
- Test: `src/lib/queryBuilder.test.ts`

**Interfaces:**
- Produces: `SearchConfig.minRetweets?: number | null`, `SearchConfig.minReplies?: number | null`; `buildSearchQuery`가 `min_retweets:N`·`min_replies:N`를 min_faves 다음에 출력.

- [ ] **Step 1: 실패 테스트 추가** (`queryBuilder.test.ts` 끝에)

```ts
test('min_retweets/min_replies 출력 + min_faves 다음 순서', () => {
  const q = buildSearchQuery({
    keywords: ['毛穴'], minFaves: 300, minRetweets: 50, minReplies: 10, imagesOnly: false,
  });
  assert.equal(q, '毛穴 min_faves:300 min_retweets:50 min_replies:10');
});

test('회귀: 다중 키워드는 (a OR b)로 괄호 — min_faves가 전체에 적용되도록', () => {
  const q = buildSearchQuery({ keywords: ['美容', 'スキンケア'], minFaves: 300, imagesOnly: false });
  assert.equal(q, '(美容 OR スキンケア) min_faves:300');
  assert.ok(q.startsWith('('), 'OR 그룹은 반드시 괄호로 시작해야 함(실측: 괄호 없으면 min_faves 무력화)');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --env-file=.env --test src/lib/queryBuilder.test.ts` / Expected: 새 테스트 FAIL(min_retweets 미출력)

- [ ] **Step 3: 타입 추가** (`types.ts`, SearchConfig의 minFaves 아래)

```ts
  minFaves?: number | null;
  minRetweets?: number | null;
  minReplies?: number | null;
```

- [ ] **Step 4: queryBuilder 수정** (`queryBuilder.ts`, `if (c.minFaves)` 줄 바로 다음)

```ts
  if (c.minFaves) parts.push(`min_faves:${c.minFaves}`);
  if (c.minRetweets) parts.push(`min_retweets:${c.minRetweets}`);
  if (c.minReplies) parts.push(`min_replies:${c.minReplies}`);
```

- [ ] **Step 5: 통과 확인** — Run: `node --import tsx --env-file=.env --test src/lib/queryBuilder.test.ts` / Expected: 전체 PASS
- [ ] **Step 6: Commit** — `git add src/lib/types.ts src/lib/queryBuilder.ts src/lib/queryBuilder.test.ts && git commit -m "feat(x-research): min_retweets/min_replies 연산자 + OR괄호 회귀 잠금"`

---

### Task 2: ColumnSettings 필터 입력 2개 추가

**Files:**
- Modify: `src/components/ColumnSettings.tsx`

**Interfaces:**
- Consumes: Task 1의 SearchConfig 필드. 기존 state 패턴(`minFaves`/`setMinFaves`)과 동일.

- [ ] **Step 1: state 추가** (`const [minFaves, ...]` 근처)

```tsx
  const [minRetweets, setMinRetweets] = useState(init.minRetweets ?? null);
  const [minReplies, setMinReplies] = useState(init.minReplies ?? null);
```

- [ ] **Step 2: 필터 그리드에 입력 2개 추가** (최소 조회수 `<div>` 다음, 같은 `grid grid-cols-2` 안)

```tsx
              <div><label className={label}>최소 RT</label>
                <input type="number" className={input} value={minRetweets ?? ''} onChange={(e) => setMinRetweets(e.target.value ? +e.target.value : null)} /></div>
              <div><label className={label}>최소 답글</label>
                <input type="number" className={input} value={minReplies ?? ''} onChange={(e) => setMinReplies(e.target.value ? +e.target.value : null)} /></div>
```

- [ ] **Step 3: submit config에 포함** (`config: { keywords: ...` 객체의 minFaves 옆)

```tsx
                    minFaves: minFaves || null, minRetweets: minRetweets || null, minReplies: minReplies || null,
```

- [ ] **Step 4: 빌드 확인** — Run: `npm run build` / Expected: Compiled successfully
- [ ] **Step 5: Commit** — `git add src/components/ColumnSettings.tsx && git commit -m "feat(x-research): 컬럼 설정에 최소 RT/답글 입력"`

---

### Task 3: 밀도 제안 순수 함수

**Files:**
- Create: `src/lib/densityProbe.ts`
- Test: `src/lib/densityProbe.test.ts`

**Interfaces:**
- Produces: `suggestMinFaves(likes: number[], sampleSize: number): { suggested: number; density: 'high' | 'low' }`. PAGE=20 기준. sampleSize<20 → 저밀도 `{100,'low'}`; ==20(꽉 참) → `{round(p25(likes)) 최소100, 'high'}`.

- [ ] **Step 1: 실패 테스트** (`densityProbe.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMinFaves } from './densityProbe.ts';

test('희소(20건 미만) → 저밀도, 제안 100', () => {
  assert.deepEqual(suggestMinFaves([5, 300, 1200], 3), { suggested: 100, density: 'low' });
});

test('꽉 참(20건) → 고밀도, p25 기반 제안(최소 100)', () => {
  const likes = Array.from({ length: 20 }, (_, i) => (i + 1) * 500); // 500..10000
  const r = suggestMinFaves(likes, 20);
  assert.equal(r.density, 'high');
  assert.ok(r.suggested >= 500 && r.suggested <= 3000, `p25 근처여야: ${r.suggested}`);
});

test('꽉 찼지만 전반적으로 낮으면 최소 100 하한', () => {
  const r = suggestMinFaves(Array(20).fill(20), 20);
  assert.equal(r.suggested, 100);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/densityProbe.test.ts` / Expected: FAIL(모듈 없음)

- [ ] **Step 3: 구현** (`densityProbe.ts`)

```ts
// 밀도 프로브: 최근 7일 표본의 좋아요 분포로 min_faves 컷라인을 제안한다.
// 실측 근거: 니치 밀도가 극단적으로 다름(브로드 1만+/주 vs 좁은 시술 300+가 11건).
const PAGE = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const k = (sorted.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

export function suggestMinFaves(likes: number[], sampleSize: number): { suggested: number; density: 'high' | 'low' } {
  if (sampleSize < PAGE) return { suggested: 100, density: 'low' };
  const sorted = [...likes].sort((a, b) => a - b);
  const p25 = percentile(sorted, 0.25);
  return { suggested: Math.max(100, Math.round(p25)), density: 'high' };
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/densityProbe.test.ts` / Expected: PASS
- [ ] **Step 5: Commit** — `git add src/lib/densityProbe.ts src/lib/densityProbe.test.ts && git commit -m "feat(x-research): 밀도 기반 min_faves 제안 순수함수"`

---

### Task 4: 밀도 API 라우트 + 설정 버튼

**Files:**
- Create: `src/app/api/research/density/route.ts`
- Modify: `src/components/ColumnSettings.tsx`

**Interfaces:**
- Consumes: `suggestMinFaves`(Task 3), `makeClient()`/`searchTweets`(getxapi).
- Produces: `POST /api/research/density` body `{ keywords: string[], lang?: string }` → `{ suggested: number, sampleSize: number, likeRange: [number, number], density: 'high'|'low' }`.

- [ ] **Step 1: 라우트 작성** (`route.ts`)

```ts
import { NextResponse } from 'next/server';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { suggestMinFaves } from '@/lib/densityProbe';

export async function POST(req: Request) {
  const { keywords, lang } = await req.json().catch(() => ({}));
  const kws: string[] = Array.isArray(keywords) ? keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  if (kws.length === 0) return NextResponse.json({ error: '키워드가 필요합니다' }, { status: 400 });

  // 프로브 전용 최소 쿼리 — filter:images 등은 밀도 측정에 불필요. min_faves:50로 최근 7일.
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const group = kws.length > 1 ? `(${kws.join(' OR ')})` : kws[0];
  const q = `${group}${lang ? ` lang:${lang}` : ''} min_faves:50 since:${since}`;

  try {
    const page = await makeClient().searchTweets(q);
    const likes = page.tweets.map((t) => (typeof (t as { likeCount?: number }).likeCount === 'number' ? (t as { likeCount: number }).likeCount : 0));
    const { suggested, density } = suggestMinFaves(likes, likes.length);
    const range: [number, number] = likes.length ? [Math.min(...likes), Math.max(...likes)] : [0, 0];
    return NextResponse.json({ suggested, sampleSize: likes.length, likeRange: range, density });
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패' }, { status: 401 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: 설정에 버튼 + state** (`ColumnSettings.tsx`) — 최소 좋아요 입력 옆. 기존 키워드 계산(`keywords`, `kwInput`) 재사용.

```tsx
  const [probe, setProbe] = useState<{ suggested: number; sampleSize: number; likeRange: [number, number]; density: string } | null>(null);
  const [probing, setProbing] = useState(false);
  async function checkDensity() {
    const kws = keywords.map((k) => k.ja);
    if (kwInput.trim() && !hasHangul(kwInput)) kws.push(kwInput.trim());
    if (kws.length === 0) { setErr('키워드를 먼저 입력하세요'); return; }
    setProbing(true); setErr('');
    try {
      const r = await fetch('/api/research/density', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: kws, lang: lang || 'ja' }) });
      if (!r.ok) { setErr('밀도 확인 실패 — 수동 입력하세요'); return; }
      setProbe(await r.json());
    } finally { setProbing(false); }
  }
```

- [ ] **Step 3: 최소 좋아요 필드 아래 표시** (필터 그리드 뒤, 이미지 체크박스 앞)

```tsx
            <div className="mt-2 flex items-center gap-2 text-[13px] text-x-secondary">
              <button type="button" onClick={checkDensity} disabled={probing} className={`${chip} disabled:opacity-50`}>{probing ? '…' : '밀도 확인'}</button>
              {probe && (
                <span>최근 7일 좋아요 {probe.likeRange[0]}~{probe.likeRange[1]} · 제안 min_faves:{probe.suggested}
                  <button type="button" onClick={() => setMinFaves(probe.suggested)} className="ml-1 text-x-blue hover:underline">적용</button>
                </span>
              )}
            </div>
```

- [ ] **Step 4: 빌드 + 라이브 확인** — Run: `npm run build` / dev에서 키워드 입력 후 "밀도 확인" → 제안·적용 동작
- [ ] **Step 5: Commit** — `git add src/app/api/research/density/route.ts src/components/ColumnSettings.tsx && git commit -m "feat(x-research): 밀도 확인 버튼 — 키워드 기반 min_faves 제안"`

---

### Task 5: 薬機法 경고 순수 함수

**Files:**
- Create: `src/lib/complianceFlags.ts`
- Test: `src/lib/complianceFlags.test.ts`

**Interfaces:**
- Produces: `flagYakkiho(text: string): string[]` — 매칭된 리스크 용어 배열(없으면 빈 배열).

- [ ] **Step 1: 실패 테스트** (`complianceFlags.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagYakkiho } from './complianceFlags.ts';

test('리스크 용어 매칭', () => {
  assert.deepEqual(flagYakkiho('このクリームでシミが消える！'), ['シミが消える']);
  assert.ok(flagYakkiho('ニキビが治る').includes('治る'));
});
test('여러 용어 매칭', () => {
  const f = flagYakkiho('効果がある医薬品');
  assert.ok(f.includes('効果がある') && f.includes('医薬品'));
});
test('리스크 없으면 빈 배열', () => {
  assert.deepEqual(flagYakkiho('新作コスメを試してみた'), []);
  assert.deepEqual(flagYakkiho(''), []);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/complianceFlags.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** (`complianceFlags.ts`)

```ts
// 薬機法(일본 의약품·화장품 광고 규제) 리스크 용어 힌트. 법률 자문이 아니라 담당자 확인용 표식이며,
// 매칭돼도 차단·필터링하지 않는다(카드에 ⚠️ 배지만). 오탐 위험 높은 체험담 단정형은 v1 제외.
const RISK_TERMS = [
  '効果がある', '効く', '治る', '治療', '完治', '医薬品', '副作用',
  'シミが消える', 'シワがなくなる', '美白効果', '痩せる',
];

export function flagYakkiho(text: string): string[] {
  if (!text) return [];
  return RISK_TERMS.filter((term) => text.includes(term));
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/complianceFlags.test.ts` / Expected: PASS
- [ ] **Step 5: Commit** — `git add src/lib/complianceFlags.ts src/lib/complianceFlags.test.ts && git commit -m "feat(x-research): 薬機法 리스크 용어 탐지 순수함수"`

---

### Task 6: TweetCard 薬機法 배지

**Files:**
- Modify: `src/components/TweetCard.tsx`

**Interfaces:**
- Consumes: `flagYakkiho`(Task 5).

- [ ] **Step 1: import + 계산** (TweetCard 함수 상단, `savedByMe` 근처)

```tsx
  const yakkiho = flagYakkiho(t.text);
```
그리고 파일 상단 import: `import { flagYakkiho } from '@/lib/complianceFlags';`

- [ ] **Step 2: NEW 배지 줄 옆에 ⚠️ 배지** (`{t.isNew && (...)}` 블록 다음)

```tsx
            {yakkiho.length > 0 && (
              <span title={`薬機法 리스크 용어: ${yakkiho.join(', ')} (표식일 뿐, 차단 아님)`}
                    className="rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-700">⚠️ 薬機法</span>
            )}
```

- [ ] **Step 3: 빌드 + 확인** — Run: `npm run build` / `/debug/card`에서 리스크 텍스트 포함 트윗에 배지 표시(fixture에 없으면 육안 확인은 실덱에서)
- [ ] **Step 4: Commit** — `git add src/components/TweetCard.tsx && git commit -m "feat(x-research): 트윗 카드 薬機法 경고 배지(표식 전용)"`

---

### Task 7: dismiss 마이그레이션 + 스토어

**Files:**
- Create: `migrations/005_dismissed.sql`, `src/lib/dismissStore.ts`
- Test: `src/lib/dismissStore.test.ts`

**Interfaces:**
- Produces: `dismiss(sql, a: {workspaceId, tweetId, memberId?: string|null}): Promise<void>`, `undismiss(sql, a: {workspaceId, tweetId}): Promise<void>`, `listDismissed(sql, workspaceId: string): Promise<string[]>`(tweetId 배열).

- [ ] **Step 1: 마이그레이션 작성** (`005_dismissed.sql`)

```sql
-- 버림(dismiss): 워크스페이스 단위로 벤치마크 무관 트윗을 숨김. 저장(candidate)=양성, 버림=음성 신호.
create table if not exists dismissed_tweet (
  workspace_id uuid not null references workspace(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  dismissed_by uuid references member(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (workspace_id, tweet_id)
);
```

- [ ] **Step 2: 적용** — Run: `npm run migrate` / Expected: `== applying migrations/005_dismissed.sql` + CREATE TABLE

- [ ] **Step 3: 실패 테스트** (`dismissStore.test.ts`)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { dismiss, undismiss, listDismissed } from './dismissStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { upsertTweets } from './tweetStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-dm-' + process.pid + '-';
function tw(id: string): DeckTweet {
  return { tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '', media: [], quoted: null, metrics: { views: 1, likes: 1, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: null };
}
after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('dismiss·list·undismiss + 멱등', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const m = await createMember(sql, P + 'm', '#111111');
  await upsertTweets(sql, [tw('a'), tw('b')]);
  try {
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'a', memberId: m.id });
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'a', memberId: m.id }); // 멱등
    assert.deepEqual(await listDismissed(sql, ws.id), [P + 'a']);
    await undismiss(sql, { workspaceId: ws.id, tweetId: P + 'a' });
    assert.deepEqual(await listDismissed(sql, ws.id), []);
    await undismiss(sql, { workspaceId: ws.id, tweetId: P + 'a' }); // 없는 것 복구 무시
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 4: 실패 확인** — Run: `node --import tsx --env-file=.env --test src/lib/dismissStore.test.ts` / Expected: FAIL(모듈 없음)

- [ ] **Step 5: 구현** (`dismissStore.ts`)

```ts
import type postgres from 'postgres';

export async function dismiss(sql: postgres.Sql, a: { workspaceId: string; tweetId: string; memberId?: string | null }): Promise<void> {
  await sql`insert into dismissed_tweet (workspace_id, tweet_id, dismissed_by)
            values (${a.workspaceId}, ${a.tweetId}, ${a.memberId ?? null})
            on conflict (workspace_id, tweet_id) do nothing`;
}

export async function undismiss(sql: postgres.Sql, a: { workspaceId: string; tweetId: string }): Promise<void> {
  await sql`delete from dismissed_tweet where workspace_id = ${a.workspaceId} and tweet_id = ${a.tweetId}`;
}

export async function listDismissed(sql: postgres.Sql, workspaceId: string): Promise<string[]> {
  const rows = await sql<{ tweet_id: string }[]>`select tweet_id from dismissed_tweet where workspace_id = ${workspaceId}`;
  return rows.map((r) => r.tweet_id);
}
```

- [ ] **Step 6: 통과 확인** — Run: `node --import tsx --env-file=.env --test src/lib/dismissStore.test.ts` / Expected: PASS
- [ ] **Step 7: Commit** — `git add migrations/005_dismissed.sql src/lib/dismissStore.ts src/lib/dismissStore.test.ts && git commit -m "feat(x-research): 버림(dismiss) 스토어 + 마이그레이션"`

---

### Task 8: getColumnTweets 버림 필터 + tweets 라우트

**Files:**
- Modify: `src/lib/tweetStore.ts`(getColumnTweets), `src/app/api/columns/[id]/tweets/route.ts`
- Test: `src/lib/tweetStore.test.ts`

**Interfaces:**
- Consumes: dismissed_tweet 테이블(Task 7).
- Produces: `getColumnTweets(sql, columnId, { sort, offset?, dismissed?: 'exclude' | 'only' })` — 기본 `'exclude'`(버림 숨김), `'only'`(버림만 반환). tweets 라우트는 `?dismissed=only` 쿼리로 전달.

- [ ] **Step 1: 실패 테스트 추가** (`tweetStore.test.ts` 끝)

```ts
test('버림 트윗은 기본 조회에서 제외, dismissed=only면 그것만', async () => {
  const { dismiss } = await import('./dismissStore.ts');
  const ws = await createWorkspace(sql, P + 'ws-dm');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'c', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [tw('d1', 10), tw('d2', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'd1', P + 'd2']);
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'd1' });
    const shown = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(shown.map((t) => t.tweetId), [P + 'd2']);
    const only = await getColumnTweets(sql, col.id, { sort: 'views', dismissed: 'only' });
    assert.deepEqual(only.map((t) => t.tweetId), [P + 'd1']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
    await sql`delete from dismissed_tweet where workspace_id = ${ws.id}`;
  }
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --env-file=.env --test src/lib/tweetStore.test.ts` / Expected: FAIL(dismissed 옵션 무시돼 d1 포함)

- [ ] **Step 3: getColumnTweets 수정** (`tweetStore.ts`) — 시그니처와 SQL:

```ts
export async function getColumnTweets(
  sql: postgres.Sql, columnId: string, opts: { sort: SortKey; offset?: number; dismissed?: 'exclude' | 'only' },
): Promise<StoredTweet[]> {
```
쿼리 문자열에서 `where ct.column_id = $1` 다음 줄에 조건 추가(기존 `left join quoted_tweet ...` 다음, `col.workspace_id`는 이미 `$2`):

```ts
      where ct.column_id = $1
        and ${opts.dismissed === 'only'
              ? `exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`
              : `not exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`}
```
(문자열 보간이라 값 파라미터가 아니라 정적 SQL 조각 — `opts.dismissed`는 코드에서만 분기되고 사용자 입력이 아니므로 인젝션 위험 없음. 기존 `sql.unsafe(...)` 방식 유지.)

- [ ] **Step 4: tweets 라우트에 쿼리 전달** (`route.ts`)

```ts
  const dismissed = sp.get('dismissed') === 'only' ? 'only' : 'exclude';
  return NextResponse.json(await getColumnTweets(getSql(), id, { sort, offset, dismissed }));
```

- [ ] **Step 5: 통과 확인** — Run: `node --import tsx --env-file=.env --test src/lib/tweetStore.test.ts` / Expected: 전체 PASS
- [ ] **Step 6: Commit** — `git add src/lib/tweetStore.ts "src/app/api/columns/[id]/tweets/route.ts" src/lib/tweetStore.test.ts && git commit -m "feat(x-research): 컬럼 조회에서 버림 제외 + dismissed=only 모드"`

---

### Task 9: 버림 API 라우트

**Files:**
- Create: `src/app/api/dismissed/route.ts`

**Interfaces:**
- Consumes: dismissStore(Task 7). `POST` body `{ workspaceId, tweetId, memberId? }`, `DELETE ?workspaceId=&tweetId=`.

- [ ] **Step 1: 라우트 작성**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { dismiss, undismiss } from '@/lib/dismissStore';

export async function POST(req: Request) {
  const { workspaceId, tweetId, memberId } = await req.json().catch(() => ({}));
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await dismiss(getSql(), { workspaceId, tweetId, memberId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'); const tweetId = sp.get('tweetId');
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await undismiss(getSql(), { workspaceId, tweetId });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 빌드 확인** — Run: `npm run build` / Expected: 성공(라우트 등록)
- [ ] **Step 3: Commit** — `git add src/app/api/dismissed/route.ts && git commit -m "feat(x-research): 버림 API(POST/DELETE)"`

---

### Task 10: Column/TweetCard 버림 UI + 토글

**Files:**
- Modify: `src/components/Column.tsx`, `src/components/TweetCard.tsx`

**Interfaces:**
- Consumes: 버림 API(Task 9), tweets 라우트 `?dismissed=only`(Task 8).
- Produces: `TweetCard`에 `onDismiss?/onUndismiss?` prop.

- [ ] **Step 1: TweetCard에 버림 버튼 prop 추가** — props에 추가:

```tsx
  onDismiss?: (tweetId: string) => void;
  onUndismiss?: (tweetId: string) => void;
  dismissedView?: boolean;
```
저장 버튼 옆(하단 `ml-auto flex gap-1` 안, 저장 버튼 다음)에:

```tsx
              {dismissedView
                ? <button onClick={() => onUndismiss?.(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-x-border">되돌리기</button>
                : onDismiss && <button onClick={() => onDismiss(t.tweetId)} title="벤치마크 무관 — 숨김" className="rounded px-1.5 py-0.5 text-x-muted hover:bg-x-border">✕ 버림</button>}
```

- [ ] **Step 2: Column에 버림 상태 + 토글 + 핸들러** (`mode` 근처에 상태 추가)

```tsx
  const [showDismissed, setShowDismissed] = useState(false);
```
`load` 함수의 fetch URL에 dismissed 반영:

```tsx
  const load = useCallback(async (s: SortKey) => {
    const r = await fetch(`/api/columns/${column.id}/tweets?sort=${s}${showDismissed ? '&dismissed=only' : ''}`);
    if (r.ok) { const page = (await r.json()) as StoredTweet[]; setTweets(page); setHasMore(page.length === PAGE); }
  }, [column.id, showDismissed]);
```
핸들러 추가(save/unsave 근처):

```tsx
  async function dismissTweet(tweetId: string) {
    await fetch('/api/dismissed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, workspaceId: column.workspaceId, memberId: member?.id ?? null }) });
    await load(sort);
  }
  async function undismissTweet(tweetId: string) {
    await fetch(`/api/dismissed?tweetId=${tweetId}&workspaceId=${column.workspaceId}`, { method: 'DELETE' });
    await load(sort);
  }
```

- [ ] **Step 3: 헤더에 토글 버튼** (정렬 탭 줄의 "NEW만/전체" 버튼 옆)

```tsx
          <button onClick={() => setShowDismissed((v) => !v)} className={btn} title="버림 보기">
            {showDismissed ? '버림✓' : '버림'}
          </button>
```

- [ ] **Step 4: TweetCard에 prop 연결** (map 안)

```tsx
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null}
                         onSave={save} onUnsave={unsave}
                         onDismiss={dismissTweet} onUndismiss={undismissTweet} dismissedView={showDismissed} />
```

- [ ] **Step 5: 빌드 + 라이브 확인** — Run: `npm run build && npm test` / dev에서: 트윗 버림 → 즉시 숨김, "버림" 토글 → 버림 목록 → 되돌리기 동작
- [ ] **Step 6: Commit** — `git add src/components/Column.tsx src/components/TweetCard.tsx && git commit -m "feat(x-research): 버림 버튼 + 버림 보기 토글 + 되돌리기"`

---

### Task 11: 최종 검증

- [ ] **Step 1: 전체 테스트** — Run: `npm test` / Expected: 기존 + 신규(queryBuilder·densityProbe·complianceFlags·dismissStore·tweetStore) 전부 PASS
- [ ] **Step 2: 빌드** — Run: `npm run build` / Expected: Compiled successfully
- [ ] **Step 3: 브라우저 E2E** — dev 서버, 더마그램 워크스페이스: 컬럼 설정에 최소 RT/답글·밀도 확인 버튼, 카드에 薬機法 배지(리스크 트윗), 버림→숨김→토글→되돌리기 전 플로우 확인. 스크린샷 `~/claude-outputs/`.
- [ ] **Step 4: 잔여 토큰/다크 검사** — Run: `grep -rn "dark:\|gray-[0-9]" src/components/Column.tsx src/components/TweetCard.tsx src/components/ColumnSettings.tsx` / Expected: 신규 코드에 없음
