# AI 지시문 편집 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원고 생성 프롬프트의 고정 문장 6개를 화면에서 확인·편집·복원할 수 있는 `/prompt` 페이지.

**Architecture:** `generatePrompt.ts`에 `PromptOverrides`를 도입(기본값 상수 export), 저장은 append-only `prompt_template_version`(최신 행 = 현재값, diff만 저장), `generate.ts` 3개 경로가 호출 시 최신 오버라이드를 로드. 미리보기는 같은 순수 함수를 클라이언트에서 샘플 데이터로 호출.

**Tech Stack:** 기존 스택 그대로. 마이그레이션 1개(RLS enable 포함).

**Spec:** `docs/superpowers/specs/2026-08-09-prompt-template-page-design.md`

**병렬 실행**: T1∥T2(파일 배타) → 통합 게이트(오케스트레이터: 마이그레이션 적용·테스트·커밋) → T3∥T4(파일 배타) → 검증·리뷰. T2의 테스트는 T1의 export에 의존하므로 **작성만 하고 실행은 통합 게이트에서**.

## Global Constraints

- 스타일 기존 토큰만(x-* / text-content·ui·caption). UI 카피는 사용자 언어(내부 개념어 금지 — "프롬프트" 대신 "AI 지시문").
- lint 기준선 24: 마운트 로드 effect엔 GlobalShell과 동일한 disable 주석 사용(아래 코드에 포함됨 — 빼지 말 것).
- 서브에이전트: 지정된 파일만 수정, **커밋 금지**(오케스트레이터가 커밋), 브리프 코드가 틀렸다고 판단되면 착수 전 보고. tsc/lint/build 전체 실행 금지(짝 레인 미완성 — 통합 게이트에서 일괄).
- 기본값 문장 6개는 기존 코드의 문자열을 **한 글자도 바꾸지 말고** 옮긴다 (기본 동작 완전 불변이 이 리팩토링의 계약).

---

### Task 1: `generatePrompt.ts` 오버라이드 도입 + 단독 테스트 — 병렬 레인 A

**Files:**
- Modify: `src/lib/generatePrompt.ts` (전체 교체)
- Create: `src/lib/generatePrompt.test.ts`

**Interfaces (T2·T3·T4가 사용):**
- `PROMPT_DEFAULTS: { system, modeForm, modeAngle, modeBoth, noCopy, hook }` (as const)
- `type PromptFieldKey = keyof typeof PROMPT_DEFAULTS` / `type PromptOverrides = Partial<Record<PromptFieldKey, string>>`
- `buildUserPrompt(i: PromptInput, overrides?: PromptOverrides): string`
- `draftSystem(overrides?: PromptOverrides): string` / 기존 `DRAFT_SYSTEM` export는 유지(호환)

- [ ] **Step 1: `src/lib/generatePrompt.ts` 전체 교체**

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
  // '다시 쓰기' — 현재 버전 전문 + (선택) 사용자 피드백. 피드백이 없으면 같은 조건 재생성.
  rewrite?: { current: string[]; feedback?: string };
  // 다중 시안 — 2 이상이면 "서로 다른 앵글로 N개" 지시가 붙는다. 1/미지정 = 기존 프롬프트 그대로.
  variantCount?: number;
}

// 편집 가능한 고정 문장 — /prompt(AI 지시문) 페이지가 덮어쓴다. 값이 없거나 빈 문자열이면 기본값.
// 계산값이 치환되는 문장(형식·글자 수·시안 수·금지 표현 헤더)은 편집 대상이 아니다 (스펙).
export const PROMPT_DEFAULTS = {
  system:
    '당신은 일본 미용의료 마케팅의 X(트위터) 카피라이터입니다. ' +
    '인플루언서가 자기 계정에 올릴 자연스러운 일본어 포스트 초안을 작성합니다. ' +
    '광고 문구처럼 읽히지 않는 개인 포스트 톤을 유지하고, 해시태그는 0~2개만 사용합니다.',
  modeForm: '아래 레퍼런스의 형식(문장 구조·길이·줄바꿈·이모지 사용·전개 방식)만 참고하세요. 소재·내용은 가져오지 마세요.',
  modeAngle: '아래 레퍼런스가 소재를 다룬 각도(앵글)만 참고하세요. 문장 형식은 따라 하지 마세요.',
  modeBoth: '아래 레퍼런스의 형식과 앵글을 함께 참고하세요.',
  noCopy: '레퍼런스 문구를 그대로 옮기지 마세요(표절 금지).',
  hook: '첫 단락이 훅입니다 — 빈 줄 전까지의 첫 단락만 읽어도 관심이 생기게 쓰세요.',
} as const;
export type PromptFieldKey = keyof typeof PROMPT_DEFAULTS;
export type PromptOverrides = Partial<Record<PromptFieldKey, string>>;

