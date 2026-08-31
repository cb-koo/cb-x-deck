# RT 작업 증빙 스크린샷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RT 작업을 게시됨으로 표시할 때 인플루언서 피드 스크린샷 1장을 반드시 첨부하게 하고, 그 이미지를 작업에 붙여 보관·확대·내려받기 하며 정산 화면에도 함께 보이게 한다.

**Architecture:** 증빙은 `campaign_task.proof jsonb` 한 칸(경로 + 올린 사람 + 시각). 이미지 파일은 새 비공개 스토리지 버킷 `task-proof`에 올라가고, DB에는 절대 URL이 아니라 스토리지 경로만 저장한다. 표시·내려받기는 그때그때 서명 URL을 받는다. 필수 강제는 DB 제약이 아니라 앱 계층(입력 검증 + 라우트)에서 한다 — 기존 게시된 RT 행에 증빙이 없어 CHECK 제약을 걸 수 없다.

**Tech Stack:** Next.js(App Router, 이 저장소 버전은 학습 데이터와 다르다 — `node_modules/next/dist/docs/` 확인), TypeScript, postgres.js(`sql` 태그), Supabase Storage(`@supabase/ssr` 브라우저 클라이언트), Tailwind, `node --test` + tsx.

**스펙:** `docs/superpowers/specs/2026-08-31-rt-proof-screenshot-design.md` — 결정 8개와 근거가 거기 있다. 판단이 갈리면 스펙이 이긴다.

## Global Constraints

- **작업 디렉터리:** `/Users/koo_clinicbridge/orca/workspaces/cb-x-deck/rt-verification-screenshot` (git worktree). 원본 저장소로 `cd` 하지 않는다.
- **`git stash` 금지** — 이 워크트리는 stash 스택을 다른 세션과 공유한다. 작업을 치워둘 필요가 있으면 임시 WIP 커밋을 쓴다.
- **`.env`가 없다.** 실 DB 테스트(`npm test`)를 처음 돌리기 전에 한 번: `vercel link` 후 `vercel env pull .env --environment=production`. 이건 Task 2에서 처음 필요하다.
- **테스트 명령**
  - 전체(실 DB, 약 4분): `npm test`
  - 단일 파일(순수 함수, 수초): `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`
- **린트 기준선은 정확히 24건(13 errors, 11 warnings)이다.** `npx eslint src`로 확인한다. 이 숫자를 **늘리지 않는다**. 새로 `<img>`를 쓰면 반드시 바로 윗줄에 `{/* eslint-disable-next-line @next/next/no-img-element */}`(JSX) 또는 `// eslint-disable-next-line @next/next/no-img-element`(TS)를 넣는다 — 기존 코드가 전부 그렇게 한다.
- **문구는 전부 사용자 언어(한국어).** 내부 개념어(proof·storage·bucket·jsonb) 금지. AGENTS.md UX 원칙 1·3·5.
- **마이그레이션 번호는 043.** 041·042는 미머지 브랜치가 점유. `scripts/apply-migrations.sh`가 매번 전 파일을 재실행하므로 모든 문장이 재실행 안전해야 한다(`if not exists`, 정책은 `drop` 후 `create`).
- **용량 상한 10MB는 두 곳(코드 상수 · 버킷 `file_size_limit`)이 같은 값이어야 한다.** 허용 형식은 `image/jpeg`·`image/png`·`image/webp` (gif 없음).
- **커밋 메시지**는 이 저장소 관례를 따른다: `feat(campaign): …` / `fix(settlement): …` 형식, 한국어 본문. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **머지 전 마지막 작업(Task 12)에서 `src/content/updates.ts` 항목을 추가한다.** 그 전에는 넣지 않는다.

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `migrations/043_task_proof.sql` | 컬럼 2개(`campaign_task.proof`, `payment_request.proof`) + `task-proof` 버킷 + 정책 |
| `src/lib/taskProofGuard.ts` | 서버·클라이언트 공용 **순수 규칙**: `TaskProof` 타입, 경로 정규식, 경로 검증, 오류 문구. 브라우저 API를 import하지 않는다(서버 라우트가 쓴다) |
| `src/lib/taskProofGuard.test.ts` | 위의 테스트 |
| `src/lib/taskProof.ts` | **브라우저 전용**: 파일 검증(형식·용량), 업로드, 서명 URL, 내려받기, 파일명. `'use client'` 컴포넌트만 import한다 |
| `src/lib/taskProof.test.ts` | 파일 검증·파일명 등 순수 부분 테스트 |
| `src/components/useSignedTaskProofUrls.ts` | 경로 배열 → 서명 URL 맵(한 번의 배치 호출). 표·정산 목록이 쓴다 |
| `src/components/TaskProofField.tsx` | 첨부 칸 — 붙여넣기·파일 고르기·미리보기·바꾸기·지우기·받기·크게 보기 |

**수정**

| 파일 | 무엇 |
|---|---|
| `src/lib/campaignTaskStore.ts` | `TaskRow.proof`·`TaskPatch.proof`·`Row.proof`·`SELECT`·`toRow`·`updateTask` |
| `src/lib/campaignTaskInput.ts` | `parseTaskPatch`의 `proof` 키 처리 + 문구 |
| `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` | 필수 강제 3규칙 + 서버가 `by`/`byName`/`at` 채우기 |
| `src/app/api/tracking/route.ts`, `src/app/api/tracking/[id]/route.ts` | RT 작업에는 게시물을 연결할 수 없다(400) |
| `src/lib/campaignApi.ts` | `TaskPatchRequest.proof?: string \| null` |
| `src/app/campaigns/useCampaignTaskActions.ts` | `markPosted`에 proof 인자, 새 `setProof` |
| `src/app/campaigns/PostedCell.tsx` | RT 분기 3상태 |
| `src/app/campaigns/TaskTable.tsx` | 썸네일·`증빙 없음` 태그, 서명 URL 전달 |
| `src/app/campaigns/CampaignDetail.tsx` | `markPosted` 통과, [게시 확인하기] 제거, 서명 URL 배치 |
| `src/lib/settlementCalc.ts` | `assessReadiness`에 `proofMissing`, `CandidateInput.task.proof`, `SettlementCandidate.proof` |
| `src/lib/settlementCalc.test.ts` | 기존 4개 호출 + 신규 케이스 |
| `src/lib/settlementStore.ts` | 후보 쿼리에 `t.proof`, `payment_request.proof` insert·select·매핑 |
| `src/app/settlement/CandidateRow.tsx`, `RequestRow.tsx`, `CandidateTable.tsx`, `RequestList.tsx` | 증빙 썸네일 |
| `src/content/updates.ts` | 업데이트 소식 1건 |

---

### Task 1: 마이그레이션 + 순수 규칙(경로·문구)

**Files:**
- Create: `migrations/043_task_proof.sql`
- Create: `src/lib/taskProofGuard.ts`
- Test: `src/lib/taskProofGuard.test.ts`

**Interfaces:**
- Consumes: 없음(첫 작업)
- Produces:
  ```ts
  export interface TaskProof { url: string; by: string | null; byName: string; at: string }
  export const TASK_PROOF_PATH_RE: RegExp
  export const TASK_PROOF_EXTENSIONS: readonly ['jpg', 'jpeg', 'png', 'webp']
  export function isTaskProofPath(v: unknown): v is string
  export function taskProofOf(v: unknown): TaskProof | null   // jsonb → 검증 통과분만
  export const PROOF_VALUE_MESSAGE: string
  export const PROOF_ONLY_RT_MESSAGE: string
  export const PROOF_REQUIRED_MESSAGE: string
  export const PROOF_KEEP_MESSAGE: string
  ```

- [ ] **Step 1: 테스트를 먼저 쓴다**

`src/lib/taskProofGuard.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaskProofPath, taskProofOf, TASK_PROOF_PATH_RE } from './taskProofGuard.ts';

const TASK = '11111111-2222-3333-4444-555555555555';
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OK = `task/${TASK}/${FILE}.png`;

test('경로 — 정상 형태만 통과', () => {
  assert.equal(isTaskProofPath(OK), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.jpg`), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.jpeg`), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.webp`), true);
});

test('경로 — 정상 UI가 만들 수 없는 값은 전부 거절', () => {
  // 추적 픽셀·IP 유출 방어: 임의 URL이 들어오면 워크스페이스 전원의 브라우저가 그 주소로 요청을 보낸다
  assert.equal(isTaskProofPath('https://evil.example/pixel.png'), false);
  assert.equal(isTaskProofPath(`draft/${TASK}/${FILE}.png`), false);      // 원고 버킷 경로
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.gif`), false);       // gif는 허용 형식 아님
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.svg`), false);
  assert.equal(isTaskProofPath(`task/${TASK}/../${FILE}.png`), false);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.png?x=1`), false);
  assert.equal(isTaskProofPath(`task/not-a-uuid/${FILE}.png`), false);
  assert.equal(isTaskProofPath(`TASK/${TASK}/${FILE}.PNG`), false);       // 대문자 경로·확장자 안 만든다
  assert.equal(isTaskProofPath(''), false);
  assert.equal(isTaskProofPath(null), false);
  assert.equal(isTaskProofPath(123), false);
});

test('정규식은 줄 전체를 고정한다 — 앞뒤에 뭘 붙여도 안 통과', () => {
  assert.equal(TASK_PROOF_PATH_RE.test(`x${OK}`), false);
  assert.equal(TASK_PROOF_PATH_RE.test(`${OK}\nhttps://evil.example`), false);
});

test('taskProofOf — jsonb 모양이 보증되지 않으므로 통과분만 돌려준다', () => {
  const good = { url: OK, by: TASK, byName: '박구건', at: '2026-08-31T01:00:00.000Z' };
  assert.deepEqual(taskProofOf(good), good);
  assert.equal(taskProofOf(null), null);
  assert.equal(taskProofOf(undefined), null);
  assert.equal(taskProofOf({ url: 'https://evil.example/a.png', by: null, byName: '', at: '' }), null);
  assert.equal(taskProofOf({ url: OK }), null);                       // 칸이 빠지면 거절
  assert.equal(taskProofOf({ ...good, byName: 42 }), null);
  assert.equal(taskProofOf('문자열'), null);
});

