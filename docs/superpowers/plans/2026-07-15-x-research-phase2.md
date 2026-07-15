# X 리서치 Phase 2 (계정 필러 분석 + 확장 탐색) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워치리스트(계정) 컬럼에 LLM 주제 분석("주제 분석" 패널 — 게시량 대비 좋아요 중앙값 비교로 ⭐기회 주제 발굴)을 추가하고, 모든 트윗 카드에 답글/스레드/리포스터 인라인 확장을 붙인다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-15-x-research-phase2-design.md` 승인본을 따른다. 필러 분석 = 스냅샷(pillar_analysis) + 트윗별 배정(tweet_topic) + 조회 시 통계 계산(순수 함수). LLM은 기존 `suggest.ts` 패턴(Haiku, 주입 가능 클라이언트, extractJson). 확장 탐색 = getxapi 클라이언트 메서드 3종 + 얇은 프록시 라우트 + 카드 하단 인라인 컴포넌트(DB 저장 없음).

**Tech Stack:** Next.js 16(App Router)·React 19·Postgres(Supabase, `postgres` npm)·`@anthropic-ai/sdk`·node 내장 테스트 러너(tsx).

## Global Constraints

- **AGENTS.md UX 원칙 준수**: 라벨은 이득 중심 사용자 언어(내부 개념어 금지 — UI에 "필러" 노출 금지, 버튼명은 **"주제 분석"**), 행동 전 기대 설정 한 줄 도움말, 결과는 판정까지 서술, 라벨↔값 파생값으로 일치, 기술값은 맥락으로 감싸기, 비용 유발 액션은 opt-in.
- **Next.js 16은 학습 데이터와 다름** — 라우트/컴포넌트 작업 전 `node_modules/next/dist/docs/`의 해당 가이드 확인.
- 테스트: `npm test` = `node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 "src/**/*.test.ts"` (실 Supabase 사용, `test-` 접두사 데이터 자기 정리). 단일 파일: `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`.
- 마이그레이션: 멱등 SQL(`if not exists`), `npm run migrate`로 적용.
- 인게이지먼트 축은 **좋아요**, 대푯값은 **중앙값**. 모델은 `process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'`.
- LLM 사용자 대면 비용 카피: 전체 분석 "약 $0.05 이하", 백필 "약 $0.01", 확장 "1회 $0.001".
- 커밋 메시지는 기존 한국어 컨벤션(`feat(x-research): ...`). 작업 완료 후 push(레포 컨벤션).
- `리서치` 페이지(exa 트랙)는 절대 건드리지 않는다. 인용 역탐색(quotes)은 구현하지 않는다(엔드포인트 404).

---

### Task 1: 마이그레이션 006 + pillarStore

**Files:**
- Create: `migrations/006_pillar.sql`
- Create: `src/lib/pillarStore.ts`
- Create: `src/lib/pillarTypes.ts`
- Test: `src/lib/pillarStore.test.ts`

**Interfaces:**
- Consumes: `getSql()`(db.ts), 기존 테이블 `deck_column`/`tweet`/`column_tweet`/`dismissed_tweet`.
- Produces (후속 태스크가 사용):
  - `pillarTypes.ts`: `PillarTopic { id: string; label: string }`, `Assignment { tweetId: string; topicId: string }`
  - `pillarStore.ts`: `saveAnalysis(sql, {columnId, topics, sampleSize, model, assignments}): Promise<void>` / `addAssignments(sql, columnId, assignments): Promise<void>` / `getAnalysis(sql, columnId): Promise<PillarAnalysisRow | null>` (`PillarAnalysisRow = {columnId, topics: PillarTopic[], sampleSize: number, model: string|null, analyzedAt: string}`) / `listAnalysisTweets(sql, columnId, opts?: {onlyUnassigned?: boolean; limit?: number}): Promise<AnalysisTweet[]>` (`AnalysisTweet = {tweetId, text, likes: number|null, isQuote: boolean, createdAt: string|null, topicId: string|null}`)

- [ ] **Step 1: 마이그레이션 파일 작성**

`migrations/006_pillar.sql`:

```sql
-- Phase 2: 계정 주제(필러) 분석 — 컬럼당 스냅샷 1개 + 트윗별 주제 배정
create table if not exists pillar_analysis (
  column_id uuid primary key references deck_column(id) on delete cascade,
  topics jsonb not null,              -- [{id: string, label: string}]
  sample_size int not null,
  model text,
  analyzed_at timestamptz not null default now()
);

create table if not exists tweet_topic (
  column_id uuid not null references deck_column(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  topic_id text not null,             -- pillar_analysis.topics[].id 참조(soft)
  primary key (column_id, tweet_id)
);
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `npm run migrate`
Expected: 006 적용 로그, 에러 없음.

- [ ] **Step 3: 공유 타입 파일 작성**

`src/lib/pillarTypes.ts` (서버·클라이언트 공용 — 순수 타입만):

```ts
export interface PillarTopic { id: string; label: string }
export interface Assignment { tweetId: string; topicId: string }
```

- [ ] **Step 4: 실패하는 테스트 작성**

`src/lib/pillarStore.test.ts`:

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { saveAnalysis, addAssignments, getAnalysis, listAnalysisTweets } from './pillarStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { upsertTweets, linkColumnTweets } from './tweetStore.ts';
import { dismiss } from './dismissStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ps-' + process.pid + '-';

function tw(id: string, likes: number, opts?: { quoted?: boolean; createdAt?: string }): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '본문' + id, media: [],
    quoted: opts?.quoted ? { id: 'q' + id, text: 'qt', userName: null, screenName: null } : null,
    metrics: { views: 1, likes, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: opts?.createdAt ?? '2026-07-01T00:00:00.000Z',
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql.end();
});

test('saveAnalysis→getAnalysis→listAnalysisTweets: 저장·배정·최신순·isQuote·likes', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w', config: { handle: 'h', userId: 'U1' },
  });
  try {
    await upsertTweets(sql, [
      tw('a', 100, { createdAt: '2026-07-03T00:00:00.000Z' }),
      tw('b', 50, { quoted: true, createdAt: '2026-07-02T00:00:00.000Z' }),
      tw('c', 10, { createdAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b', P + 'c']);

    assert.equal(await getAnalysis(sql, col.id), null);
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }],
      sampleSize: 3, model: 'test-model',
      assignments: [{ tweetId: P + 'a', topicId: 't1' }, { tweetId: P + 'b', topicId: 't2' }],
    });

    const a = await getAnalysis(sql, col.id);
    assert.equal(a!.sampleSize, 3);
    assert.deepEqual(a!.topics.map((t) => t.id), ['t1', 't2']);
    assert.ok(a!.analyzedAt);

    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'a', P + 'b', P + 'c']); // 최신순
    assert.deepEqual(rows.map((r) => r.topicId), ['t1', 't2', null]);          // c는 미분류
    assert.deepEqual(rows.map((r) => r.likes), [100, 50, 10]);
    assert.deepEqual(rows.map((r) => r.isQuote), [false, true, false]);

    const un = await listAnalysisTweets(sql, col.id, { onlyUnassigned: true });
    assert.deepEqual(un.map((r) => r.tweetId), [P + 'c']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('saveAnalysis 재실행 = 스냅샷·배정 통째 교체', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w2', config: { handle: 'h', userId: 'U2' },
  });
  try {
    await upsertTweets(sql, [tw('d', 1), tw('e', 2)]);
    await linkColumnTweets(sql, col.id, [P + 'd', P + 'e']);
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 'old', label: '옛주제' }], sampleSize: 2, model: null,
      assignments: [{ tweetId: P + 'd', topicId: 'old' }, { tweetId: P + 'e', topicId: 'old' }],
    });
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 'new', label: '새주제' }], sampleSize: 2, model: null,
      assignments: [{ tweetId: P + 'd', topicId: 'new' }],
    });
    const a = await getAnalysis(sql, col.id);
    assert.deepEqual(a!.topics, [{ id: 'new', label: '새주제' }]);
    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.topicId).sort(), [null, 'new']); // old 배정 잔존 없음
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('addAssignments 멱등 + 버림 트윗은 분석 목록에서 제외', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w3', config: { handle: 'h', userId: 'U3' },
  });
  try {
    await upsertTweets(sql, [tw('f', 1), tw('g', 2)]);
    await linkColumnTweets(sql, col.id, [P + 'f', P + 'g']);
    await saveAnalysis(sql, { columnId: col.id, topics: [{ id: 't1', label: 'ㅌ' }], sampleSize: 2, model: null, assignments: [] });
    await addAssignments(sql, col.id, [{ tweetId: P + 'f', topicId: 't1' }]);
    await addAssignments(sql, col.id, [{ tweetId: P + 'f', topicId: 't1' }]); // 멱등
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'g' });
    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'f']); // g는 버림으로 제외
    assert.equal(rows[0].topicId, 't1');
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 5: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillarStore.test.ts`
Expected: FAIL — `Cannot find module './pillarStore.ts'`

