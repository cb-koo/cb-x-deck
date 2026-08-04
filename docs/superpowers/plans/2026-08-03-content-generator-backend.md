# 콘텐츠 생성 백엔드 (Plan 1/2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 `docs/superpowers/specs/2026-08-03-content-generator-design.md`의 데이터 모델·생성 파이프라인·API를 구현한다 (UI는 Plan 2).

**Architecture:** 마이그레이션(client·client_procedure·draft) → 순수 lib(가중 글자수·검수 플래그·프롬프트 조립) → 스토어(clientStore·referenceStore·draftStore) → `callLLM` 확장(구조화 출력·refusal) → 오케스트레이션(`generate.ts`) → 얇은 API 라우트. 모든 로직은 `src/lib/`에 두고 라우트는 프록시만 한다(레포 관례).

**Tech Stack:** Next.js 16 App Router, postgres.js, `node:test`(실 Supabase, `test-` 접두 자가 정리), `@anthropic-ai/sdk`(기존 `callLLM` 경유), 신규 의존성 0.

## Global Constraints

- 모델: `CONTENT_MODEL ?? 'claude-opus-5'` — 이 기능만. 다른 기능의 `MODEL()`(haiku)은 건드리지 않는다
- `max_tokens: 16000` (Opus 5는 thinking 기본 ON, thinking+응답 합산 상한)
- 레퍼런스 상한 **8건**, 3요소(클라이언트·레퍼런스·방향성) 중 **최소 1개** 필수
- `format`은 `'single' | 'thread'`, `reference_mode`는 `'off' | 'form' | 'angle' | 'both'`
- `draft.content`는 `{posts:[{text, media:[]}]}` — 원본 불변, 편집은 `edited` 컬럼
- 스냅샷: `client_name`·`procedure_names`·`refs`(발췌+메모)를 초안에 고정 저장
- 에러 메시지는 비개발자용 평문 한국어(브리핑 라우트 관례), 스택·코드 노출 금지
- 테스트: `node:test` + `assert/strict`, 실 DB, `test-` 접두 데이터 `after`에서 정리, 파일 단독 실행 `node --import tsx --env-file-if-exists=.env --test <파일>`
- 커밋 메시지는 레포 관례(한국어, `feat(x-deck):` 식 접두)를 따른다
- 린트 기준선 24개 유지 (`npm run lint` 경고 수가 늘면 안 됨)

---

### Task 1: 마이그레이션 014 — client·client_procedure·draft

**Files:**
- Create: `migrations/014_content_generator.sql`