test('taskProofOf — by는 null을 허용한다(멤버가 지워진 경우)', () => {
  const p = { url: OK, by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' };
  assert.deepEqual(taskProofOf(p), p);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --test src/lib/taskProofGuard.test.ts`
Expected: FAIL — `Cannot find module './taskProofGuard.ts'`

- [ ] **Step 3: `src/lib/taskProofGuard.ts`를 만든다**

```ts
// RT 작업 증빙 스크린샷의 순수 규칙 — 서버 라우트와 브라우저가 함께 쓴다(브라우저 API를 import하지 않는다).
// 스펙 2026-08-31-rt-proof-screenshot-design.md §4-2·§5-1.
//
// 경로 정규식으로 좁히는 이유는 draftMediaGuard와 같다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 업로드 경로의 MIME·용량
// 제한은 PATCH 경로를 통과하지 않으므로, 여기가 유일한 방어선이다.

export interface TaskProof {
  url: string;        // 스토리지 경로. task/<작업id>/<파일id>.<확장자> — 절대 URL이 아니다
  by: string | null;  // 올린 member.id. 멤버가 지워지면 null이 될 수 있다
  byName: string;     // 올린 사람 이름 스냅샷 — 표시할 때마다 member를 조인하지 않기 위해(payment_request 관례)
  at: string;         // ISO 시각
}

export const TASK_PROOF_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// 줄 전체를 고정한다(^…$) — 앞뒤에 뭘 붙여 우회하지 못하게. 개행이 섞인 값도 통과하지 않는다.
export const TASK_PROOF_PATH_RE = new RegExp(`^task/${UUID}/${UUID}\\.(?:${TASK_PROOF_EXTENSIONS.join('|')})$`);

export function isTaskProofPath(v: unknown): v is string {
  return typeof v === 'string' && TASK_PROOF_PATH_RE.test(v);
}

// jsonb 컬럼의 모양은 보증되지 않는다 — 검증 통과분만 돌려준다(campaignTaskStore.costOf와 같은 태도).
export function taskProofOf(v: unknown): TaskProof | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as { url?: unknown; by?: unknown; byName?: unknown; at?: unknown };
  if (!isTaskProofPath(p.url)) return null;
  if (!(p.by === null || typeof p.by === 'string')) return null;
  if (typeof p.byName !== 'string') return null;
  if (typeof p.at !== 'string' || p.at === '') return null;
  return { url: p.url, by: p.by, byName: p.byName, at: p.at };
}

// ── 문구 (사용자 언어, AGENTS 원칙 1·3) ──
export const PROOF_VALUE_MESSAGE = '증빙 스크린샷 값이 올바르지 않아요 — 화면을 새로고침하고 다시 올려주세요';
export const PROOF_ONLY_RT_MESSAGE = '증빙 스크린샷은 RT 작업에만 붙일 수 있어요';
export const PROOF_REQUIRED_MESSAGE = '증빙 스크린샷을 넣어야 게시됨으로 표시할 수 있어요';
export const PROOF_KEEP_MESSAGE = '게시됨인 RT 작업은 증빙을 뗄 수 없어요 — 다른 스크린샷으로 바꿔 주세요';
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --test src/lib/taskProofGuard.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 마이그레이션 `migrations/043_task_proof.sql`을 만든다**

```sql
-- 043: RT 작업 증빙 스크린샷 (스펙 2026-08-31-rt-proof-screenshot-design.md §4·§10)
-- 041·042는 정산 프로덕트 연동 API 브랜치(미머지)가 쓴다 → 이 파일은 043.
-- apply-migrations.sh가 전 파일을 매번 재실행하므로 모든 문장은 재실행 안전(멱등).

-- §4-2 작업 한 건의 증빙 1장 — {url, by, byName, at}. RT 작업에만 채워진다(앱이 지킨다).
alter table campaign_task add column if not exists proof jsonb;

-- §7 정산 요청 스냅샷 — 요청 만든 시점의 증빙을 그대로 복사한다(전송은 아직 안 한다).
alter table payment_request add column if not exists proof jsonb;

-- §4-3 비공개 버킷. 표시·내려받기 모두 서명 URL로만 접근한다.
-- draft-media(024)를 재사용하지 않는 이유: 경로 정규식이 draft/<uuid>/…에 묶여 있고 용량 상한이 다르다.
-- file_size_limit은 src/lib/taskProof.ts의 MAX_TASK_PROOF_BYTES와 반드시 같은 값(10MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-proof', 'task-proof', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- 이미 만들어져 있던 버킷도 이 값으로 맞춘다 — on conflict do nothing이 값 변경을 안 해서, 상한을
-- 올린 뒤 재실행할 때 코드 상수와 어긋난 채 남는 것을 막는다.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       public = false
 where id = 'task-proof';

-- create policy에는 if not exists가 없다 — 재실행 안전하게 drop 후 create(024와 같은 관례).
-- delete 정책을 주지 않는 이유: '지우기'·'바꾸기'는 campaign_task.proof 포인터만 바꾼다.
-- 스토리지 객체는 남긴다(비공개라 새지 않고, 교체 흔적이 남는 쪽이 증빙에 유리하다).
drop policy if exists "task-proof read" on storage.objects;
create policy "task-proof read" on storage.objects
  for select to authenticated using (bucket_id = 'task-proof');

drop policy if exists "task-proof write" on storage.objects;
create policy "task-proof write" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-proof');
```

- [ ] **Step 6: 커밋**

```bash
git add migrations/043_task_proof.sql src/lib/taskProofGuard.ts src/lib/taskProofGuard.test.ts
git commit -m "feat(campaign): RT 증빙 스크린샷 — 마이그레이션 043·경로 규칙과 문구

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

> **마이그레이션 적용은 사람이 한다.** 이 계획에서 `scripts/apply-migrations.sh`를 실행하지 않는다 — Task 2의 실 DB 테스트 전에 koo에게 적용을 요청하고, 적용됐다는 답을 받은 뒤 진행한다.

---

### Task 2: 저장소 — 증빙 읽기·쓰기

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (`TaskRow` 10-22행, `TaskPatch` 27-32행, `Row` 45-52행, `toRow` 64-77행, `SELECT` 79-92행, `updateTask` 138-158행)
- Test: `src/lib/campaignTaskStore.test.ts` (실 DB — 기존 파일에 추가)

**Interfaces:**
- Consumes: `TaskProof`, `taskProofOf` (Task 1)
- Produces: `TaskRow.proof: TaskProof | null`, `TaskPatch.proof?: TaskProof | null`

- [ ] **Step 1: `.env`를 준비한다 (아직 없으면)**

```bash
ls .env || (vercel link && vercel env pull .env --environment=production)
```

`.env`가 이미 있으면 그대로 쓴다. `vercel link`은 대화형이라 막히면 사용자에게 `! vercel link`로 직접 실행해 달라고 요청한다. **연결된 프로젝트가 `cb-x-deck`인지 `.vercel/project.json`으로 확인한다** — 엉뚱한 프로젝트에 연결되는 함정이 있었다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/lib/campaignTaskStore.test.ts` 맨 아래에 추가한다. 이 파일의 기존 테스트가 캠페인·작업을 어떻게 만들고 지우는지 먼저 읽고 **그 헬퍼를 그대로 쓴다**(자체 헬퍼를 새로 만들지 않는다).

```ts
test('증빙 — 저장하고 다시 읽는다 · 3값 규칙(undefined 유지 · null 지움)', async () => {
  // 이 파일의 기존 관례대로 캠페인·작업을 만든다(위쪽 테스트의 헬퍼를 재사용).
  const { campaignId } = await makeCampaign();          // ← 기존 헬퍼 이름에 맞춘다
  const [task] = await createTasks(sql, campaignId, {
    type: 'rt', targetTaskId: null, targetTweetUrl: 'https://x.com/a/status/1',
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle: 'someone', cost: null }],
  });
  const proof = {
    url: `task/${task.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`,
    by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z',
  };

  assert.equal((await getTask(sql, task.id))!.proof, null);

  await updateTask(sql, task.id, { proof });
  assert.deepEqual((await getTask(sql, task.id))!.proof, proof);

  // 다른 칸만 고치면 증빙은 그대로 남는다(undefined = 건드리지 않음)
  await updateTask(sql, task.id, { note: '메모' });
  assert.deepEqual((await getTask(sql, task.id))!.proof, proof);

  // null = 지움
  await updateTask(sql, task.id, { proof: null });
  assert.equal((await getTask(sql, task.id))!.proof, null);

  await deleteTask(sql, task.id);
});

test('증빙 — jsonb에 깨진 값이 들어 있으면 null로 읽는다(화면이 죽지 않게)', async () => {
  const { campaignId } = await makeCampaign();
  const [task] = await createTasks(sql, campaignId, {
    type: 'rt', targetTaskId: null, targetTweetUrl: 'https://x.com/a/status/2',
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle: 'someone', cost: null }],
  });
  await sql`update campaign_task set proof = ${sql.json({ url: 'https://evil.example/a.png' } as never)} where id = ${task.id}`;
  assert.equal((await getTask(sql, task.id))!.proof, null);
  await deleteTask(sql, task.id);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskStore.test.ts`
Expected: FAIL — `proof`가 `TaskPatch`에 없다는 타입 오류, 또는 `undefined !== null`

- [ ] **Step 4: 저장소를 고친다**

1. import 추가: `import { taskProofOf, type TaskProof } from './taskProofGuard.ts';`
2. `TaskRow`에 한 줄 추가 (`note: string;` 다음):
   ```ts
   proof: TaskProof | null;   // RT 증빙 스크린샷 1장(스펙 2026-08-31 §4-2). RT 아닌 유형은 늘 null
   ```
3. `TaskPatch`에 추가 (`note?: string;` 다음):
   ```ts
   proof?: TaskProof | null;   // 3값: undefined 유지 · null 떼기 · 값 설정
   ```
4. `type Row`에 추가 (`note: string;` 다음): `proof: unknown;`
5. `toRow`에 추가 (`note: r.note,` 다음): `proof: taskProofOf(r.proof),`
6. `SELECT`의 `t.cost, t.note, t.created_at, t.updated_at,` 를 `t.cost, t.note, t.proof, t.created_at, t.updated_at,` 로 바꾼다
7. `updateTask`의 `note = coalesce(…)` 줄 다음에 추가:
   ```sql
         proof             = case when ${patch.proof !== undefined} then ${patch.proof ? sql.json(patch.proof as never) : null}::jsonb else proof end,
   ```
   (`cost`와 같은 패턴 — `case when`이라야 null 지움과 유지가 갈린다. `coalesce`를 쓰면 null로 지울 수 없다.)

- [ ] **Step 5: 통과를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskStore.test.ts`
Expected: PASS — 신규 2건 포함 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignTaskStore.test.ts
git commit -m "feat(campaign): 작업 증빙 칸 읽기·쓰기(3값 규칙)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 입력 검증 + 필수 강제

**Files:**
- Modify: `src/lib/campaignTaskInput.ts` (`parseTaskPatch`)
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` (PATCH)
- Test: `src/lib/campaignTaskInput.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `isTaskProofPath`, `PROOF_VALUE_MESSAGE`, `PROOF_ONLY_RT_MESSAGE`, `PROOF_REQUIRED_MESSAGE`, `PROOF_KEEP_MESSAGE` (Task 1), `TaskPatch.proof` (Task 2)
- Produces: API 계약 — `PATCH` 본문의 `proof`는 **스토리지 경로 문자열 또는 null**. `by`·`byName`·`at`은 서버가 채운다(클라이언트 값을 믿지 않는다). `parseTaskPatch`는 `proofUrl?: string | null`을 결과에 실어 라우트에 넘긴다.

> **왜 `TaskPatch.proof`(객체)를 파서가 만들지 않나:** 파서는 순수 함수라 로그인한 멤버를 모른다. 파서는 경로만 검증해 `proofUrl`로 넘기고, 라우트가 멤버 정보를 붙여 `TaskPatch.proof` 객체를 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/campaignTaskInput.test.ts`에 추가:

```ts
const P_TASK = '11111111-2222-3333-4444-555555555555';
const P_FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const P_OK = `task/${P_TASK}/${P_FILE}.png`;

test('parseTaskPatch — 증빙 경로는 통과, 임의 URL은 거절', () => {
  const ok = parseTaskPatch({ proof: P_OK });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.proofUrl, P_OK);

  const bad = parseTaskPatch({ proof: 'https://evil.example/pixel.png' });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.message, PROOF_VALUE_MESSAGE);

  const obj = parseTaskPatch({ proof: { url: P_OK, byName: '남의 이름' } });
  assert.equal(obj.ok, false);   // 객체는 받지 않는다 — 서버가 by/byName/at을 채운다
});

test('parseTaskPatch — 증빙 null은 떼기(파서 단계에서는 허용)', () => {
  const r = parseTaskPatch({ proof: null });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.proofUrl, null);
});

test('parseTaskPatch — 증빙 키가 없으면 결과에도 없다(건드리지 않음)', () => {
  const r = parseTaskPatch({ note: '메모' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && 'proofUrl' in r.value, false);
});
```

`PROOF_VALUE_MESSAGE`를 import에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --test src/lib/campaignTaskInput.test.ts`
Expected: FAIL — `proofUrl`이 없다

- [ ] **Step 3: `parseTaskPatch`를 고친다**

1. import: `import { isTaskProofPath, PROOF_VALUE_MESSAGE } from './taskProofGuard.ts';`
2. `TaskPatch`를 그대로 반환 타입으로 쓰던 자리를 바꾼다 — `parseTaskPatch`의 반환은 `Parsed<TaskPatchParsed>`가 된다:
   ```ts
   // 파서는 멤버를 모르므로 증빙은 경로만 넘긴다 — 라우트가 by/byName/at을 붙여 TaskPatch.proof를 만든다(§5-1).
   export type TaskPatchParsed = Omit<TaskPatch, 'proof'> & { proofUrl?: string | null };
   ```
   `export function parseTaskPatch(body: unknown): Parsed<TaskPatchParsed>` 로 시그니처를 바꾸고 `const out: TaskPatchParsed = {};` 로 고친다.
3. `if ('note' in b) …` 다음에 추가:
   ```ts
   if ('proof' in b) {
     if (b.proof === null) out.proofUrl = null;
     else if (isTaskProofPath(b.proof)) out.proofUrl = b.proof;
     else return fail(PROOF_VALUE_MESSAGE);
   }
   ```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --test src/lib/campaignTaskInput.test.ts`
Expected: PASS

- [ ] **Step 5: 라우트에서 필수 3규칙을 강제한다**

`src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`의 PATCH에서, `if (patch.visitOn && cur.type !== 'visit') …` 줄 **다음에** 넣는다. `patch`는 이제 `TaskPatchParsed`라 `proofUrl`을 들고 있다 — `updateTask`에 넘기기 전에 객체로 바꿔야 한다.

```ts
  // ── RT 증빙 3규칙 (스펙 §5) ──
  const { proofUrl, ...rest } = patch;
  const taskPatch: TaskPatch = { ...rest };
  if (proofUrl !== undefined) {
    // ① 범위 — RT 작업에만 붙는다(결정 3)
    if (cur.type !== 'rt') return NextResponse.json({ error: PROOF_ONLY_RT_MESSAGE }, { status: 400 });
    // ② 게시됨인 RT에서 증빙을 비우는 것은 막는다 — 비우기가 아니라 바꾸기만(결정 1과 5의 정합)
    if (proofUrl === null && cur.postedAt) return NextResponse.json({ error: PROOF_KEEP_MESSAGE }, { status: 400 });
    taskPatch.proof = proofUrl === null
      ? null
      : { url: proofUrl, by: gate.member.id, byName: gate.member.name, at: new Date().toISOString() };
  }
  // ③ 필수 — RT를 게시됨으로 바꾸려면 이번 요청에 증빙이 오거나 이미 행에 있어야 한다(결정 1).
  //    DB CHECK 제약으로는 못 막는다: 기존 게시된 RT 행에 증빙이 없어 그 행을 수정할 때 터진다(§5).
  if (taskPatch.postedAt && !cur.postedAt && cur.type === 'rt' && !taskPatch.proof && !cur.proof) {
    return NextResponse.json({ error: PROOF_REQUIRED_MESSAGE }, { status: 400 });
  }
```

그리고 아래쪽에서 `patch`를 쓰던 자리를 `taskPatch`로 바꾼다:
- `if (Object.keys(patch).length === 0)` → `patch` 유지(빈 요청 판정은 파서 결과 기준이 맞다)
- `if (patch.removedAt && !cur.postedAt && !patch.postedAt)` → 그대로(둘 다 파서 결과에 있다)
- `patch.targetTaskId` 분기의 `patch.targetTweetUrl = null` → `taskPatch.targetTweetUrl = null` 로, `patch.targetTaskId = null` → `taskPatch.targetTaskId = null` 로 바꾼다
- `await updateTask(tx, taskId, patch)` → `await updateTask(tx, taskId, taskPatch)`
- `patch.influencerHandle !== undefined` 분기는 그대로 둔다(`patch`에도 있다)

import 추가:
```ts
import { PROOF_ONLY_RT_MESSAGE, PROOF_REQUIRED_MESSAGE, PROOF_KEEP_MESSAGE } from '@/lib/taskProofGuard';
import type { TaskPatch } from '@/lib/campaignTaskStore';
```

`gate.member.name`이 있는지 확인한다 — 없으면 `resolveMember`가 돌려주는 필드 이름에 맞춘다(`src/lib/authGuard.ts`).

- [ ] **Step 6: 다른 호출부의 타입을 맞춘다**

`parseTaskPatch`는 라우트 4곳이 쓴다. 타입이 바뀌었으니 전수 확인:

```bash
grep -rn "parseTaskPatch" src --include="*.ts" --include="*.tsx" | grep -v "\.test\."
npx tsc --noEmit
```

`proofUrl`을 쓰지 않는 호출부는 `Omit`으로 넓어진 타입을 그대로 `updateTask`에 넘길 수 없다 — 그 자리에서도 `const { proofUrl: _p, ...rest } = parsed.value;` 로 떼어낸다(`_p`는 `@typescript-eslint/no-unused-vars` 규칙에 걸리지 않게 이름 앞에 `_`).

- [ ] **Step 7: 타입·린트를 확인한다**

Run: `npx tsc --noEmit && npx eslint src`
Expected: tsc 오류 0, eslint `✖ 24 problems` (기준선 그대로)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/campaignTaskInput.ts src/lib/campaignTaskInput.test.ts "src/app/api/campaigns/[id]/tasks/[taskId]/route.ts"
git commit -m "feat(campaign): RT 게시 확인에 증빙 필수 — 서버가 지킨다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 게시물 연결로 RT를 게시됨으로 만들 수 없게

**Files:**
- Modify: `src/lib/trackingStore.ts` (`linkTrackedPost` 214행~)
- Modify: `src/app/api/tracking/route.ts` (POST의 `if (taskId)` 분기), `src/app/api/tracking/[id]/route.ts` (PATCH의 `taskId` 분기)
- Test: `src/lib/trackingStore.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `linkTrackedPost`가 RT 작업에 연결을 시도하면 `TrackingLinkError`(code `'rt-task'`)를 던진다

**왜:** `linkTrackedPost`는 `coalesce`로 대상 작업의 `posted_at`·`posted_source`를 채운다 — RT 작업에 쓰면 증빙 없이 게시됨이 된다. 화면은 이미 RT를 제외하지만(`TaskTable.tsx:180`의 `onLinkPost={t.type === 'rt' ? null : …}`) API는 열려 있다. RT엔 자기 게시물이 없으니 이 연결은 원래도 개념상 틀렸다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/trackingStore.test.ts`에 추가한다(이 파일의 기존 헬퍼로 tracked_post와 작업을 만든다):

```ts
test('게시물 연결 — RT 작업에는 붙일 수 없다(증빙 없이 게시됨이 되는 우회 경로 차단)', async () => {
  const { campaignId } = await makeCampaign();       // ← 이 파일의 기존 헬퍼 이름에 맞춘다
  const [rt] = await createTasks(sql, campaignId, {
    type: 'rt', targetTaskId: null, targetTweetUrl: 'https://x.com/a/status/10',
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle: 'someone', cost: null }],
  });
  const post = await makeTrackedPost();              // ← 기존 헬퍼

  await assert.rejects(
    () => linkTrackedPost(sql, post.id, { taskId: rt.id }),
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'rt-task',
  );

  // 게시 확인이 채워지지 않았음을 직접 확인한다 — 이게 이 가드의 목적이다
  assert.equal((await getTask(sql, rt.id))!.postedAt, null);

  await deleteTask(sql, rt.id);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingStore.test.ts`
Expected: FAIL — `TrackingLinkError`가 없다

- [ ] **Step 3: `linkTrackedPost`에 가드를 넣는다**

`src/lib/trackingStore.ts`에 오류 클래스를 추가하고(파일 위쪽, 다른 export 옆):

```ts
// 게시물 연결이 거절되는 이유 — 라우트가 400 문구로 바꿔 보낸다.
export class TrackingLinkError extends Error {
  constructor(public code: 'rt-task') { super(code); this.name = 'TrackingLinkError'; }
}
export const TRACKING_LINK_RT_MESSAGE = 'RT 작업에는 게시물을 연결할 수 없어요 — RT는 새 게시물을 만들지 않아요. 증빙 스크린샷으로 게시 확인해 주세요';
```

`linkTrackedPost`의 `if ('taskId' in link)` 분기에서 작업을 조회하는 부분을 `type`까지 읽어 검사한다:

```ts
  if ('taskId' in link) {
    taskId = link.taskId;
    if (taskId) {
      const t = await sql<Array<{ draft_id: string | null; type: string }>>`select draft_id, type from campaign_task where id = ${taskId}`;
      if (t.length === 0) throw Object.assign(new Error('task not found'), { code: '23503' });   // FK 위반과 같은 처리(라우트 400)
      // RT엔 자기 게시물이 없다 — 붙이면 posted_at이 증빙 없이 채워진다(RT 증빙 스펙 §5)
      if (t[0].type === 'rt') throw new TrackingLinkError('rt-task');
      draftId = t[0].draft_id;
    }
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingStore.test.ts`
Expected: PASS

- [ ] **Step 5: 라우트 두 곳에서 400으로 바꿔 보낸다**

`src/app/api/tracking/route.ts` POST의 `catch (e)` 안, `23503` 검사 **앞에** 추가:

```ts
      if (e instanceof TrackingLinkError) return NextResponse.json({ error: TRACKING_LINK_RT_MESSAGE }, { status: 400 });
```

`src/app/api/tracking/[id]/route.ts` PATCH의 `catch (e)` 안에도 같은 줄을 `23503` 검사 앞에 추가한다. 두 파일 모두 import를 늘린다:

```ts
import { TrackingLinkError, TRACKING_LINK_RT_MESSAGE } from '@/lib/trackingStore';
```

POST 쪽 주의: 연결 실패로 400을 돌려주더라도 **tracked_post 등록은 이미 끝난 상태다**(기존 주석이 그렇게 말한다). 그 동작을 바꾸지 않는다.

- [ ] **Step 6: 타입·린트를 확인하고 커밋**

```bash
npx tsc --noEmit && npx eslint src
git add src/lib/trackingStore.ts src/lib/trackingStore.test.ts src/app/api/tracking/route.ts "src/app/api/tracking/[id]/route.ts"
git commit -m "fix(tracking): RT 작업에는 게시물을 연결할 수 없게 — 증빙 없는 게시 확인 우회 차단

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 브라우저 라이브러리 — 검증·업로드·서명·내려받기

**Files:**
- Create: `src/lib/taskProof.ts`
- Test: `src/lib/taskProof.test.ts`

**Interfaces:**
- Consumes: `TASK_PROOF_EXTENSIONS`, `isTaskProofPath` (Task 1)
- Produces:
  ```ts
  export const TASK_PROOF_BUCKET = 'task-proof'
  export const MAX_TASK_PROOF_BYTES = 10 * 1024 * 1024
  export const ALLOWED_TASK_PROOF_MIME: readonly ['image/jpeg', 'image/png', 'image/webp']
  export function taskProofValidationError(file: File): string | null
  export function taskProofFilename(i: { postedAt: string | null; influencerHandle: string | null; url: string }): string
  export async function uploadTaskProof(taskId: string, file: File): Promise<string>   // 스토리지 경로
  export async function signTaskProofUrl(path: string, expiresIn?: number): Promise<string>
  export async function downloadTaskProof(path: string, filename: string): Promise<void>
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/taskProof.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskProofValidationError, taskProofFilename, MAX_TASK_PROOF_BYTES } from './taskProof.ts';

// node 환경에도 File이 있다(Node 20+). 크기는 내용 길이로 만든다.
const file = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

test('검증 — 허용 형식만 통과, gif는 거절', () => {
  assert.equal(taskProofValidationError(file('a.png', 'image/png', 10)), null);
  assert.equal(taskProofValidationError(file('a.jpg', 'image/jpeg', 10)), null);
  assert.equal(taskProofValidationError(file('a.webp', 'image/webp', 10)), null);
  assert.equal(
    taskProofValidationError(file('a.gif', 'image/gif', 10)),
    '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)',
  );
  assert.equal(
    taskProofValidationError(file('a.pdf', 'application/pdf', 10)),
    '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)',
  );
});

test('검증 — 10MB 경계', () => {
  assert.equal(taskProofValidationError(file('a.png', 'image/png', MAX_TASK_PROOF_BYTES)), null);
  assert.equal(
    taskProofValidationError(file('a.png', 'image/png', MAX_TASK_PROOF_BYTES + 1)),
    '10MB를 넘어요 — 크기를 줄여서 다시 올려주세요',
  );
});

test('파일명 — 게시일·핸들·용도가 보이고, 게시일이 없으면 핸들만', () => {
  assert.equal(
    taskProofFilename({ postedAt: '2026-08-31', influencerHandle: 'someone', url: 'task/x/y.png' }),
    '20260831_someone_RT증빙.png',
  );
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'someone', url: 'task/x/y.jpg' }),
    'someone_RT증빙.jpg',
  );
  // 배정이 없으면 화면과 같은 말('미배정'), 파일명 금지문자는 밑줄
  assert.equal(
    taskProofFilename({ postedAt: '2026-08-31', influencerHandle: null, url: 'task/x/y.webp' }),
    '20260831_미배정_RT증빙.webp',
  );
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'a/b:c', url: 'task/x/y.png' }),
    'a_b_c_RT증빙.png',
  );
  // 확장자를 못 찾으면 png로 — 파일명이 확장자 없이 나가지 않게
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'someone', url: 'task/x/y' }),
    'someone_RT증빙.png',
  );
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --test src/lib/taskProof.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: `src/lib/taskProof.ts`를 만든다**