- [ ] **Step 6: pillarStore 구현**

`src/lib/pillarStore.ts`:

```ts
import type postgres from 'postgres';
import type { Assignment, PillarTopic } from './pillarTypes.ts';

export interface PillarAnalysisRow {
  columnId: string;
  topics: PillarTopic[];
  sampleSize: number;
  model: string | null;
  analyzedAt: string; // ISO
}

export interface AnalysisTweet {
  tweetId: string;
  text: string;
  likes: number | null;
  isQuote: boolean;
  createdAt: string | null; // ISO
  topicId: string | null;   // null = 미분류
}

// 전체 분석 결과 저장 — 스냅샷·배정을 트랜잭션으로 통째 교체 (실패 시 기존 분석 무손상)
export async function saveAnalysis(
  sql: postgres.Sql,
  a: { columnId: string; topics: PillarTopic[]; sampleSize: number; model: string | null; assignments: Assignment[] },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into pillar_analysis (column_id, topics, sample_size, model, analyzed_at)
      values (${a.columnId}, ${tx.json(a.topics as never)}, ${a.sampleSize}, ${a.model}, now())
      on conflict (column_id) do update set
        topics = excluded.topics, sample_size = excluded.sample_size,
        model = excluded.model, analyzed_at = now()`;
    await tx`delete from tweet_topic where column_id = ${a.columnId}`;
    for (const as of a.assignments) {
      await tx`insert into tweet_topic (column_id, tweet_id, topic_id)
               values (${a.columnId}, ${as.tweetId}, ${as.topicId}) on conflict do nothing`;
    }
  });
}

export async function addAssignments(sql: postgres.Sql, columnId: string, assignments: Assignment[]): Promise<void> {
  for (const a of assignments) {
    await sql`insert into tweet_topic (column_id, tweet_id, topic_id)
              values (${columnId}, ${a.tweetId}, ${a.topicId}) on conflict do nothing`;
  }
}

export async function getAnalysis(sql: postgres.Sql, columnId: string): Promise<PillarAnalysisRow | null> {
  const rows = await sql<Array<{ topics: PillarTopic[]; sample_size: number; model: string | null; analyzed_at: Date }>>`
    select topics, sample_size, model, analyzed_at from pillar_analysis where column_id = ${columnId}`;
  const r = rows[0];
  if (!r) return null;
  return { columnId, topics: r.topics, sampleSize: r.sample_size, model: r.model, analyzedAt: r.analyzed_at.toISOString() };
}

type AnalysisRow = {
  tweet_id: string; text: string; likes: string | number | null;
  is_quote: boolean; tweet_created_at: Date | null; topic_id: string | null;
};

// 분석 대상 트윗 — 버림(dismissed) 제외, 최신순, 기본 상한 500
export async function listAnalysisTweets(
  sql: postgres.Sql, columnId: string, opts?: { onlyUnassigned?: boolean; limit?: number },
): Promise<AnalysisTweet[]> {
  const rows = await sql.unsafe<AnalysisRow[]>(
    `select t.tweet_id, t.text, (t.metrics->>'likes')::bigint as likes,
            (t.quoted is not null) as is_quote, t.tweet_created_at, tt.topic_id
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id
       join tweet t on t.tweet_id = ct.tweet_id
       left join tweet_topic tt on tt.column_id = ct.column_id and tt.tweet_id = t.tweet_id
      where ct.column_id = $1
        and not exists (select 1 from dismissed_tweet d
                         where d.workspace_id = dc.workspace_id and d.tweet_id = t.tweet_id)
        ${opts?.onlyUnassigned ? 'and tt.topic_id is null' : ''}
      order by t.tweet_created_at desc nulls last, t.tweet_id
      limit $2`,
    [columnId, opts?.limit ?? 500],
  );
  return rows.map((r) => ({
    tweetId: r.tweet_id, text: r.text,
    likes: r.likes === null ? null : Number(r.likes),
    isQuote: r.is_quote,
    createdAt: r.tweet_created_at?.toISOString() ?? null,
    topicId: r.topic_id,
  }));
}
```

- [ ] **Step 7: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillarStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add migrations/006_pillar.sql src/lib/pillarTypes.ts src/lib/pillarStore.ts src/lib/pillarStore.test.ts
git commit -m "feat(x-research): 주제 분석 스토어 — pillar_analysis·tweet_topic 마이그레이션 + 스냅샷 교체/증분 배정/분석 대상 조회"
```

---

### Task 2: pillarStats 순수 함수 (통계·판정)

**Files:**
- Create: `src/lib/pillarStats.ts`
- Test: `src/lib/pillarStats.test.ts`

**Interfaces:**
- Consumes: `PillarTopic`(pillarTypes.ts).
- Produces:
  - `PillarStatsInput { tweetId: string; likes: number | null; isQuote: boolean; topicId: string | null }`
  - `PillarVerdict = 'opportunity' | 'core' | 'low' | 'normal'`
  - `PillarTopicStat { topicId; label; count; sharePct; postCount; quoteCount; medianLikes; verdict; judgment }`
  - `PillarStats { rows: PillarTopicStat[]; accountMedian: number; classifiedCount: number; unclassifiedCount: number; postCount: number; quoteCount: number }`
  - `computePillarStats(tweets: PillarStatsInput[], topics: PillarTopic[]): PillarStats`
  - `PillarPayload`(API 응답 형태 — Task 4·6에서 사용): `{ analysis: { topics: PillarTopic[]; sampleSize: number; analyzedAt: string } | null; stats: PillarStats | null; tweetTopics: Record<string, string>; unassignedCount: number; samplePeriod: [string, string] | null }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/pillarStats.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePillarStats, type PillarStatsInput } from './pillarStats.ts';

function t(id: string, likes: number | null, topicId: string | null, isQuote = false): PillarStatsInput {
  return { tweetId: id, likes, isQuote, topicId };
}

test('⭐기회 판정: 비중 낮음 + 중앙값 1.5배 + 3건 이상 → 맨 앞 정렬', () => {
  const tweets = [
    // t1: 3건, 좋아요 높음 (기회 후보)
    t('a', 1000, 't1'), t('b', 1200, 't1'), t('c', 1400, 't1'),
    // t2: 7건, 좋아요 낮음 (주력이지만 반응 낮음)
    t('d', 10, 't2'), t('e', 10, 't2'), t('f', 20, 't2'), t('g', 20, 't2'),
    t('h', 30, 't2'), t('i', 30, 't2'), t('j', 40, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }]);
  // accountMedian: 10건 → 중앙 두 값(30,30)? 정렬: 10,10,20,20,30,30,40,1000,1200,1400 → (30+30)/2=30
  assert.equal(s.accountMedian, 30);
  const t1 = s.rows.find((r) => r.topicId === 't1')!;
  assert.equal(t1.verdict, 'opportunity');
  assert.equal(t1.medianLikes, 1200);
  assert.equal(t1.sharePct, 30);                 // 3/10
  assert.equal(t1.judgment, '적게 올리는데 반응 최상 — 기회 주제');
  assert.equal(s.rows[0].topicId, 't1');         // ⭐ 먼저
});

test('3건 미만이면 기회 아님(표본 신뢰) → normal', () => {
  const tweets = [
    t('a', 1000, 't1'), t('b', 1200, 't1'),      // 2건뿐
    t('c', 10, 't2'), t('d', 10, 't2'), t('e', 20, 't2'), t('f', 20, 't2'), t('g', 30, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  assert.equal(s.rows.find((r) => r.topicId === 't1')!.verdict, 'normal');
});

test('core: 비중·중앙값 모두 평균 이상 / low: 중앙값이 절반 미만(비중 높으면 카피 다름)', () => {
  const tweets = [
    t('a', 100, 't1'), t('b', 100, 't1'), t('c', 100, 't1'), t('d', 100, 't1'),
    t('e', 10, 't2'), t('f', 10, 't2'), t('g', 10, 't2'), t('h', 10, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  // accountMedian = (10+100)/2 = 55, 균등비중 = 50%
  const t1 = s.rows.find((r) => r.topicId === 't1')!;
  const t2 = s.rows.find((r) => r.topicId === 't2')!;
  assert.equal(t1.verdict, 'core');
  assert.equal(t1.judgment, '이 계정의 주력 주제');
  assert.equal(t2.verdict, 'low');               // 10 < 55*0.5
  assert.equal(t2.judgment, '많이 올리지만 반응 낮음'); // 비중 50% ≥ 균등비중
});

test('중앙값: 홀수=가운데, 짝수=두 값 평균 반올림, null 좋아요=0', () => {
  const odd = computePillarStats([t('a', 1, 't1'), t('b', 5, 't1'), t('c', 9, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(odd.rows[0].medianLikes, 5);
  const even = computePillarStats([t('a', 1, 't1'), t('b', 4, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(even.rows[0].medianLikes, 3);     // (1+4)/2=2.5 → 3
  const withNull = computePillarStats([t('a', null, 't1'), t('b', 10, 't1'), t('c', 20, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(withNull.rows[0].medianLikes, 10); // null→0: [0,10,20]
});

test('미분류 집계 + 0건 주제 행 제거 + 투고/인용 카운트', () => {
  const tweets = [t('a', 10, 't1'), t('b', 10, 't1', true), t('c', 5, null)];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 'empty', label: 'ㄴ' }]);
  assert.equal(s.classifiedCount, 2);
  assert.equal(s.unclassifiedCount, 1);
  assert.deepEqual(s.rows.map((r) => r.topicId), ['t1']);  // empty 행 없음
  assert.equal(s.rows[0].postCount, 1);
  assert.equal(s.rows[0].quoteCount, 1);
  assert.equal(s.postCount, 1);
  assert.equal(s.quoteCount, 1);
});

test('빈 입력·전체 좋아요 0이면 기회 판정 없음(0분모 가드)', () => {
  const empty = computePillarStats([], [{ id: 't1', label: 'ㄱ' }]);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.accountMedian, 0);
  const zeros = computePillarStats(
    [t('a', 0, 't1'), t('b', 0, 't1'), t('c', 0, 't1'), t('d', 0, 't2'), t('e', 0, 't2'), t('f', 0, 't2'), t('g', 0, 't2')],
    [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  assert.ok(zeros.rows.every((r) => r.verdict !== 'opportunity'));
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillarStats.test.ts`
Expected: FAIL — `Cannot find module './pillarStats.ts'`