const pick = (o: PromptOverrides | undefined, k: PromptFieldKey): string => {
  const v = o?.[k]?.trim();
  return v ? v : PROMPT_DEFAULTS[k];
};

// 기존 import 호환용(값 = 기본값). 오버라이드 적용 경로는 draftSystem()을 쓴다.
export const DRAFT_SYSTEM = PROMPT_DEFAULTS.system;
export function draftSystem(overrides?: PromptOverrides): string { return pick(overrides, 'system'); }

const MODE_KEY: Record<Exclude<ReferenceMode, 'off'>, PromptFieldKey> = {
  form: 'modeForm', angle: 'modeAngle', both: 'modeBoth',
};

export function buildUserPrompt(i: PromptInput, overrides?: PromptOverrides): string {
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
    const lines = [`## 레퍼런스 (${i.references.length}건)`, pick(overrides, MODE_KEY[i.mode]),
      pick(overrides, 'noCopy')];
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
  if (i.rewrite) {
    const cur = i.rewrite.current.map((t, n) => `${n + 1}. ${t}`).join('\n---\n');
    task.push('아래는 이 초안의 현재 버전입니다. 처음부터 다시 쓰세요.', cur);
    task.push(i.rewrite.feedback?.trim()
      ? `사용자 피드백(반드시 반영해서 다시 쓰기): ${i.rewrite.feedback.trim()}`
      : '같은 조건으로 새로 쓰되, 현재 버전과 훅·표현이 겹치지 않게 하세요.');
  }
  if ((i.variantCount ?? 1) > 1) {
    task.push(`이번 요청은 시안 ${i.variantCount}개입니다. 서로 다른 앵글·훅으로 ${i.variantCount}개를 만드세요.`,
      '시안끼리 첫 문장(훅)·소재 접근이 겹치면 안 됩니다.');
  }
  task.push(i.format === 'single'
    ? `형식: 단문 포스트 1개. 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내.`
    : `형식: 스레드 3~5개 포스트. 각 포스트는 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내. 1번 포스트가 훅.`);
  task.push(pick(overrides, 'hook'));
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

- [ ] **Step 2: `src/lib/generatePrompt.test.ts` 작성**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, draftSystem, PROMPT_DEFAULTS, type PromptInput } from './generatePrompt.ts';

const base: PromptInput = {
  client: { name: '가온피부과', info: '강남역 3번 출구', bannedPhrases: ['완치'] },
  procedures: [{ name: '보톡스', description: '이마 주사', effectPhrases: '주름 완화', bannedPhrases: ['동안'] }],
  references: [{ tweetId: '1', handle: 'beauty_jp', name: null, excerpt: 'サンプル投稿',
                 memos: [{ member: '박구건', text: '훅이 좋아요' }] }],
  mode: 'both', direction: '여름 이벤트', format: 'single', constraintsOn: true,
};

test('오버라이드 없으면 기본 문장 그대로 (리팩토링 계약: 기본 동작 불변)', () => {
  const p = buildUserPrompt(base);
  assert.ok(p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes(PROMPT_DEFAULTS.noCopy));
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem(), PROMPT_DEFAULTS.system);
});

