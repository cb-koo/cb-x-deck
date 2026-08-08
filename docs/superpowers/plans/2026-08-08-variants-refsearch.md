# 다중 시안 + 레퍼런스 검색·정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 조건으로 시안 N개(1콜 N변형)를 독립 초안 카드로 받는 다중 시안과, 레퍼런스 선택 시트의 클라이언트 사이드 검색·정렬을 구현한다.

**Architecture:** 다중 시안은 `generateDraft`가 `count`(기본 1)를 받아 count>1일 때만 variants 스키마·다양성 지시로 분기하고, 응답의 N변형을 같은 `batch_id`로 N행 삽입해 `string[]`를 반환한다(단일 경로의 프롬프트·스키마는 불변). 검색·정렬은 시트가 이미 전체 행을 로드하므로 순수 함수(`refSheetFilter.ts`)로 클라이언트에서 처리한다.

**Tech Stack:** Next.js 16(주의: 학습 데이터와 다름 — `node_modules/next/dist/docs/` 참조) · React 19 · postgres.js · node:test + tsx(실 DB)

**Spec:** `docs/superpowers/specs/2026-08-08-variants-refsearch-design.md`

## Global Constraints

- **UX 원칙 (AGENTS.md):** 라벨은 이득을 사용자 언어로 · 라벨-값 일치 · 기술 값 노출 최소화 · 비용 유발 액션은 opt-in
- **시안 수는 저장하지 않는다:** localStorage 저장 금지 + 생성 성공 후 1로 리셋 (비용이 조용히 N배가 되는 사고 경로 차단, 스펙 §1)
- **count===1이면 기존 경로 그대로:** 프롬프트·스키마·저장(batch null)이 현재와 바이트 단위로 동일해야 한다
- **형제 표시는 얇게:** 도구층 한 줄 `시안 B · 같은 조건 N개 중` — 그룹 접기/펼치기 금지 (사용자 확정)
- **검색·정렬은 세션용:** 저장하지 않고 시트를 다시 열면 초기화. 기본 정렬은 현행 서버 순서(메모 우선·최신) 유지
- **테스트:** `npm test`는 실 DB ~4분 — 개발 중엔 단일 파일 `node --import tsx --env-file-if-exists=.env --test <파일>`
- **린트 기준선 24개:** 새 에러/경고를 추가하지 않는다
- **주의: 이 워크트리 .env는 프로덕션 DB(풀러 6543)다** — 마이그레이션·DB 테스트가 프로덕션에 직접 적용된다(017은 nullable 컬럼 2개 추가라 구버전 앱과 안전 공존). 테스트는 반드시 자기 정리(P 접두사 + 삭제).
- **커밋 순서:** 서버(1~4) → 클라이언트(5~6) → 검색·정렬(7~8) → 마감(9)

---

## Phase A — 다중 시안

### Task 1: 마이그레이션 017 + draftStore batch 관통

**Files:**
- Create: `migrations/017_draft_batch.sql`
- Modify: `src/lib/draftStore.ts`
- Test: `src/lib/draftStore.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `DraftRow.batchId: string | null` · `DraftRow.variantIndex: number | null` · `insertDraft(sql, { …, batchId?: string | null, variantIndex?: number | null })` — Task 3·6이 사용

- [ ] **Step 1: 마이그레이션 작성 + 적용**

`migrations/017_draft_batch.sql`:

```sql
-- 017: 다중 시안 묶음 (스펙 2026-08-08-variants-refsearch-design.md §1)
-- 한 번의 생성(1콜 N변형)에서 나온 형제 시안들이 같은 batch_id를 공유한다.
-- 단일 생성은 둘 다 null — 기존 행과 동일. variant_index는 0부터(표시 라벨 A/B/C…).
alter table draft add column if not exists batch_id uuid;
alter table draft add column if not exists variant_index int;
```

Run: `npm run migrate`
Expected: 017 적용 로그, 에러 없음

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/draftStore.test.ts` 끝에 추가:

```ts
test('batch — 기본 null·삽입 왕복', async () => {
  const soloId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '단일', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const solo = await getDraft(sql, soloId);
  assert.equal(solo!.batchId, null);          // 단일 생성은 batch 없음 (기존 행과 동일)
  assert.equal(solo!.variantIndex, null);

  const batchId = crypto.randomUUID();
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    ids.push(await insertDraft(sql, {
      clientId: null, clientName: null, procedureNames: [],
      direction: P + '배치', format: 'single', referenceMode: 'off', refs: [],
      content, model: null, memberId: null, batchId, variantIndex: i,
    }));
  }
  const a = await getDraft(sql, ids[0]);
  const b = await getDraft(sql, ids[1]);
  assert.equal(a!.batchId, batchId);
  assert.equal(a!.variantIndex, 0);
  assert.equal(b!.batchId, batchId);
  assert.equal(b!.variantIndex, 1);

  for (const id of [soloId, ...ids]) await removeDraft(sql, id);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: FAIL — `insertDraft`가 `batchId`를 모르고 `DraftRow.batchId` 없음

- [ ] **Step 4: 구현**

`src/lib/draftStore.ts`에서:

`DraftRow`에 추가 (`status` 필드 아래):

```ts
  status: DraftStatus; // 결정 진행도 라벨 — 전이 제약 없음 (스펙 §2)
  batchId: string | null;      // 다중 시안 묶음 — 단일 생성은 null
  variantIndex: number | null; // 묶음 내 순번(0부터, 표시 라벨 A/B/C…)