- [ ] **Step 3: 구현**

`src/lib/pillarStats.ts` (순수 함수 — 클라이언트에서도 import 가능):

```ts
import type { PillarTopic } from './pillarTypes.ts';

export interface PillarStatsInput {
  tweetId: string;
  likes: number | null;
  isQuote: boolean;
  topicId: string | null; // null = 미분류
}

export type PillarVerdict = 'opportunity' | 'core' | 'low' | 'normal';

export interface PillarTopicStat {
  topicId: string;
  label: string;
  count: number;
  sharePct: number;      // 분류된 트윗 대비 %
  postCount: number;     // 투고
  quoteCount: number;    // 인용RT
  medianLikes: number;
  verdict: PillarVerdict;
  judgment: string;      // 판정 한 줄(사용자 언어) — verdict에서 파생, 라벨↔값 일치
}

export interface PillarStats {
  rows: PillarTopicStat[];        // ⭐기회 먼저, 이후 medianLikes 내림차순. 0건 주제 제외
  accountMedian: number;
  classifiedCount: number;
  unclassifiedCount: number;
  postCount: number;
  quoteCount: number;
}

// GET /api/columns/[id]/pillar 응답 형태 (서버·클라이언트 공용)
export interface PillarPayload {
  analysis: { topics: PillarTopic[]; sampleSize: number; analyzedAt: string } | null;
  stats: PillarStats | null;
  tweetTopics: Record<string, string>; // tweetId → topicId (컬럼 트윗 필터링용)
  unassignedCount: number;
  samplePeriod: [string, string] | null; // 분류된 트윗의 [최고(古), 최신] ISO
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computePillarStats(tweets: PillarStatsInput[], topics: PillarTopic[]): PillarStats {
  const classified = tweets.filter((t) => t.topicId !== null);
  const accountMedian = median(classified.map((t) => t.likes ?? 0));
  const equalShare = topics.length > 0 ? 100 / topics.length : 100;

  const rows = topics
    .map((topic) => {
      const mine = classified.filter((t) => t.topicId === topic.id);
      const count = mine.length;
      const sharePct = classified.length ? Math.round((count / classified.length) * 100) : 0;
      const medianLikes = median(mine.map((t) => t.likes ?? 0));
      // 판정은 전부 파생값 — UI는 이 값을 그대로 표시만 한다 (라벨↔값 모순 방지)
      let verdict: PillarVerdict = 'normal';
      if (count >= 3 && sharePct < equalShare && accountMedian > 0 && medianLikes >= 1.5 * accountMedian) {
        verdict = 'opportunity';
      } else if (sharePct >= equalShare && medianLikes >= accountMedian) {
        verdict = 'core';
      } else if (medianLikes < 0.5 * accountMedian) {
        verdict = 'low';
      }
      const judgment =
        verdict === 'opportunity' ? '적게 올리는데 반응 최상 — 기회 주제'
        : verdict === 'core' ? '이 계정의 주력 주제'
        : verdict === 'low' ? (sharePct >= equalShare ? '많이 올리지만 반응 낮음' : '반응 낮음')
        : '반응 보통';
      return {
        topicId: topic.id, label: topic.label, count, sharePct,
        postCount: mine.filter((t) => !t.isQuote).length,
        quoteCount: mine.filter((t) => t.isQuote).length,
        medianLikes, verdict, judgment,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) =>
      Number(b.verdict === 'opportunity') - Number(a.verdict === 'opportunity')
      || b.medianLikes - a.medianLikes);

  return {
    rows, accountMedian,
    classifiedCount: classified.length,
    unclassifiedCount: tweets.length - classified.length,
    postCount: classified.filter((t) => !t.isQuote).length,
    quoteCount: classified.filter((t) => t.isQuote).length,
  };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillarStats.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pillarStats.ts src/lib/pillarStats.test.ts
git commit -m "feat(x-research): 주제별 통계·판정 순수 함수 — 좋아요 중앙값, ⭐기회(비중낮음+1.5배+3건) 파생 판정"
```

---

### Task 3: pillar.ts LLM 엔진 (주제 도출·증분 분류)

**Files:**
- Create: `src/lib/pillar.ts`
- Test: `src/lib/pillar.test.ts`

**Interfaces:**
- Consumes: `AnthropicLike`·`extractJson`(suggest.ts), `PillarTopic`·`Assignment`(pillarTypes.ts).
- Produces:
  - `PillarInputTweet { tweetId: string; text: string }`
  - `MAX_ANALYSIS_TWEETS = 500`
  - `deriveTopics(tweets: PillarInputTweet[], client?: AnthropicLike): Promise<{ topics: PillarTopic[]; assignments: Assignment[] } | null>` — **null = 실패**(호출측이 기존 스냅샷 보존)
  - `classifyTweets(topics: PillarTopic[], tweets: PillarInputTweet[], client?: AnthropicLike): Promise<Assignment[]>` — 실패 시 `[]`(미분류 유지, 무해)

토큰 절약 설계: 프롬프트에 트윗을 `번호. 본문` 목록으로 넣고, 응답 배정은 **트윗 번호 배열**(`{"t1":[1,5]}`)로 받아 tweetId로 역매핑한다(тweetId 문자열을 응답에 반복시키지 않음 — 500건도 출력 토큰 안전).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/pillar.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTopics, classifyTweets, MAX_ANALYSIS_TWEETS, type PillarInputTweet } from './pillar.ts';

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}
const tw = (id: string): PillarInputTweet => ({ tweetId: id, text: '본문' + id });

test('deriveTopics: 주제 + 번호 배정 → tweetId 역매핑', async () => {
  const out = await deriveTopics([tw('A'), tw('B'), tw('C')], fakeClient(
    '{"topics":[{"id":"t1","label":"성분"},{"id":"t2","label":"시술"}],"assignments":{"t1":[1,3],"t2":[2]}}'));
  assert.deepEqual(out!.topics, [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }]);
  assert.deepEqual(out!.assignments, [
    { tweetId: 'A', topicId: 't1' }, { tweetId: 'C', topicId: 't1' }, { tweetId: 'B', topicId: 't2' },
  ]);
});