test('오버라이드가 해당 문장만 교체한다', () => {
  const p = buildUserPrompt(base, { modeBoth: '커스텀 모드 규칙', noCopy: '커스텀 베끼기 금지', hook: '커스텀 훅' });
  assert.ok(p.includes('커스텀 모드 규칙'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes('커스텀 베끼기 금지'));
  assert.ok(p.includes('커스텀 훅'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '커스텀 역할' }), '커스텀 역할');
});

test('빈 문자열·공백 오버라이드는 기본값으로 폴백 (지워서 망가지는 사고 방지)', () => {
  const p = buildUserPrompt(base, { hook: '  ' });
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '' }), PROMPT_DEFAULTS.system);
});

test('모드별 오버라이드는 그 모드가 선택됐을 때만 적용', () => {
  const p = buildUserPrompt({ ...base, mode: 'form' }, { modeForm: 'FORM 전용', modeAngle: 'ANGLE 전용' });
  assert.ok(p.includes('FORM 전용'));
  assert.ok(!p.includes('ANGLE 전용'));
});
```

- [ ] **Step 3: 이 파일 2개만으로 테스트 실행** — `node --import tsx --test src/lib/generatePrompt.test.ts`
Expected: PASS (tests 4). 추가로 `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts` 실행해 기존 생성 테스트가 여전히 통과하는지 확인(기본 동작 불변 계약).

---

### Task 2: 마이그레이션 + `promptSettings` 스토어 — 병렬 레인 B

**Files:**
- Create: `migrations/021_prompt_template.sql`
- Create: `src/lib/promptSettings.ts`
- Create: `src/lib/promptSettings.test.ts`

**Interfaces:**
- Consumes: T1의 `PROMPT_DEFAULTS`·`PromptFieldKey`·`PromptOverrides` (동시 진행 — 이 시그니처 전제로 작성)
- Produces (T3·T4가 사용): `sanitizeOverrides(input: unknown): PromptOverrides | null` /
  `getPromptOverrides(sql): Promise<PromptOverrides>` / `savePromptOverrides(sql, overrides, memberId: string | null)` /
  `listPromptVersions(sql, limit?): Promise<Array<{ id; overrides; memberName: string | null; createdAt: string }>>`

⚠️ **테스트는 작성만** — T1이 같은 시각에 generatePrompt를 고치는 중이라 import가 아직 없을 수 있다. 실행은 통합 게이트(오케스트레이터).

- [ ] **Step 1: `migrations/021_prompt_template.sql`**

```sql
-- AI 지시문(프롬프트 고정 문장) 오버라이드 — append-only, 최신 행 = 현재값. 행 없음 = 전부 기본값.
-- overrides에는 기본값과 다른 필드만 저장한다(diff) — 코드 기본값이 개선되면 편집 안 한 필드는 자동 추종.
create table if not exists prompt_template_version (
  id uuid primary key default gen_random_uuid(),
  overrides jsonb not null default '{}'::jsonb,
  member_id uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
-- 앱은 직접 Postgres 연결이라 무영향 — anon/authenticated 키만 차단 (신규 테이블 관례)
alter table prompt_template_version enable row level security;
```

- [ ] **Step 2: `src/lib/promptSettings.ts`**

```ts
import type postgres from 'postgres';
import { PROMPT_DEFAULTS, type PromptFieldKey, type PromptOverrides } from './generatePrompt.ts';

export interface PromptVersionRow {
  id: string; overrides: PromptOverrides; memberName: string | null; createdAt: string;
}

const KEYS = Object.keys(PROMPT_DEFAULTS) as PromptFieldKey[];

// 쓰기 검증 — 알려진 키·문자열·2000자 이내만(위반 = null). 트림 후 빈 값·기본값과 같은 값은 버린다:
// diff만 저장해야 코드 기본값이 나중에 개선될 때 편집 안 한 필드가 자동으로 따라간다 (스펙).
export function sanitizeOverrides(input: unknown): PromptOverrides | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const out: PromptOverrides = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(KEYS as string[]).includes(k)) return null;
    if (typeof v !== 'string' || v.length > 2000) return null;
    const t = v.trim();
    if (t && t !== PROMPT_DEFAULTS[k as PromptFieldKey]) out[k as PromptFieldKey] = t;
  }
  return out;
}