```ts
// RT 증빙 스크린샷 — 브라우저에서 앱 밖으로 나가는/들어오는 경로(업로드·서명·내려받기)와
// 그 경로가 쓰는 순수 규칙(검증·파일명). 경로 규칙 자체는 taskProofGuard가 갖는다(서버와 공유).
// draftMedia.ts와 나란히 두고 재사용하지 않는다 — 상한·형식·경로·파일명 규칙이 전부 다르다.
import { createClient } from './supabase/client.ts';
import { TASK_PROOF_EXTENSIONS } from './taskProofGuard.ts';

export const TASK_PROOF_BUCKET = 'task-proof';

// 마이그레이션 043의 버킷 file_size_limit과 반드시 같은 값 — 여기서 통과시킨 파일이 서버에서
// 거절되면 "골라서 바로 알았다"가 깨진다.
export const MAX_TASK_PROOF_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TASK_PROOF_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// 파일명 금지문자(Windows·macOS 공통) → 밑줄. 핸들은 자유 입력이라 섞일 수 있다.
const FORBIDDEN_CHARS_RE = /[/\\:*?"<>|]/g;

// ── 검증 (순수) ──
export function taskProofValidationError(file: File): string | null {
  if (!ALLOWED_TASK_PROOF_MIME.includes(file.type as (typeof ALLOWED_TASK_PROOF_MIME)[number])) {
    return '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)';
  }
  if (file.size > MAX_TASK_PROOF_BYTES) return '10MB를 넘어서요 — 크기를 줄여서 다시 올려주세요';
  return null;
}

// ── 파일명 (순수) ──
function extensionOf(pathOrName: string): string {
  const last = pathOrName.split('/').pop() ?? '';
  const i = last.lastIndexOf('.');
  if (i < 0 || i === last.length - 1) return '';
  const ext = last.slice(i + 1).toLowerCase();
  return (TASK_PROOF_EXTENSIONS as readonly string[]).includes(ext) ? ext : '';
}

// <게시일YYYYMMDD>_<핸들|미배정>_RT증빙.<확장자> — 게시일이 없으면 날짜를 빼고 핸들부터.
export function taskProofFilename(i: { postedAt: string | null; influencerHandle: string | null; url: string }): string {
  const name = (i.influencerHandle || '미배정').replace(/^@/, '').replace(FORBIDDEN_CHARS_RE, '_');
  const date = i.postedAt ? `${i.postedAt.replace(/-/g, '')}_` : '';
  return `${date}${name}_RT증빙.${extensionOf(i.url) || 'png'}`;
}

// ── 업로드 ──
function extensionForFile(file: File): string {
  return extensionOf(file.name) || MIME_EXT[file.type] || 'png';
}

// task-proof 버킷에 올리고 스토리지 경로를 돌려준다. 절대 URL이 아니다 — 비공개 버킷이라
// 표시·내려받기 모두 그때그때 서명 URL을 새로 받는다.
export async function uploadTaskProof(taskId: string, file: File): Promise<string> {
  const err = taskProofValidationError(file);
  if (err) throw new Error(err);
  const path = `task/${taskId}/${crypto.randomUUID()}.${extensionForFile(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(TASK_PROOF_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('올리지 못했어요 — 다시 시도해주세요');
  return path;
}

// ── 서명 ──
export async function signTaskProofUrl(path: string, expiresIn = 3600): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(TASK_PROOF_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error('이미지 링크를 만들지 못했어요 — 다시 시도해주세요');
  return data.signedUrl;
}

// ── 내려받기 ──
// 서명 URL을 클릭 시점에 새로 받는다 — 렌더 때 받은 URL을 재사용하면 만료된 채 조용히 실패한다.
export async function downloadTaskProof(path: string, filename: string): Promise<void> {
  const signed = await signTaskProofUrl(path, 60);
  const res = await fetch(signed);
  if (!res.ok) throw new Error('이미지를 받지 못했어요 — 다시 시도해주세요');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke를 미룬다 — click() 직후 동기로 걷으면 다운로드가 blob을 읽기 전에 무효화되어 저장이
  // 간헐적으로 끊긴다(draftMedia에서 리뷰로 잡힌 것과 같은 함정).
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --test src/lib/taskProof.test.ts`
Expected: PASS — 3 tests

문구가 테스트와 어긋나면(예: `10MB를 넘어서요` vs `10MB를 넘어요`) **테스트를 코드에 맞추지 말고 둘을 하나로 정한다** — 사용자에게 보이는 문구다. `10MB를 넘어요 — 크기를 줄여서 다시 올려주세요`로 통일한다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/taskProof.ts src/lib/taskProof.test.ts
git commit -m "feat(campaign): 증빙 스크린샷 업로드·서명·내려받기 라이브러리

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 첨부 칸 컴포넌트 + 서명 URL 배치 훅

**Files:**
- Create: `src/components/useSignedTaskProofUrls.ts`
- Create: `src/components/TaskProofField.tsx`

**Interfaces:**
- Consumes: `uploadTaskProof`, `taskProofValidationError`, `downloadTaskProof`, `taskProofFilename`, `TASK_PROOF_BUCKET` (Task 5), `ImageLightbox` (기존)
- Produces:
  ```ts
  // useSignedTaskProofUrls.ts
  export function useSignedTaskProofUrls(paths: string[]): Record<string, string>

  // TaskProofField.tsx
  export function TaskProofField(props: {
    taskId: string;
    value: string | null;              // 저장된 스토리지 경로
    signedUrl: string | null;          // 부모가 배치로 받아 넘긴 표시용 URL(없으면 미리보기만)
    postedAt: string | null;           // 파일명용
    influencerHandle: string | null;   // 파일명용
    required: boolean;                 // true면 '필수' 표시 + 안내 문구
    canRemove: boolean;                // false면 [지우기] 없음(게시됨인 RT)
    disabled: boolean;
    onChange: (path: string | null) => void;   // 업로드 완료·지우기 시
  }): JSX.Element
  ```

**설계 메모(왜 이렇게):** 표에는 증빙 있는 행이 여러 개다. 컴포넌트가 각자 서명하면 행 수만큼 왕복한다 → 부모가 `useSignedTaskProofUrls`로 **한 번에** 서명하고 URL을 내려준다(`useSignedMedia`가 원고에서 쓰는 방식과 같은 이유). 방금 올린 파일은 서명을 기다리지 않고 `URL.createObjectURL`로 즉시 보여준다.

- [ ] **Step 1: `src/components/useSignedTaskProofUrls.ts`를 만든다**

```ts
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TASK_PROOF_BUCKET } from '@/lib/taskProof';

const EXPIRES_IN = 86400;   // 24시간 — 탭을 켜둔 채 다음 날 열면 넘길 수 있다(그때는 <img onError>가 아니라 새로고침으로 해결)

// 경로 배열 → { 경로: 서명 URL }. 입력 크기와 무관하게 고정된 개수의 상태·이펙트만 쓴다
// (행 수가 렌더마다 바뀌어도 훅 호출 횟수가 변하지 않게 — useSignedMedia와 같은 이유).
export function useSignedTaskProofUrls(paths: string[]): Record<string, string> {
  const [signed, setSigned] = useState<Record<string, string>>({});
  const requestedRef = useRef<Set<string>>(new Set());

  const key = paths.filter(Boolean).sort().join('|');
  const unique = useMemo(() => Array.from(new Set(paths.filter(Boolean))), [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const need = unique.filter((p) => !requestedRef.current.has(p));
    if (need.length === 0) return;
    need.forEach((p) => requestedRef.current.add(p));
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from(TASK_PROOF_BUCKET).createSignedUrls(need, EXPIRES_IN);
      if (error || !data) return;   // 실패하면 썸네일만 안 보인다 — 화면은 계속 쓸 수 있어야 한다
      const next: Record<string, string> = {};
      data.forEach((row, i) => { if (row.signedUrl) next[need[i]] = row.signedUrl; });
      if (Object.keys(next).length) setSigned((cur) => ({ ...cur, ...next }));
    })();
  }, [unique]);

  return signed;
}
```

`eslint-disable-line react-hooks/exhaustive-deps`가 새 경고를 만들지 않는지 Step 4에서 확인한다. 걸리면 `useMemo`를 없애고 `paths`를 그대로 쓰되 `key`를 의존성으로 두는 형태로 바꾼다.

- [ ] **Step 2: `src/components/TaskProofField.tsx`를 만든다**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { uploadTaskProof, taskProofValidationError, downloadTaskProof, taskProofFilename } from '@/lib/taskProof';
import { ImageLightbox } from '@/components/ImageLightbox';

// RT 증빙 첨부 칸 — 붙여넣기가 주 경로다(스크린샷은 거의 항상 클립보드에 있다).
// 파일을 고르는 순간 올라가고, 저장(부모의 onChange가 하는 PATCH)은 부모가 판단한다.
export function TaskProofField({
  taskId, value, signedUrl, postedAt, influencerHandle, required, canRemove, disabled, onChange,
}: {
  taskId: string; value: string | null; signedUrl: string | null;
  postedAt: string | null; influencerHandle: string | null;
  required: boolean; canRemove: boolean; disabled: boolean;
  onChange: (path: string | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);   // 방금 올린 파일의 objectURL — 서명을 기다리지 않는다
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 컴포넌트가 사라질 때 objectURL을 걷는다(누수 방지)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function put(file: File) {
    const v = taskProofValidationError(file);
    if (v) { setErr(v); return; }
    setErr('');
    setBusy(true);
    try {
      const path = await uploadTaskProof(taskId, file);
      setPreview((cur) => { if (cur) URL.revokeObjectURL(cur); return URL.createObjectURL(file); });
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했어요 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  // 붙여넣기 — 이 상자에 포커스가 있을 때만 받는다(문서 전역에 붙이면 다른 입력의 붙여넣기를 훔친다)
  function onPaste(e: React.ClipboardEvent) {
    if (disabled || busy) return;
    const item = Array.from(e.clipboardData.files)[0];
    if (!item) return;
    e.preventDefault();
    void put(item);
  }

  const shown = preview ?? signedUrl;
  const label = 'text-ui text-x-secondary';

  return (
    <div className="mt-2">
      <p className={label}>증빙 스크린샷 {required && <span className="text-red-600">필수</span>}</p>
      {shown ? (
        <div className="mt-1 flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="증빙 스크린샷" className="h-16 w-16 cursor-zoom-in rounded-md border border-x-border object-cover"
               onClick={() => setZoom(true)} />
          <div className="min-w-0 text-ui">
            <div className="flex flex-wrap gap-x-2">
              <button type="button" onClick={() => setZoom(true)} className="text-x-blue-text hover:underline">크게 보기</button>
              <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()} className="text-x-blue-text hover:underline disabled:opacity-50">바꾸기</button>
              {canRemove && (
                <button type="button" disabled={disabled || busy} onClick={() => { setPreview(null); onChange(null); }} className="text-x-secondary hover:underline disabled:opacity-50">지우기</button>
              )}
              {value && (
                <button type="button" onClick={() => void downloadTaskProof(value, taskProofFilename({ postedAt, influencerHandle, url: value }))}
                        className="text-x-blue-text hover:underline">받기</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div ref={boxRef} tabIndex={0} onPaste={onPaste} onClick={() => inputRef.current?.click()}
             role="button" aria-label="증빙 스크린샷 올리기"
             className="mt-1 cursor-pointer rounded-lg border border-dashed border-x-border-strong px-3 py-4 text-center text-ui text-x-secondary hover:bg-x-hover focus:border-x-blue focus:outline-none">
          {busy ? '올리는 중…' : '여기를 누르거나 Ctrl+V로 붙여넣기'}
        </div>
      )}
      {required && !shown && (
        <p className="mt-1 text-ui text-x-muted">인플루언서 피드에서 RT가 보이는 화면을 찍어주세요 — 계정 이름과 RT 표시가 함께 보이면 좋아요</p>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
      {zoom && shown && <ImageLightbox urls={[shown]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: 타입을 확인한다**

Run: `npx tsc --noEmit`
Expected: 오류 0. `React.ClipboardEvent`를 쓰려면 `import type { ClipboardEvent } from 'react'`가 필요할 수 있다 — tsc가 말하는 대로 맞춘다.

- [ ] **Step 4: 린트를 확인한다**

Run: `npx eslint src`
Expected: `✖ 24 problems` — 기준선 그대로. 늘었으면 늘어난 규칙을 보고 그 자리에서 해결한다(`<img>`는 disable 주석, 훅 의존성은 형태를 바꿔서).

- [ ] **Step 5: 커밋**

```bash
git add src/components/TaskProofField.tsx src/components/useSignedTaskProofUrls.ts
git commit -m "feat(campaign): 증빙 첨부 칸(붙여넣기·미리보기·크게 보기·받기)과 서명 URL 배치 훅

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 게시 확인 팝오버에 붙인다