test('deriveTopics: 방어 — 없는 주제·범위 밖 번호·중복 배정 제거', async () => {
  const out = await deriveTopics([tw('A'), tw('B')], fakeClient(
    '{"topics":[{"id":"t1","label":"ㄱ"}],"assignments":{"t1":[1,1,99],"ghost":[2]}}'));
  assert.deepEqual(out!.assignments, [{ tweetId: 'A', topicId: 't1' }]);
});

test('deriveTopics: 파싱 불가·topics 없음 → null (기존 스냅샷 보존용 신호)', async () => {
  assert.equal(await deriveTopics([tw('A')], fakeClient('죄송합니다')), null);
  assert.equal(await deriveTopics([tw('A')], fakeClient('{"assignments":{}}')), null);
  assert.equal(await deriveTopics([tw('A')], fakeClient('{"topics":[]}')), null);
});

test('deriveTopics: 500건 상한 — 넘치는 입력은 잘라서 프롬프트에 넣음', async () => {
  let prompt = '';
  const c = { messages: { create: async (p: { messages: Array<{ content: string }> }) => {
    prompt = p.messages[0].content;
    return { content: [{ type: 'text', text: '{"topics":[{"id":"t1","label":"ㄱ"}],"assignments":{}}' }] };
  } } };
  const many = Array.from({ length: MAX_ANALYSIS_TWEETS + 50 }, (_, i) => tw('id' + i));
  await deriveTopics(many, c as never);
  assert.ok(prompt.includes(`${MAX_ANALYSIS_TWEETS}.`));
  assert.ok(!prompt.includes(`${MAX_ANALYSIS_TWEETS + 1}.`));
});