```

`Row` 타입에 추가 (`status` 아래):

```ts
  status: DraftStatus;
  batch_id: string | null; variant_index: number | null;
```

`toRow`에 추가 (`status` 매핑 아래):

```ts
  status: r.status,
  batchId: r.batch_id, variantIndex: r.variant_index,
```

`SELECT` 컬럼 목록에 추가:

```ts
const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.dismissed_flags, d.status, d.batch_id, d.variant_index, d.model, d.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by`;
```

`insertDraft` 시그니처·INSERT에 추가:

```ts
export async function insertDraft(sql: postgres.Sql, input: {
  clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; model: string | null; memberId: string | null;
  batchId?: string | null; variantIndex?: number | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by, batch_id, variant_index)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId}, ${input.batchId ?? null}, ${input.variantIndex ?? null})
    returning id`;
  return rows[0].id;
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: PASS 전부 (기존 테스트 포함)

- [ ] **Step 6: Commit**

```bash
git add migrations/017_draft_batch.sql src/lib/draftStore.ts src/lib/draftStore.test.ts
git commit -m "feat(x-deck): draft.batch_id·variant_index — 다중 시안 묶음 저장 (마이그레이션 017, TDD)"
```

### Task 2: generatePrompt — 다양성 지시 + variants 스키마

**Files:**
- Modify: `src/lib/generatePrompt.ts`
- Test: `src/lib/generatePrompt.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `PromptInput.variantCount?: number` · `variantsOutputSchema(): object` — Task 3이 사용. `buildUserPrompt`·`draftOutputSchema` 기존 시그니처 불변

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/generatePrompt.test.ts` 끝에 추가 (기존 import 스타일에 `variantsOutputSchema` 추가):

```ts
test('variantCount>1 — 다양성 지시가 들어가고, 1이면 흔적도 없다', () => {
  const base = {
    client: null, procedures: [], references: [], mode: 'off' as const,
    direction: '테스트', format: 'single' as const, constraintsOn: false,
  };
  const multi = buildUserPrompt({ ...base, variantCount: 3 });
  assert.ok(multi.includes('시안 3개'));
  assert.ok(multi.includes('서로 다른 앵글'));
  const single = buildUserPrompt({ ...base, variantCount: 1 });
  const none = buildUserPrompt(base);
  assert.equal(single, none);                 // count 1 = 기존 프롬프트와 동일
  assert.ok(!none.includes('시안'));
});

test('variantsOutputSchema — variants 배열 스키마', () => {
  const s = variantsOutputSchema() as { properties: { variants: { items: { properties: object } } }; required: string[] };
  assert.deepEqual(s.required, ['variants']);
  assert.ok('posts' in s.properties.variants.items.properties);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generatePrompt.test.ts`
Expected: FAIL — `variantsOutputSchema` export 없음

- [ ] **Step 3: 구현**

`src/lib/generatePrompt.ts`에서:

`PromptInput`에 필드 추가 (`rewrite` 아래):

```ts
  rewrite?: { current: string[]; feedback?: string };
  // 다중 시안 — 2 이상이면 "서로 다른 앵글로 N개" 지시가 붙는다. 1/미지정 = 기존 프롬프트 그대로.
  variantCount?: number;
```

`buildUserPrompt`의 task 블록에서, 형식 지시(`task.push(i.format === 'single' …)`) **앞**에 추가:

```ts
  if ((i.variantCount ?? 1) > 1) {
    task.push(`이번 요청은 시안 ${i.variantCount}개입니다. 서로 다른 앵글·훅으로 ${i.variantCount}개를 만드세요.`,
      '시안끼리 첫 문장(훅)·소재 접근이 겹치면 안 됩니다.');
  }
```

파일 끝에 스키마 추가 (`draftOutputSchema`는 그대로 두고):

```ts
// 다중 시안용 — variants[n].posts 구조. 단일 생성은 기존 draftOutputSchema를 그대로 쓴다.
export function variantsOutputSchema(): object {
  return {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: draftOutputSchema(),
      },
    },
    required: ['variants'],
    additionalProperties: false,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generatePrompt.test.ts`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/lib/generatePrompt.ts src/lib/generatePrompt.test.ts