**Files:**
- Modify: `src/lib/campaignApi.ts` (`TaskPatchRequest`)
- Modify: `src/app/campaigns/useCampaignTaskActions.ts` (`markPosted`, 신규 `setProof`)
- Modify: `src/app/campaigns/PostedCell.tsx`
- Modify: `src/app/campaigns/TaskTable.tsx` (`PostedCell` 호출부 166행 부근), `src/app/campaigns/CampaignDetail.tsx` (`markPosted` 래퍼 149행 부근)

**Interfaces:**
- Consumes: `TaskProofField` (Task 6), `useSignedTaskProofUrls` (Task 6), `TaskRow.proof` (Task 2), API `proof` 계약 (Task 3)
- Produces:
  - `TaskPatchRequest`에 `proof?: string | null`
  - actions: `markPosted(t, date, postUrl?, proof?)`, `setProof(t, path: string | null)`
  - `PostedCell` props에 `proofSignedUrl: string | null`, `onSetProof: (path: string | null) => void`

- [ ] **Step 1: API 타입에 proof를 넣는다**

`src/lib/campaignApi.ts`의 `TaskPatchRequest`에 추가:

```ts
  proof?: string | null;   // 스토리지 경로 또는 null(떼기). 올린 사람·시각은 서버가 채운다
```