test('classifyTweets: 기존 주제에 배정, 새 주제 무시, 실패 시 빈 배열', async () => {
  const topics = [{ id: 't1', label: '성분' }];
  const ok = await classifyTweets(topics, [tw('X'), tw('Y')], fakeClient('{"assignments":{"t1":[2],"t9":[1]}}'));
  assert.deepEqual(ok, [{ tweetId: 'Y', topicId: 't1' }]);
  assert.deepEqual(await classifyTweets(topics, [tw('X')], fakeClient('모르겠어요')), []);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillar.test.ts`
Expected: FAIL — `Cannot find module './pillar.ts'`

- [ ] **Step 3: 구현**

`src/lib/pillar.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { extractJson, type AnthropicLike } from './suggest.ts';
import type { Assignment, PillarTopic } from './pillarTypes.ts';

export interface PillarInputTweet { tweetId: string; text: string }

export const MAX_ANALYSIS_TWEETS = 500;

const MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

function tweetLines(tweets: PillarInputTweet[]): string {
  return tweets.map((t, i) => `${i + 1}. ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
}

const DERIVE_PROMPT = (lines: string, n: number) => `당신은 일본 뷰티/미용의료 X(트위터) 계정의 콘텐츠 전략 분석가입니다.
아래는 한 계정의 트윗 ${n}건입니다 (번호. 본문):
${lines}

이 계정의 콘텐츠 주제(콘텐츠 기둥)를 5~10개 도출하고, 각 트윗을 가장 잘 맞는 주제 하나에 배정하세요.
규칙:
- 주제 라벨은 한국어로 짧게(2~10자). 게시 형식(공지·이벤트 등)이 아니라 소재·화두 기준으로 묶는다 (예: "성분·피부 지식", "시술 안내", "원장 일상")
- 트윗 수가 적으면 주제 수도 줄인다(최소 3개). 억지로 늘리지 않는다
- 어느 주제에도 확실히 안 맞는 트윗은 배정을 생략한다
JSON만 출력. assignments의 값은 트윗 번호 배열:
{"topics":[{"id":"t1","label":"성분·피부 지식"}],"assignments":{"t1":[1,5,9],"t2":[2,3]}}`;

const CLASSIFY_PROMPT = (topics: PillarTopic[], lines: string) => `당신은 일본 뷰티/미용의료 X(트위터) 계정의 콘텐츠 전략 분석가입니다.
기존 주제 목록:
${topics.map((t) => `- ${t.id}: ${t.label}`).join('\n')}

아래 새 트윗들을 위 주제 중 가장 잘 맞는 하나에 배정하세요 (번호. 본문):
${lines}

규칙: 새 주제를 만들지 않는다. 어느 주제에도 확실히 안 맞는 트윗은 배정을 생략한다.
JSON만 출력. 값은 트윗 번호 배열: {"assignments":{"t1":[1,3]}}`;

// LLM 응답의 번호 배정({"t1":[1,5]})을 tweetId 배정으로 역매핑 — 방어적(없는 주제·번호·중복 제거)
function parseAssignments(v: unknown, topics: PillarTopic[], tweets: PillarInputTweet[]): Assignment[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const ids = new Set(topics.map((t) => t.id));
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const [topicId, nums] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(topicId) || !Array.isArray(nums)) continue;
    for (const n of nums) {
      const t = typeof n === 'number' ? tweets[n - 1] : undefined;
      if (t && !seen.has(t.tweetId)) {
        seen.add(t.tweetId);
        out.push({ tweetId: t.tweetId, topicId });
      }
    }
  }
  return out;
}

function parseTopics(v: unknown): PillarTopic[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { id: string; label: string } =>
      typeof x === 'object' && x !== null
      && typeof (x as Record<string, unknown>).id === 'string'
      && typeof (x as Record<string, unknown>).label === 'string')
    .map((x) => ({ id: x.id, label: x.label }))
    .slice(0, 10);
}

// 전체 분석: 주제 도출 + 배정을 한 호출로. 실패 시 null — 호출측은 기존 스냅샷을 덮지 않는다
export async function deriveTopics(
  tweetsIn: PillarInputTweet[],
  client?: AnthropicLike,
): Promise<{ topics: PillarTopic[]; assignments: Assignment[] } | null> {
  const tweets = tweetsIn.slice(0, MAX_ANALYSIS_TWEETS);
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 4000,
    messages: [{ role: 'user', content: DERIVE_PROMPT(tweetLines(tweets), tweets.length) }],
  });
  const j = extractJson(res) as { topics?: unknown; assignments?: unknown } | null;
  if (!j) return null;
  const topics = parseTopics(j.topics);
  if (topics.length === 0) return null;
  return { topics, assignments: parseAssignments(j.assignments, topics, tweets) };
}

// 증분 분류: 기존 주제에 새 트윗만 배정(주제 안정·비용 최소). 실패 시 [] — 미분류로 남아 무해
export async function classifyTweets(
  topics: PillarTopic[],
  tweetsIn: PillarInputTweet[],
  client?: AnthropicLike,
): Promise<Assignment[]> {
  const tweets = tweetsIn.slice(0, MAX_ANALYSIS_TWEETS);
  if (topics.length === 0 || tweets.length === 0) return [];
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 2000,
    messages: [{ role: 'user', content: CLASSIFY_PROMPT(topics, tweetLines(tweets)) }],
  });
  const j = extractJson(res) as { assignments?: unknown } | null;
  if (!j) return [];
  return parseAssignments(j.assignments, topics, tweets);
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/pillar.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pillar.ts src/lib/pillar.test.ts
git commit -m "feat(x-research): 주제 도출·증분 분류 LLM 엔진 — 번호 배정 역매핑으로 출력 토큰 절약, 실패 시 null/빈배열"
```

---

### Task 4: pillar API 라우트 (POST 분석 실행 / GET 조회)

**Files:**
- Create: `src/app/api/columns/[id]/pillar/route.ts`

**Interfaces:**
- Consumes: `getAnalysis`/`saveAnalysis`/`addAssignments`/`listAnalysisTweets`(Task 1), `deriveTopics`/`classifyTweets`/`MAX_ANALYSIS_TWEETS`(Task 3), `computePillarStats`·`PillarPayload`(Task 2), `getColumn`(columnStore), `getSql`(db).
- Produces: `GET /api/columns/[id]/pillar` → `PillarPayload` JSON. `POST /api/columns/[id]/pillar` body `{mode: 'full'|'incremental'}` → 성공 시 갱신된 `PillarPayload`, 실패 시 `{error}` (400/404/502).

라우트는 얇은 프록시(레포 컨벤션 — 라우트 자체 테스트 없음, 로직은 Task 1~3 테스트가 커버). 빌드 통과로 검증.

- [ ] **Step 1: 라우트 구현**

`src/app/api/columns/[id]/pillar/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { deriveTopics, classifyTweets, MAX_ANALYSIS_TWEETS } from '@/lib/pillar';
import { computePillarStats, type PillarPayload } from '@/lib/pillarStats';
import { getAnalysis, saveAnalysis, addAssignments, listAnalysisTweets } from '@/lib/pillarStore';
import type postgres from 'postgres';

async function payload(sql: postgres.Sql, columnId: string): Promise<PillarPayload> {
  const analysis = await getAnalysis(sql, columnId);
  if (!analysis) return { analysis: null, stats: null, tweetTopics: {}, unassignedCount: 0, samplePeriod: null };
  const tweets = await listAnalysisTweets(sql, columnId, { limit: MAX_ANALYSIS_TWEETS });
  const stats = computePillarStats(
    tweets.map((t) => ({ tweetId: t.tweetId, likes: t.likes, isQuote: t.isQuote, topicId: t.topicId })),
    analysis.topics,
  );
  const classified = tweets.filter((t) => t.topicId !== null);
  const dates = classified.map((t) => t.createdAt).filter((d): d is string => d !== null).sort();
  return {
    analysis: { topics: analysis.topics, sampleSize: analysis.sampleSize, analyzedAt: analysis.analyzedAt },
    stats,
    tweetTopics: Object.fromEntries(classified.map((t) => [t.tweetId, t.topicId!])),
    unassignedCount: tweets.length - classified.length,
    samplePeriod: dates.length ? [dates[0], dates[dates.length - 1]] : null,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await payload(getSql(), id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();
  const col = await getColumn(sql, id);
  if (!col) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });
  if (col.kind !== 'watchlist') return NextResponse.json({ error: '주제 분석은 계정 컬럼 전용입니다' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === 'incremental' ? 'incremental' : 'full';

  if (mode === 'incremental') {
    const analysis = await getAnalysis(sql, id);
    if (!analysis) return NextResponse.json({ error: '먼저 전체 분석을 실행하세요' }, { status: 400 });
    const unassigned = await listAnalysisTweets(sql, id, { onlyUnassigned: true, limit: MAX_ANALYSIS_TWEETS });
    if (unassigned.length > 0) {
      const asg = await classifyTweets(analysis.topics, unassigned.map((t) => ({ tweetId: t.tweetId, text: t.text })));
      await addAssignments(sql, id, asg);
    }
    return NextResponse.json(await payload(sql, id));
  }

  const tweets = await listAnalysisTweets(sql, id, { limit: MAX_ANALYSIS_TWEETS });
  if (tweets.length === 0) {
    return NextResponse.json({ error: '분석할 트윗이 없어요 — 먼저 새로고침하세요' }, { status: 400 });
  }
  const derived = await deriveTopics(tweets.map((t) => ({ tweetId: t.tweetId, text: t.text })));
  // 실패 시 기존 스냅샷을 덮지 않는다 — saveAnalysis 자체를 호출하지 않음
  if (!derived) return NextResponse.json({ error: '분석 실패 — 다시 시도해주세요' }, { status: 502 });
  await saveAnalysis(sql, {
    columnId: id, topics: derived.topics, sampleSize: tweets.length,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
    assignments: derived.assignments,
  });
  return NextResponse.json(await payload(sql, id));
}
```

- [ ] **Step 2: 빌드로 검증**

Run: `npm run build`
Expected: 빌드 성공, 타입 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/columns/[id]/pillar/route.ts
git commit -m "feat(x-research): 주제 분석 API — POST full/incremental(실패 시 스냅샷 보존) + GET 통계·주제맵·표본기간"
```

---

### Task 5: 새로고침 maxPages 오버라이드 (과거 백필용)

**Files:**
- Modify: `src/lib/refreshColumn.ts` (opts 파라미터 추가)
- Modify: `src/app/api/columns/[id]/refresh/route.ts` (body `{maxPages}` 수용)
- Test: `src/lib/refreshColumn.test.ts` (테스트 추가)

**Interfaces:**
- Produces: `refreshColumn(sql, client, columnId, opts?: { maxPagesOverride?: number })` — override가 config.maxPages보다 우선. `POST /api/columns/[id]/refresh` body `{maxPages?: number}`(1~10 클램프, 없으면 기존 동작). Task 6의 백필 버튼이 `{maxPages: 10}`으로 호출.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/refreshColumn.test.ts`에 아래 테스트 추가 (기존 import·helper 재사용):

```ts
test('maxPagesOverride가 config.maxPages보다 우선(과거 백필용)', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w3', config: { handle: 'u', userId: 'UID3', maxPages: 1 },
  });
  let calls = 0;
  const fake = {
    searchTweets: async () => page([], null),
    getUserTweets: async () => { calls++; return page([raw('o' + calls, 10)], calls < 5 ? 'C' + calls : null); },
  };
  try {
    await refreshColumn(sql, fake, col.id, { maxPagesOverride: 3 });
    assert.equal(calls, 3); // config는 1이지만 override 3 적용
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refreshColumn.test.ts`
Expected: FAIL — refreshColumn이 4번째 인자를 받지 않아 calls가 1.

- [ ] **Step 3: refreshColumn 수정**

`src/lib/refreshColumn.ts` — 시그니처와 maxPages 계산 두 곳 변경:

```ts
export async function refreshColumn(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'searchTweets' | 'getUserTweets'>,
  columnId: string,
  opts?: { maxPagesOverride?: number },
): Promise<{ fetched: number; inserted: number; updated: number }> {
```

기존 `const maxPages = ...` 줄을:

```ts
  const maxPages = opts?.maxPagesOverride ?? ((col.config.maxPages ?? DEFAULT_MAX_PAGES) as number);
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refreshColumn.test.ts`
Expected: PASS (기존 2 + 신규 1)

- [ ] **Step 5: refresh 라우트에 body 파라미터 추가**

`src/app/api/columns/[id]/refresh/route.ts` — 핸들러 첫 인자를 `_req`→`req`로 바꾸고, `refreshColumn` 호출을 다음으로 교체:

```ts
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();

  const existing = await getColumn(sql, id);
  if (!existing) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  // 과거 백필용: body {maxPages}로 이번 1회만 더 깊이 페이지네이션 (1~10 클램프)
  const body = (await req.json().catch(() => ({}))) as { maxPages?: unknown };
  const mp = Number(body.maxPages);
  const maxPagesOverride = Number.isFinite(mp) && mp >= 1 ? Math.min(10, Math.floor(mp)) : undefined;

  try {
    const client = makeClient();
    const result = await refreshColumn(sql, client, id, { maxPagesOverride });
```

(이하 기존 코드 유지 — enrichQuoted·에러 처리 변경 없음)

- [ ] **Step 6: 빌드로 검증**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add src/lib/refreshColumn.ts src/lib/refreshColumn.test.ts src/app/api/columns/[id]/refresh/route.ts
git commit -m "feat(x-research): 새로고침 maxPages 오버라이드 — 표본 부족 시 과거 트윗 백필(1~10 클램프)"
```

---

### Task 6: PillarPanel + Column 배선 (주제 분석 UI)

**Files:**
- Create: `src/components/PillarPanel.tsx`
- Modify: `src/components/Column.tsx`

**Interfaces:**
- Consumes: `PillarPayload`·`PillarStats`(pillarStats.ts), `formatCount`(format.ts), Task 4 API, Task 5 refresh body.
- Produces: `PillarPanel({ columnId, topicFilter, onTopicFilter, onData, onAfterBackfill, onClose })`. Column은 `pillarMap`(tweetId→topicId)으로 트윗 목록을 필터링.

UI 카피(AGENTS.md 원칙 준수 — 그대로 사용):
- 헤더 버튼: `주제 분석` / title `이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하`
- 최초 안내: `이 계정의 트윗을 주제별로 묶어 게시량 대비 반응(좋아요 중앙값)을 비교해요. (약 $0.05 이하)` + `[분석 시작]`
- 표본: `표본 N건 (M/D~M/D) · 투고 n · 인용RT n`
- 필터 안내: `주제를 누르면 아래에 그 트윗만 표시돼요`
- 증분: `새 트윗 N건 분류` / 백필: `표본이 적어요 — 과거 트윗 더 가져오기` (title에 `약 $0.01`) / 재도출: `주제 다시 도출` (title `주제 목록을 처음부터 다시 만들어요 · 전체 재분석 (약 $0.05 이하)`)

- [ ] **Step 1: PillarPanel 구현**

`src/components/PillarPanel.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { PillarPayload } from '@/lib/pillarStats';
import { formatCount } from '@/lib/format';

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtPeriod(p: [string, string] | null): string {
  return p ? ` (${fmtDay(p[0])}~${fmtDay(p[1])})` : '';
}

export function PillarPanel({ columnId, topicFilter, onTopicFilter, onData, onAfterBackfill, onClose }: {
  columnId: string;
  topicFilter: string | null;
  onTopicFilter: (topicId: string | null) => void;
  onData: (p: PillarPayload) => void;         // Column이 tweetTopics로 목록 필터링
  onAfterBackfill: () => void;                // 백필 후 Column 트윗 목록 재조회
  onClose: () => void;
}) {
  const [data, setData] = useState<PillarPayload | null>(null);
  const [busy, setBusy] = useState<'' | 'analyze' | 'backfill'>('');
  const [err, setErr] = useState('');

  const apply = useCallback((p: PillarPayload) => { setData(p); onData(p); }, [onData]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns/${columnId}/pillar`);
    if (r.ok) apply((await r.json()) as PillarPayload);
  }, [columnId, apply]);
  useEffect(() => { load(); }, [load]);

  async function run(mode: 'full' | 'incremental') {
    setBusy('analyze'); setErr('');
    const r = await fetch(`/api/columns/${columnId}/pillar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    if (r.ok) apply((await r.json()) as PillarPayload);
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  // 표본 부족 시 과거 백필(새로고침 10페이지) — 수집만 하고, 분류는 사용자가 버튼으로(비용 opt-in)
  async function backfill() {
    setBusy('backfill'); setErr('');
    const r = await fetch(`/api/columns/${columnId}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxPages: 10 }),
    });
    if (r.ok) { onAfterBackfill(); await load(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  const a = data?.analysis ?? null;
  const stats = data?.stats ?? null;
  const smallBtn = 'rounded border border-x-border-strong px-2 py-1 text-xs hover:bg-x-hover disabled:opacity-50';
  const primaryBtn = 'rounded bg-x-blue px-2 py-1 text-xs font-bold text-white hover:bg-x-blue/90 disabled:opacity-50';

  return (
    <div className="border-b border-x-border px-3 py-2 text-[13px]">
      <div className="flex items-baseline gap-2">
        <p className="font-bold">주제 분석</p>
        {a && (
          <span className="text-xs text-x-muted">
            표본 {a.sampleSize}건{fmtPeriod(data?.samplePeriod ?? null)} · 투고 {stats?.postCount ?? 0} · 인용RT {stats?.quoteCount ?? 0} · 분석 {fmtDay(a.analyzedAt)}
          </span>
        )}
        <button onClick={onClose} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
      </div>

      {data && !a && (
        <div className="mt-1">
          <p className="text-xs text-x-secondary">이 계정의 트윗을 주제별로 묶어 게시량 대비 반응(좋아요 중앙값)을 비교해요. (약 $0.05 이하)</p>
          <button onClick={() => run('full')} disabled={busy !== ''} className={`mt-1 ${primaryBtn}`}>
            {busy === 'analyze' ? '분석 중…' : '분석 시작'}
          </button>
        </div>
      )}

      {a && stats && (
        <>
          <p className="mt-1 text-xs text-x-muted">주제를 누르면 아래에 그 트윗만 표시돼요</p>
          <ul className="mt-1">
            {stats.rows.map((r) => (
              <li key={r.topicId}>
                <button onClick={() => onTopicFilter(topicFilter === r.topicId ? null : r.topicId)}
                        className={`w-full rounded px-1 py-0.5 text-left hover:bg-x-hover ${topicFilter === r.topicId ? 'bg-x-blue/10' : ''}`}>
                  <span className="font-bold">{r.verdict === 'opportunity' ? '⭐ ' : ''}{r.label}</span>
                  <span className="float-right text-x-secondary">{r.count}건({r.sharePct}%) · ♥{formatCount(r.medianLikes)}</span>
                  <span className="block text-xs text-x-muted">{r.judgment}{r.quoteCount > 0 ? ` · 인용RT ${r.quoteCount}건 포함` : ''}</span>
                </button>
              </li>
            ))}
            {stats.unclassifiedCount > 0 && (
              <li className="px-1 py-0.5 text-xs text-x-muted">미분류 {stats.unclassifiedCount}건</li>
            )}
          </ul>
          <div className="mt-1 flex flex-wrap gap-1">
            {(data?.unassignedCount ?? 0) > 0 && (
              <button onClick={() => run('incremental')} disabled={busy !== ''} className={primaryBtn}
                      title="분석 이후 들어온 트윗을 기존 주제에 배정해요">
                {busy === 'analyze' ? '분류 중…' : `새 트윗 ${data!.unassignedCount}건 분류`}
              </button>
            )}
            {a.sampleSize < 50 && (
              <button onClick={backfill} disabled={busy !== ''} className={smallBtn}
                      title="표본이 적으면 판정이 흔들려요 — 과거 트윗을 더 수집합니다 (약 $0.01)">
                {busy === 'backfill' ? '수집 중…' : '표본이 적어요 — 과거 트윗 더 가져오기'}
              </button>
            )}
            <button onClick={() => run('full')} disabled={busy !== ''} className={smallBtn}
                    title="주제 목록을 처음부터 다시 만들어요 · 전체 재분석 (약 $0.05 이하)">
              주제 다시 도출
            </button>
          </div>
        </>
      )}

      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Column 배선**

`src/components/Column.tsx` 수정 4곳:

(a) import 추가:

```tsx
import { PillarPanel } from './PillarPanel';
import type { PillarPayload } from '@/lib/pillarStats';
```

(b) 상태 추가 (`const [width, ...]` 아래):

```tsx
  const [showPillar, setShowPillar] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [pillarMap, setPillarMap] = useState<Record<string, string>>({});
```

(c) `visible` 계산을 주제 필터와 합성 (기존 `const visible = ...` 줄을 교체):

```tsx
  const modeFiltered = mode === 'new' ? tweets.filter((t) => t.isNew) : tweets;
  const visible = topicFilter ? modeFiltered.filter((t) => pillarMap[t.tweetId] === topicFilter) : modeFiltered;
```

(d) 헤더 두 번째 줄(정렬 버튼 행)의 `<span className="ml-auto" />` 앞에 주제 분석 토글 추가:

```tsx
          {column.kind === 'watchlist' && (
            <button onClick={() => { setShowPillar((v) => !v); if (showPillar) setTopicFilter(null); }}
                    className={`${btn} ${showPillar ? 'font-bold text-x-text' : ''}`}
                    title="이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하">
              주제 분석{showPillar ? '✓' : ''}
            </button>
          )}
```

(e) 렌더링 — 기존 `{column.kind === 'search' && <CooccurrencePanel .../>}` 바로 아래에:

```tsx
      {column.kind === 'watchlist' && showPillar && (
        <PillarPanel columnId={column.id}
                     topicFilter={topicFilter} onTopicFilter={setTopicFilter}
                     onData={(p: PillarPayload) => setPillarMap(p.tweetTopics)}
                     onAfterBackfill={() => load(sort)}
                     onClose={() => { setShowPillar(false); setTopicFilter(null); }} />
      )}
```

(f) 주제 필터 중 표시 — 트윗 목록 비었을 때 문구 분기(기존 `visible.length === 0` 문구를 교체):

```tsx
        {visible.length === 0
          ? <p className="p-4 text-center text-sm text-x-muted">
              {topicFilter ? '이 주제의 트윗이 현재 목록에 없어요 (주제를 다시 눌러 해제)'
                : mode === 'new' ? '신규 유입 없음 — 그 자체가 시그널입니다' : '트윗 없음'}
            </p>
          : ...기존 유지}
```

- [ ] **Step 3: 빌드로 검증**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 브라우저 육안 확인**

Run: `npm run dev` 후 브라우저에서 덱 열기.
확인: ①계정 컬럼에만 `주제 분석` 버튼 노출(검색 컬럼엔 없음) ②토글→패널 열림, 분석 전이면 안내+`분석 시작` ③`분석 시작` 클릭→주제 행·판정·표본 기간 표시 ④주제 클릭→아래 트윗 필터링, 재클릭→해제 ⑤패널 닫으면 필터도 해제.

- [ ] **Step 5: Commit**

```bash
git add src/components/PillarPanel.tsx src/components/Column.tsx
git commit -m "feat(x-research): 주제 분석 패널 — 계정 컬럼 토글, 판정 서술·표본기간, 주제 클릭 필터, 증분/백필/재도출 버튼"
```

---

### Task 7: getxapi 확장 메서드 3종 + 리포스터 매퍼

**Files:**
- Modify: `src/lib/getxapi.ts`
- Modify: `src/lib/mappers.ts`
- Test: `src/lib/getxapi.test.ts`, `src/lib/mappers.test.ts` (테스트 추가)
- Create: `scripts/smoke-expansion.ts`

**Interfaces:**
- Produces:
  - `getxapi.ts`: `UsersPage { has_more: boolean; next_cursor: string | null; users: Record<string, unknown>[] }`, `getTweetReplies(tweetId, cursor?): Promise<SearchPage>`, `getTweetThread(tweetId, cursor?): Promise<SearchPage>`, `getTweetRetweeters(tweetId, cursor?): Promise<UsersPage>`
  - `mappers.ts`: `ExpansionUser { handle: string; name: string | null; avatarUrl: string | null; followers: number | null }`, `mapRawUser(raw: Record<string, unknown>): ExpansionUser | null`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/getxapi.test.ts`에 추가 (기존 import·fake 패턴과 공존):

```ts
function fakeFetchJson(payload: unknown, urls: string[]): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

test('getTweetReplies/Thread: 경로·tweetId·cursor + tweets/replies/data 키 정규화', async () => {
  const urls: string[] = [];
  const c1 = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ tweets: [{ id: '1' }], has_more: true, next_cursor: 'N' }, urls), sleep: async () => {} });
  const p1 = await c1.getTweetReplies('T1', 'CUR');
  assert.match(urls[0], /\/twitter\/tweet\/replies\?/);
  assert.match(urls[0], /tweetId=T1/);
  assert.match(urls[0], /cursor=CUR/);
  assert.deepEqual(p1, { tweets: [{ id: '1' }], has_more: true, next_cursor: 'N' });

  const c2 = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ replies: [{ id: '2' }] }, []), sleep: async () => {} });
  const p2 = await c2.getTweetThread('T2');
  assert.deepEqual(p2, { tweets: [{ id: '2' }], has_more: false, next_cursor: null });
});

test('getTweetRetweeters: users/retweeters/data 키 정규화', async () => {
  const urls: string[] = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ retweeters: [{ userName: 'u1' }], has_more: false, next_cursor: '' }, urls), sleep: async () => {} });
  const p = await c.getTweetRetweeters('T3');
  assert.match(urls[0], /\/twitter\/tweet\/retweeters\?/);
  assert.deepEqual(p, { users: [{ userName: 'u1' }], has_more: false, next_cursor: null }); // 빈 문자열 커서 → null
});
```

`src/lib/mappers.test.ts`에 추가:

```ts
test('mapRawUser: 핸들 필수, screen_name 폴백, 필드 매핑', () => {
  assert.deepEqual(mapRawUser({ userName: 'u', name: 'N', profilePicture: 'p', followers: 5 }),
    { handle: 'u', name: 'N', avatarUrl: 'p', followers: 5 });
  assert.deepEqual(mapRawUser({ screen_name: 's' }),
    { handle: 's', name: null, avatarUrl: null, followers: null });
  assert.equal(mapRawUser({ name: '핸들없음' }), null);
});
```

(import에 `mapRawUser` 추가)

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/getxapi.test.ts src/lib/mappers.test.ts`
Expected: FAIL — 메서드/함수 없음.

- [ ] **Step 3: getxapi 구현**

`src/lib/getxapi.ts` — `UserInfo` 인터페이스 아래에 추가:

```ts
export interface UsersPage {
  has_more: boolean;
  next_cursor: string | null;
  users: Record<string, unknown>[];
}
```

클래스 내부(`getTweetDetail` 아래)에 추가:

```ts
  // 확장 탐색 — 응답 배열 키가 엔드포인트마다 다를 수 있어 관대하게 정규화(실계약은 smoke-expansion.ts로 확인)
  private static pageMeta(raw: Record<string, unknown>): { has_more: boolean; next_cursor: string | null } {
    return {
      has_more: raw.has_more === true,
      next_cursor: typeof raw.next_cursor === 'string' && raw.next_cursor ? raw.next_cursor : null,
    };
  }

  async getTweetReplies(tweetId: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/replies?${qs}`);
    const arr = [raw.tweets, raw.replies, raw.data].find(Array.isArray) as RawTweet[] | undefined;
    return { tweets: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }

  async getTweetThread(tweetId: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/thread?${qs}`);
    const arr = [raw.tweets, raw.replies, raw.data].find(Array.isArray) as RawTweet[] | undefined;
    return { tweets: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }

  async getTweetRetweeters(tweetId: string, cursor?: string): Promise<UsersPage> {
    const qs = new URLSearchParams({ tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/retweeters?${qs}`);
    const arr = [raw.users, raw.retweeters, raw.data].find(Array.isArray) as Record<string, unknown>[] | undefined;
    return { users: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }
```

`src/lib/mappers.ts` — 파일 끝에 추가:

```ts
export interface ExpansionUser {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  followers: number | null;
}

export function mapRawUser(raw: Record<string, unknown>): ExpansionUser | null {
  const handle = str(raw.userName) ?? str(raw.screen_name);
  if (!handle) return null;
  return { handle, name: str(raw.name), avatarUrl: str(raw.profilePicture), followers: num(raw.followers) };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/getxapi.test.ts src/lib/mappers.test.ts`
Expected: PASS (기존 + 신규 3)

- [ ] **Step 5: 스모크 스크립트 작성 + 실계약 확인**

`scripts/smoke-expansion.ts`:

```ts
// 확장 탐색 3 엔드포인트 실계약 확인 (비용 ~$0.003)
// 사용: npx tsx --env-file=.env scripts/smoke-expansion.ts <tweetId>
import { makeClient } from '../src/lib/getxapi.ts';

const tweetId = process.argv[2];
if (!tweetId) {
  console.error('사용법: npx tsx --env-file=.env scripts/smoke-expansion.ts <tweetId>');
  process.exit(1);
}
const c = makeClient();
const runs = [
  ['replies', () => c.getTweetReplies(tweetId)],
  ['thread', () => c.getTweetThread(tweetId)],
  ['retweeters', () => c.getTweetRetweeters(tweetId)],
] as const;
for (const [name, fn] of runs) {
  const page = await fn();
  const items = 'tweets' in page ? page.tweets : page.users;
  console.log(`\n== ${name}: ${items.length}건, has_more=${page.has_more}, next_cursor=${page.next_cursor}`);
  console.dir(items[0], { depth: 2 });
}
```

Run: 답글·RT가 있는 실제 트윗 ID 하나로 `npx tsx --env-file=.env scripts/smoke-expansion.ts <tweetId>` (덱에 저장된 벤치마크 트윗 URL에서 ID 추출).
Expected: 3개 모두 0건 아님(대상 트윗에 답글·RT가 있는 한), 정규화된 형태 출력. **배열 키가 예상(tweets/replies/users/retweeters/data)과 다르면 여기서 정규화 후보에 실키를 추가하고 getxapi.test.ts에 그 케이스를 반영한 뒤 재실행.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/getxapi.ts src/lib/getxapi.test.ts src/lib/mappers.ts src/lib/mappers.test.ts scripts/smoke-expansion.ts
git commit -m "feat(x-research): getxapi 확장 3종(답글/스레드/리포스터) + 리포스터 매퍼 + 실계약 스모크"
```

---

### Task 8: 확장 프록시 라우트

**Files:**
- Create: `src/app/api/tweets/[id]/[kind]/route.ts`

**Interfaces:**
- Consumes: `makeClient`·`GetxapiAuthError`(getxapi.ts), `mapRawTweet`·`mapRawUser`(mappers.ts).
- Produces: `GET /api/tweets/[id]/replies|thread|retweeters?cursor=` → 답글/스레드는 `{tweets: DeckTweet[], nextCursor: string|null}`, 리포스터는 `{users: ExpansionUser[], nextCursor: string|null}`. 그 외 kind는 404.

- [ ] **Step 1: 라우트 구현**

`src/app/api/tweets/[id]/[kind]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { mapRawTweet, mapRawUser } from '@/lib/mappers';

const KINDS = new Set(['replies', 'thread', 'retweeters']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params;
  if (!KINDS.has(kind)) return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 404 });
  const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined;

  try {
    const client = makeClient();
    if (kind === 'retweeters') {
      const page = await client.getTweetRetweeters(id, cursor);
      return NextResponse.json({
        users: page.users.map(mapRawUser).filter((u) => u !== null),
        nextCursor: page.has_more ? page.next_cursor : null,
      });
    }
    const page = kind === 'replies' ? await client.getTweetReplies(id, cursor) : await client.getTweetThread(id, cursor);
    return NextResponse.json({
      tweets: page.tweets.map(mapRawTweet).filter((t) => t !== null),
      nextCursor: page.has_more ? page.next_cursor : null,
    });
  } catch (e) {
    if (e instanceof GetxapiAuthError) {
      return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: 빌드로 검증**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tweets/[id]/[kind]/route.ts
git commit -m "feat(x-research): 확장 탐색 프록시 — 답글/스레드/리포스터 조회(키 서버 보관, 저장 없음)"
```

---

### Task 9: TweetExpansion + TweetCard 배선

**Files:**
- Create: `src/components/TweetExpansion.tsx`
- Modify: `src/components/TweetCard.tsx`

**Interfaces:**
- Consumes: Task 8 API, `DeckTweet`(types.ts), `ExpansionUser`(mappers.ts — 타입만), `formatCount`(format.ts).
- Produces: `TweetExpansion({ tweetId })` — 자체 상태로 동작(카드에서 1줄 삽입). 결과 저장 없음(언마운트 시 소멸).

UI 카피: 버튼 `답글 / 스레드 / 리포스터`, title `X에서 불러와요 · 1회 $0.001`. 실패: `불러오기 실패 — 다시 시도`.

- [ ] **Step 1: TweetExpansion 구현**

`src/components/TweetExpansion.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { DeckTweet } from '@/lib/types';
import type { ExpansionUser } from '@/lib/mappers';
import { formatCount } from '@/lib/format';

type Kind = 'replies' | 'thread' | 'retweeters';
const LABEL: Record<Kind, string> = { replies: '답글', thread: '스레드', retweeters: '리포스터' };
const EMPTY: Record<Kind, string> = { replies: '답글 없음', thread: '스레드 없음', retweeters: '리포스터 없음' };

// 확장 탐색 — 클릭 시에만 호출(opt-in), 결과는 컴포넌트 상태로만 유지(DB 저장 없음)
export function TweetExpansion({ tweetId }: { tweetId: string }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [tweets, setTweets] = useState<DeckTweet[]>([]);
  const [users, setUsers] = useState<ExpansionUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function fetchPage(k: Kind, cur: string | null, replace: boolean) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/tweets/${tweetId}/${k}${cur ? `?cursor=${encodeURIComponent(cur)}` : ''}`);
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '불러오기 실패 — 다시 시도');
        return;
      }
      const j = (await r.json()) as { tweets?: DeckTweet[]; users?: ExpansionUser[]; nextCursor: string | null };
      if (k === 'retweeters') setUsers((prev) => (replace ? j.users ?? [] : [...prev, ...(j.users ?? [])]));
      else setTweets((prev) => (replace ? j.tweets ?? [] : [...prev, ...(j.tweets ?? [])]));
      setCursor(j.nextCursor ?? null);
    } catch {
      setErr('불러오기 실패 — 다시 시도');
    } finally {
      setBusy(false);
    }
  }

  function toggle(k: Kind) {
    if (kind === k) { setKind(null); return; }
    setKind(k); setTweets([]); setUsers([]); setCursor(null); setErr('');
    fetchPage(k, null, true);
  }

  const empty = kind === 'retweeters' ? users.length === 0 : tweets.length === 0;

  return (
    <div className="mt-1">
      <div className="flex gap-1 text-xs text-x-secondary">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} onClick={() => toggle(k)} title="X에서 불러와요 · 1회 $0.001"
                  className={`rounded px-1.5 py-0.5 hover:bg-x-border ${kind === k ? 'font-bold text-x-text' : ''}`}>
            {LABEL[k]}{kind === k ? ' ✕' : ''}
          </button>
        ))}
      </div>
      {kind && (
        <div className="mt-1 rounded border border-x-border bg-x-hover/40 p-2 text-[13px]">
          {err && (
            <p className="text-xs text-red-500">
              {err} <button onClick={() => fetchPage(kind, cursor, empty)} className="underline">다시 시도</button>
            </p>
          )}
          {busy && empty && <p className="text-xs text-x-muted">불러오는 중…</p>}
          {kind !== 'retweeters' && tweets.map((t) => (
            <div key={t.tweetId} className="border-b border-x-border py-1 last:border-b-0">
              <span className="font-bold">{t.authorName ?? t.authorHandle}</span>
              <span className="text-x-secondary"> @{t.authorHandle} · ♥{formatCount(t.metrics.likes)}</span>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
            </div>
          ))}
          {kind === 'retweeters' && users.map((u) => (
            <div key={u.handle} className="flex items-baseline gap-1 border-b border-x-border py-1 last:border-b-0">
              <a href={`https://x.com/${u.handle}`} target="_blank" rel="noopener" className="font-bold hover:underline">
                {u.name ?? u.handle}
              </a>
              <span className="text-x-secondary">@{u.handle}</span>
              {u.followers !== null && <span className="ml-auto text-xs text-x-muted">팔로워 {formatCount(u.followers)}</span>}
            </div>
          ))}
          {!busy && !err && empty && <p className="text-xs text-x-muted">{EMPTY[kind]}</p>}
          {cursor && (
            <button onClick={() => fetchPage(kind, cursor, false)} disabled={busy}
                    className="mt-1 w-full rounded py-1 text-center text-xs text-x-blue hover:bg-x-hover disabled:opacity-50">
              {busy ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TweetCard 배선**

`src/components/TweetCard.tsx`:

(a) import 추가:

```tsx
import { TweetExpansion } from './TweetExpansion';
```

(b) 액션 줄(`수집 ... · 갱신 ...`이 있는 `<div className="mt-2 flex ...">`) **닫힌 직후**, `</div></div></article>` 앞에 삽입:

```tsx
          <TweetExpansion tweetId={t.tweetId} />
```

- [ ] **Step 3: 빌드로 검증**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 브라우저 육안 확인**

Run: `npm run dev` 후 덱 열기.
확인: ①모든 트윗 카드(검색·계정 컬럼)에 답글/스레드/리포스터 버튼 ②클릭 전 네트워크 호출 없음(개발자도구 확인 — opt-in) ③답글 클릭→인라인 목록, 재클릭→접힘 ④리포스터→계정 목록+팔로워 ⑤`더 보기` 페이지네이션 ⑥없는 트윗 ID·네트워크 차단 시 "불러오기 실패 — 다시 시도" 인라인.

- [ ] **Step 5: Commit**

```bash
git add src/components/TweetExpansion.tsx src/components/TweetCard.tsx
git commit -m "feat(x-research): 카드 인라인 확장 — 답글/스레드/리포스터 opt-in 펼침, 커서 더보기, 저장 없음"
```

---

### Task 10: 최종 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전체 green (기존 + 신규 pillarStore 3·pillarStats 6·pillar 5·refreshColumn 1·getxapi 2·mappers 1).

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 통합 브라우저 시나리오 (스펙 데이터 흐름 재현)**

`npm run dev` 후: 계정 컬럼 새로고침 → 주제 분석 → 분석 시작 → ⭐/판정/표본기간 확인 → 주제 클릭 필터 → 트윗 저장 → 새로고침으로 새 트윗 유입 → "새 트윗 N건 분류" → 표 갱신 확인. 카드에서 답글 펼침 → 보관함 저장 판단에 활용되는지 확인. `리서치` 페이지가 변경 없는지 열어서 확인.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-Review 체크 (플랜 작성 후 완료)

- 스펙 커버리지: DB(§1→Task 1), 엔진(§2→Task 3), 통계·판정(§3→Task 2), API(§4→Task 4·5), 패널 UI(§5→Task 6), getxapi(§6→Task 7), 확장 UI(§7→Task 9), 프록시(§6→Task 8), 에러 처리(각 라우트·컴포넌트에 반영), 테스트(§테스트→각 태스크). 제외 항목(자동 분류·주제 편집·확장 저장·quotes) 구현 없음 확인.
- 타입 일관성: `PillarTopic`/`Assignment`는 pillarTypes.ts 단일 정의, `PillarPayload`는 pillarStats.ts 단일 정의를 서버·클라이언트가 공유. `listAnalysisTweets` 시그니처 Task 1 정의 = Task 4 사용 일치. `maxPagesOverride` Task 5 정의 = Task 6 백필 호출 일치.