git commit -m "feat(x-deck): 프롬프트 다양성 지시(variantCount) + variants 출력 스키마 — count 1은 기존과 동일 (TDD)"
```

### Task 3: generateDraft — 1콜 N변형·N행 삽입·string[] 반환

**Files:**
- Modify: `src/lib/generate.ts`
- Modify: `src/app/api/drafts/route.ts:35` (반환 타입 대응 — 검증은 Task 4)
- Modify: `scripts/smoke-generate.ts:8`
- Test: `src/lib/generate.test.ts` (기존 파일 수정 + 추가)

**Interfaces:**
- Consumes: `insertDraft { batchId, variantIndex }` (Task 1) · `variantsOutputSchema`, `PromptInput.variantCount` (Task 2)
- Produces: `GenerateRequest.count?: number`(기본 1) · `generateDraft(...): Promise<string[]>` (삽입 순서 = variant 순서) — Task 4·5가 사용

- [ ] **Step 1: 기존 테스트의 반환 타입 대응 + 실패하는 테스트 작성**

`src/lib/generate.test.ts`에서 `const id = await generateDraft(` 형태 4곳(72·113·141·179행 부근)을 전부 `const [id] = await generateDraft(`로 바꾼다 (거부 케이스 40·51·194행은 반환을 안 쓰므로 그대로).

파일 끝에 추가 — 기존 테스트들이 쓰는 fake Anthropic client 패턴을 그대로 따른다(파일 상단의 기존 fake 정의를 참고해 같은 방식으로 variants 응답을 반환하는 fake를 만든다):

```ts
test('count 3 — 1콜로 variants 3개를 받아 3행 삽입, 같은 batch·순번', async () => {
  const fake = {
    messages: {
      create: async (params: { output_config?: { format?: { schema?: object } } }) => {
        // variants 스키마가 전달됐는지 확인
        const schema = JSON.stringify(params.output_config?.format?.schema ?? {});
        assert.ok(schema.includes('variants'));
        return {
          content: [{ type: 'text', text: JSON.stringify({ variants: [
            { posts: [{ text: '시안A本文' }] },
            { posts: [{ text: '시안B本文' }] },
            { posts: [{ text: '시안C本文' }] },
          ] }) }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
  const ids = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '다중', format: 'single', constraintsOn: false, memberId: null, count: 3,
  }, fake as never);
  assert.equal(ids.length, 3);
  const rows = await Promise.all(ids.map((id) => getDraft(sql, id)));
  assert.equal(rows[0]!.content.posts[0].text, '시안A本文');
  assert.equal(rows[2]!.content.posts[0].text, '시안C本文');
  assert.ok(rows[0]!.batchId);                                  // 묶음 생성됨
  assert.equal(rows[1]!.batchId, rows[0]!.batchId);             // 같은 묶음
  assert.deepEqual(rows.map((r) => r!.variantIndex), [0, 1, 2]);
  for (const id of ids) await removeDraft(sql, id);
});

test('count 1 — 기존과 동일: posts 스키마·batch null', async () => {
  const fake = {
    messages: {
      create: async (params: { output_config?: { format?: { schema?: object } } }) => {
        const schema = JSON.stringify(params.output_config?.format?.schema ?? {});
        assert.ok(!schema.includes('variants'));                // 단일은 기존 posts 스키마
        return {
          content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '単発本文' }] }) }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '단발', format: 'single', constraintsOn: false, memberId: null,
  }, fake as never);
  const row = await getDraft(sql, id);
  assert.equal(row!.batchId, null);
  assert.equal(row!.variantIndex, null);
  await removeDraft(sql, id);
});
```

주의: 이 파일의 기존 fake client 형태(필드명·removeDraft/정리 방식)를 먼저 읽고, 위 코드를 그 관례에 맞춰 조정한다 — import(`removeDraft`, `getDraft`, `crypto` 등)가 이미 있는지 확인하고 없으면 추가.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: FAIL — `count` 필드 없음 / 반환이 string이라 `ids.length` 없음 / `const [id]` 부분은 컴파일 단계 통과 후 기존 케이스도 함께 확인

- [ ] **Step 3: 구현**

`src/lib/generate.ts`에서:

import에 `variantsOutputSchema` 추가:

```ts
import { buildUserPrompt, draftOutputSchema, variantsOutputSchema, DRAFT_SYSTEM } from './generatePrompt.ts';
```

`GenerateRequest`에 추가:

```ts
export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; memberId: string | null;
  count?: number; // 시안 수 (1~5, 기본 1) — 라우트가 범위 검증
}
```

`generateDraft`를 다음으로 교체 (검증·재료 로드 부분은 그대로, 프롬프트 이후만 분기):

```ts
export async function generateDraft(
  sql: postgres.Sql, req: GenerateRequest, client?: AnthropicLike,
): Promise<string[]> {
  const count = req.count ?? 1;
  const hasClient = !!req.clientId;
  const hasRefs = req.refTweetIds.length > 0 && req.mode !== 'off';
  const hasDirection = req.direction.trim().length > 0;
  if (!hasClient && !hasRefs && !hasDirection) {
    throw new GenerateInputError('클라이언트·레퍼런스·방향성 중 최소 하나는 필요해요');
  }
  if (req.refTweetIds.length > MAX_REFS) {
    throw new GenerateInputError(`레퍼런스는 ${MAX_REFS}건까지 고를 수 있어요 — 서로 다른 앵글로 3~5건이 가장 좋아요`);
  }

  // 재료 로드
  const clientData = req.clientId ? await getClientWithProcedures(sql, req.clientId) : null;
  if (req.clientId && !clientData) throw new GenerateInputError('클라이언트를 찾을 수 없어요 — 목록을 새로고침해 주세요');
  const procedures = (clientData?.procedures ?? []).filter((p) => req.procedureIds.includes(p.id));
  const refRows = hasRefs ? await getReferencesByIds(sql, req.refTweetIds) : [];
  const refs: RefSnapshot[] = refRows.map((r) => ({
    tweetId: r.tweetId, handle: r.authorHandle, name: r.authorName,
    excerpt: r.text, memos: r.memos,
  }));
  if (hasRefs && refs.length < req.refTweetIds.length) {
    throw new GenerateInputError(
      `레퍼런스 ${req.refTweetIds.length - refs.length}건을 보관함에서 찾을 수 없어요 — 목록을 새로고침해 주세요`);
  }

  // 프롬프트 → LLM (구조화 출력) — count 1이면 기존 posts 스키마·프롬프트 그대로 (스펙 §1)
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: refs, mode: hasRefs ? req.mode : 'off',
    direction: req.direction, format: req.format, constraintsOn: req.constraintsOn,
    ...(count > 1 ? { variantCount: count } : {}),
  });
  const res = await callLLM('anthropic.draft', {
    model: CONTENT_MODEL(),
    max_tokens: 16000, // Opus 5는 thinking 기본 ON — thinking+응답 합산 상한이라 여유 필요
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: count > 1 ? variantsOutputSchema() : draftOutputSchema() } },
  }, client);

  // 파싱 — 구조화 출력이라 JSON 보장이 원칙이나, 방어적으로 검증
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let variants: Array<{ posts: Array<{ text: string }> }>;
  try {
    variants = count > 1
      ? (JSON.parse(text) as { variants: Array<{ posts: Array<{ text: string }> }> }).variants
      : [JSON.parse(text) as { posts: Array<{ text: string }> }];
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  const bad = (v: { posts?: Array<{ text?: string }> }) =>
    !Array.isArray(v?.posts) || v.posts.length === 0 || v.posts.some((p) => typeof p?.text !== 'string' || !p.text.trim());
  if (!Array.isArray(variants) || variants.length === 0 || variants.some(bad)) {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  // 모델이 count보다 적게/많게 반환하면 받은 만큼만 — 도착한 카드 수가 곧 사실 (스펙 §3)
  variants = variants.slice(0, count);

  const batchId = count > 1 ? crypto.randomUUID() : null;
  const ids: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const content: DraftContent = { posts: variants[i].posts.map((p) => ({ text: p.text, media: [] })) };
    ids.push(await insertDraft(sql, {
      clientId: req.clientId, clientName: clientData?.client.name ?? null,
      procedureNames: procedures.map((p) => p.name),
      direction: req.direction, format: req.format,
      referenceMode: hasRefs ? req.mode : 'off', refs,
      content, model: CONTENT_MODEL(), memberId: req.memberId,
      batchId, variantIndex: batchId ? i : null,
    }));
  }
  return ids;
}
```

`src/app/api/drafts/route.ts`의 POST에서 (count 검증은 Task 4 — 여기선 컴파일만 맞춘다):

```ts
    const ids = await generateDraft(sql, {
      clientId: body.clientId ?? null,
      procedureIds: body.procedureIds ?? [],
      refTweetIds: body.refTweetIds ?? [],
      mode: body.mode ?? 'off',
      direction: body.direction ?? '',
      format: body.format === 'thread' ? 'thread' : 'single',
      constraintsOn: !!body.constraintsOn,
      count: body.count,
      memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(브리핑 관례)
    });
    return NextResponse.json(await Promise.all(ids.map((id) => getDraft(sql, id))));