- [ ] **Step 2: actions를 고친다**

`src/app/campaigns/useCampaignTaskActions.ts`의 `markPosted`를 바꾼다:

```ts
    // 게시 확인 — 사람이 찍은 것이라 postedSource는 'manual'. RT는 증빙(proof)이 함께 와야 서버가 받는다(RT 증빙 스펙 §5).
    markPosted: async (t: Item, date: string, postUrl?: string, proof?: string) => {
      const ok = await patch(t, { postedAt: date, ...(postUrl ? { postUrl } : {}), ...(proof ? { proof } : {}) },
                             { postedAt: date, postedSource: 'manual', published: true, ...(postUrl ? { postUrl } : {}),
                               ...(proof ? { proof: { url: proof, by: null, byName: '', at: new Date().toISOString() } } : {}) });
      if (!ok) return false;
      if (postUrl) {
        const reg = await registerTrackedPostApi(postUrl, t.id);
        if (!reg.ok) show('게시 확인은 저장됐어요 — 트래킹 등록은 실패했어요. 행 메뉴 [게시물 연결(트래킹)]로 다시 시도할 수 있어요');
      }
      onChanged();
      return true;
    },
    // 증빙만 바꾸기·떼기 — 게시됨인 RT는 서버가 떼기를 거절한다(비우기가 아니라 바꾸기만).
    // 낙관값의 by/byName은 응답이 진짜 값으로 덮는다(patch가 r.data로 덮어쓴다).
    setProof: (t: Item, path: string | null) =>
      patch(t, { proof: path }, { proof: path ? { url: path, by: null, byName: '', at: new Date().toISOString() } : null }),
```