// 읽기는 관대하게 — 아는 키만 남긴다 (필드가 코드에서 사라져도 나머지 오버라이드는 유지)
function filterKnown(raw: unknown): PromptOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: PromptOverrides = {};
  for (const k of KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}

export async function getPromptOverrides(sql: postgres.Sql): Promise<PromptOverrides> {
  const rows = await sql<Array<{ overrides: unknown }>>`
    select overrides from prompt_template_version order by created_at desc limit 1`;
  return rows.length ? filterKnown(rows[0].overrides) : {};
}

export async function savePromptOverrides(
  sql: postgres.Sql, overrides: PromptOverrides, memberId: string | null,
): Promise<void> {
  await sql`insert into prompt_template_version (overrides, member_id)
            values (${sql.json(overrides)}, ${memberId})`;
}

export async function listPromptVersions(sql: postgres.Sql, limit = 20): Promise<PromptVersionRow[]> {
  const rows = await sql<Array<{ id: string; overrides: unknown; created_at: Date; member_name: string | null }>>`
    select v.id, v.overrides, v.created_at, m.name as member_name
      from prompt_template_version v
      left join member m on m.id = v.member_id
     order by v.created_at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, overrides: filterKnown(r.overrides),
    memberName: r.member_name, createdAt: new Date(r.created_at).toISOString(),
  }));
}
```

- [ ] **Step 3: `src/lib/promptSettings.test.ts`** (작성만 — 실행은 통합 게이트)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { sanitizeOverrides, getPromptOverrides, savePromptOverrides, listPromptVersions } from './promptSettings.ts';
import { PROMPT_DEFAULTS } from './generatePrompt.ts';

const sql = getSql();
const MARK = `test-pt-${process.pid}`;

after(async () => {
  // 공유 DB(로컬=프로덕션) — 테스트 행이 잠깐 "최신 템플릿"이 되므로 반드시 정리 (clientStore 테스트와 같은 관례)
  await sql`delete from prompt_template_version where overrides->>'hook' like ${MARK + '%'}`;
  await sql.end();
});

test('sanitize: 형식 위반은 null, 기본값·빈 값은 버림', () => {
  assert.equal(sanitizeOverrides(null), null);
  assert.equal(sanitizeOverrides([]), null);
  assert.equal(sanitizeOverrides({ unknown: 'x' }), null);
  assert.equal(sanitizeOverrides({ hook: 123 }), null);
  assert.equal(sanitizeOverrides({ hook: 'a'.repeat(2001) }), null);
  assert.deepEqual(sanitizeOverrides({ hook: PROMPT_DEFAULTS.hook, system: '  ' }), {});
  assert.deepEqual(sanitizeOverrides({ hook: '커스텀 훅' }), { hook: '커스텀 훅' });
});

test('저장 → 최신 반영, 이력은 최신순 + 멤버 없으면 null', async () => {
  await savePromptOverrides(sql, { hook: `${MARK} 훅1` }, null);
  await savePromptOverrides(sql, { hook: `${MARK} 훅2` }, null);
  const cur = await getPromptOverrides(sql);
  assert.equal(cur.hook, `${MARK} 훅2`);
  const versions = await listPromptVersions(sql, 5);
  assert.equal(versions[0].overrides.hook, `${MARK} 훅2`);
  assert.equal(versions[1].overrides.hook, `${MARK} 훅1`);
  assert.equal(versions[0].memberName, null);
  assert.ok(versions[0].createdAt.endsWith('Z'));
});
```

---

### 통합 게이트 (오케스트레이터 — T1·T2 완료 후)

- [ ] 마이그레이션 적용: `set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/021_prompt_template.sql`
- [ ] `node --import tsx --test src/lib/generatePrompt.test.ts` → PASS 4
- [ ] `node --import tsx --env-file-if-exists=.env --test src/lib/promptSettings.test.ts` → PASS 2
- [ ] `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts` → 기존 통과 유지
- [ ] `npx tsc --noEmit` → 0
- [ ] 커밋 2개 (T1, T2 순)

---

### Task 3: `generate.ts` 배선 + API 라우트 — 병렬 레인 C

**Files:**
- Modify: `src/lib/generate.ts`
- Create: `src/app/api/prompt-settings/route.ts`

**Interfaces:**
- Consumes: T1 `draftSystem`·`buildUserPrompt(input, overrides)`·`PROMPT_DEFAULTS`, T2 스토어 4함수
- Produces: `GET /api/prompt-settings` → `{ overrides, defaults, versions }` / `PUT` body `{ overrides }` → `{ overrides }` | 400 `{ error }`

- [ ] **Step 1: `src/lib/generate.ts` 수정** — 정확히 아래 4곳:

(a) import 교체:
```ts
import { buildUserPrompt, draftOutputSchema, variantsOutputSchema, draftSystem } from './generatePrompt.ts';
import { getPromptOverrides } from './promptSettings.ts';
```
(기존 `DRAFT_SYSTEM` import 제거)

(b) `generateDraft`: `// 프롬프트 → LLM` 주석 직전에 로드를 추가하고, 호출 2곳에 전달:
```ts
  // 팀이 /prompt에서 편집한 지시문 오버라이드 — 생성 시점의 최신 저장본 1회 로드
  const promptOverrides = await getPromptOverrides(sql);
```
`buildUserPrompt({ ... })` → `buildUserPrompt({ ... }, promptOverrides)` /
`system: DRAFT_SYSTEM` → `system: draftSystem(promptOverrides)`

(c) `rewriteDraft`: `const user = buildUserPrompt({` 직전에 같은 로드 추가, `buildUserPrompt(..., promptOverrides)` + `system: draftSystem(promptOverrides)`

(d) `regeneratePost`: `callLLM` 직전에 같은 로드 추가, `system: draftSystem(promptOverrides)`
(인라인 프롬프트라 system만 적용 — 스펙)

- [ ] **Step 2: `src/app/api/prompt-settings/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { getPromptOverrides, listPromptVersions, sanitizeOverrides, savePromptOverrides } from '@/lib/promptSettings';
import { PROMPT_DEFAULTS } from '@/lib/generatePrompt';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const [overrides, versions] = await Promise.all([getPromptOverrides(sql), listPromptVersions(sql)]);
  return NextResponse.json({ overrides, defaults: PROMPT_DEFAULTS, versions });
}

export async function PUT(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { overrides?: unknown };
  const clean = sanitizeOverrides(body.overrides ?? {});
  if (clean === null) return NextResponse.json({ error: '지시문 형식이 올바르지 않아요' }, { status: 400 });
  // 저장자 = 서버가 해석한 멤버 (클라이언트 body 무시 — 초안 관례)
  await savePromptOverrides(getSql(), clean, gate.member.id);
  return NextResponse.json({ overrides: clean });
}
```

- [ ] **Step 3: 자체 점검** — generate.ts에서 `DRAFT_SYSTEM` 잔존 참조 0건(`grep -n DRAFT_SYSTEM src/lib/generate.ts`), 로드가 각 함수당 1회.

---

### Task 4: `/prompt` 페이지 + 진입 링크 — 병렬 레인 D

**Files:**
- Create: `src/app/prompt/layout.tsx`
- Create: `src/app/prompt/page.tsx`
- Modify: `src/app/generate/page.tsx` (h1 한 줄만 — 아래 지시)

**Interfaces:**
- Consumes: T1 `buildUserPrompt`·`PROMPT_DEFAULTS`·타입 (클라이언트에서 직접 import — 순수 함수), T3 API

- [ ] **Step 1: `src/app/prompt/layout.tsx`**

```tsx
import { GlobalShell } from '@/components/GlobalShell';

export default function PromptLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
```

- [ ] **Step 2: `src/app/prompt/page.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { relTime } from '@/lib/relTime';
import {
  buildUserPrompt, PROMPT_DEFAULTS,
  type PromptFieldKey, type PromptInput, type PromptOverrides,
} from '@/lib/generatePrompt';

// 필드 메타 — 라벨은 사용자 언어, help는 "이 문장이 언제 들어가는지"
const FIELDS: Array<{ key: PromptFieldKey; label: string; help: string; rows: number }> = [
  { key: 'system', label: '역할 지시', help: 'AI가 어떤 사람으로서 쓰는지 — 원고 전체의 톤을 정해요. 모든 생성·다시 쓰기에 들어가요.', rows: 3 },
  { key: 'hook', label: '첫 문장(훅) 지시', help: '모든 생성에 들어가요 — 첫 단락을 어떻게 쓰라고 시킬지.', rows: 2 },
  { key: 'noCopy', label: '레퍼런스 베끼기 금지', help: '레퍼런스를 참고하는 생성에 항상 함께 들어가요.', rows: 2 },
  { key: 'modeForm', label: '레퍼런스 "형식만" 규칙', help: '생성 화면에서 참고 방식으로 "형식만"을 골랐을 때 들어가요.', rows: 2 },
  { key: 'modeAngle', label: '레퍼런스 "앵글만" 규칙', help: '참고 방식 "앵글만"일 때 들어가요.', rows: 2 },
  { key: 'modeBoth', label: '레퍼런스 "형식+앵글" 규칙', help: '참고 방식 "형식+앵글"일 때 들어가요.', rows: 2 },
];
const KEYS = FIELDS.map((f) => f.key);
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<PromptFieldKey, string>;

// 미리보기용 샘플 재료 — 실제 생성에선 그때 고른 클라이언트·레퍼런스·방향성이 이 자리에 들어간다
const SAMPLE: PromptInput = {
  client: { name: '(샘플) 가온피부과', info: '강남역 3번 출구 도보 2분. 피부과 전문의 2인 진료.',
            bannedPhrases: ['완치', '부작용 없음'] },
  procedures: [{ name: '보톡스', description: '이마·미간 주름 부위에 소량 주사.',
                 effectPhrases: '주름이 옅어 보이는 효과, 개인차 있음', bannedPhrases: ['주름 제거'] }],
  references: [{ tweetId: '0', handle: 'sample_account', name: null,
                 excerpt: '(샘플) 실제로는 보관함에서 고른 레퍼런스 원문이 들어가요',
                 memos: [{ member: '팀', text: '(샘플) 레퍼런스에 단 팀 메모가 참고 포인트로 들어가요' }] }],
  mode: 'both', direction: '(샘플) 여름 이벤트 안내', format: 'single', constraintsOn: true,
};

type VersionRow = { id: string; overrides: PromptOverrides; memberName: string | null; createdAt: string };
type Values = Record<PromptFieldKey, string>;
const toValues = (o: PromptOverrides): Values =>
  Object.fromEntries(KEYS.map((k) => [k, o[k] ?? PROMPT_DEFAULTS[k]])) as Values;

export default function PromptPage() {
  const [values, setValues] = useState<Values | null>(null); // null = 로딩 전
  const [loadErr, setLoadErr] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/prompt-settings');
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { overrides: PromptOverrides; versions: VersionRow[] };
      setValues(toValues(data.overrides));
      setVersions(data.versions);
      setLoadErr(false);
    } catch { setLoadErr(true); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(기존 코드베이스 관례)
  useEffect(() => { load(); }, [load]);

  // 편집 중 값 → diff 오버라이드 (저장·미리보기가 같은 계산을 공유)
  const overrides = useMemo<PromptOverrides>(() => {
    if (!values) return {};
    const out: PromptOverrides = {};
    for (const k of KEYS) { const t = values[k].trim(); if (t && t !== PROMPT_DEFAULTS[k]) out[k] = t; }
    return out;
  }, [values]);
  const preview = useMemo(() => (values ? buildUserPrompt(SAMPLE, overrides) : ''), [values, overrides]);
  const previewSystem = overrides.system ?? PROMPT_DEFAULTS.system;

  async function save() {
    if (!values || saving) return;
    setSaving(true);
    try {
      const r = await apiFetch('/api/prompt-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: Object.fromEntries(KEYS.map((k) => [k, values[k]])) }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await load(); // 이력 갱신
    } finally { setSaving(false); }
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-8">
      <h1 className="text-[20px] font-bold">AI 지시문</h1>
      <p className="mt-1 text-ui text-x-secondary">
        원고를 만들 때 AI에게 주는 지시문이에요. 여기서 바꾸면 팀 전체의 이후 생성에 바로 적용돼요.
        비워두면 그 문장은 기본값으로 동작해요.
      </p>

      {!values && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">지시문을 불러오지 못했습니다</p>
          <Button onClick={load}>다시 시도</Button>
        </div>
      )}

      {values && (
        <>
          <div className="mt-5 space-y-4">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="flex items-baseline justify-between">
                  <span className="text-ui font-bold">{f.label}</span>
                  {values[f.key].trim() !== PROMPT_DEFAULTS[f.key] && (
                    <button onClick={(e) => { e.preventDefault(); setValues({ ...values, [f.key]: PROMPT_DEFAULTS[f.key] }); setSaved(false); }}
                            className="text-caption text-x-blue-text hover:underline">기본값 복원</button>
                  )}
                </span>
                <p className="text-caption text-x-muted">{f.help}</p>
                <textarea value={values[f.key]} rows={f.rows}
                          onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setSaved(false); }}
                          className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
              </label>
            ))}
          </div>
          {err && <p className="mt-3 text-ui text-red-500">{err}</p>}
          <div className="mt-4 flex items-center gap-2.5">
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
            {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓ — 다음 생성부터 적용돼요</span>}
          </div>

          <div className="mt-8">
            <h2 className="text-content font-bold">AI에게 전달되는 모습 (샘플)</h2>
            <p className="text-caption text-x-muted">
              지금 편집 중인 문장이 들어간 실제 전달 형태예요. 실제 생성에선 (샘플) 자리에 그때 고른
              클라이언트·시술·레퍼런스·방향성이 들어가요.
            </p>
            <p className="mt-2 text-caption font-bold text-x-muted">역할 지시 (시스템)</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui leading-normal">{previewSystem}</pre>
            <p className="mt-2 text-caption font-bold text-x-muted">본문</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui leading-normal">{preview}</pre>
          </div>

          {versions.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-content font-bold">변경 이력 ({versions.length})</summary>
              <div className="mt-2 space-y-2">
                {versions.map((v) => {
                  const keys = Object.keys(v.overrides) as PromptFieldKey[];
                  return (
                    <div key={v.id} className="flex items-baseline justify-between gap-3 rounded-lg border border-x-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-ui">
                          {relTime(v.createdAt, '저장')}{v.memberName ? ` · ${v.memberName}` : ''}
                        </p>
                        <p className="truncate text-caption text-x-muted">
                          {keys.length > 0 ? `직접 쓴 문장: ${keys.map((k) => LABEL[k]).join(', ')}` : '전부 기본값'}
                        </p>
                      </div>
                      <Button className="shrink-0" onClick={() => { setValues(toValues(v.overrides)); setSaved(false); }}>
                        이 버전 불러오기
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-caption text-x-muted">불러온 버전은 저장을 눌러야 적용돼요.</p>
            </details>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: `src/app/generate/page.tsx` 진입 링크** — `<h1 className="text-[20px] font-bold">콘텐츠 생성</h1>` 줄을 아래로 교체 (이 파일의 다른 부분은 만지지 말 것):

```tsx
        <div className="flex items-baseline justify-between">
          <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
          <a href="/prompt" className="text-ui text-x-secondary hover:text-x-text">AI 지시문</a>
        </div>
```

---

### 최종 검증 (오케스트레이터 — T3·T4 완료 후)

- [ ] `npx tsc --noEmit` 0 / `npm run lint` 24 유지 / `npm run build` 성공
- [ ] 태스크 리뷰(sonnet, 통합 diff) → 수정 → 최종 브랜치 리뷰(opus)
- [ ] 사용자 화면 확인: 필드 편집→미리보기 즉시 반영 / 저장→"저장됨 ✓" / 기본값 복원 버튼 표시 조건 /
      이력 불러오기→저장 / 저장 후 실제 생성에서 바뀐 문장 반영(생성 1회) / generate 링크 진입