**Interfaces:**
- Produces: 테이블 `client`, `client_procedure`, `draft` (이후 모든 스토어 태스크가 사용)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 014: 콘텐츠 생성 — 클라이언트(최상위 엔티티)·시술·초안. 재실행 안전.
-- 클라이언트는 워크스페이스에 속하지 않는다(워크스페이스는 목적별 복수 생성됨).
create table if not exists client (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  info text not null default '',              -- 클리닉·의사 자유 서술
  banned_phrases jsonb not null default '[]', -- string[] — 생성 제약(옵션)·검수 기준(상시) 양쪽에 사용
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists client_procedure (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  name text not null,
  description text not null default '',
  effect_phrases text not null default '',    -- 효과·결과로 쓸 수 있는 표현(자유 서술)
  banned_phrases jsonb not null default '[]',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_procedure_client on client_procedure (client_id);

-- 초안: 최상위(워크스페이스 FK 없음). 근거 재현을 위해 생성 시점 스냅샷을 함께 저장(briefing.content 선례).
create table if not exists draft (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references client(id) on delete set null,
  client_name text,                            -- 스냅샷 — 클라 수정·삭제 후에도 풋터 재현
  procedure_names jsonb not null default '[]', -- string[] 스냅샷
  direction text not null default '',          -- 방향성(선택 사항 — 3요소 중 하나)
  format text not null check (format in ('single','thread')),
  reference_mode text not null check (reference_mode in ('off','form','angle','both')),
  refs jsonb not null default '[]',            -- RefSnapshot[] ("references"는 SQL 예약어라 refs)
  content jsonb not null,                      -- DraftContent {posts:[{text, media:[]}]} 생성 원본. 불변
  edited jsonb,                                -- 편집본(동일 모양). null = 미편집
  dismissed_flags jsonb not null default '[]', -- string[] — "kind:term" 키
  model text,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_draft_created on draft (created_at desc);
create index if not exists idx_draft_client on draft (client_id);
```

- [ ] **Step 2: 적용**

Run: `npm run migrate`
Expected: 에러 없이 종료 (기존 001~013도 재실행 안전이라 전체 적용됨)

- [ ] **Step 3: 테이블 존재 확인**

Run:
```bash
node --import tsx --env-file-if-exists=.env --input-type=module -e "
const { getSql } = await import('./src/lib/db.ts');
const sql = getSql();
console.log(await sql\`select to_regclass('client') as c, to_regclass('client_procedure') as p, to_regclass('draft') as d\`);
await sql.end();"
```
Expected: `[ { c: 'client', p: 'client_procedure', d: 'draft' } ]`

- [ ] **Step 4: Commit**

```bash
git add migrations/014_content_generator.sql
git commit -m "feat(x-deck): 콘텐츠 생성 스키마 — client·client_procedure·draft (014)"
```

---

### Task 2: `xLength` — X 가중 글자수

**Files:**
- Create: `src/lib/xLength.ts`
- Test: `src/lib/xLength.test.ts`

**Interfaces:**
- Produces: `xWeightedLength(text: string): number`, `X_MAX_WEIGHTED = 280` (Plan 2의 카운터·본 플랜 프롬프트 규칙 문구가 사용)

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/xLength.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xWeightedLength, X_MAX_WEIGHTED } from './xLength.ts';

test('라틴 1자 = 1', () => {
  assert.equal(xWeightedLength('abc'), 3);
  assert.equal(xWeightedLength(''), 0);
});
test('CJK 1자 = 2 (일본어 140자 = 280)', () => {
  assert.equal(xWeightedLength('こんにちは'), 10);
  assert.equal(xWeightedLength('施術'), 4);
  assert.equal(xWeightedLength('aこ'), 3);
});
test('이모지 = 2', () => {
  assert.equal(xWeightedLength('🙌'), 2);
});
test('URL은 길이와 무관하게 23', () => {
  assert.equal(xWeightedLength('https://example.com/very/long/path?with=query'), 23);
  // 'text ' (5) + URL(23) + ' end' (4)
  assert.equal(xWeightedLength('text https://a.io/x end'), 32);
});
test('상한 상수', () => {
  assert.equal(X_MAX_WEIGHTED, 280);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/xLength.test.ts`
Expected: FAIL — `Cannot find module './xLength.ts'`

- [ ] **Step 3: 구현** — `src/lib/xLength.ts`

```ts
// X(트위터) 가중 글자수 — 공식 twitter-text 설정의 경량 근사(가이드용, 차단하지 않음).
// 규칙: URL은 t.co 단축으로 항상 23 / 아래 '경량 범위' 코드포인트는 1 / 나머지(CJK·이모지 등)는 2.
// 한계(스펙 명시): ZWJ 결합 이모지는 과대 계산될 수 있다 — 실제 검증은 게시 시점에 X가 한다.
const URL_RE = /https?:\/\/[^\s]+/g;
const URL_WEIGHT = 23;
// twitter-text v3 config의 weight-1 범위
const LIGHT: Array<[number, number]> = [
  [0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037],
];

export const X_MAX_WEIGHTED = 280; // 무료 계정 상한 — 일본어 환산 약 140자

export function xWeightedLength(text: string): number {
  if (!text) return 0;
  let total = 0;
  const rest = text.replace(URL_RE, () => { total += URL_WEIGHT; return ''; });
  for (const ch of rest) {
    const cp = ch.codePointAt(0) as number;
    total += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  return total;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/xLength.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/xLength.ts src/lib/xLength.test.ts
git commit -m "feat(x-deck): X 가중 글자수 근사 계산 xWeightedLength"
```

---

### Task 3: `complianceFlags` 확장 — 초안 검수 플래그

**Files:**
- Modify: `src/lib/complianceFlags.ts` (기존 `flagYakkiho`는 변경 금지 — 트윗 카드가 사용 중)
- Test: `src/lib/complianceFlags.test.ts` (기존 테스트에 추가)

**Interfaces:**
- Consumes: 기존 `flagYakkiho(text): string[]`
- Produces: `draftFlags(text: string, banned?: string[]): DraftFlag[]`, `flagKey(f: DraftFlag): string`, `interface DraftFlag { term; reason; kind: 'yakkiho'|'medical_ad'|'banned' }` (Plan 2 표식 UI와 dismissed_flags 매칭이 사용)

- [ ] **Step 1: 실패하는 테스트 추가** — `src/lib/complianceFlags.test.ts` 하단에 append

```ts
import { draftFlags, flagKey } from './complianceFlags.ts';

test('draftFlags: 약기법 용어는 kind=yakkiho', () => {
  const f = draftFlags('効果があるらしい');
  assert.ok(f.some((x) => x.kind === 'yakkiho' && x.term === '効果がある'));
});
test('draftFlags: 체험담·비포애프터 힌트는 kind=medical_ad', () => {
  const f = draftFlags('施術を受けてみた。ビフォーはこちら');
  assert.ok(f.some((x) => x.kind === 'medical_ad' && x.term === '受けてみた'));
  assert.ok(f.some((x) => x.kind === 'medical_ad' && x.term === 'ビフォー'));
});
test('draftFlags: 클라이언트 금지어는 kind=banned', () => {
  const f = draftFlags('B클리닉より安い', ['B클리닉']);
  assert.deepEqual(f.filter((x) => x.kind === 'banned').map((x) => x.term), ['B클리닉']);
});
test('draftFlags: 매칭 없으면 빈 배열, flagKey는 kind:term', () => {
  assert.deepEqual(draftFlags('新作コスメの紹介', []), []);
  assert.equal(flagKey({ term: '効く', reason: 'r', kind: 'yakkiho' }), 'yakkiho:効く');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/complianceFlags.test.ts`
Expected: FAIL — `draftFlags` export 없음

- [ ] **Step 3: 구현** — `src/lib/complianceFlags.ts`에 추가 (기존 코드 아래)

```ts
// ── 초안 검수 플래그 ──────────────────────────────────────────────
// 기존 flagYakkiho와 같은 원칙: 법률 자문이 아니라 담당자 확인용 표식이며 차단·필터링하지 않는다.
export interface DraftFlag { term: string; reason: string; kind: 'yakkiho' | 'medical_ad' | 'banned' }

// dismissed_flags 매칭 키
export const flagKey = (f: DraftFlag): string => `${f.kind}:${f.term}`;

// 医療広告ガイドライン 힌트(체험담·비포애프터) — 시드로 시작해 운영하며 보강
const MEDICAL_AD_TERMS: Array<{ term: string; reason: string }> = [
  { term: 'してみた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '行ってきた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '受けてみた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '体験', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: 'ビフォー', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'アフター', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'before', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'after', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
];

export function draftFlags(text: string, banned: string[] = []): DraftFlag[] {
  if (!text) return [];
  const flags: DraftFlag[] = flagYakkiho(text).map((term) => ({
    term, reason: '효과 단정 표현 — 약기법', kind: 'yakkiho' as const,
  }));
  for (const { term, reason } of MEDICAL_AD_TERMS) {
    if (text.includes(term)) flags.push({ term, reason, kind: 'medical_ad' });
  }
  for (const p of banned) {
    if (p && text.includes(p)) flags.push({ term: p, reason: '클라이언트 금지 표현', kind: 'banned' });
  }
  return flags;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/complianceFlags.test.ts`
Expected: PASS (기존 3 + 신규 4)

- [ ] **Step 5: Commit**

```bash
git add src/lib/complianceFlags.ts src/lib/complianceFlags.test.ts
git commit -m "feat(x-deck): 초안 검수 플래그 draftFlags — 약기법+의료광고 힌트+클라 금지어"
```

---

### Task 4: `callLLM` 확장 — 파라미터 패스스루·refusal + opus-5 단가

**Files:**
- Modify: `src/lib/llm.ts`
- Modify: `src/lib/usagePricing.ts` (`ANTHROPIC_PRICES`에 1줄)
- Test: `src/lib/llm.test.ts` (기존 테스트에 추가)

**Interfaces:**
- Consumes: 기존 `callLLM(operation, params, client?)`, `AnthropicLike`
- Produces: `params`에 임의 추가 필드(`system`, `output_config` 등) 허용 / `LLMResponse.stop_reason?: string` / `class LLMRefusalError` (Task 9와 라우트가 사용)

- [ ] **Step 1: 실패하는 테스트 추가** — `src/lib/llm.test.ts` 하단에 append

먼저 파일 상단의 기존 `./llm.ts` import 문을 열어 `LLMRefusalError`가 포함되도록 **기존 import 문을 수정**한다(새 import 문을 추가하면 중복 import로 깨진다). 그 다음 아래 테스트를 append:

```ts
test('refusal 응답이면 LLMRefusalError를 던진다', async () => {
  const fake: AnthropicLike = {
    messages: { create: async () => ({ content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }) },
  };
  await assert.rejects(
    callLLM('test-refusal', { model: 'test', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, fake),
    LLMRefusalError,
  );
});

test('추가 파라미터(system·output_config)가 SDK 호출에 그대로 전달된다', async () => {
  let received: Record<string, unknown> = {};
  const fake: AnthropicLike = {
    messages: { create: async (p: object) => { received = p as Record<string, unknown>; return { content: [{ type: 'text', text: 'ok' }] }; } },
  };
  await callLLM('test-passthrough', {
    model: 'test', max_tokens: 10, messages: [{ role: 'user', content: 'x' }],
    system: 'SYS', output_config: { format: { type: 'json_schema' } },
  }, fake);
  assert.equal(received.system, 'SYS');
  assert.ok(received.output_config);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/llm.test.ts`
Expected: FAIL — `LLMRefusalError` export 없음 (또는 타입 에러: `system` 필드 불허)

- [ ] **Step 3: 구현** — `src/lib/llm.ts` 수정 3곳

(1) `LLMResponse`에 `stop_reason` 추가:
```ts
export interface LLMResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}
```
(2) 에러 클래스 추가 (interface들 아래):
```ts
// Opus 계열 안전 분류기는 거절을 HTTP 200 + stop_reason: 'refusal' + 빈 content로 반환한다.
// 빈 응답을 정상 취급하지 않도록 명시적 에러로 승격 — 호출부가 평문 안내로 매핑한다.
export class LLMRefusalError extends Error {
  constructor() { super('안전 분류기가 이 요청을 거절했어요'); this.name = 'LLMRefusalError'; }
}
```
(3) `callLLM` 시그니처의 params 타입을 넓히고, 사용량 기록 **후** refusal을 던진다:
```ts
export async function callLLM(
  operation: string,
  params: { model: string; max_tokens: number; messages: object[] } & Record<string, unknown>,
  client?: AnthropicLike,
): Promise<LLMResponse> {
```
함수 끝부분(기존 `recordUsageSafe({...})` 호출 다음, `return res;` 앞)에 추가:
```ts
  if (res.stop_reason === 'refusal') throw new LLMRefusalError();
```

(4) `src/lib/usagePricing.ts`의 `ANTHROPIC_PRICES`에 추가 (기존 3개 항목 아래):
```ts
  'claude-opus-5': { in: 5, out: 25 },
```
> 없으면 미등록 모델이 haiku 단가로 조용히 계산되어 콘텐츠 생성 비용이 1/5로 저평가된다. (미등록 모델의 "단가 미등록" 표시화는 별도 백로그)

- [ ] **Step 4: 통과 확인 (기존 테스트 포함 회귀 없음)**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/llm.test.ts src/lib/usagePricing.test.ts`
Expected: PASS 전체

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts src/lib/llm.test.ts src/lib/usagePricing.ts
git commit -m "feat(x-deck): callLLM 확장 — 파라미터 패스스루·refusal 승격 + opus-5 단가"
```

---

### Task 5: `clientStore` — 클라이언트·시술 CRUD

**Files:**
- Create: `src/lib/clientStore.ts`
- Test: `src/lib/clientStore.test.ts`

**Interfaces:**
- Consumes: Task 1 테이블, `getSql`
- Produces (Task 9·10이 사용):
  - `interface ClientRow { id; name; info; bannedPhrases: string[]; position: number }`
  - `interface ProcedureRow { id; clientId; name; description; effectPhrases: string; bannedPhrases: string[]; position: number }`
  - `createClient(sql, name): Promise<ClientRow>` / `listClients(sql): Promise<ClientRow[]>`
  - `getClientWithProcedures(sql, id): Promise<{ client: ClientRow; procedures: ProcedureRow[] } | null>`
  - `updateClient(sql, id, patch: { name?; info?; bannedPhrases?: string[] }): Promise<void>`
  - `deleteClient(sql, id)` / `createProcedure(sql, clientId, input)` / `updateProcedure(sql, id, patch)` / `deleteProcedure(sql, id)`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/clientStore.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  createClient, listClients, getClientWithProcedures, updateClient, deleteClient,
  createProcedure, updateProcedure, deleteProcedure,
} from './clientStore.ts';

const sql = getSql();
const P = 'test-cl-' + process.pid + '-';

after(async () => {
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('client CRUD 왕복 + banned_phrases 배열', async () => {
  const c = await createClient(sql, P + 'A클리닉');
  assert.equal(c.name, P + 'A클리닉');
  assert.deepEqual(c.bannedPhrases, []);

  await updateClient(sql, c.id, { info: '개원 10년', bannedPhrases: ['B클리닉'] });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.info, '개원 10년');
  assert.deepEqual(got!.client.bannedPhrases, ['B클리닉']);
  assert.deepEqual(got!.procedures, []);

  assert.ok((await listClients(sql)).some((x) => x.id === c.id));
  await deleteClient(sql, c.id);
  assert.equal(await getClientWithProcedures(sql, c.id), null);
});

test('procedure CRUD + client 삭제 시 cascade', async () => {
  const c = await createClient(sql, P + 'B클리닉');
  const p = await createProcedure(sql, c.id, { name: '보톡스', description: '주름 완화', effectPhrases: '표정 주름이 부드러워짐' });
  assert.equal(p.clientId, c.id);

  await updateProcedure(sql, p.id, { effectPhrases: '눈가 주름 완화', bannedPhrases: ['半永久'] });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.procedures.length, 1);
  assert.equal(got!.procedures[0].effectPhrases, '눈가 주름 완화');
  assert.deepEqual(got!.procedures[0].bannedPhrases, ['半永久']);

  await deleteProcedure(sql, p.id);
  assert.equal((await getClientWithProcedures(sql, c.id))!.procedures.length, 0);

  const p2 = await createProcedure(sql, c.id, { name: '리쥬란' });
  await deleteClient(sql, c.id);
  const orphan = await sql`select id from client_procedure where id = ${p2.id}`;
  assert.equal(orphan.length, 0); // cascade
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/clientStore.ts`

```ts
import type postgres from 'postgres';

export interface ClientRow { id: string; name: string; info: string; bannedPhrases: string[]; position: number }
export interface ProcedureRow {
  id: string; clientId: string; name: string; description: string;
  effectPhrases: string; bannedPhrases: string[]; position: number;
}

type CRow = { id: string; name: string; info: string; banned_phrases: string[]; position: number };
type PRow = { id: string; client_id: string; name: string; description: string; effect_phrases: string; banned_phrases: string[]; position: number };

const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position });
const toProcedure = (r: PRow): ProcedureRow =>
  ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description,
     effectPhrases: r.effect_phrases, bannedPhrases: r.banned_phrases, position: r.position });

export async function createClient(sql: postgres.Sql, name: string): Promise<ClientRow> {
  const rows = await sql<CRow[]>`
    insert into client (name) values (${name})
    returning id, name, info, banned_phrases, position`;
  return toClient(rows[0]);
}

export async function listClients(sql: postgres.Sql): Promise<ClientRow[]> {
  const rows = await sql<CRow[]>`
    select id, name, info, banned_phrases, position from client order by position, created_at`;
  return rows.map(toClient);
}

export async function getClientWithProcedures(
  sql: postgres.Sql, id: string,
): Promise<{ client: ClientRow; procedures: ProcedureRow[] } | null> {
  const rows = await sql<CRow[]>`
    select id, name, info, banned_phrases, position from client where id = ${id}`;
  if (rows.length === 0) return null;
  const procs = await sql<PRow[]>`
    select id, client_id, name, description, effect_phrases, banned_phrases, position
      from client_procedure where client_id = ${id} order by position, created_at`;
  return { client: toClient(rows[0]), procedures: procs.map(toProcedure) };
}

export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[] },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases)
    where id = ${id}`;
}

export async function deleteClient(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from client where id = ${id}`;
}

export async function createProcedure(
  sql: postgres.Sql, clientId: string,
  input: { name: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<ProcedureRow> {
  const rows = await sql<PRow[]>`
    insert into client_procedure (client_id, name, description, effect_phrases, banned_phrases)
    values (${clientId}, ${input.name}, ${input.description ?? ''}, ${input.effectPhrases ?? ''},
            ${sql.json(input.bannedPhrases ?? [])})
    returning id, client_id, name, description, effect_phrases, banned_phrases, position`;
  return toProcedure(rows[0]);
}

export async function updateProcedure(
  sql: postgres.Sql, id: string,
  patch: { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<void> {
  await sql`update client_procedure set
      name = coalesce(${patch.name ?? null}, name),
      description = coalesce(${patch.description ?? null}, description),
      effect_phrases = coalesce(${patch.effectPhrases ?? null}, effect_phrases),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases)
    where id = ${id}`;
}

export async function deleteProcedure(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from client_procedure where id = ${id}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/clientStore.ts src/lib/clientStore.test.ts
git commit -m "feat(x-deck): clientStore — 클라이언트·시술 CRUD"
```

---

### Task 6: `referenceStore` — 보관함 전역 읽기

**Files:**
- Create: `src/lib/referenceStore.ts`
- Test: `src/lib/referenceStore.test.ts`

**Interfaces:**
- Consumes: 기존 테이블 `library_item`·`candidate`·`candidate_tag`·`tag`·`tweet`·`workspace`·`member`
- Produces (Task 9·11이 사용):
  - `interface ReferenceRow { tweetId; authorHandle; authorName: string|null; authorAvatarUrl: string|null; text; likes: number|null; memos: Array<{member: string; text: string}>; tags: string[]; workspaces: Array<{id: string; name: string}>; addedAt: string }`
  - `listReferences(sql, opts: { scope: 'all' | { workspaceId: string }; tag?: string }): Promise<ReferenceRow[]>` — 같은 트윗은 1행 병합(메모 전부+출처), **메모 있는 것 우선** 정렬
  - `getReferencesByIds(sql, tweetIds: string[]): Promise<ReferenceRow[]>` — 전역 스코프

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/referenceStore.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { listReferences, getReferencesByIds } from './referenceStore.ts';

const sql = getSql();
const P = 'test-ref-' + process.pid + '-';
const T1 = P + 'tw1';
const T2 = P + 'tw2';

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;   // candidate·library_item cascade
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql`delete from tag where name like ${P + '%'}`;
  await sql.end();
});

test('전역 병합: 같은 트윗은 1행 + 메모 전부 + 출처 워크스페이스, 메모 우선 정렬', async () => {
  const wsA = await createWorkspace(sql, P + 'wsA');
  const wsB = await createWorkspace(sql, P + 'wsB');
  const [m] = await sql<Array<{ id: string }>>`
    insert into member (name) values (${P + 'm'}) returning id`;
  await sql`insert into tweet (tweet_id, author_handle, text, metrics)
            values (${T1}, 'mika', '正直迷ってた', ${sql.json({ likes: 10 })}),
                   (${T2}, 'rina', 'メモなしツイート', ${sql.json({})})`;
  // T1은 두 워크스페이스에, T2는 A에만
  await sql`insert into library_item (workspace_id, tweet_id) values
            (${wsA.id}, ${T1}), (${wsB.id}, ${T1}), (${wsA.id}, ${T2})`;
  // 메모는 wsA·wsB 각 1건 (T1), T2는 저장만
  const [c1] = await sql<Array<{ id: string }>>`
    insert into candidate (tweet_id, workspace_id, member_id, memo)
    values (${T1}, ${wsA.id}, ${m.id}, '앵글이 신선') returning id`;
  await sql`insert into candidate (tweet_id, workspace_id, member_id, memo)
            values (${T1}, ${wsB.id}, ${m.id}, '형식 재사용')`;
  const [tg] = await sql<Array<{ id: string }>>`
    insert into tag (name) values (${P + '형식'}) returning id`;
  await sql`insert into candidate_tag (candidate_id, tag_id) values (${c1.id}, ${tg.id})`;

  try {
    const all = (await listReferences(sql, { scope: 'all' })).filter((r) => r.tweetId.startsWith(P));
    assert.equal(all.length, 2);
    assert.equal(all[0].tweetId, T1);                      // 메모 있는 것 우선
    assert.equal(all[0].memos.length, 2);                  // 두 워크스페이스 메모 병합
    assert.equal(all[0].workspaces.length, 2);
    assert.equal(all[0].likes, 10);
    assert.ok(all[0].tags.includes(P + '형식'));
    assert.equal(all[1].tweetId, T2);
    assert.equal(all[1].memos.length, 0);

    // 워크스페이스 스코프: wsB에는 T1만, 메모는 wsB 것만
    const scoped = (await listReferences(sql, { scope: { workspaceId: wsB.id } }))
      .filter((r) => r.tweetId.startsWith(P));
    assert.equal(scoped.length, 1);
    assert.deepEqual(scoped[0].memos.map((x) => x.text), ['형식 재사용']);

    // 태그 필터
    const tagged = (await listReferences(sql, { scope: 'all', tag: P + '형식' }))
      .filter((r) => r.tweetId.startsWith(P));
    assert.deepEqual(tagged.map((r) => r.tweetId), [T1]);

    // getReferencesByIds
    const byIds = await getReferencesByIds(sql, [T1]);
    assert.equal(byIds.length, 1);
    assert.equal(byIds[0].memos.length, 2);
  } finally {
    await deleteWorkspace(sql, wsA.id);
    await deleteWorkspace(sql, wsB.id);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/referenceStore.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/referenceStore.ts`

```ts
import type postgres from 'postgres';

// 보관함 전역 읽기 — 레퍼런스 선택용 (스펙 §2 /api/references, 보관함 구조 A안).
// 트윗 본체(tweet)는 전역 PK이므로 워크스페이스 간 병합은 소속(library_item)·메모(candidate) 차원에서만 일어난다.
export interface ReferenceRow {
  tweetId: string; authorHandle: string; authorName: string | null; authorAvatarUrl: string | null;
  text: string; likes: number | null;
  memos: Array<{ member: string; text: string }>;
  tags: string[];
  workspaces: Array<{ id: string; name: string }>;
  addedAt: string;
}

type ItemRow = {
  tweet_id: string; added_at: Date; workspace_id: string; workspace_name: string;
  author_handle: string; author_name: string | null; author_avatar_url: string | null;
  text: string; likes: number | null;
};
type CandRow = { tweet_id: string; memo: string; member_name: string; tags: string[] };

async function fetchRows(
  sql: postgres.Sql,
  scope: 'all' | { workspaceId: string },
  tweetIds: string[] | null,
): Promise<ReferenceRow[]> {
  const wsItems = scope === 'all' ? sql`true` : sql`li.workspace_id = ${scope.workspaceId}`;
  const idFilter = tweetIds ? sql`li.tweet_id in ${sql(tweetIds)}` : sql`true`;
  const items = await sql<ItemRow[]>`
    select li.tweet_id, li.added_at, li.workspace_id, w.name as workspace_name,
           t.author_handle, t.author_name, t.author_avatar_url, t.text,
           nullif(t.metrics->>'likes', '')::int as likes
      from library_item li
      join tweet t on t.tweet_id = li.tweet_id
      join workspace w on w.id = li.workspace_id
     where ${wsItems} and ${idFilter}
     order by li.added_at desc`;
  if (items.length === 0) return [];

  const ids = [...new Set(items.map((r) => r.tweet_id))];
  const wsCands = scope === 'all' ? sql`true` : sql`c.workspace_id = ${scope.workspaceId}`;
  const cands = await sql<CandRow[]>`
    select c.tweet_id, c.memo, m.name as member_name,
           coalesce(array_agg(tg.name) filter (where tg.name is not null), '{}') as tags
      from candidate c
      join member m on m.id = c.member_id
      left join candidate_tag ct on ct.candidate_id = c.id
      left join tag tg on tg.id = ct.tag_id
     where c.tweet_id in ${sql(ids)} and ${wsCands}
     group by c.id, m.name
     order by c.saved_at`;

  const byTweet = new Map<string, ReferenceRow>();
  for (const r of items) {
    const cur = byTweet.get(r.tweet_id);
    if (cur) { cur.workspaces.push({ id: r.workspace_id, name: r.workspace_name }); continue; }
    byTweet.set(r.tweet_id, {
      tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
      authorAvatarUrl: r.author_avatar_url, text: r.text, likes: r.likes,
      memos: [], tags: [], workspaces: [{ id: r.workspace_id, name: r.workspace_name }],
      addedAt: r.added_at.toISOString(),
    });
  }
  for (const c of cands) {
    const row = byTweet.get(c.tweet_id);
    if (!row) continue;
    if (c.memo.trim()) row.memos.push({ member: c.member_name, text: c.memo });
    for (const t of c.tags) if (!row.tags.includes(t)) row.tags.push(t);
  }
  // 메모 있는 것 우선(메모=teaching note가 생성 품질에 직접 기여), 그 안에서 최근 저장순
  return [...byTweet.values()].sort((a, b) =>
    (b.memos.length > 0 ? 1 : 0) - (a.memos.length > 0 ? 1 : 0) || b.addedAt.localeCompare(a.addedAt));
}

export async function listReferences(
  sql: postgres.Sql,
  opts: { scope: 'all' | { workspaceId: string }; tag?: string },
): Promise<ReferenceRow[]> {
  const rows = await fetchRows(sql, opts.scope, null);
  return opts.tag ? rows.filter((r) => r.tags.includes(opts.tag as string)) : rows;
}

export async function getReferencesByIds(sql: postgres.Sql, tweetIds: string[]): Promise<ReferenceRow[]> {
  if (tweetIds.length === 0) return [];
  return fetchRows(sql, 'all', tweetIds);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/referenceStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/referenceStore.ts src/lib/referenceStore.test.ts
git commit -m "feat(x-deck): referenceStore — 보관함 전역 읽기(트윗 병합·메모 우선·태그 필터)"
```

---

### Task 7: `draftTypes` + `generatePrompt` — 프롬프트 조립 (순수 함수)

**Files:**
- Create: `src/lib/draftTypes.ts`
- Create: `src/lib/generatePrompt.ts`
- Test: `src/lib/generatePrompt.test.ts`

**Interfaces:**
- Consumes: `DeckMedia` (`src/lib/types.ts`), `X_MAX_WEIGHTED` (Task 2)
- Produces (Task 8·9·12와 Plan 2가 사용):
  - `draftTypes.ts`: `DraftPost { text: string; media: DeckMedia[] }` / `DraftContent { posts: DraftPost[] }` / `DraftFormat = 'single'|'thread'` / `ReferenceMode = 'off'|'form'|'angle'|'both'` / `RefSnapshot { tweetId; handle; name: string|null; excerpt: string; memos: Array<{member; text}> }`
  - `generatePrompt.ts`: `DRAFT_SYSTEM: string` / `buildUserPrompt(input: PromptInput): string` / `draftOutputSchema(): object` / `interface PromptInput`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/generatePrompt.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, draftOutputSchema, type PromptInput } from './generatePrompt.ts';

const base: PromptInput = {
  client: null, procedures: [], references: [], mode: 'off',
  direction: '', format: 'single', constraintsOn: false,
};
const client = { name: 'A클리닉', info: '개원 10년, 원장 직접 시술', bannedPhrases: ['B클리닉'] };
const ref = { tweetId: 't1', handle: 'mika', name: 'みか', excerpt: '正直迷ってた',
              memos: [{ member: '박구건', text: '앵글이 신선' }] };

test('꺼진 요소의 블록은 프롬프트에 부재한다 (반영 토글 계약)', () => {
  const p = buildUserPrompt({ ...base, direction: '다운타임 강조' });
  assert.ok(!p.includes('클라이언트 정보'));
  assert.ok(!p.includes('레퍼런스'));
  assert.ok(p.includes('다운타임 강조'));
});

test('클라이언트+시술 블록 포함, 금지어는 constraintsOn일 때만', () => {
  const proc = { name: '보톡스', description: '주름 완화', effectPhrases: '주름이 부드러워짐', bannedPhrases: ['半永久'] };
  const off = buildUserPrompt({ ...base, client, procedures: [proc], direction: 'x' });
  assert.ok(off.includes('A클리닉') && off.includes('보톡스') && off.includes('주름이 부드러워짐'));
  assert.ok(!off.includes('B클리닉') && !off.includes('半永久'));
  const on = buildUserPrompt({ ...base, client, procedures: [proc], direction: 'x', constraintsOn: true });
  assert.ok(on.includes('B클리닉') && on.includes('半永久'));
});

test('참고 모드별 지시 차이 + 메모(팀 메모) 포함 + 표절 금지 상시', () => {
  const form = buildUserPrompt({ ...base, references: [ref], mode: 'form' });
  assert.ok(form.includes('형식') && !form.includes('앵글만 참고'));
  const angle = buildUserPrompt({ ...base, references: [ref], mode: 'angle' });
  assert.ok(angle.includes('앵글'));
  assert.ok(form.includes('팀 메모') && form.includes('앵글이 신선'));
  assert.ok(form.includes('그대로 옮기지'));
});

test('mode=off면 레퍼런스가 있어도 블록 부재', () => {
  const p = buildUserPrompt({ ...base, references: [ref], mode: 'off', direction: 'x' });
  assert.ok(!p.includes('正直迷ってた'));
});

test('형식 규칙: single=1개·thread=3~5개, 첫 단락 훅 규칙 포함', () => {
  const s = buildUserPrompt({ ...base, direction: 'x', format: 'single' });
  assert.ok(s.includes('1개') && s.includes('첫 단락'));
  const t = buildUserPrompt({ ...base, direction: 'x', format: 'thread' });
  assert.ok(t.includes('3~5'));
});

test('avoid(다른 각도로) 포함', () => {
  const p = buildUserPrompt({ ...base, direction: 'x', avoid: '실패담 앵글' });
  assert.ok(p.includes('실패담 앵글') && p.includes('다른 각도'));
});

test('출력 스키마: posts 배열 필수', () => {
  const s = draftOutputSchema() as { properties: { posts: object }; required: string[] };
  assert.ok(s.properties.posts);
  assert.deepEqual(s.required, ['posts']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generatePrompt.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — 먼저 `src/lib/draftTypes.ts`

```ts
import type { DeckMedia } from './types.ts';

// 초안 본문 — 단문은 posts 1개, 스레드는 N개. 미디어는 반드시 포스트 단위(스레드는 트윗마다 이미지가 따로 붙음).
// v1은 media를 항상 빈 배열로 저장하고 렌더는 MediaGrid에 위임(0건 → null) — 이미지 확장 지점(스펙 '향후 확장').
export interface DraftPost { text: string; media: DeckMedia[] }
export interface DraftContent { posts: DraftPost[] }
export type DraftFormat = 'single' | 'thread';
export type ReferenceMode = 'off' | 'form' | 'angle' | 'both';

// 생성 시점 레퍼런스 스냅샷 — 메모는 이후 수정될 수 있으므로 생성에 쓴 것을 박제(근거 풋터 재현)
export interface RefSnapshot {
  tweetId: string; handle: string; name: string | null;
  excerpt: string;
  memos: Array<{ member: string; text: string }>;
}
```

이어서 `src/lib/generatePrompt.ts`:

```ts
import { X_MAX_WEIGHTED } from './xLength.ts';
import type { DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export interface PromptInput {
  client: { name: string; info: string; bannedPhrases: string[] } | null;
  procedures: Array<{ name: string; description: string; effectPhrases: string; bannedPhrases: string[] }>;
  references: RefSnapshot[];
  mode: ReferenceMode;
  direction: string;
  format: DraftFormat;
  constraintsOn: boolean;
  avoid?: string; // '다른 각도로' — 피할 접근
}

export const DRAFT_SYSTEM =
  '당신은 일본 미용의료 마케팅의 X(트위터) 카피라이터입니다. ' +
  '인플루언서가 자기 계정에 올릴 자연스러운 일본어 포스트 초안을 작성합니다. ' +
  '광고 문구처럼 읽히지 않는 개인 포스트 톤을 유지하고, 해시태그는 0~2개만 사용합니다.';

const MODE_RULE: Record<Exclude<ReferenceMode, 'off'>, string> = {
  form: '아래 레퍼런스의 형식(문장 구조·길이·줄바꿈·이모지 사용·전개 방식)만 참고하세요. 소재·내용은 가져오지 마세요.',
  angle: '아래 레퍼런스가 소재를 다룬 각도(앵글)만 참고하세요. 문장 형식은 따라 하지 마세요.',
  both: '아래 레퍼런스의 형식과 앵글을 함께 참고하세요.',
};

export function buildUserPrompt(i: PromptInput): string {
  const blocks: string[] = [];

  // 1) 클라이언트 블록 — 고정 정보를 앞에 (같은 클라 반복 생성 시 프롬프트 캐시 최적화)
  if (i.client) {
    const lines = [`## 클라이언트 정보: ${i.client.name}`, i.client.info];
    for (const p of i.procedures) {
      lines.push(`### 시술: ${p.name}`, p.description);
      if (p.effectPhrases) lines.push(`효과·결과로 쓸 수 있는 표현: ${p.effectPhrases}`);
    }
    blocks.push(lines.filter(Boolean).join('\n'));
  }

  // 2) 레퍼런스 블록 — 메모 = teaching note (예시마다 "무엇이 좋은지"를 앞세우는 방식)
  if (i.mode !== 'off' && i.references.length > 0) {
    const lines = [`## 레퍼런스 (${i.references.length}건)`, MODE_RULE[i.mode],
      '레퍼런스 문구를 그대로 옮기지 마세요(표절 금지).'];
    i.references.forEach((r, n) => {
      lines.push(`### 레퍼런스 ${n + 1} (@${r.handle})`);
      for (const m of r.memos) lines.push(`팀 메모(참고 포인트): ${m.text} — ${m.member}`);
      lines.push(r.excerpt);
    });
    blocks.push(lines.join('\n'));
  }

  // 3) 이번 작업 지시 — 가변 정보는 뒤에
  const task = ['## 이번 초안'];
  if (i.direction.trim()) task.push(`방향성: ${i.direction.trim()}`);
  if (i.avoid) task.push(`이전 초안과 다른 각도로 접근하세요. 피할 접근: ${i.avoid}`);
  task.push(i.format === 'single'
    ? `형식: 단문 포스트 1개. 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내.`
    : `형식: 스레드 3~5개 포스트. 각 포스트는 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내. 1번 포스트가 훅.`);
  task.push('첫 단락이 훅입니다 — 빈 줄 전까지의 첫 단락만 읽어도 관심이 생기게 쓰세요.');
  if (i.constraintsOn) {
    const banned = [...(i.client?.bannedPhrases ?? []), ...i.procedures.flatMap((p) => p.bannedPhrases)];
    if (banned.length > 0) task.push(`금지 표현(절대 사용 금지): ${banned.join(', ')}`);
  }
  blocks.push(task.join('\n'));

  return blocks.join('\n\n');
}

// 구조화 출력 스키마 — extractJson 정규식 대신 output_config.format으로 형식을 강제
export function draftOutputSchema(): object {
  return {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['posts'],
    additionalProperties: false,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generatePrompt.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftTypes.ts src/lib/generatePrompt.ts src/lib/generatePrompt.test.ts
git commit -m "feat(x-deck): 초안 프롬프트 조립 — 3요소 토글 계약·참고 모드·구조화 출력 스키마"
```

---

### Task 8: `draftStore` — 초안 CRUD

**Files:**
- Create: `src/lib/draftStore.ts`
- Test: `src/lib/draftStore.test.ts`

**Interfaces:**
- Consumes: Task 1 `draft` 테이블, Task 7 타입, `Member` (`src/lib/types.ts`)
- Produces (Task 9·12와 Plan 2가 사용):
  - `interface DraftRow { id; clientId: string|null; clientName: string|null; procedureNames: string[]; direction; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[]; content: DraftContent; edited: DraftContent|null; dismissedFlags: string[]; model: string|null; createdAt: string; member: Member|null }`
  - `insertDraft(sql, input): Promise<string>` / `listDrafts(sql, opts: { clientId?: string; limit?: number }): Promise<DraftRow[]>` / `getDraft(sql, id): Promise<DraftRow|null>`
  - `updateDraft(sql, id, patch: { edited?: DraftContent; dismissedFlags?: string[] }): Promise<void>` / `removeDraft(sql, id): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/draftStore.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, listDrafts, getDraft, updateDraft, removeDraft } from './draftStore.ts';
import { createClient, deleteClient } from './clientStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'test-dr-' + process.pid + '-';
const content: DraftContent = { posts: [{ text: '正直迷ってた。\n\nでも良かった。', media: [] }] };

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('insert→list→get→update(edited·dismissed)→remove 왕복 + 스냅샷', async () => {
  const c = await createClient(sql, P + 'A클리닉');
  const id = await insertDraft(sql, {
    clientId: c.id, clientName: c.name, procedureNames: ['보톡스'],
    direction: P + '다운타임 강조', format: 'single', referenceMode: 'both',
    refs: [{ tweetId: 't1', handle: 'mika', name: 'みか', excerpt: '正直迷ってた',
             memos: [{ member: '박구건', text: '앵글이 신선' }] }],
    content, model: 'claude-opus-5', memberId: null,
  });

  const list = await listDrafts(sql, { clientId: c.id });
  assert.equal(list.length, 1);
  assert.equal(list[0].clientName, c.name);
  assert.deepEqual(list[0].procedureNames, ['보톡스']);
  assert.equal(list[0].refs[0].memos[0].text, '앵글이 신선');
  assert.equal(list[0].edited, null);
  assert.equal(list[0].model, 'claude-opus-5');

  // 클라이언트 삭제 후에도 스냅샷으로 재현 (client_id는 set null)
  await deleteClient(sql, c.id);
  const afterDel = await getDraft(sql, id);
  assert.equal(afterDel!.clientId, null);
  assert.equal(afterDel!.clientName, c.name);

  const edited: DraftContent = { posts: [{ text: '修正版', media: [] }] };
  await updateDraft(sql, id, { edited, dismissedFlags: ['yakkiho:効果がある'] });
  const got = await getDraft(sql, id);
  assert.deepEqual(got!.edited, edited);
  assert.deepEqual(got!.content, content);          // 원본 불변
  assert.deepEqual(got!.dismissedFlags, ['yakkiho:効果がある']);

  await removeDraft(sql, id);
  assert.equal(await getDraft(sql, id), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/draftStore.ts`

```ts
import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export interface DraftRow {
  id: string; clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null; dismissedFlags: string[];
  model: string | null; createdAt: string; member: Member | null;
}

type Row = {
  id: string; client_id: string | null; client_name: string | null; procedure_names: string[];
  direction: string; format: DraftFormat; reference_mode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null; dismissed_flags: string[];
  model: string | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

const toRow = (r: Row): DraftRow => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, procedureNames: r.procedure_names,
  direction: r.direction, format: r.format, referenceMode: r.reference_mode, refs: r.refs,
  content: r.content, edited: r.edited, dismissedFlags: r.dismissed_flags,
  model: r.model, createdAt: r.created_at.toISOString(),
  member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
});

const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.dismissed_flags, d.model, d.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by`;

export async function insertDraft(sql: postgres.Sql, input: {
  clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; model: string | null; memberId: string | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId})
    returning id`;
  return rows[0].id;
}

export async function listDrafts(
  sql: postgres.Sql, opts: { clientId?: string; limit?: number } = {},
): Promise<DraftRow[]> {
  const where = opts.clientId ? sql`where d.client_id = ${opts.clientId}` : sql``;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} ${where}
    order by d.created_at desc
    limit ${opts.limit ?? 50}`;
  return rows.map(toRow);
}

export async function getDraft(sql: postgres.Sql, id: string): Promise<DraftRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function updateDraft(
  sql: postgres.Sql, id: string,
  patch: { edited?: DraftContent; dismissedFlags?: string[] },
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags)
    where id = ${id}`;
}

export async function removeDraft(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from draft where id = ${id}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftStore.ts src/lib/draftStore.test.ts
git commit -m "feat(x-deck): draftStore — 초안 CRUD·스냅샷·원본/편집본 분리"
```

---

### Task 9: `generate` — 생성 오케스트레이션

**Files:**
- Create: `src/lib/generate.ts`
- Test: `src/lib/generate.test.ts`

**Interfaces:**
- Consumes: Task 4 `callLLM`·`LLMRefusalError`, Task 5 `getClientWithProcedures`, Task 6 `getReferencesByIds`, Task 7 `buildUserPrompt`·`DRAFT_SYSTEM`·`draftOutputSchema`, Task 8 `insertDraft`
- Produces (Task 12가 사용):
  - `CONTENT_MODEL = () => process.env.CONTENT_MODEL ?? 'claude-opus-5'`
  - `MAX_REFS = 8`
  - `class GenerateInputError extends Error`
  - `generateDraft(sql, req: GenerateRequest, client?: AnthropicLike): Promise<string /* draft id */>`
  - `interface GenerateRequest { clientId: string|null; procedureIds: string[]; refTweetIds: string[]; mode: ReferenceMode; direction: string; format: DraftFormat; constraintsOn: boolean; avoid?: string; memberId: string|null }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/generate.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { generateDraft, GenerateInputError, MAX_REFS, CONTENT_MODEL } from './generate.ts';
import { createClient, createProcedure } from './clientStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { getDraft, removeDraft } from './draftStore.ts';
import type { AnthropicLike } from './llm.ts';

const sql = getSql();
const P = 'test-gen-' + process.pid + '-';
const T1 = P + 'tw1';

function fakeLLM(capture?: (p: Record<string, unknown>) => void): AnthropicLike {
  return {
    messages: {
      create: async (p: object) => {
        capture?.(p as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '正直迷ってた。\n\n良かった。' }] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
}

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('3요소 전부 비면 GenerateInputError', async () => {
  await assert.rejects(
    generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
      direction: '   ', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM()),
    GenerateInputError,
  );
});

test('레퍼런스 8건 초과면 GenerateInputError', async () => {
  const ids = Array.from({ length: MAX_REFS + 1 }, (_, i) => `x${i}`);
  await assert.rejects(
    generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: ids, mode: 'both',
      direction: 'x', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM()),
    GenerateInputError,
  );
});

test('생성 왕복: 스냅샷·모델 기록·프롬프트에 클라+레퍼런스+메모 포함', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const c = await createClient(sql, P + 'A클리닉');
  await createProcedure(sql, c.id, { name: '보톡스', effectPhrases: '주름 완화' });
  const [m] = await sql<Array<{ id: string }>>`
    insert into member (name) values (${P + 'm'}) returning id`;
  await sql`insert into tweet (tweet_id, author_handle, text) values (${T1}, 'mika', '正直迷ってた')`;
  await sql`insert into library_item (workspace_id, tweet_id) values (${ws.id}, ${T1})`;
  await sql`insert into candidate (tweet_id, workspace_id, member_id, memo)
            values (${T1}, ${ws.id}, ${m.id}, '앵글이 신선')`;

  const client = await getClientProcIds(c.id);
  let sent: Record<string, unknown> = {};
  const id = await generateDraft(sql, {
    clientId: c.id, procedureIds: client, refTweetIds: [T1], mode: 'both',
    direction: P + '다운타임 강조', format: 'single', constraintsOn: false, memberId: null,
  }, fakeLLM((p) => { sent = p; }));

  try {
    assert.equal(sent.model, CONTENT_MODEL());
    assert.ok(sent.system);
    assert.ok(sent.output_config);
    const userMsg = (sent.messages as Array<{ content: string }>)[0].content;
    assert.ok(userMsg.includes(P + 'A클리닉') && userMsg.includes('正直迷ってた') && userMsg.includes('앵글이 신선'));

    const draft = await getDraft(sql, id);
    assert.equal(draft!.clientName, P + 'A클리닉');
    assert.deepEqual(draft!.procedureNames, ['보톡스']);
    assert.equal(draft!.refs[0].tweetId, T1);
    assert.equal(draft!.refs[0].memos[0].text, '앵글이 신선');
    assert.equal(draft!.content.posts.length, 1);
    assert.deepEqual(draft!.content.posts[0].media, []);
    assert.equal(draft!.model, CONTENT_MODEL());
  } finally {
    await removeDraft(sql, id);
    await deleteWorkspace(sql, ws.id);
  }
});

async function getClientProcIds(clientId: string): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    select id from client_procedure where client_id = ${clientId}`;
  return rows.map((r) => r.id);
}
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/generate.ts`

```ts
import type postgres from 'postgres';
import { callLLM, type AnthropicLike } from './llm.ts';
import { getClientWithProcedures } from './clientStore.ts';
import { getReferencesByIds } from './referenceStore.ts';
import { buildUserPrompt, draftOutputSchema, DRAFT_SYSTEM } from './generatePrompt.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export const CONTENT_MODEL = () => process.env.CONTENT_MODEL ?? 'claude-opus-5';
export const MAX_REFS = 8; // few-shot 실무 상한 — 초과 시 원고가 레퍼런스 문구를 베낄 위험(over-copying)이 커진다

// 입력이 잘못된 경우 — 라우트가 400 + 평문으로 매핑
export class GenerateInputError extends Error {}

export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; avoid?: string; memberId: string | null;
}

export async function generateDraft(
  sql: postgres.Sql, req: GenerateRequest, client?: AnthropicLike,
): Promise<string> {
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

  // 프롬프트 → LLM (구조화 출력)
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: refs, mode: hasRefs ? req.mode : 'off',
    direction: req.direction, format: req.format, constraintsOn: req.constraintsOn, avoid: req.avoid,
  });
  const res = await callLLM('draft', {
    model: CONTENT_MODEL(),
    max_tokens: 16000, // Opus 5는 thinking 기본 ON — thinking+응답 합산 상한이라 여유 필요
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: draftOutputSchema() } },
  }, client);

  // 파싱 — 구조화 출력이라 JSON 보장이 원칙이나, 방어적으로 검증
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let posts: Array<{ text: string }>;
  try {
    posts = (JSON.parse(text) as { posts: Array<{ text: string }> }).posts;
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (!Array.isArray(posts) || posts.length === 0 || posts.some((p) => typeof p.text !== 'string' || !p.text.trim())) {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }

  const content: DraftContent = { posts: posts.map((p) => ({ text: p.text, media: [] })) };
  return insertDraft(sql, {
    clientId: req.clientId, clientName: clientData?.client.name ?? null,
    procedureNames: procedures.map((p) => p.name),
    direction: req.direction, format: req.format,
    referenceMode: hasRefs ? req.mode : 'off', refs,
    content, model: CONTENT_MODEL(), memberId: req.memberId,
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/generate.ts src/lib/generate.test.ts
git commit -m "feat(x-deck): generateDraft — 3요소 검증·스냅샷·opus-5 구조화 출력"
```

---

### Task 10: API — clients·procedures 라우트

**Files:**
- Create: `src/app/api/clients/route.ts`
- Create: `src/app/api/clients/[id]/route.ts`
- Create: `src/app/api/clients/[id]/procedures/route.ts`
- Create: `src/app/api/procedures/[id]/route.ts`

레포에 라우트 테스트 하네스가 없으므로(관례) 이 태스크의 검증은 타입체크+lint. 로직은 전부 Task 5에서 테스트된 스토어에 있음.

**Interfaces:**
- Consumes: Task 5 clientStore 전부, `requireAllowedUser`·`requireMember`(`src/lib/authGuard`), `getSql`

- [ ] **Step 1: `src/app/api/clients/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listClients, createClient, getClientWithProcedures } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const clients = await listClients(sql);
  // 시술 포함 목록 — 클라이언트 수는 소수라 N+1 허용
  const withProcs = await Promise.all(clients.map((c) => getClientWithProcedures(sql, c.id)));
  return NextResponse.json(withProcs.filter(Boolean));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: '클라이언트 이름이 필요해요' }, { status: 400 });
  return NextResponse.json(await createClient(getSql(), body.name.trim()));
}
```

- [ ] **Step 2: `src/app/api/clients/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const row = await getClientWithProcedures(getSql(), id);
  if (!row) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; info?: string; bannedPhrases?: string[] };
  await updateClient(getSql(), id, body);
  return NextResponse.json(await getClientWithProcedures(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteClient(getSql(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/clients/[id]/procedures/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createProcedure } from '@/lib/clientStore';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] };
  if (!body.name?.trim()) return NextResponse.json({ error: '시술 이름이 필요해요' }, { status: 400 });
  return NextResponse.json(await createProcedure(getSql(), id, { ...body, name: body.name.trim() }));
}
```

- [ ] **Step 4: `src/app/api/procedures/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { updateProcedure, deleteProcedure } from '@/lib/clientStore';
import { requireMember } from '@/lib/authGuard';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] };
  await updateProcedure(getSql(), id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteProcedure(getSql(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: 검증 — 타입·린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 에러 0, lint 경고 기존 기준선(24) 이하

- [ ] **Step 6: Commit**

```bash
git add src/app/api/clients src/app/api/procedures
git commit -m "feat(x-deck): 클라이언트·시술 API 라우트"
```

---

### Task 11: API — references 라우트

**Files:**
- Create: `src/app/api/references/route.ts`

**Interfaces:**
- Consumes: Task 6 `listReferences`

- [ ] **Step 1: 구현**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listReferences } from '@/lib/referenceStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 레퍼런스 선택용 보관함 읽기 — scope=all(전 워크스페이스 병합) | scope=<workspaceId>
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'all';
  const tag = url.searchParams.get('tag') ?? undefined;
  const rows = await listReferences(getSql(), {
    scope: scope === 'all' ? 'all' : { workspaceId: scope },
    tag,
  });
  return NextResponse.json(rows);
}
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

- [ ] **Step 3: Commit**

```bash
git add src/app/api/references
git commit -m "feat(x-deck): 레퍼런스 조회 API — 보관함 전역 읽기"
```

---

### Task 12: API — drafts 라우트

**Files:**
- Create: `src/app/api/drafts/route.ts`
- Create: `src/app/api/drafts/[id]/route.ts`

**Interfaces:**
- Consumes: Task 9 `generateDraft`·`GenerateInputError`, Task 4 `LLMRefusalError`, Task 8 `listDrafts`·`getDraft`·`updateDraft`·`removeDraft`

- [ ] **Step 1: `src/app/api/drafts/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { generateDraft, GenerateInputError, type GenerateRequest } from '@/lib/generate';
import { listDrafts, getDraft } from '@/lib/draftStore';
import { LLMRefusalError } from '@/lib/llm';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const clientId = new URL(req.url).searchParams.get('clientId') ?? undefined;
  return NextResponse.json(await listDrafts(getSql(), { clientId }));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as Partial<GenerateRequest>;
  try {
    const id = await generateDraft(sql, {
      clientId: body.clientId ?? null,
      procedureIds: body.procedureIds ?? [],
      refTweetIds: body.refTweetIds ?? [],
      mode: body.mode ?? 'off',
      direction: body.direction ?? '',
      format: body.format === 'thread' ? 'thread' : 'single',
      constraintsOn: !!body.constraintsOn,
      avoid: body.avoid,
      memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(브리핑 관례)
    });
    return NextResponse.json(await getDraft(sql, id));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 방향성을 바꿔 다시 시도해주세요' }, { status: 502 });
    }
    // 원인을 삼키지 않는다(브리핑 라우트 관례)
    console.error('[draft] 생성 중 오류', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
```

- [ ] **Step 2: `src/app/api/drafts/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft, removeDraft } from '@/lib/draftStore';
import type { DraftContent } from '@/lib/draftTypes';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const row = await getDraft(getSql(), id);
  if (!row) return NextResponse.json({ error: `draft not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { edited?: DraftContent; dismissedFlags?: string[] };
  await updateDraft(getSql(), id, body);
  return NextResponse.json(await getDraft(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await removeDraft(getSql(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

- [ ] **Step 4: Commit**

```bash
git add src/app/api/drafts
git commit -m "feat(x-deck): 초안 API — 생성(에러 평문 매핑)·목록·편집·삭제"
```

---

### Task 13: 스레드 부분 재생성 — `regeneratePost` + 라우트

스펙 §2: "스레드 '이 트윗만 다시' = 해당 post만 재생성해 **`edited`에 반영** (`content`는 불변)".

**Files:**
- Modify: `src/lib/generate.ts` (함수 1개 추가 + import 확장)
- Create: `src/app/api/drafts/[id]/regen-post/route.ts`
- Test: `src/lib/generate.test.ts` (append)

**Interfaces:**
- Consumes: Task 8 `getDraft`·`updateDraft`·`DraftRow`, Task 2 `X_MAX_WEIGHTED`, Task 9의 `CONTENT_MODEL`·`GenerateInputError`·`DRAFT_SYSTEM`·`draftOutputSchema`
- Produces: `regeneratePost(sql, draftId: string, postIndex: number, client?: AnthropicLike): Promise<DraftRow>` / `POST /api/drafts/[id]/regen-post` body `{ index: number }`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/lib/generate.test.ts` 하단에 append. 상단의 기존 `./generate.ts` import 문에 `regeneratePost`를 추가한다(새 import 문 추가 금지 — 중복 import).

```ts
function fakeThread(): AnthropicLike {
  return { messages: { create: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '1番' }, { text: '2番' }, { text: '3番' }] }) }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
  }) } };
}

test('스레드 부분 재생성: 해당 post만 edited에 반영, content 불변', async () => {
  const id = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '스레드', format: 'thread', constraintsOn: false, memberId: null,
  }, fakeThread());
  const regenFake: AnthropicLike = { messages: { create: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '新2番' }] }) }],
    usage: { input_tokens: 100, output_tokens: 20 },
    stop_reason: 'end_turn',
  }) } };
  try {
    const updated = await regeneratePost(sql, id, 1, regenFake);
    assert.equal(updated.edited!.posts.length, 3);
    assert.equal(updated.edited!.posts[0].text, '1番');   // 나머지 유지
    assert.equal(updated.edited!.posts[1].text, '新2番'); // 대상만 교체
    assert.equal(updated.content.posts[1].text, '2番');   // 원본 불변
  } finally {
    await removeDraft(sql, id);
  }
});

test('잘못된 index면 GenerateInputError', async () => {
  const id = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '스레드2', format: 'thread', constraintsOn: false, memberId: null,
  }, fakeThread());
  try {
    await assert.rejects(regeneratePost(sql, id, 99, fakeThread()), GenerateInputError);
  } finally {
    await removeDraft(sql, id);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: FAIL — `regeneratePost` export 없음

- [ ] **Step 3: 구현** — `src/lib/generate.ts`에 추가

import 확장 (기존 import 문 수정):
```ts
import { insertDraft, getDraft, updateDraft, type DraftRow } from './draftStore.ts';
import { X_MAX_WEIGHTED } from './xLength.ts';
```

파일 하단에 함수 추가:
```ts
// 스레드에서 한 트윗만 다시 — 결과는 edited에 반영(원본 content 불변, 스펙 §2).
// 편집 중 상태(edited)가 있으면 그 위에서 교체한다.
export async function regeneratePost(
  sql: postgres.Sql, draftId: string, postIndex: number, client?: AnthropicLike,
): Promise<DraftRow> {
  const draft = await getDraft(sql, draftId);
  if (!draft) throw new GenerateInputError('초안을 찾을 수 없어요');
  const base = draft.edited ?? draft.content;
  if (!Number.isInteger(postIndex) || postIndex < 0 || postIndex >= base.posts.length) {
    throw new GenerateInputError('다시 만들 트윗을 찾을 수 없어요');
  }

  const thread = base.posts.map((p, n) => `${n + 1}. ${p.text}`).join('\n---\n');
  const user = [
    '아래는 X 스레드 초안입니다. 다른 포스트는 그대로 두고,',
    `${postIndex + 1}번 포스트만 같은 맥락에서 다른 표현·접근으로 다시 쓰세요.`,
    `가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내.`,
    draft.direction.trim() ? `방향성: ${draft.direction.trim()}` : '',
    '',
    thread,
    '',
    `출력: 다시 쓴 ${postIndex + 1}번 포스트 1개만 posts 배열에 담으세요.`,
  ].filter((l, n, arr) => l !== '' || arr[n - 1] !== '').join('\n');

  const res = await callLLM('draft-regen', {
    model: CONTENT_MODEL(), max_tokens: 16000, system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: draftOutputSchema() } },
  }, client);

  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let posts: Array<{ text: string }>;
  try {
    posts = (JSON.parse(text) as { posts: Array<{ text: string }> }).posts;
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (!posts?.[0]?.text?.trim()) throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');

  const edited = {
    posts: base.posts.map((p, n) => (n === postIndex ? { text: posts[0].text, media: p.media } : p)),
  };
  await updateDraft(sql, draftId, { edited });
  return (await getDraft(sql, draftId)) as DraftRow;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts`
Expected: PASS (기존 3 + 신규 2)

- [ ] **Step 5: 라우트** — `src/app/api/drafts/[id]/regen-post/route.ts`

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { regeneratePost, GenerateInputError } from '@/lib/generate';
import { LLMRefusalError } from '@/lib/llm';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { index?: number };
  if (typeof body.index !== 'number') {
    return NextResponse.json({ error: '다시 만들 트윗 번호(index)가 필요해요' }, { status: 400 });
  }
  try {
    return NextResponse.json(await regeneratePost(getSql(), id, body.index));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    }
    console.error('[draft] 부분 재생성 오류', { id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
```

- [ ] **Step 6: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 통과

```bash
git add src/lib/generate.ts src/lib/generate.test.ts src/app/api/drafts
git commit -m "feat(x-deck): 스레드 부분 재생성 — regeneratePost, edited 반영·원본 불변"
```

---

### Task 14: 스모크 스크립트 + 전체 검증

**Files:**
- Create: `scripts/smoke-generate.ts`
- Modify: `package.json` (scripts에 1줄)

**Interfaces:**
- Consumes: Task 9 `generateDraft`, Task 8 `getDraft`·`removeDraft`

- [ ] **Step 1: `scripts/smoke-generate.ts`** (기존 smoke-* 패턴)

```ts
// 실호출 스모크: 방향성만으로 초안 1건 생성 → 출력 → 삭제. 비용 ~$0.07 (opus-5)
import { getSql } from '../src/lib/db.ts';
import { generateDraft } from '../src/lib/generate.ts';
import { getDraft, removeDraft } from '../src/lib/draftStore.ts';

const sql = getSql();
const id = await generateDraft(sql, {
  clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
  direction: '여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조하는 단문',
  format: 'single', constraintsOn: false, memberId: null,
});
const draft = await getDraft(sql, id);
console.log('생성 결과:', JSON.stringify(draft?.content, null, 2));
console.log('모델:', draft?.model);
await removeDraft(sql, id);
console.log('스모크 초안 삭제 완료');
await sql.end();
```

- [ ] **Step 2: `package.json` scripts에 추가** (smoke:translate 아래)

```json
"smoke:generate": "node --import tsx --env-file-if-exists=.env scripts/smoke-generate.ts",
```

- [ ] **Step 3: 스모크 실행 (실비용 ~$0.07 — 1회만)**

Run: `npm run smoke:generate`
Expected: 일본어 posts 1개 출력, `모델: claude-opus-5`, 삭제 완료 메시지

- [ ] **Step 4: 전체 테스트·린트 (회귀 확인)**

Run: `npm test` (약 4분, 실 DB)
Expected: 전체 PASS
Run: `npm run lint`
Expected: 경고 24개 이하 (기준선 유지)

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-generate.ts package.json
git commit -m "feat(x-deck): smoke:generate — 초안 생성 실호출 검증"
```

---

## Plan 2 예고 (이 플랜 범위 밖 — 별도 작성)

Plan 1 완료 후 실제 시그니처 기준으로 작성: 최상위 레이아웃(`/generate`·`/clients`, 사이드바 wsId=localStorage) / `DraftComposer`(4컨트롤) / `DraftCard`(X 실측 600px + 도구층 표식·근거 풋터 펼침) / `DraftEditModal`(X 컴포즈) / `RefPickerSheet` / 클라이언트 CRUD 페이지 / 진입점 A 액션(`TweetCard`·`CandidateCard`) / 대기·빈 상태(G·N축). 스펙 §4·§5가 원본.