`import type { TaskProof }`가 필요하면 `@/lib/taskProofGuard`에서 가져온다.

- [ ] **Step 3: `PostedCell.tsx`에 RT 분기를 넣는다**

props를 늘린다:

```tsx
export function PostedCell({ task, today, proofSignedUrl, onMarkPosted, onMarkRemoved, onUnmarkRemoved, onSetProof }: {
  task: CampaignTaskItem; today: string; proofSignedUrl: string | null;
  onMarkPosted: (date: string, postUrl?: string, proof?: string) => void;
  onMarkRemoved: (date: string, reason: string) => void;
  onUnmarkRemoved: () => void;
  onSetProof: (path: string | null) => void;
}) {
```

상태를 하나 더 둔다(`const [url, setUrl] = useState('')` 옆):

```tsx
  const [pendingProof, setPendingProof] = useState<string | null>(null);   // 아직 저장 전 — [게시됨으로 표시]와 함께 나간다
```

`openPop()`에서 초기화한다: `setPendingProof(null);`

`POP_H`를 늘린다 — 증빙 칸이 들어가 팝오버가 커진다: `const POP_H = 380;` (좌표 뒤집기 계산에만 쓰이는 값이라 실제 높이와 대략 맞으면 된다.)

`submitPosted`를 고친다:

```tsx
  function submitPosted() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    if (task.type === 'rt' && !pendingProof) { setErr('증빙 스크린샷을 넣어야 게시됨으로 표시할 수 있어요'); return; }
    const u = url.trim();
    if (u) { const p = parseTweetLink(u); if (!p.ok) { setErr(tweetLinkParseMessage(p.reason)); return; } }
    onMarkPosted(date, u || undefined, pendingProof ?? undefined); close();
  }
```

**① 미게시 분기** — `{task.type !== 'rt' && (…게시물 링크…)}` 블록 **다음에** 넣는다:

```tsx
              {task.type === 'rt' && (
                <TaskProofField taskId={task.id} value={pendingProof} signedUrl={null}
                                postedAt={null} influencerHandle={task.influencerHandle}
                                required canRemove disabled={false}
                                onChange={(p) => { setPendingProof(p); setErr(''); }} />
              )}
```

안내 문구도 RT에서 달라진다 — 팝오버 첫 줄 `게시된 날을 적으면 이 작업이 게시됨으로 바뀌고 정산 후보가 돼요`를:

```tsx
              <p className="mt-0.5 text-ui text-x-muted">
                {task.type === 'rt'
                  ? '게시된 날을 적고 증빙 스크린샷을 넣으면 게시됨으로 바뀌고 정산 후보가 돼요'
                  : '게시된 날을 적으면 이 작업이 게시됨으로 바뀌고 정산 후보가 돼요'}
              </p>
```

버튼도 막는다:

```tsx
                <button type="button" onClick={submitPosted}
                        disabled={task.type === 'rt' && !pendingProof}
                        className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover disabled:cursor-not-allowed disabled:opacity-50">게시됨으로 표시</button>
```

**② 게시됨(내림 표시) 분기** — `{task.postUrl && <a …>게시물 보기 ↗</a>}` **앞에** 넣는다:

```tsx
              {task.type === 'rt' && (
                <TaskProofField taskId={task.id} value={task.proof?.url ?? null} signedUrl={proofSignedUrl}
                                postedAt={task.postedAt} influencerHandle={task.influencerHandle}
                                required={false} canRemove={false} disabled={false}
                                onChange={(p) => onSetProof(p)} />
              )}
              {task.type === 'rt' && task.proof && (
                <p className="mt-0.5 text-ui text-x-muted">{task.proof.byName || '누군가'}가 {formatDateKo(task.proof.at.slice(0, 10))} 올림</p>
              )}
              {task.type === 'rt' && !task.proof && (
                <p className="mt-0.5 text-ui text-amber-700">증빙 없음 — 지금 채울 수 있어요</p>
              )}
```

`canRemove={false}`가 결정 1과 5를 함께 지킨다: 게시됨인 RT는 **바꾸기만** 된다(스펙 §6-1 ②).

**③ 내려짐 분기**에도 증빙을 보여준다 — `{task.removedReason && …}` 다음에 위와 같은 블록(단 `required={false} canRemove={false}`)을 넣는다. 내려진 뒤에도 증빙은 정산 판단에 쓰인다.

import를 추가한다: `import { TaskProofField } from '@/components/TaskProofField';`

- [ ] **Step 4: 호출부를 잇는다**

`src/app/campaigns/TaskTable.tsx`의 `PostedCell` 호출(166행 부근)에 두 props를 넘긴다. `TaskTable`은 이미 `actions`와 행 목록을 들고 있으니 서명 URL은 **`TaskTable`에서 한 번에** 받는다:

```tsx
  const proofUrls = useSignedTaskProofUrls(tasks.map((t) => t.proof?.url ?? '').filter(Boolean));
```

(`tasks`가 이 컴포넌트에서 부르는 이름과 다르면 그 이름을 쓴다.) 그리고:

```tsx
                                  proofSignedUrl={t.proof ? proofUrls[t.proof.url] ?? null : null}
                                  onMarkPosted={(date, url, proof) => void actions.markPosted(t, date, url, proof)}
                                  onSetProof={(path) => void actions.setProof(t, path)}
```

`src/app/campaigns/CampaignDetail.tsx`의 `markPosted` 래퍼(149행 부근)도 인자를 통과시킨다:

```tsx
    markPosted: async (t: CampaignTaskItem, date: string, postUrl?: string, proof?: string) => {
      const ok = await taskActions.markPosted(t, date, postUrl, proof);
```

(그 함수가 하던 나머지 동작은 그대로 둔다.)

- [ ] **Step 5: 타입·린트를 확인한다**

Run: `npx tsc --noEmit && npx eslint src`
Expected: tsc 오류 0, eslint 24건

- [ ] **Step 6: 빌드가 되는지 확인한다**

Run: `npm run build`
Expected: 성공. 클라이언트 컴포넌트에서 서버 전용 모듈을 끌어오면 여기서 터진다 — `taskProof.ts`가 `postgres`나 `db.ts`를 import하지 않는지 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/campaignApi.ts src/app/campaigns/useCampaignTaskActions.ts src/app/campaigns/PostedCell.tsx src/app/campaigns/TaskTable.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign): RT 게시 확인에 증빙 스크린샷 칸 — 없으면 게시됨으로 못 바꾼다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 표에 증빙 표시