```

`scripts/smoke-generate.ts:8`: `const id = await generateDraft(sql, {` → `const [id] = await generateDraft(sql, {`

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: PASS 전부 (기존 케이스 포함)

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/lib/generate.ts src/lib/generate.test.ts src/app/api/drafts/route.ts scripts/smoke-generate.ts
git commit -m "feat(x-deck): generateDraft 다중 시안 — 1콜 N변형·같은 batch로 N행 삽입·string[] 반환, count 1은 기존 경로 그대로 (TDD)"
```

### Task 4: POST 라우트 — count 검증 + 배열 응답 확정

**Files:**
- Modify: `src/app/api/drafts/route.ts`

**Interfaces:**
- Consumes: `GenerateRequest.count` (Task 3)
- Produces: `POST /api/drafts` body `{ …, count?: number }`, 1~5 벗어나면 400 `{ error: '시안 수는 1~5 사이여야 해요' }`, 응답은 항상 `DraftRow[]` — Task 5가 사용

- [ ] **Step 1: 검증 추가**

`src/app/api/drafts/route.ts`의 POST에서 기존 `mode`/배열 검증 블록 아래에 추가:

```ts
  if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 5)) {
    return NextResponse.json({ error: '시안 수는 1~5 사이여야 해요' }, { status: 400 });
  }
```

body 캐스팅 타입에 count 포함 — `as Partial<GenerateRequest>`는 Task 3에서 count가 GenerateRequest에 들어갔으므로 그대로 동작한다. Task 3에서 이미 응답을 배열로 바꿨으니 이 태스크는 검증만 추가.

- [ ] **Step 2: 린트 + 타입 확인**

Run: `npm run lint 2>&1 | tail -3` 그리고 `npx tsc --noEmit 2>&1 | tail -3`
Expected: 기준선 24 · 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/api/drafts/route.ts
git commit -m "feat(x-deck): POST /api/drafts count 검증 — 정수 1~5 아니면 400"
```

### Task 5: 컴포저 시안 수 입력 + page 배열 수용

**Files:**
- Modify: `src/components/DraftComposer.tsx`
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `POST /api/drafts` 배열 응답 + `count` body (Task 4)
- Produces: `ComposerState.count: number` (DEFAULT_COMPOSER에 `count: 1`) — Task 6과 독립

- [ ] **Step 1: ComposerState에 count + 입력 UI + 동적 캡션**

`src/components/DraftComposer.tsx`에서:

```ts
export interface ComposerState {
  clientId: string | null; procedureIds: string[];
  format: DraftFormat; mode: ReferenceMode; constraintsOn: boolean; direction: string;
  count: number; // 시안 수 (1~5) — 저장하지 않고 생성 후 1로 리셋 (스펙 §1, 비용 opt-in)
}
export const DEFAULT_COMPOSER: ComposerState = {
  clientId: null, procedureIds: [], format: 'single', mode: 'both', constraintsOn: false, direction: '',
  count: 1,
};
```

요약줄(`summary` 배열)에 항목 추가 — `value.constraintsOn ? '생성 제약 켬' : null` 앞에:

```ts
    value.count > 1 ? `시안 ${value.count}개` : null,
```

비용 캡션(기존 84~90행)을 count 반영형으로 교체:

```tsx
        {!generating && (
          <p className="mt-1 text-caption text-x-muted">
            {canGenerate
              ? `${COST_CAPTION}${value.count > 1 ? ` × ${value.count}` : ''}${clients.length > 0 && !value.clientId ? " · 클라이언트 정보 없이 만들어요 — '바꾸기'에서 선택할 수 있어요" : ''}`
              : '클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요'}
          </p>
        )}
```

접힘 패널의 '생성 제약' 라벨 **위**에 행 추가:

```tsx
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">시안 수</span>
              <input type="number" min={1} max={5} value={value.count}
                     onChange={(e) => onChange({ ...value, count: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                     className="w-16 rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue" />
              <span className="text-caption text-x-secondary">서로 다른 앵글로 여러 개 만들어 하나 이상 골라요 — 개수만큼 비용·시간이 늘어요</span>
            </label>
```

- [ ] **Step 2: page — count 전송·배열 수용·스켈레톤 문구·리셋**

`src/app/generate/page.tsx`에서:

localStorage 저장 시 count 제외 (`updateComposer`):

```ts
  const updateComposer = useCallback((v: ComposerState) => {
    setComposer(v);
    localStorage.setItem(COMPOSER_KEY, JSON.stringify({ ...v, direction: '', count: 1 })); // 방향성·시안 수는 매번 새로
  }, []);
```

`generate()`에서 — 요청에 count 포함, 응답 배열 수용, 성공 후 count 리셋:

```ts
      const src = {
        clientId: composer.clientId, procedureIds: composer.procedureIds,
        refTweetIds: refRows.map((x) => x.tweetId),
        mode: refRows.length > 0 ? composer.mode : 'off',
        direction: composer.direction, format: composer.format,
        count: composer.count,
      };
      const r = await apiFetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ ...src, constraintsOn: composer.constraintsOn }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const created = body as DraftRow[];
      setDrafts((cur) => [...created, ...cur]);
      // 방금 만든 초안이 현재 필터에 가려 안 보이면 필터를 전체로 — 생성 결과가 소리 없이 사라지지 않게 (T11 리뷰 반영)
      setFilter((f) => (filterDrafts(created, f).length > 0 ? f : { status: 'all', clientId: '' }));
      setComposer((c) => ({ ...c, count: 1 })); // 시안 수는 1회용 — 다음 생성이 조용히 N배 비용이 되지 않게
```

`generate()` 시작부에 이번 생성 개수 기억 (스켈레톤 문구용) — `genStartedAt.current = Date.now();` 아래:

```ts
    genCount.current = composer.count;
```

ref 선언부에 추가:

```ts
  const genCount = useRef(1); // 이번 생성의 시안 수 — 스켈레톤 문구용
```

스켈레톤 문구(기존 `원고 작성 중… 보통 15~30초 걸려요` p 태그)를 교체:

```tsx
          <p className="mt-2 text-ui text-x-secondary">
            {genCount.current > 1 ? `시안 ${genCount.current}개 작성 중… 개수만큼 조금 더 걸려요` : '원고 작성 중… 보통 15~30초 걸려요'}
          </p>
```

- [ ] **Step 3: 린트 + 타입 확인**

Run: `npm run lint 2>&1 | tail -3` 그리고 `npx tsc --noEmit 2>&1 | tail -3`
Expected: 기준선 24 · 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/components/DraftComposer.tsx src/app/generate/page.tsx
git commit -m "feat(x-deck): 시안 수 입력(1~5·1회용·동적 비용 캡션) + 생성 응답 배열 수용·스켈레톤 개수 문구"
```

### Task 6: 형제 표시 — 라벨 헬퍼 + DraftCard 도구층

**Files:**
- Modify: `src/lib/draftUi.ts`
- Modify: `src/components/DraftCard.tsx`
- Modify: `src/app/generate/page.tsx`
- Test: `src/lib/draftUi.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `DraftRow.batchId`·`variantIndex` (Task 1)
- Produces: `variantLabel(index: number): string` · `siblingCount(drafts: Array<{ batchId: string | null }>, batchId: string): number` · `DraftCard` props에 `siblingTotal: number | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/draftUi.test.ts` 끝에 추가 (import에 `variantLabel, siblingCount` 추가):

```ts
test('variantLabel — 0부터 A·B·C…', () => {
  assert.equal(variantLabel(0), 'A');
  assert.equal(variantLabel(1), 'B');
  assert.equal(variantLabel(4), 'E');
});

test('siblingCount — 같은 batch만 센다 (삭제되면 정직하게 줄어듦)', () => {
  const drafts = [
    { batchId: 'b1' }, { batchId: 'b1' }, { batchId: 'b2' }, { batchId: null },
  ];
  assert.equal(siblingCount(drafts, 'b1'), 2);
  assert.equal(siblingCount(drafts, 'b2'), 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: FAIL — export 없음

- [ ] **Step 3: 헬퍼 구현**

`src/lib/draftUi.ts` 끝에 추가:

```ts
// 다중 시안 형제 표시 (스펙 §1 얇은 표시) — variant_index → A/B/C…
export function variantLabel(index: number): string {
  return String.fromCharCode(65 + index); // 시안 수 상한 5라 Z 초과 없음
}

// "같은 조건 N개 중"의 N — 로드된 목록 기준. 형제가 삭제되면 줄어든다(라벨-값 일치).
export function siblingCount(drafts: Array<{ batchId: string | null }>, batchId: string): number {
  return drafts.filter((d) => d.batchId === batchId).length;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: PASS 전부

- [ ] **Step 5: DraftCard 표시 + page 연결**

`src/components/DraftCard.tsx`에서:

import 추가:

```tsx
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags, variantLabel } from '@/lib/draftUi';
```

props에 `siblingTotal` 추가 (구조 분해와 타입 둘 다 — `onChangeStatus` 뒤):

```tsx
  onChangeStatus: (s: DraftStatus) => void;
  siblingTotal: number | null; // 다중 시안 형제 수 (batch 없으면 null)
```

도구층 상태 칩 행(`<DraftStatusChip …/>` 감싸는 div)에 형제 표시 추가:

```tsx
        <div className="flex items-center gap-2 pb-1">
          <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
          {draft.batchId !== null && siblingTotal !== null && (
            <span className="text-caption text-x-muted">
              시안 {variantLabel(draft.variantIndex ?? 0)} · 같은 조건 {siblingTotal}개 중
            </span>
          )}
        </div>
```

`src/app/generate/page.tsx`의 `<DraftCard …>` 호출에 prop 추가 (import에 `siblingCount` 추가 — 기존 draftUi import 줄에 합침):

```tsx
                   onChangeStatus={(s) => changeStatus(d, s)}
                   siblingTotal={d.batchId ? siblingCount(drafts, d.batchId) : null} />
```

- [ ] **Step 6: 린트 확인 + Commit**

Run: `npm run lint 2>&1 | tail -3`
Expected: 기준선 24

```bash
git add src/lib/draftUi.ts src/lib/draftUi.test.ts src/components/DraftCard.tsx src/app/generate/page.tsx
git commit -m "feat(x-deck): 시안 형제 표시 — '시안 B · 같은 조건 N개 중' 도구층 얇은 표시 (variantLabel·siblingCount TDD)"
```

## Phase B — 레퍼런스 시트 검색·정렬

### Task 7: refSheetFilter — 검색 매칭·정렬 순수 함수

**Files:**
- Create: `src/lib/refSheetFilter.ts`
- Test: `src/lib/refSheetFilter.test.ts`

**Interfaces:**
- Consumes: `ReferenceRow` (referenceStore) — `{ text, authorName, authorHandle, memos[{member,text}], tags[], metrics{likes,views,bookmarks,…}, addedAt }`
- Produces: `type RefSortKey = 'default' | 'likes' | 'views' | 'bookmarks' | 'recent'` · `REF_SORT_LABEL: Record<RefSortKey, string>` · `matchesRefSearch(row, query, translation?): boolean` · `sortRefRows(rows, key): ReferenceRow[]` — Task 8이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/refSheetFilter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRefSearch, sortRefRows, REF_SORT_LABEL, type RefSortKey } from './refSheetFilter.ts';
import type { ReferenceRow } from './referenceStore.ts';

const row = (over: Partial<ReferenceRow>): ReferenceRow => ({
  tweetId: 't1', authorHandle: 'mika', authorName: 'みか', authorAvatarUrl: null,
  text: 'ウルセラの体験談', media: [], likes: null,
  metrics: { views: null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
  memos: [{ member: '박구건', text: '앵글이 신선' }], tags: ['시술후기'],
  workspaces: [], addedAt: '2026-08-01T00:00:00Z',
  ...over,
});

test('matchesRefSearch — 본문·작성자·메모·태그·번역문, 토큰 AND, 대소문자 무시', () => {
  const r = row({});
  assert.ok(matchesRefSearch(r, 'ウルセラ'));                    // 본문
  assert.ok(matchesRefSearch(r, 'MIKA'));                        // 핸들, 대소문자 무시
  assert.ok(matchesRefSearch(r, '앵글'));                        // 메모
  assert.ok(matchesRefSearch(r, '시술후기'));                    // 태그
  assert.ok(matchesRefSearch(r, '울쎄라', '울쎄라 체험담'));      // 번역문(있을 때만)
  assert.ok(!matchesRefSearch(r, '울쎄라'));                     // 번역문 없으면 미매칭
  assert.ok(matchesRefSearch(r, 'ウルセラ 신선'));               // 토큰 AND (본문+메모)
  assert.ok(!matchesRefSearch(r, 'ウルセラ 없는말'));            // 하나라도 없으면 탈락
  assert.ok(matchesRefSearch(r, '  '));                          // 빈 검색 = 전부 통과
});

test('sortRefRows — 지표 내림차순·null 뒤로·동률은 addedAt 최신·default는 원본 순서', () => {
  const a = row({ tweetId: 'a', metrics: { ...row({}).metrics, likes: 10 }, addedAt: '2026-08-01T00:00:00Z' });
  const b = row({ tweetId: 'b', metrics: { ...row({}).metrics, likes: 30 }, addedAt: '2026-08-02T00:00:00Z' });
  const c = row({ tweetId: 'c', metrics: { ...row({}).metrics, likes: null }, addedAt: '2026-08-03T00:00:00Z' });
  const d = row({ tweetId: 'd', metrics: { ...row({}).metrics, likes: 30 }, addedAt: '2026-08-04T00:00:00Z' });

  assert.deepEqual(sortRefRows([a, b, c, d], 'likes').map((x) => x.tweetId), ['d', 'b', 'a', 'c']); // 동률 30은 최신(d) 먼저, null은 맨 뒤
  assert.deepEqual(sortRefRows([a, b, c, d], 'recent').map((x) => x.tweetId), ['d', 'c', 'b', 'a']);
  assert.deepEqual(sortRefRows([b, a, c, d], 'default').map((x) => x.tweetId), ['b', 'a', 'c', 'd']); // 서버 순서 그대로
  const keys: RefSortKey[] = ['default', 'likes', 'views', 'bookmarks', 'recent'];
  for (const k of keys) assert.ok(REF_SORT_LABEL[k].length > 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refSheetFilter.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/refSheetFilter.ts`:

```ts
import type { ReferenceRow } from './referenceStore.ts';

// 레퍼런스 시트 검색·정렬 (스펙 §2) — 전부 클라이언트 사이드 세션용 렌즈.
// 서버 기본 순서(메모 우선·최신)는 'default'가 그대로 보존한다.

export type RefSortKey = 'default' | 'likes' | 'views' | 'bookmarks' | 'recent';

export const REF_SORT_LABEL: Record<RefSortKey, string> = {
  default: '기본 (메모 우선·최신)', likes: '좋아요순', views: '조회순', bookmarks: '북마크순', recent: '최신순',
};

// 검색 대상: 본문·작성자(이름+핸들)·메모(작성자명 포함)·태그·번역문(캐시에 있을 때만).
// 공백으로 나눈 모든 토큰이 매칭돼야 통과(AND), 대소문자 무시.
export function matchesRefSearch(row: ReferenceRow, query: string, translation?: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [
    row.text, row.authorName ?? '', row.authorHandle,
    ...row.memos.flatMap((m) => [m.member, m.text]),
    ...row.tags,
    translation ?? '',
  ].join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const METRIC: Record<Exclude<RefSortKey, 'default' | 'recent'>, (r: ReferenceRow) => number> = {
  likes: (r) => r.metrics.likes ?? -1,      // null 지표는 맨 뒤
  views: (r) => r.metrics.views ?? -1,
  bookmarks: (r) => r.metrics.bookmarks ?? -1,
};

export function sortRefRows(rows: ReferenceRow[], key: RefSortKey): ReferenceRow[] {
  if (key === 'default') return rows;
  const byAdded = (a: ReferenceRow, b: ReferenceRow) => Date.parse(b.addedAt) - Date.parse(a.addedAt);
  if (key === 'recent') return [...rows].sort(byAdded);
  const metric = METRIC[key];
  return [...rows].sort((a, b) => (metric(b) - metric(a)) || byAdded(a, b)); // 동률은 최신순
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refSheetFilter.test.ts`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/lib/refSheetFilter.ts src/lib/refSheetFilter.test.ts
git commit -m "feat(x-deck): 레퍼런스 검색 매칭·정렬 순수 함수 — 본문·작성자·메모·태그·번역문 AND 검색, 지표 정렬·최신 tie-break (TDD)"
```

### Task 8: RefPickerSheet — 검색 입력·정렬 셀렉트 통합

**Files:**
- Modify: `src/components/RefPickerSheet.tsx`

**Interfaces:**
- Consumes: `matchesRefSearch`, `sortRefRows`, `REF_SORT_LABEL`, `RefSortKey` (Task 7) · `useTranslations().translations` (`Record<tweetId, { content }>`)
- Produces: 없음 (컴포넌트 내부)

- [ ] **Step 1: 상태·파생값 추가**

`src/components/RefPickerSheet.tsx`에서:

import 추가:

```tsx
import { matchesRefSearch, sortRefRows, REF_SORT_LABEL, type RefSortKey } from '@/lib/refSheetFilter';
```

`tag` 상태 아래에 추가:

```tsx
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<RefSortKey>('default');
```

시트를 열 때 초기화 (세션용 렌즈 — 기존 `if (open) setSel(selectedIds)` effect에 합친다):

```tsx
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 시트를 열 때마다 상위 선택값으로 재동기화(기존 코드베이스 관례)
  useEffect(() => { if (open) { setSel(selectedIds); setQuery(''); setSortKey('default'); } }, [open, selectedIds]);
```

`visible` 파생을 교체 (기존 `const visible = tag ? rows.filter(...) : rows;`):

```tsx
  const visible = useMemo(() => {
    const tagged = tag ? rows.filter((r) => r.tags.includes(tag)) : rows;
    const searched = tagged.filter((r) => matchesRefSearch(r, query, translations[r.tweetId]?.content));
    return sortRefRows(searched, sortKey);
  }, [rows, tag, query, sortKey, translations]);
```

- [ ] **Step 2: UI — 필터 행에 검색 입력 + 정렬 셀렉트**

기존 필터 행(범위 세그먼트·태그 칩·전체 번역 버튼이 있는 div)의 태그 칩들 **뒤**, `전체 번역` 버튼 앞에 추가:

```tsx
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="본문·작성자·메모·태그·번역문 검색"
                 aria-label="레퍼런스 검색"
                 className="min-w-[180px] flex-1 rounded-md border border-x-border-strong bg-white px-2 py-1 text-ui outline-none focus:border-x-blue" />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as RefSortKey)}
                  aria-label="레퍼런스 정렬"
                  className="rounded-md border border-x-border-strong bg-white px-2 py-1 text-caption outline-none focus:border-x-blue">
            {(Object.keys(REF_SORT_LABEL) as RefSortKey[]).map((k) => (
              <option key={k} value={k}>{REF_SORT_LABEL[k]}</option>
            ))}
          </select>
```

- [ ] **Step 3: 검색 결과 0건 상태**

기존 빈 상태(`보관함이 비어 있어요 …`) 아래에, 보관함엔 있는데 검색으로 빈 경우를 추가:

```tsx
          {loaded && rows.length > 0 && visible.length === 0 && (
            <p className="p-4 text-ui text-x-secondary">검색과 일치하는 레퍼런스가 없어요 — 검색어를 줄이거나 태그·정렬을 바꿔보세요.</p>
          )}
```

기존 빈 상태의 조건은 `loaded && rows.length === 0`으로 좁힌다 (현재 `visible.length === 0` 기준이면 두 안내가 겹친다).

- [ ] **Step 4: 린트 + 수동 시나리오 확인**

Run: `npm run lint 2>&1 | tail -3`
Expected: 기준선 24

수동 확인(사용자 QA로 대체 가능): ① 검색어 입력 → 즉시 좁혀짐 ② 번역 켠 트윗은 한국어로도 검색됨 ③ 좋아요순 → 지표 없는 행이 맨 뒤 ④ 검색 중 선택 유지("N / 8 선택" 불변) ⑤ 시트 재오픈 시 검색·정렬 초기화.

- [ ] **Step 5: Commit**

```bash
git add src/components/RefPickerSheet.tsx
git commit -m "feat(x-deck): 레퍼런스 시트 검색·정렬 — 번역문까지 훑는 AND 검색 + 지표순 정렬(세션용, 선택 유지)"
```

### Task 9: README 현행화 + 전체 검증

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: 없음

- [ ] **Step 1: README 갱신**

`README.md`의 "콘텐츠 생성 (원고)" 섹션에 기존 문체로 반영:

- 다중 시안: "시안 수(1~5)를 정하면 한 번의 생성으로 서로 다른 앵글의 시안이 각각 초안 카드로 도착한다 — 여러 개를 동시에 채택 가능(각각 상태 변경). 시안 수는 저장되지 않고 매번 1로 돌아온다(비용 opt-in)"
- 레퍼런스 시트: "검색(본문·작성자·메모·태그·번역문)과 정렬(기본·좋아요·조회·북마크·최신)" 추가
- 스키마 한 줄의 draft 컬럼 나열에 `batch_id`·`variant_index` 추가

- [ ] **Step 2: 전체 검증**

Run: `npm test 2>&1 | tail -6` (실 DB, ~4분+)
Expected: 전부 PASS

Run: `npm run lint 2>&1 | tail -3`
Expected: 기준선 24

Run: `npm run build 2>&1 | tail -5`
Expected: 빌드 성공

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(x-deck): README 현행화 — 다중 시안·레퍼런스 검색·정렬"
```

---

## 배포 메모 (플랜 범위 밖)

- 마이그레이션 017은 Task 1에서 프로덕션 DB에 바로 적용된다(.env=프로덕션 — nullable 컬럼 2개라 구버전 앱과 안전 공존). 코드 배포는 main 머지 후 `vercel --prod`(사용자 실행, 권한 정책).
- 다중 시안 실호출 스모크는 비용이 count배 — 기존 `npm run smoke:generate`(단일)로 충분, 다중은 사용자 QA에서 1회.