**Files:**
- Modify: `src/app/campaigns/TaskTable.tsx` (단계 셀 자리)

**Interfaces:**
- Consumes: Task 7의 `proofUrls`
- Produces: 없음(표시 전용)

- [ ] **Step 1: 단계 칩 옆에 표시를 넣는다**

`PostedCell`을 감싼 셀에서, `PostedCell` **다음에** 넣는다:

```tsx
                        {t.type === 'rt' && t.postedAt && (
                          t.proof
                            ? proofUrls[t.proof.url]
                              ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={proofUrls[t.proof.url]} alt="증빙 스크린샷" title="증빙 스크린샷 — 눌러서 크게 보기"
                                     onClick={() => setZoomUrl(proofUrls[t.proof!.url])}
                                     className="ml-1.5 inline-block h-6 w-6 cursor-zoom-in rounded border border-x-border object-cover align-middle" />
                              )
                              : <span className="ml-1.5 text-[12px] text-x-muted">증빙 있음</span>
                            : <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">증빙 없음</span>
                        )}
```

`TaskTable` 안에 확대 상태를 하나 둔다:

```tsx
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
```

그리고 컴포넌트 반환의 맨 끝(표 바깥)에:

```tsx
      {zoomUrl && <ImageLightbox urls={[zoomUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoomUrl(null)} />}
```

import: `import { ImageLightbox } from '@/components/ImageLightbox';`

**주의:** 서명이 아직 안 왔을 때 `증빙 있음` 텍스트로 자리를 채운다 — 썸네일이 늦게 뜨는 사이 `증빙 없음`이 잘못 보이면 안 된다(라벨-값 일치, UX 원칙 4).

- [ ] **Step 2: 타입·린트·빌드**

Run: `npx tsc --noEmit && npx eslint src && npm run build`
Expected: tsc 0, eslint 24건, 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add src/app/campaigns/TaskTable.tsx
git commit -m "feat(campaign): 작업 표에 증빙 썸네일·증빙 없음 표시

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: [게시 확인하기] 버튼 감추기

**Files:**
- Modify: `src/app/campaigns/CampaignDetail.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

**하지 말 것:** `checkPostedApi`·`/api/campaigns/[id]/check-posted`·`src/lib/checkPosted.ts`·`src/lib/checkPostedRun.ts`·`src/app/campaigns/CheckPostedModal.tsx`와 그 테스트를 **삭제하지 않는다**. 보류이지 폐기가 아니다(스펙 결정 2).

- [ ] **Step 1: 화면에서 뺀다**

`src/app/campaigns/CampaignDetail.tsx`에서:
1. 툴바(316행 부근)의 `<Button onClick={() => void checkPosted()} …>게시 확인하기</Button>`와 그 옆 `<span className="ml-auto …">게시 확인하기 — …</span>` 줄을 지운다. 툴바에 `ml-auto`로 오른쪽에 붙던 요소가 사라지므로 남는 요소의 정렬이 어긋나지 않는지 확인한다(필요하면 `[+ 작업 추가]`만 남은 줄의 클래스를 정리한다).
2. `checkPosted()` 함수(206행 부근), `checking` 상태, `rtPendingCount` `useMemo`(165행 부근), `CheckPostedModal` 렌더와 그 결과 상태를 지운다.
3. 쓰이지 않게 된 import(`checkPostedApi`, `CheckPostedResult`, `CheckPostedModal`)를 지운다 — `@typescript-eslint/no-unused-vars`가 기준선을 넘기게 만든다.

- [ ] **Step 2: 남은 코드가 살아 있는지 확인한다**

```bash
npx tsc --noEmit && npx eslint src
node --import tsx --env-file-if-exists=.env --test src/lib/checkPosted.test.ts src/lib/checkPostedRun.test.ts
```
Expected: 두 테스트 파일 모두 PASS(보존된 자산이 여전히 동작한다), eslint 24건

- [ ] **Step 3: 커밋**

```bash
git add src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign): [게시 확인하기] 화면에서 감춤 — RT 게시 확인은 증빙 경로 하나로

리포스트 목록 자동 조회는 보류(결정 2). 라우트·판정 코드·테스트는 되살릴 자산으로 남긴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 정산 신호등에 '증빙 없음'

**Files:**
- Modify: `src/lib/settlementCalc.ts` (`IssueCode`, `assessReadiness` 75-84행, `CandidateInput`, `SettlementCandidate`, `computeCandidate` 138-152행)
- Modify: `src/lib/settlementStore.ts` (`CandRow`, `CANDIDATE_SQL`, `rowToCandidate`)
- Modify: `src/app/settlement/CandidateRow.tsx`, `src/app/settlement/CandidateTable.tsx`
- Test: `src/lib/settlementCalc.test.ts`

**Interfaces:**
- Consumes: `TaskProof` (Task 1), `campaign_task.proof` (Task 2), `useSignedTaskProofUrls` (Task 6)
- Produces:
  - `IssueCode`에 `'no-proof'` 추가
  - `assessReadiness` 입력에 `proofMissing: boolean`
  - `CandidateInput.task.proof: TaskProof | null`, `SettlementCandidate.proof: TaskProof | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/settlementCalc.test.ts`에 추가:

```ts
test('assessReadiness — 증빙 없는 RT는 노랑 경고, 막지는 않는다', () => {
  const base = { inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', removedAt: null, removedReason: '' };
  const missing = assessReadiness({ ...base, proofMissing: true });
  assert.equal(missing.level, 'warn');
  assert.ok(missing.issues.some((i) => i.code === 'no-proof' && i.level === 'warn'));

  const has = assessReadiness({ ...base, proofMissing: false });
  assert.equal(has.level, 'ready');
  assert.equal(has.issues.length, 0);
});

test('computeCandidate — RT는 증빙이 없으면 no-proof, 투고는 증빙과 무관', () => {
  const rt = computeCandidate(candInput({ type: 'rt', proof: null }));
  assert.ok(rt.issues.some((i) => i.code === 'no-proof'));

  const rtWithProof = computeCandidate(candInput({
    type: 'rt',
    proof: { url: 'task/11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png', by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' },
  }));
  assert.equal(rtWithProof.issues.some((i) => i.code === 'no-proof'), false);
  assert.deepEqual(rtWithProof.proof?.byName, '박구건');

  const post = computeCandidate(candInput({ type: 'post', proof: null }));
  assert.equal(post.issues.some((i) => i.code === 'no-proof'), false);
});
```

`candInput(...)`은 이 파일에 이미 있는 `computeCandidate` 호출 케이스를 헬퍼로 뽑아 쓴다 — **기존 테스트가 `computeCandidate`를 어떻게 부르는지 먼저 읽고 그 형태로 만든다.** 기존 `assessReadiness` 호출 4곳에는 `proofMissing: false`를 넣는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --test src/lib/settlementCalc.test.ts`
Expected: FAIL — `proofMissing`이 타입에 없다 / `no-proof`가 안 나온다

- [ ] **Step 3: `settlementCalc.ts`를 고친다**

1. import: `import type { TaskProof } from './taskProofGuard.ts';`
2. `IssueCode`에 `'no-proof'` 추가
3. `assessReadiness` 입력 타입에 `proofMissing: boolean` 추가하고, `no-reference` 줄 **다음에**:
   ```ts
   if (i.proofMissing) issues.push({ level: 'warn', code: 'no-proof', text: '증빙 스크린샷 없음' });
   ```
4. `CandidateInput.task`에 `proof: TaskProof | null` 추가
5. `SettlementCandidate`에 `proof: TaskProof | null` 추가
6. `computeCandidate`에서:
   ```ts
   // RT만 증빙을 요구한다(RT 증빙 스펙 결정 3) — 투고·인용RT는 post_url이 증거다
   const proofMissing = task.type === 'rt' && !task.proof;
   const r = assessReadiness({ …기존…, proofMissing });
   ```
   그리고 반환 객체에 `proof: task.proof,` 추가

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --test src/lib/settlementCalc.test.ts`
Expected: PASS

- [ ] **Step 5: 후보 쿼리가 증빙을 실어 보낸다**

`src/lib/settlementStore.ts`:
1. import: `import { taskProofOf } from './taskProofGuard.ts';`
2. `CandRow`에 `proof: unknown;` 추가
3. `CANDIDATE_SQL`의 `select t.id, t.type, …` 목록에 `t.proof` 추가
4. `rowToCandidate`의 `task: { … }`에 `proof: taskProofOf(r.proof),` 추가

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS (기존 테스트가 깨지지 않는다)

- [ ] **Step 6: 후보 행에 썸네일을 넣는다**

`src/app/settlement/CandidateTable.tsx`에서 서명을 배치로 받는다(후보 목록 렌더 위):

```tsx
  const proofUrls = useSignedTaskProofUrls(candidates.map((c) => c.proof?.url ?? '').filter(Boolean));
```

(`candidates`가 이 파일에서 쓰는 이름과 다르면 그 이름에 맞춘다.) `CandidateRow`에 `proofSignedUrl={c.proof ? proofUrls[c.proof.url] ?? null : null}`을 넘긴다.

`src/app/settlement/CandidateRow.tsx`: props에 `proofSignedUrl: string | null`을 받고, 아랫줄의 `참고` 라벨 **다음에** 넣는다:

```tsx
        {c.proof && (
          <span className="flex items-center gap-1.5 text-x-secondary">증빙
            {proofSignedUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={proofSignedUrl} alt="증빙 스크린샷" title={`${c.proof.byName || '누군가'}가 올림`}
                     onClick={() => setZoom(true)} className="h-7 w-7 cursor-zoom-in rounded border border-x-border object-cover" />
              : <span className="text-x-muted">있음</span>}
          </span>
        )}
```

`const [zoom, setZoom] = useState(false);`와 반환 끝의 `{zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}`도 함께 넣는다.

`no-proof` 경고 문구는 이미 `issues.map`이 그려준다 — 따로 추가하지 않는다.

- [ ] **Step 7: 타입·린트·빌드를 확인하고 커밋**

```bash
npx tsc --noEmit && npx eslint src && npm run build
git add src/lib/settlementCalc.ts src/lib/settlementCalc.test.ts src/lib/settlementStore.ts src/app/settlement/CandidateRow.tsx src/app/settlement/CandidateTable.tsx
git commit -m "feat(settlement): 증빙 없는 RT는 노랑 경고 + 후보 행에 증빙 썸네일

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 정산 요청에 증빙 스냅샷

**Files:**
- Modify: `src/lib/settlementStore.ts` (`PaymentRequestRow`, `RRow`, `R_SELECT`, `toRequest`, insert 문)
- Modify: `src/app/settlement/RequestRow.tsx`, 그 목록 컴포넌트(`src/app/settlement/RequestList.tsx` — 실제 파일명을 `ls src/app/settlement`로 확인)
- Test: `src/lib/settlementStore.test.ts`

**Interfaces:**
- Consumes: `SettlementCandidate.proof` (Task 10), `payment_request.proof` 컬럼 (Task 1)
- Produces: `PaymentRequestRow.proof: TaskProof | null`

**전송하지 않는다.** 정산 프로덕트 API 계약에는 이미지 칸이 없다(스펙 결정 6) — 이 작업은 **담아두기**까지다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/settlementStore.test.ts`에 추가한다(이 파일의 기존 요청 생성 테스트 형태를 그대로 따른다):

```ts
test('요청 스냅샷 — 만든 시점의 증빙이 요청 행에 복사된다(전송은 안 한다)', async () => {
  // 기존 테스트의 준비 헬퍼로 RT 작업 + 결제 수단 + 증빙을 갖춘 후보를 만든다
  const { taskId } = await makeSettlementReadyRtTask();     // ← 이 파일 기존 헬퍼에 맞춘다
  const proof = {
    url: `task/${taskId}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`,
    by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z',
  };
  await updateTask(sql, taskId, { proof });

  const [row] = await createRequests(sql, /* 기존 테스트와 같은 인자 */);
  assert.deepEqual(row.proof, proof);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — `row.proof`가 `undefined`

- [ ] **Step 3: 스토어를 고친다**

1. `PaymentRequestRow`에 `proof: TaskProof | null;` 추가 (`referenceUrl` 다음)
2. `RRow`에 `proof: unknown;` 추가
3. `R_SELECT`의 select 목록에 `proof` 추가
4. `toRequest`에 `proof: taskProofOf(r.proof),` 추가
5. insert 문에 컬럼과 값을 추가한다 — **컬럼 목록과 values의 순서가 정확히 맞아야 한다.** `reference_url` 다음에 `proof`를 넣고:
   ```ts
             ${item.deadlineOn}, ${item.referenceUrl || null}, ${cand.proof ? tx.json(asJson(cand.proof)) : null},
   ```
   컬럼 목록에도 `deadline_on, reference_url, proof, payment_method, …` 로 넣는다.

`asJson` 헬퍼가 이 파일에 이미 있다 — 그것을 쓴다.

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS

- [ ] **Step 5: 요청 내역 행에 보여준다**

`src/app/settlement/RequestRow.tsx`의 `<Item k="참고자료" … />` **다음에**:

```tsx
            <Item k="증빙" v={r.proof
              ? (proofSignedUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={proofSignedUrl} alt="증빙 스크린샷" onClick={() => setZoom(true)}
                       className="h-16 w-16 cursor-zoom-in rounded border border-x-border object-cover" />
                : '있음')
              : '—'} sub={r.proof ? `${r.proof.byName || '누군가'}가 올림` : undefined} />
```

`Item`의 `sub` prop이 이 파일에 이미 있는지 확인하고(있다), props에 `proofSignedUrl: string | null`을 받는다. 확대는 `CandidateRow`와 같은 방식(`zoom` 상태 + `ImageLightbox`).

목록 컴포넌트에서 배치 서명해 넘긴다:

```tsx
  const proofUrls = useSignedTaskProofUrls(requests.map((r) => r.proof?.url ?? '').filter(Boolean));
```

- [ ] **Step 6: 타입·린트·빌드를 확인하고 커밋**

```bash
npx tsc --noEmit && npx eslint src && npm run build
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/app/settlement/
git commit -m "feat(settlement): 정산 요청에 증빙 스냅샷 담아두기(전송은 계약 열릴 때)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: 전체 검증 + 업데이트 소식

**Files:**
- Modify: `src/content/updates.ts`

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npm test`
Expected: 전부 PASS (약 4분, 실 DB). 실패하면 그 자리에서 고친다 — 넘어가지 않는다.

- [ ] **Step 2: 린트·타입·빌드를 마지막으로 확인한다**

```bash
npx eslint src && npx tsc --noEmit && npm run build
```
Expected: eslint `✖ 24 problems`(기준선), tsc 0, 빌드 성공

- [ ] **Step 3: 업데이트 소식을 맨 위에 추가한다**

`src/content/updates.ts` 맨 위 항목으로. 기존 항목의 필드 이름·형식을 그대로 따르고 `date`는 배포 예정일 `'2026-08-31'`:

```ts
  {
    date: '2026-08-31',
    type: '새 기능',
    title: 'RT 작업에 증빙 스크린샷을 남길 수 있어요',
    body: [
      'RT는 새 글이 올라가지 않아서 "정말 했는지"를 나중에 확인할 방법이 없었어요. 이제 RT 작업을 게시됨으로 표시할 때 인플루언서 피드 스크린샷을 함께 넣습니다 — 캡처해서 Ctrl+V로 붙여넣으면 돼요.',
      '스크린샷은 필수예요. 없으면 게시됨으로 표시되지 않아요. 잘못 올렸으면 [바꾸기]로 다른 스크린샷으로 덮을 수 있고, 누가 언제 올렸는지가 함께 남아요.',
      '전에 쓰던 [게시 확인하기](리포스트한 계정을 자동으로 찾아 채우던 버튼)는 잠시 내렸어요 — 자동으로 채우면 증빙이 남지 않기 때문이에요.',
      '정산 화면에서도 그 스크린샷을 바로 볼 수 있어요. 예전에 올린 RT 작업은 증빙이 없으니 "증빙 없음"으로 표시되고, 필요하면 지금 채울 수 있어요.',
    ],
    link: { label: '캠페인으로', href: '/campaigns' },
  },
```

`link.href`는 워크스페이스 안 화면이면 `{ws}` 토큰을 쓴다 — `/campaigns`가 워크스페이스 밖 경로인지 `src/content/updates.ts`의 기존 항목으로 확인하고 그 형식에 맞춘다.

- [ ] **Step 4: 업데이트 형식 테스트를 돌린다**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/content/updates.ts
git commit -m "docs(updates): RT 증빙 스크린샷 항목

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 사람이 확인할 것을 정리해 보고한다**

화면 확인은 OAuth 게이팅 때문에 koo만 할 수 있다. 다음을 정리해 전달한다:
- 로컬 확인 방법: `npm run build && npx next start -p 3001` 후 `http://127.0.0.1:3001`(`localhost`는 크롬 프록시에 잡히고, `next dev`는 하이드레이션이 조용히 실패한다)
- **마이그레이션 043이 프로덕션에 적용됐는지** — 적용 전에는 증빙 칸이 500을 낸다
- 확인해 볼 것: ① RT 작업 게시 확인에서 붙여넣기 → 게시됨 ② 스크린샷 없이 [게시됨으로 표시]가 막히는지 ③ 기존 게시된 RT에 `증빙 없음`이 보이고 뒤늦게 채워지는지 ④ 표 썸네일 확대 ⑤ 정산 후보에서 노랑 경고와 썸네일 ⑥ 요청 만든 뒤 요청 내역에 증빙이 남는지

---

## Self-Review

**스펙 커버리지**

| 스펙 | 담당 |
|---|---|
| §4-2 `campaign_task.proof` | Task 1(마이그레이션) · Task 2(읽기·쓰기) |
| §4-3 `task-proof` 버킷·상한·정책 | Task 1 · Task 5(코드 상수 일치) |
| §5 필수 강제 3경로 | Task 3(PATCH) · Task 4(게시물 연결) · Task 9(자동 확인 버튼 제거) |
| §5-1 입력 검증·경로 정규식 | Task 1 · Task 3 |
| §6-1 팝오버 3상태 | Task 7 |
| §6-2 표 썸네일·증빙 없음 | Task 8 |
| §6-3 버튼 제거(코드 보존) | Task 9 |
| §7 정산 신호등·후보 썸네일 | Task 10 |
| §7 요청 스냅샷·요청 내역 표시 | Task 11 |
| §8 파일 구성 | Task 1·5·6의 신규 파일 |
| §9 테스트 6종 | Task 1·2·3·4·5·10·11 |
| §10 마이그레이션 043 | Task 1 |
| §12 업데이트 소식 | Task 12 |

**타입 일관성:** `TaskProof`는 `taskProofGuard.ts`에서만 정의하고 모두가 거기서 import한다. API 경계는 **경로 문자열**(`TaskPatchRequest.proof?: string | null`), 저장소 경계는 **객체**(`TaskPatch.proof?: TaskProof | null`) — 변환은 라우트 한 곳에서만 한다(Task 3). `parseTaskPatch`의 반환 타입은 `TaskPatchParsed`(= `Omit<TaskPatch,'proof'> & { proofUrl?: … }`)로 바뀌므로 호출부 4곳을 Task 3 Step 6에서 전수 확인한다.

**기존 테스트 헬퍼:** Task 2·4·10·11의 테스트는 각 파일에 이미 있는 준비 헬퍼를 쓰라고 지시했다 — 이름이 다르면 그 파일을 읽고 맞춘다. 새 헬퍼를 만들어 중복시키지 않는다.
