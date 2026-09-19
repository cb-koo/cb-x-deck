# 캠페인 v2 — C 원고 모드(패널 안에서 원고 만들기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/campaigns/flow` 패널의 원고 칸에서 화면을 떠나지 않고 원고를 만들고 붙인다 — 같은 패널이 **원고 모드**로 바뀌어 ① 생성(레퍼런스+방향성 → 시안 N개 → 하나 붙이기) ② 직접 쓰기(X 컴포저) ③ 있는 원고 고르기 세 갈래를 처리하고, 붙은 뒤에는 그 자리에 원고 카드가 들어온다.

**Architecture:** 서버는 거의 그대로다 — 생성은 기존 `POST /api/drafts`를 **`taskId` 없이** 불러 미부착으로 만들고(“생성은 미부착, 선택 시 부착”), 붙이기는 기존 `PATCH /api/drafts/[id] { taskId }`다. 새로 만드는 서버 코드는 **후보 조회 하나**(형제 시안 / 작업 없는 원고)뿐이다. 화면은 `TaskPanel` 안에서 `mode: 'task' | 'draft'`를 토글하고, 원고 모드의 세 갈래를 각각 한 파일로 둔다. 판정·분류·검색 같은 결정은 순수 함수(`src/lib/draftPickView.ts`)로 빼 테스트한다.

**Tech Stack:** Next.js App Router(`'use client'` 컴포넌트, `src/app/api/**/route.ts`), React 19, Tailwind(X 팔레트 토큰), postgres.js, `node --test`(연습용 DB — 단일 파일은 `node --import tsx --env-file-if-exists=.env.staging --test <file>`).

**입력 문서:** `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` **§5(원고 모드)** 와 §4-2(패널), `CONTEXT.md`(원고·원고 모드·형제 시안·미정), `docs/adr/0006`. B 계획의 결과물(`src/app/campaigns/flow/**`, `src/lib/campaignFlowView.ts`)이 이 계획의 바탕이다.

## Global Constraints

- **표면은 하나다(§5).** 원고 모드는 새 창·새 시트가 아니라 **같은 패널**이 바뀌는 것이다. 위에 `← 작업으로`가 있고, 폭은 560 그대로(안쪽 콘텐츠 폭 516).
- **클라이언트·인플루언서·유형·대상은 작업에서 온다** — 원고 모드에서 고치지 않는다(칩으로 보여만 준다). 인플이 미정인 작업에서도 원고 모드는 열린다.
- **생성은 미부착**: 패널에서 부르는 `POST /api/drafts`에는 `taskId`를 **보내지 않는다**. 시안 카드에서 [이 시안 붙이기]를 누를 때 `PATCH /api/drafts/[id] { taskId }`로 붙인다. 안 고른 시안은 **작업 없는 원고**로 남는다(= 형제 시안).
- **시안 카드는 읽기 + [이 시안 붙이기]만.** 다듬기(다시 쓰기·번역·이미지·상태)는 붙인 뒤 원고 카드에서 한다.
- **생성은 비용 유발 opt-in**(UX 원칙 6): 버튼을 눌러야 돌고, 무엇이 얼마나 드는지 버튼 옆에 말한다(기존 `DraftComposer`의 `생성 1회 ≈ $0.02` 문구와 같은 자리·같은 뜻).
- **레퍼런스 고르기 창은 기존 `RefPickerSheet`를 그대로 쓴다**(§5-1 1.5 예고 — 재설계는 v2 1.5 별건). 새로 만들지 말 것.
- **원고 카드는 기존 `DraftCard`를 그대로 쓴다**(`max-w-[600px]`, 내부 고정 폭 없음 → 패널 안 516px에 들어간다). 카드의 기능을 다시 만들지 말 것.
- **직접 쓰기의 X 컴포저**(§5-2): 가져오는 것 = 아바타·핸들(작업의 인플루언서) · 글자 수 원형 카운터(`xWeightedLength`, 초과 시 빨강) · 스레드(아래 `+`로 다음 글, 글마다 카운터, 연결선) · 이미지 첨부(글 아래 미리보기 격자, 글당 최대 `MAX_MEDIA_PER_POST`). **안 가져오는 것 = 이모지 피커·투표·GIF·예약.** 버튼은 `[저장하고 붙이기]`.
- **본문과 이미지는 한 번에 저장된다**(koo 09-19): X에서 글을 쓸 때처럼 이미지를 고르는 순간 올라가 미리보기가 뜨고, `[저장하고 붙이기]`는 **한 번**이다. "저장한 뒤 이미지를 다시 올리는" 순서를 만들지 말 것.
- **원고 카드의 편집(`DraftEditModal`)을 이 컴포저로 통일하는 것은 이번 범위가 아니다**(koo 09-18: "통일이 맞되 크기 보고"). 1차는 직접 쓰기만 — 후속 항목으로 §8에 남긴다.
- **스키마 변경 없음.** 새 마이그레이션을 만들지 않는다. 형제 시안은 기존 `draft.batch_id`(017)·`variant_index`로 판정한다.
- **취소된 작업(R18)에서는 원고 모드를 열지 않는다** — 원고를 붙일 수 없다(서버가 `task-cancelled`로 거절). 원고 칸은 스냅샷 텍스트만 보인다.
- **RT 작업에는 원고 칸이 없다**(§5-4) — 원고 모드 입구도 없다.
- 굵은 글씨는 표 규칙(R26)이라 **표**에는 쓰지 않는다. 패널·카드 안은 기존 관례를 따른다.
- 검증: `npx tsc --noEmit` · `npx eslint src/app/campaigns/flow src/lib`(새 문제 0) · `npx eslint src`(기준선 **24건** 유지) · 바꾼 순수 함수의 테스트 파일 · `npm run build`. **전체 `npm test`는 컨트롤러가 돌린다** — 태스크 안에서 돌리지 말 것.
- 커밋: 한글 제목 `feat(campaign-v2): …` / `fix(...)` / `docs(...)`, 본문에 왜, 끝에 `Co-Authored-By:` 줄. 경로 명시 스테이징(`git add <파일>`), `git add -A` 금지 — 이 워크트리는 다른 세션과 공유된다.

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/campaignDraftStore.ts` (신규) | 이 캠페인의 원고 후보를 두 묶음으로 조회(형제 시안 / 작업 없는 원고) | 1 |
| `src/app/api/campaigns/[id]/draft-candidates/route.ts` (신규) | 위 조회의 GET 라우트 | 1 |
| `src/lib/campaignApi.ts` | `fetchDraftCandidatesApi` · `createDraftsApi` · `createManualDraftApi` 래퍼 | 1 |
| `src/lib/draftPickView.ts` (+`.test.ts`, 신규) | 후보 검색·라벨·빈 상태 문구, 컴포저 저장 가능 판정 — 순수 함수 | 1·4·5 |
| `src/app/campaigns/flow/TaskPanel.tsx` | `mode: 'task' | 'draft'` 토글, 원고 모드 머리말(`← 작업으로`)·입구 세 개 | 2 |
| `src/app/campaigns/flow/FlowRowMenu.tsx` | 원고 항목 셋이 패널의 원고 모드를 연다(바깥 화면으로 나가지 않는다) | 2 |
| `src/app/campaigns/flow/draft/DraftMode.tsx` (신규) | 원고 모드의 껍데기 — 탭 세 개, 붙어 있으면 `DraftCard` | 2 |
| `src/app/campaigns/flow/draft/DraftGenerate.tsx` (신규) | 레퍼런스·방향성·접힌 설정·[시안 N개 만들기]·시안 카드 | 3 |
| `src/lib/draftMedia.ts` | 원고가 생기기 전에 올리는 헬퍼(`uploadPendingDraftImage`) | 4 |
| `src/app/api/drafts/manual/route.ts` | 글마다 이미지를 함께 받아 한 번에 저장 | 4 |
| `src/app/campaigns/flow/draft/XComposer.tsx` (신규) | X 포스트 작성 UI(카운터·스레드·이미지) | 4 |
| `src/app/campaigns/flow/draft/DraftWrite.tsx` (신규) | 직접 쓰기 화면 — `XComposer` + [저장하고 붙이기] | 4 |
| `src/app/campaigns/flow/draft/DraftPick.tsx` (신규) | 있는 원고 고르기 — 두 묶음 + 검색 | 5 |
| `src/app/campaigns/flow/FlowDetail.tsx` | 원고 모드에 필요한 자료(클라이언트·시술·후보·레퍼런스)와 콜백 배선 | 2·3·5 |
| `src/lib/campaignFlowView.ts` | 원고 칸 문구가 첫 줄을 즉시 반영하도록 보강 | 6 |
| `src/content/updates.ts` · 결정 문서 §5·§8 | 배포 안내 · 확정/미결 갱신 | 7 |

---

### Task 1: 원고 후보 조회(형제 시안 / 작업 없는 원고) + API 래퍼

**Files:**
- Create: `src/lib/campaignDraftStore.ts`
- Create: `src/app/api/campaigns/[id]/draft-candidates/route.ts`
- Create: `src/lib/draftPickView.ts`, `src/lib/draftPickView.test.ts`
- Modify: `src/lib/campaignApi.ts`(래퍼만 — `draftStore.ts`는 건드리지 않는다)
- Test: `src/lib/campaignDraftStore.test.ts` (신규, 연습용 DB)

**Interfaces:**
- Produces:
  - `listDraftCandidates(sql, campaignId): Promise<{ siblings: DraftRow[]; others: DraftRow[] }>`
  - `GET /api/campaigns/[id]/draft-candidates` → 같은 모양
  - `fetchDraftCandidatesApi(campaignId)` · `createDraftsApi(body)` · `createManualDraftApi(body)` (`src/lib/campaignApi.ts`)
  - `searchDraftCandidates(rows, q): DraftRow[]` · `candidateLine(d): { title: string; body: string; meta: string }` (`src/lib/draftPickView.ts`)

**두 묶음의 정의**(§5-3): **형제 시안** = 이 캠페인의 어느 작업에 붙은 원고와 `batch_id`가 같은, **아직 안 붙은** 원고. (= "하나를 골랐더니 남은 것들". 캠페인에 붙은 원고가 없으면 빈 묶음이다.) **작업 없는 원고** = 같은 클라이언트의 안 붙은 원고 중 형제가 아닌 것. 다른 클라이언트 원고는 후보가 아니다.

- [ ] **Step 1: 실패하는 스토어 테스트를 쓴다**

`src/lib/campaignDraftStore.test.ts` — 기존 `src/lib/campaignTaskCancel.test.ts`의 픽스처 관례(접두어 + `process.pid`, `after()` 정리)를 그대로 따른다. 접두어는 `tcdr`.

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { insertDraft } from './draftStore.ts';
import { listDraftCandidates } from './campaignDraftStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tcdr' + process.pid;
const content: DraftContent = { posts: [{ text: '후보 테스트', media: [] }] };
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const mkDraft = (clientId: string, clientName: string, taskId: string | null, batchId: string | null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, taskId, batchId,
  });

test('1) 형제 시안 = 이 캠페인에 붙은 원고와 같은 배치의 안 붙은 원고, 작업 없는 원고 = 나머지 같은 클라', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠', nameEn: `${P.toLowerCase()}-camp`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  const [t] = await createTasks(sql, camp.id, {
    type: 'post', targetTaskId: null, targetTweetUrl: null, draftId: null,
    scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [{ handle: null, cost: null }],
  });
  const batch = crypto.randomUUID();
  const attached = await mkDraft(c.id, c.name, t.id, batch);   // 이 캠페인 작업에 붙은 원고
  const sibling = await mkDraft(c.id, c.name, null, batch);    // 같은 배치, 안 붙음 → 형제
  const loose = await mkDraft(c.id, c.name, null, null);       // 배치 없음, 안 붙음 → 작업 없는 원고

  const r = await listDraftCandidates(sql, camp.id);
  assert.deepEqual(r.siblings.map((d) => d.id), [sibling]);
  assert.deepEqual(r.others.map((d) => d.id), [loose]);
  assert.ok(!r.siblings.some((d) => d.id === attached) && !r.others.some((d) => d.id === attached));  // 붙은 것은 후보가 아니다
});

test('2) 다른 클라이언트 원고는 후보가 아니다 · 캠페인에 클라가 없으면 두 묶음 모두 빈다', async () => {
  const c1 = await createClient(sql, P + '클라1');
  const c2 = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, {
    clientId: c1.id, clientName: c1.name, name: P + '캠2', nameEn: `${P.toLowerCase()}-camp2`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  await mkDraft(c2.id, c2.name, null, null);
  const r = await listDraftCandidates(sql, camp.id);
  assert.equal(r.siblings.length, 0);
  assert.equal(r.others.length, 0);

  const noClient = await createCampaign(sql, {
    clientId: null, clientName: null, name: P + '캠3', nameEn: `${P.toLowerCase()}-camp3`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  const r2 = await listDraftCandidates(sql, noClient.id);
  assert.equal(r2.siblings.length, 0);
  assert.equal(r2.others.length, 0);
});
```

`insertDraft`는 이미 `batchId`·`variantIndex`를 받는다(`src/lib/draftStore.ts`) — 그대로 넘기면 된다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/campaignDraftStore.test.ts`
Expected: FAIL — `listDraftCandidates`가 없어서 import 에러.

- [ ] **Step 3: 스토어를 구현한다**

`src/lib/campaignDraftStore.ts`:

```ts
import type postgres from 'postgres';
import { isUuidLike } from './uuid.ts';
import { listDrafts, type DraftRow } from './draftStore.ts';

// 캠페인 v2 원고 모드의 '있는 원고 고르기'(§5-3) — 두 묶음으로 나눠 준다.
//  · 형제 시안: 이 캠페인의 작업에 붙은 원고와 같은 배치(batch_id)에서 나왔지만 아직 안 붙은 것.
//    = "시안 셋 중 하나를 골랐더니 남은 둘". 사용자가 가장 먼저 찾는 후보라 따로 세운다.
//  · 작업 없는 원고: 같은 클라이언트의 안 붙은 원고 중 형제가 아닌 것.
// 다른 클라이언트 원고는 후보가 아니다(§5-3). 클라이언트가 없는 캠페인은 둘 다 빈 목록.
export async function listDraftCandidates(
  sql: postgres.Sql, campaignId: string,
): Promise<{ siblings: DraftRow[]; others: DraftRow[] }> {
  if (!isUuidLike(campaignId)) return { siblings: [], others: [] };
  const camp = await sql<Array<{ client_id: string | null }>>`
    select client_id from campaign where id = ${campaignId}`;
  const clientId = camp[0]?.client_id ?? null;
  if (!clientId) return { siblings: [], others: [] };

  // 이 캠페인 작업에 붙은 원고들의 배치 — 형제를 찾는 기준
  const batches = await sql<Array<{ batch_id: string }>>`
    select distinct d.batch_id from campaign_task t
      join draft d on d.id = t.draft_id
     where t.campaign_id = ${campaignId} and d.batch_id is not null`;
  const batchIds = batches.map((b) => b.batch_id);

  // 후보 모집단은 기존 목록 함수 하나로 — 정렬(만든 순 역순, variant_index)과 필드 구성이 갈리지 않게 한다
  const unattached = await listDrafts(sql, { clientId, unattached: true, limit: 200 });
  const isSibling = (d: DraftRow) => d.batchId !== null && batchIds.includes(d.batchId);
  return { siblings: unattached.filter(isSibling), others: unattached.filter((d) => !isSibling(d)) };
}
```

`DraftRow.batchId`·`variantIndex`는 이미 있다(`draftStore.ts`, 017 마이그레이션) — 스토어를 고칠 필요가 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/campaignDraftStore.test.ts`
Expected: `ℹ pass 2` / `ℹ fail 0`

- [ ] **Step 5: 라우트를 만든다**

`src/app/api/campaigns/[id]/draft-candidates/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { listDraftCandidates } from '@/lib/campaignDraftStore';

// 원고 모드의 '있는 원고 고르기' 후보(§5-3) — 읽기 전용이라 /api/drafts GET과 같은 등급 게이트.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  return NextResponse.json(await listDraftCandidates(sql, id));
}
```

- [ ] **Step 6: 클라이언트 래퍼를 더한다**

`src/lib/campaignApi.ts` 끝의 원고 구역에:

```ts
// 원고 모드(§5) — 생성은 taskId 없이 부르고(미부착), 붙이기는 기존 patchDraftApi({ taskId })가 한다.
export const fetchDraftCandidatesApi = (campaignId: string) =>
  call<{ siblings: DraftRow[]; others: DraftRow[] }>(`/api/campaigns/${campaignId}/draft-candidates`);
export const createDraftsApi = (body: {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat; constraintsOn: boolean; count: number;
}) => call<DraftRow[]>('/api/drafts', json('POST', body));
export const createManualDraftApi = (body: { posts: string[]; title?: string | null; clientId: string | null; procedureIds: string[] }) =>
  call<DraftRow[]>('/api/drafts/manual', json('POST', body));
```

`ReferenceMode`·`DraftFormat`은 `./draftTypes.ts`에서 `import type`으로 가져온다.

- [ ] **Step 7: 순수 함수와 테스트**

`src/lib/draftPickView.ts`:

```ts
import type { DraftRow } from './draftStore.ts';
import { draftLabel } from './draftViews.ts';

// '있는 원고 고르기'(§5-3)와 시안 카드가 함께 쓰는 표시 규칙 — 컴포넌트는 그리기만 한다.
export function candidateLine(d: DraftRow): { title: string; body: string; meta: string } {
  const src = d.edited ?? d.content;
  const body = (src.posts[0]?.text ?? '').split('\n')[0].trim();
  const parts = [d.format === 'thread' ? `스레드 ${src.posts.length}` : '단문'];
  if (d.variantIndex !== null && d.variantIndex !== undefined) parts.push(`시안 ${'ABCDE'[d.variantIndex] ?? d.variantIndex + 1}`);
  return { title: draftLabel(d).text, body, meta: parts.join(' · ') };
}

// 검색 한 칸이 두 묶음에 함께 걸린다(§5-3) — 제목과 본문 첫 줄을 본다. 공백만이면 전부 통과.
export function searchDraftCandidates(rows: DraftRow[], q: string): DraftRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((d) => {
    const { title, body } = candidateLine(d);
    return title.toLowerCase().includes(s) || body.toLowerCase().includes(s);
  });
}
```

`variantIndex`는 배치 형제의 순번(0부터)이고 `listDrafts`가 이미 그 컬럼으로 정렬한다 — 라벨 A/B/C는 여기서 파생한다.

`src/lib/draftPickView.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateLine, searchDraftCandidates } from './draftPickView.ts';
import type { DraftRow } from './draftStore.ts';

const mk = (p: Partial<DraftRow>): DraftRow => ({
  id: 'd1', clientId: null, clientName: null, procedureNames: [], direction: '', format: 'single',
  referenceMode: 'off', refs: [], content: { posts: [{ text: '첫 줄이에요\n둘째 줄', media: [] }] }, edited: null,
  history: [], translation: null, koLatest: null, title: null, koTitle: null, dismissedFlags: [],
  status: 'draft', influencerHandle: null, taskId: null, taskType: null, batchId: null, variantIndex: null,
  ...(p as object),
} as DraftRow);

test('1) 후보 한 줄 — 제목·본문 첫 줄·형식/시안 표시, edited가 있으면 그쪽을 본다', () => {
  assert.deepEqual(candidateLine(mk({ title: '치아미백 후기' })), { title: '치아미백 후기', body: '첫 줄이에요', meta: '단문' });
  assert.equal(candidateLine(mk({ format: 'thread', content: { posts: [{ text: 'a', media: [] }, { text: 'b', media: [] }] } })).meta, '스레드 2');
  assert.equal(candidateLine(mk({ variantIndex: 1 })).meta, '단문 · 시안 B');
  assert.equal(candidateLine(mk({ edited: { posts: [{ text: '고친 첫 줄', media: [] }] } })).body, '고친 첫 줄');
});

test('2) 검색 — 제목·본문 첫 줄, 대소문자 무관, 공백만이면 전부', () => {
  const rows = [mk({ id: 'a', title: '치아미백' }), mk({ id: 'b', title: null, content: { posts: [{ text: 'Whitening 3일차', media: [] }] } })];
  assert.deepEqual(searchDraftCandidates(rows, '미백').map((d) => d.id), ['a']);
  assert.deepEqual(searchDraftCandidates(rows, 'whitening').map((d) => d.id), ['b']);
  assert.deepEqual(searchDraftCandidates(rows, '   ').map((d) => d.id), ['a', 'b']);
});
```

- [ ] **Step 8: 검증하고 커밋한다**

Run: `node --import tsx --test src/lib/draftPickView.test.ts && node --import tsx --env-file-if-exists=.env.staging --test src/lib/campaignDraftStore.test.ts && npx tsc --noEmit && npx eslint src/lib`

```bash
git add src/lib/campaignDraftStore.ts src/lib/campaignDraftStore.test.ts src/lib/draftPickView.ts src/lib/draftPickView.test.ts src/lib/campaignApi.ts "src/app/api/campaigns/[id]/draft-candidates/route.ts"
git commit -m "feat(campaign-v2): 원고 후보 조회(형제 시안·작업 없는 원고) + 원고 모드 API 래퍼"
```

---

### Task 2: 패널의 원고 모드 껍데기 + 붙은 원고 카드

**Files:**
- Modify: `src/app/campaigns/flow/TaskPanel.tsx`
- Create: `src/app/campaigns/flow/draft/DraftMode.tsx`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`

**Interfaces:**
- Consumes: `fetchDraftCandidatesApi`(Task 1) — 입구 라벨의 개수(`있는 원고 고르기 n`)에 쓴다.
- Produces: `TaskPanel`의 내부 상태 `mode: 'task' | 'draft'`와 `draftTab: 'generate' | 'write' | 'pick'`; `DraftMode` props
  ```ts
  { task: FlowRow; campaign: CampaignRow; today: string; tab: DraftTab; onTab: (t: DraftTab) => void;
    onBack: () => void; candidates: { siblings: DraftRow[]; others: DraftRow[] } | null;
    onReloadCandidates: () => void; draft: DraftRow | null; draftBusy: boolean;
    card: ReactNode;   // 붙어 있을 때 그릴 DraftCard — FlowDetail이 만든다(카드의 배선을 여기서 다시 하지 않는다)
    generate: ReactNode; write: ReactNode; pick: ReactNode }   // 세 갈래는 Task 3·4·5가 채운다
  ```

- [ ] **Step 1: 원고 모드로 들어가고 나오는 길을 만든다**

`TaskPanel.tsx`:
- 상태 추가: `const [mode, setMode] = useState<'task' | 'draft'>('task');` · `const [draftTab, setDraftTab] = useState<DraftTab>('generate');`
- 작업이 바뀌면(패널 key로 remount) 자동으로 `'task'`로 돌아간다 — 별도 처리 불필요.
- 원고 칸(`case 'draft'`)의 세 버튼이 모드를 연다:
  ```tsx
  <button type="button" onClick={() => { setDraftTab('generate'); setMode('draft'); }}>새로 쓰기</button>
  <button type="button" onClick={() => { setDraftTab('write'); setMode('draft'); }}>직접 쓰기</button>
  <button type="button" onClick={() => { setDraftTab('pick'); setMode('draft'); }}>있는 원고 고르기{candidateCount !== null ? ` ${candidateCount}` : ''}</button>
  ```
  기존의 `새로 만들기`(→ `/generate` 링크)와 `있는 원고 고르기`(→ `AttachDraftModal`)는 **이 세 버튼으로 대체한다** — 링크와 모달 배선을 지운다(`onGenerateHref`·`onAttachDraft` prop과 `FlowDetail`의 `attachFor` 상태까지). 원고가 붙어 있으면 지금처럼 `제목 · 상태 [열기] [떼기]`이되, `[열기]`가 `setDraftTab` 없이 `setMode('draft')`로 카드를 연다.
- **행 메뉴도 같은 곳으로 보낸다.** `src/app/campaigns/flow/FlowRowMenu.tsx`의 `원고 열기`·`원고 붙이기`·`새로 만들기`(지금은 `/generate` 링크)는 전부 **그 행의 패널을 원고 모드로 연다**. 한 화면에서 두 갈래(패널 / 바깥 화면)가 생기면 사용자는 어느 쪽이 맞는지 모른다. `FlowRowMenuActions`에 `openDraftMode: (t: FlowRow, tab: DraftTab) => void` 하나를 두고 세 항목이 그것만 부른다 — `generateHref`와 `attachDraft`는 이 메뉴에서 지운다(`FlowDetail`이 넘기던 것도 함께).
- 헤더: `mode === 'draft'`이면 크럼 자리에 `← 작업으로` 버튼(`onClick={() => setMode('task')}`), 제목은 `원고 · {유형} · {@핸들 또는 인플루언서 미정}`. `···` 메뉴는 원고 모드에서 숨긴다(작업 동작이라 여기서 부를 일이 없다).
- 푸터: 원고 모드에서는 이전/다음 대신 `[작업으로]` 하나. (작업 사이 이동은 작업 모드의 일이다.)
- Esc·바깥 클릭: 원고 모드에서도 지금 규칙 그대로 패널이 닫힌다. 단 **원고 모드에서 닫으면 다음에 열 때는 작업 모드**다(모드는 패널 로컬 상태라 자동).

- [ ] **Step 2: `DraftMode` 껍데기를 만든다**

`src/app/campaigns/flow/draft/DraftMode.tsx` — 원고가 붙어 있으면 탭 없이 `card`만, 없으면 탭 세 개와 해당 갈래를 그린다.

```tsx
'use client';
import type { ReactNode } from 'react';
import type { DraftRow } from '@/lib/draftStore';

export type DraftTab = 'generate' | 'write' | 'pick';
const TAB_LABEL: Record<DraftTab, string> = { generate: '생성', write: '직접 쓰기', pick: '있는 원고 고르기' };

// 원고 모드(§5) — 패널이 원고 일을 하는 상태. 원고가 붙어 있으면 손보는 곳(카드)이고,
// 없으면 만드는 곳(생성·직접 쓰기·고르기)이다. 세 갈래의 알맹이는 부모가 넣는다(이 파일은 골격만).
export function DraftMode({ draft, tab, onTab, pickCount, card, generate, write, pick }: {
  draft: DraftRow | null;
  tab: DraftTab; onTab: (t: DraftTab) => void;
  pickCount: number | null;
  card: ReactNode; generate: ReactNode; write: ReactNode; pick: ReactNode;
}) {
  if (draft) return <>{card}</>;
  return (
    <div>
      <div className="-mx-6 mb-4 flex gap-1 border-b border-x-border px-6">
        {(['generate', 'write', 'pick'] as DraftTab[]).map((t) => (
          <button key={t} type="button" onClick={() => onTab(t)} aria-current={tab === t ? 'page' : undefined}
                  className={`px-3 py-2 text-ui ${tab === t ? 'border-b-2 border-x-blue text-x-text' : 'text-x-secondary hover:text-x-text'}`}>
            {TAB_LABEL[t]}{t === 'pick' && pickCount !== null ? <span className="ml-1 text-x-muted">{pickCount}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'generate' ? generate : tab === 'write' ? write : pick}
    </div>
  );
}
```

- [ ] **Step 3: `FlowDetail`이 카드와 자료를 넘긴다**

- 후보를 읽는다: 패널이 열린 캠페인에 대해 `fetchDraftCandidatesApi(id)`를 부르고 `candidates` 상태에 둔다. 원고를 붙이거나 뗄 때마다 다시 읽는다(`reloadCandidates`).
- `card`는 **기존 원고 카드 배선을 그대로 재사용**한다 — 지금 `peekId` 오버레이가 쓰는 `DraftCard` props 묶음(`banned`·`onRewrite`·`onChangeStatus`·`onSaveMedia`·`task` 등)을 함수 하나(`renderDraftCard(d: DraftRow)`)로 빼서 오버레이와 패널이 같은 것을 쓴다. 패널 안에서는 `task` prop을 넘기지 않는다(작업 칸은 패널 본체가 이미 보여 준다).
- 카드가 열릴 원고 한 건은 지금처럼 `GET /api/drafts/[id]`로 받아 둔다(`peekDraft` 재사용).

- [ ] **Step 4: 빌드와 검증**

Run: `npx tsc --noEmit && npx eslint src/app/campaigns/flow && npm run build`
Expected: 오류 0, `/campaigns/flow` 빌드됨. 화면에서 원고 칸의 세 버튼이 패널을 원고 모드로 바꾸고, 붙어 있으면 카드가 패널 안에 보인다(탭 없음).

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/draft/DraftMode.tsx src/app/campaigns/flow/FlowRowMenu.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 패널이 원고 모드로 바뀐다 — 세 입구와 붙은 원고 카드"
```

---

### Task 3: 생성 — 레퍼런스·방향성·접힌 설정·시안 카드

**Files:**
- Create: `src/app/campaigns/flow/draft/DraftGenerate.tsx`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`

**Interfaces:**
- Consumes: `createDraftsApi`(Task 1) · `patchDraftApi(id, { taskId })`(기존) · `RefPickerSheet`·`AddByLinkModal`(기존 컴포넌트) · `clientData`(FlowDetail이 이미 읽는 `{ client, procedures }`)
- Produces: `DraftGenerate` props
  ```ts
  { task: FlowRow; clientId: string | null; clientName: string | null; procedures: ProcedureRow[];
    targetRef: { tweetId: string; label: string } | null;   // 인용RT의 대상 게시물(자동 포함)
    onAttached: (d: DraftRow) => void }   // 시안을 붙였다 — 부모가 상세를 다시 읽고 카드로 전환한다
  ```

**첫 화면은 매번 바꾸는 둘만(§5-1)** — 레퍼런스와 방향성. 나머지(시술·형식·시안 수·제약)는 `▸ 설정`으로 접고, **시술·형식·제약만** 클라이언트별 마지막 값을 `localStorage`에 기억한다(키 `campaign-v2-draft-settings:<clientId>`, 기존 `/generate`의 `COMPOSER_KEY` 관례). **시안 수는 기억하지 않는다**(09-19 리뷰 결정) — `/generate`가 같은 이유로 저장에서 빼고 생성 뒤 1로 되돌린다(`generate/page.tsx`의 "시안 수는 1회용 — 다음 생성이 조용히 N배 비용이 되지 않게"). 기억해 두면 한 번 5로 둔 사용자가 그 뒤 모든 생성에서 5배를 내고, 비용 문구는 1회분만 말한다.

- [ ] **Step 1: 레퍼런스 줄을 만든다**

```tsx
<div className="space-y-1">
  <p className="text-ui text-x-secondary">레퍼런스 <span className="text-x-muted">이 글들을 참고해서 써요</span></p>
  <div className="flex flex-wrap items-center gap-1.5">
    {targetRef && <span className="rounded-full bg-x-surface px-2.5 py-1 text-ui text-x-secondary">🔗 대상 · {targetRef.label}</span>}
    {refs.map((r) => (
      <span key={r.tweetId} className="inline-flex items-center gap-1 rounded-full bg-x-surface px-2.5 py-1 text-ui">
        {r.authorHandle ? `@${r.authorHandle}` : '레퍼런스'}
        <button type="button" onClick={() => setRefs((cur) => cur.filter((x) => x.tweetId !== r.tweetId))} aria-label="레퍼런스 빼기">✕</button>
      </span>
    ))}
    <Button variant="subtle" className="h-8 px-2.5" onClick={() => setPickerOpen(true)}>+ 보관함에서</Button>
    <Button variant="subtle" className="h-8 px-2.5" onClick={() => setLinkOpen(true)}>+ 링크</Button>
  </div>
  {targetRef && <p className="text-caption text-x-muted">인용RT의 대상 게시물은 자동으로 들어가요</p>}
</div>
```

`refs`는 `ReferenceRow[]`. `+ 보관함에서`는 기존 `RefPickerSheet`(props: `open`·`onClose`·`lastWsId`·`selectedIds`·`seedRows`·`onApply`)를, `+ 링크`는 기존 `AddByLinkModal`을 연다 — `/generate`의 호출부를 그대로 베낀다. `lastWsId`는 `/generate`가 쓰는 것과 같은 localStorage 값을 읽는다(없으면 `null`).

`targetRef`: 작업이 인용RT이고 대상이 정해졌으면 그 게시물의 tweetId. `task.target?.postUrl ?? task.targetTweetUrl`에서 `parseTweetLink`로 id를 뽑는다(`src/lib/tweetLink.ts`). 뽑히지 않으면 `null`(칩을 그리지 않는다).

- [ ] **Step 2: 방향성과 접힌 설정**

```tsx
<label className="block">
  <span className="text-ui text-x-secondary">방향성</span>
  <textarea value={direction} onChange={(e) => setDirection(e.target.value)} rows={3}
            placeholder="예: 시술 후 3일차 실제 느낌, 담담한 톤, 가격 언급 없이"
            className="mt-1 w-full resize-none rounded-md border border-x-border-strong px-3 py-2 text-content outline-none focus:border-x-blue" />
</label>
<details className="border-t border-x-border pt-3">
  <summary className="cursor-pointer list-none text-ui text-x-secondary">
    ▸ 설정 <span className="text-x-muted">{settingsSummary}</span>
  </summary>
  {/* 시술(체크박스) · 형식(단문/스레드) · 시안 수(1~5) · 의료광고 제약(체크) */}
</details>
```

`settingsSummary`는 현재 값을 한 줄로: `시술 치아미백 · 단문 · 시안 3개 · 제약 켬`. 시술이 없으면 `시술 없음`.

- [ ] **Step 3: 생성 버튼과 진행 표시**

```tsx
<div className="flex items-center gap-2 pt-1">
  <Button variant="primary" disabled={busy || !canGenerate} onClick={() => void run()} className="h-10 px-4 text-content">
    {busy ? `만드는 중… ${done}/${count}` : `시안 ${count}개 만들기`}
  </Button>
  <span className="text-caption text-x-muted">생성 1회 ≈ $0.02</span>
</div>
{!canGenerate && <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 만들 수 있어요</p>}
```

`canGenerate`는 기존 `canGenerate(value, refCount)`(`src/components/DraftComposer.tsx`)와 **같은 판정**을 쓴다 — 그 함수를 import 한다(중복 구현 금지). `busy` 중에는 패널을 떠나지 않는다(§5-1 "만드는 동안 패널에 머무른다"). 진행 숫자는 서버가 한 번에 응답하므로 `done`은 쓰지 않고 `만드는 중…`만 보여도 된다 — 그렇게 할 거면 위 라벨을 그 문구로 단순화하고 `done`을 만들지 말 것.

`run()`:
```ts
const r = await createDraftsApi({
  clientId, procedureIds, refTweetIds: [...(targetRef ? [targetRef.tweetId] : []), ...refs.map((x) => x.tweetId)],
  mode, direction, format, constraintsOn, count,
});
if (!r.ok) { show(r.error); return; }
setVariants(r.data);   // 미부착 원고들 — taskId를 보내지 않았다
```

- [ ] **Step 4: 시안 카드(읽기 + 붙이기)**

```tsx
{variants.length > 0 && (
  <div className="space-y-2 border-t border-x-border pt-3">
    <p className="text-ui text-x-secondary">만들어진 시안 <span className="text-x-muted">하나를 골라 붙여요 · 다듬기는 붙인 뒤에</span></p>
    {variants.map((d, i) => {
      const line = candidateLine(d);
      return (
        <div key={d.id} className="rounded-lg border border-x-border p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-ui text-x-secondary">시안 {'ABCDE'[i] ?? i + 1}</p>
            <Button variant={i === 0 ? 'primary' : 'subtle'} disabled={attaching} onClick={() => void attach(d)} className="h-8 shrink-0 px-2.5">이 시안 붙이기</Button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-content">{(d.edited ?? d.content).posts.map((p) => p.text).join('\n\n')}</p>
          <p className="mt-1 text-caption text-x-muted">{line.meta}</p>
        </div>
      );
    })}
    <p className="text-caption text-x-muted">고르지 않은 시안은 '있는 원고 고르기'에 남아요</p>
  </div>
)}
```

`attach(d)`: `patchDraftApi(d.id, { taskId: task.id })` → 성공하면 `onAttached(r.data)`. 실패하면 `show(r.error)`(그 작업에 이미 원고가 붙었거나 취소된 경우 서버가 문구를 준다).

- [ ] **Step 5: 검증과 커밋**

Run: `npx tsc --noEmit && npx eslint src/app/campaigns/flow && npm run build`

```bash
git add src/app/campaigns/flow/draft/DraftGenerate.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 패널에서 시안을 만들고 하나를 붙인다 — 생성은 미부착, 선택이 부착"
```

---

### Task 4: 직접 쓰기 — X 컴포저

**Files:**
- Create: `src/app/campaigns/flow/draft/XComposer.tsx`
- Create: `src/app/campaigns/flow/draft/DraftWrite.tsx`
- Modify: `src/lib/draftMedia.ts` (원고 생성 전 업로드 헬퍼)
- Modify: `src/app/api/drafts/manual/route.ts` (글마다 이미지를 함께 받는다)
- Modify: `src/lib/draftPickView.ts`, `src/lib/draftPickView.test.ts`, `src/lib/campaignApi.ts`

**Interfaces:**
- Consumes: `xWeightedLength`·`X_MAX_WEIGHTED`(`src/lib/xLength.ts`) · `selectDraftImages`·`uploadDraftImage`·`MAX_MEDIA_PER_POST`(`src/lib/draftMedia.ts`) · `MediaGrid`(`src/components/MediaGrid.tsx`) · `createManualDraftApi`(Task 1)
- Produces:
  - `XComposer` props: `{ handle: string | null; posts: ComposerPost[]; onChange: (next: ComposerPost[]) => void; onPickImages: (postIndex: number, files: File[]) => void; uploading: number; disabled?: boolean }` · `type ComposerPost = { text: string; media: DeckMedia[] }` — **이미 올라간 이미지**를 들고 있다(고르는 순간 올린다)
  - `composerCanSave(posts): boolean` (`src/lib/draftPickView.ts`) — 저장 가능 판정

- [ ] **Step 1: 저장 가능 판정을 테스트로 먼저 못 박는다**

`src/lib/draftPickView.test.ts`에 추가:

```ts
test('3) 컴포저 저장 판정 — 빈 칸만 있으면 못 저장, 한 칸이라도 내용이 있으면 저장, 글자 수 초과면 못 저장', () => {
  assert.equal(composerCanSave([{ text: '', media: [] }]), false);
  assert.equal(composerCanSave([{ text: '   ', media: [] }]), false);
  assert.equal(composerCanSave([{ text: '올릴 글', media: [] }]), true);
  assert.equal(composerCanSave([{ text: '올릴 글', media: [] }, { text: '', media: [] }]), false);   // 스레드 중간이 비면 안 된다
  assert.equal(composerCanSave([{ text: 'あ'.repeat(200), media: [] }]), false);                      // 전각 200자 = 가중치 400 > 280
});
```

`src/lib/draftPickView.ts`:
```ts
import { X_MAX_WEIGHTED, xWeightedLength } from './xLength.ts';
export interface ComposerPost { text: string; media: DeckMedia[] }
// 직접 쓰기(§5-2) 저장 판정 — 스레드의 모든 칸이 비지 않고 각 칸이 X 상한 안이어야 한다.
// 빈 칸을 허용하면 X에 올릴 수 없는 글이 저장되고, 사용자는 저장된 뒤에야 안다.
export function composerCanSave(posts: ComposerPost[]): boolean {
  if (posts.length === 0) return false;
  return posts.every((p) => p.text.trim().length > 0 && xWeightedLength(p.text) <= X_MAX_WEIGHTED);
}
```

Run: `node --import tsx --test src/lib/draftPickView.test.ts` → 새 테스트가 먼저 실패하는지 보고, 구현 후 통과.

- [ ] **Step 2: 원고가 생기기 전에 올리는 헬퍼를 더한다**

`uploadDraftImage(draftId, file)`는 경로에 원고 id가 필요하다. 아직 원고가 없는 컴포저용으로 같은 파일에 형제 함수를 둔다 — `url`은 스토리지 경로일 뿐이고 어디에도 원고 id를 되읽는 코드가 없으므로(`draftMediaFilename`은 입력값으로 이름을 만든다) 접두어만 다르면 된다.

```ts
// 원고가 생기기 전에 올린다(캠페인 v2 직접 쓰기, §5-2) — X에서처럼 이미지를 고르는 순간 올라가고
// [저장하고 붙이기] 한 번으로 본문과 함께 저장된다. 경로의 앞부분은 표시·다운로드 어디서도 되읽지 않는다.
// 저장하지 않고 떠나면 올라간 파일이 남는다 — 원고에서 이미지를 뗐을 때와 같은 성질이라 같은 수준으로 둔다.
export async function uploadPendingDraftImage(file: File): Promise<DeckMedia> {
  const validationError = draftImageValidationError(file);
  if (validationError) throw new Error(validationError);
  const path = `draft/pending/${crypto.randomUUID()}.${extensionForFile(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(DRAFT_MEDIA_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('업로드에 실패했어요 — 다시 시도해주세요');
  return { type: 'photo', url: path, videoUrl: null };
}
```

- [ ] **Step 3: `XComposer`를 만든다**

X 작성 화면의 모양을 가져온다 — 아바타(핸들 첫 글자, 표의 `handleInitial`과 같은 방식) · 핸들 · 본문 textarea(자동 높이) · 오른쪽 아래 원형 카운터 · 글 아래 이미지 격자 · 칸 사이 세로 연결선 · 마지막 칸 아래 `+` 버튼.

```tsx
const remain = X_MAX_WEIGHTED - xWeightedLength(p.text);
const over = remain < 0;
// 원형 카운터 — 남은 글자가 20 이하면 숫자를 같이 보여준다(X와 같은 규칙)
<span className={`text-caption tabular-nums ${over ? 'text-red-600' : 'text-x-muted'}`}>
  {remain <= 20 ? remain : ''}
</span>
<svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" className="text-x-border" strokeWidth="2" />
  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
          className={over ? 'text-red-600' : 'text-x-blue'}
          strokeDasharray={`${Math.min(1, xWeightedLength(p.text) / X_MAX_WEIGHTED) * 50.3} 50.3`} />
</svg>
```

이미지: `selectDraftImages(files, remainingSlots)`(기존 헬퍼)로 개수·형식·용량을 거른 뒤 **고르는 즉시 올린다** — X에서 글을 쓸 때처럼 미리보기가 바로 뜨고, 저장은 한 번이다. 올리는 동안 그 자리에 진행 표시를 두고 `[저장하고 붙이기]`는 비활성(`uploading > 0`). 거절된 파일은 이유를 한 줄로 말한다(`DraftImageRejection.reason`). 표시는 기존 `MediaGrid`(서명 URL 재발급까지 처리한다)를 그대로 쓴다. 스레드 칸 삭제 버튼은 칸이 둘 이상일 때만.

**안 만드는 것**: 이모지 피커·투표·GIF·예약(§5-2).

- [ ] **Step 4: 생성 라우트가 글마다 이미지를 함께 받는다**

`src/app/api/drafts/manual/route.ts`는 지금 `posts: string[]`만 받아 `media: []`로 저장한다. 본문과 이미지를 한 번에 저장하려면 글마다 이미지를 받아야 한다. **기존 형태(`string[]`)도 계속 받는다** — `DraftWriteModal`(기존 화면)이 그대로 동작해야 한다.

```ts
// posts: string[](기존 입구) 또는 { text, media }[](캠페인 v2 컴포저) — 둘 다 받는다.
// 이미지는 클라이언트가 이미 스토리지에 올린 경로다(PATCH /api/drafts/[id] { edited }와 같은 신뢰 수준).
type PostIn = string | { text?: unknown; media?: unknown };
const rawPosts = Array.isArray(body.posts) ? (body.posts as PostIn[]) : [];
const parsed = rawPosts.map((p) => (typeof p === 'string'
  ? { text: p, media: [] as DeckMedia[] }
  : { text: typeof p?.text === 'string' ? p.text : '', media: parseDeckMedia(p?.media) }));
if (parsed.length === 0 || parsed.some((p) => !p.text.trim())) {
  return NextResponse.json({ error: '본문을 입력해주세요' }, { status: 400 });
}
```
`parseDeckMedia(v)`는 같은 파일 안의 작은 헬퍼 — 배열이 아니면 `[]`, 각 항목은 `{ type: string, url: string, videoUrl: string | null }` 모양이고 `url`이 비지 않은 문자열인 것만 남긴다. 저장할 `content`는 `{ posts: parsed }`.

기존 응답·나머지 동작(클라이언트 스냅샷·taskId 부착·오류 매핑)은 그대로 둔다.

`src/lib/campaignApi.ts`의 `createManualDraftApi` 타입을 `posts: Array<{ text: string; media: DeckMedia[] }>`로 넓힌다.

- [ ] **Step 5: `DraftWrite`가 한 번에 저장하고 붙인다**

```tsx
<XComposer handle={task.influencerHandle} posts={posts} onChange={setPosts} disabled={busy} />
<div className="mt-3 flex items-center gap-2">
  <Button variant="primary" disabled={busy || !composerCanSave(posts)} onClick={() => void save()} className="h-10 px-4 text-content">
    {busy ? '저장 중…' : '저장하고 붙이기'}
  </Button>
  {!composerCanSave(posts) && <span className="text-caption text-x-muted">글자 수가 넘거나 빈 칸이 있어요</span>}
</div>
```

`save()` — 이미지는 이미 스토리지에 있으므로 **한 번의 생성 요청에 본문과 함께 실어 보낸다**:
```ts
setBusy(true);
const r = await createManualDraftApi({ posts: posts.map((p) => ({ text: p.text.trim(), media: p.media })), clientId, procedureIds });
if (!r.ok) { setBusy(false); show(r.error); return; }
const draft = r.data[0];
const a = await patchDraftApi(draft.id, { taskId: task.id });
setBusy(false);
if (!a.ok) { show(`${a.error} — 쓴 글은 '있는 원고 고르기'에 저장돼 있어요`); onSavedUnattached(); return; }
onAttached(a.data);
```
붙이기가 실패해도 **쓴 것은 이미 원고로 남아 있다** — 다시 칠 일이 없고, 고르기 탭에서 붙이면 된다.

- [ ] **Step 6: 검증과 커밋**

Run: `node --import tsx --test src/lib/draftPickView.test.ts && npx tsc --noEmit && npx eslint src/app/campaigns/flow src/lib && npm run build`

```bash
git add src/app/campaigns/flow/draft/XComposer.tsx src/app/campaigns/flow/draft/DraftWrite.tsx src/lib/draftMedia.ts src/app/api/drafts/manual/route.ts src/lib/campaignApi.ts src/lib/draftPickView.ts src/lib/draftPickView.test.ts src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 직접 쓰기를 X 작성 화면으로 — 글자 수·스레드·이미지 한 번에 저장"
```

---

### Task 5: 있는 원고 고르기 — 두 묶음 + 검색

**Files:**
- Create: `src/app/campaigns/flow/draft/DraftPick.tsx`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`

**Interfaces:**
- Consumes: `fetchDraftCandidatesApi`·`searchDraftCandidates`·`candidateLine`(Task 1) · `patchDraftApi`(기존)
- Produces: `DraftPick` props `{ candidates: { siblings: DraftRow[]; others: DraftRow[] } | null; onAttach: (d: DraftRow) => void; attaching: boolean }`

- [ ] **Step 1: 두 묶음과 검색 한 칸**

```tsx
<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용으로 찾기" aria-label="원고 찾기"
       className="h-9 w-full rounded-md border border-x-border-strong px-3 text-ui outline-none focus:border-x-blue" />
<Group title="같은 재료로 만든 시안" rows={searchDraftCandidates(candidates.siblings, q)} … />
<Group title="작업 없는 원고" rows={searchDraftCandidates(candidates.others, q)} … />
```

각 행: `candidateLine(d)`의 `title`(한 줄, 말줄임) · `body`(첫 줄, 말줄임, 회색) · `meta`(형식·시안) + `[붙이기]`.

빈 상태를 구분해 말한다:
- 후보를 아직 못 읽었으면 `불러오는 중…`
- 두 묶음이 모두 비면 `붙일 수 있는 원고가 없어요 — 'AI로 만들기'나 '직접 쓰기'로 만들어요`
- 검색 결과만 비면 `'{q}'에 맞는 원고가 없어요`
- 형제 묶음만 비면 그 묶음 자체를 그리지 않는다(빈 제목만 남기지 말 것).

- [ ] **Step 2: 붙이기**

`onAttach(d)` → `patchDraftApi(d.id, { taskId: task.id })` → 성공하면 부모가 상세를 다시 읽고 카드로 전환 + 후보 목록도 다시 읽는다. 실패 문구는 서버 것을 그대로.

- [ ] **Step 3: 검증과 커밋**

Run: `npx tsc --noEmit && npx eslint src/app/campaigns/flow && npm run build`

```bash
git add src/app/campaigns/flow/draft/DraftPick.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 있는 원고 고르기 — 형제 시안과 작업 없는 원고, 검색 한 칸"
```

---

### Task 6: 표와 패널이 같은 값을 말하게 한다

**Files:**
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`
- Modify: `src/lib/campaignFlowView.ts`, `src/lib/campaignFlowView.test.ts`

원고를 붙이거나·떼거나·카드에서 본문을 고치면 표의 원고 칸(본문 첫 줄)이 **즉시** 따라가야 한다. 지금은 카드 편집 뒤 `draftLabel`만 갱신하고 `draftFirstLine`은 그대로다(B 최종 리뷰 M1).

- [ ] **Step 1: 실패하는 테스트**

`src/lib/campaignFlowView.test.ts`에 추가:

```ts
test('11) 원고 칸은 본문 첫 줄을 쓴다 — 첫 줄이 갱신되면 표도 따라간다', () => {
  const t = mk({ draftId: 'd', draftLabel: '제목', draftFirstLine: '옛 첫 줄' });
  assert.equal(draftCell(t).text, '옛 첫 줄');
  assert.equal(draftCell({ ...t, draftFirstLine: '새 첫 줄' }).text, '새 첫 줄');
});
```

- [ ] **Step 2: `mergeRow`가 첫 줄도 갱신한다**

`FlowDetail.tsx`의 `mergeRow(row: DraftRow)`:
```ts
setTasks((cur) => cur.map((t) => (t.draftId === row.id
  ? { ...t, draftStatus: row.status, draftLabel: draftLabel(row).text,
      draftFirstLine: ((row.edited ?? row.content).posts[0]?.text ?? '').split('\n')[0].trim() || null }
  : t)));
```
첫 줄을 뽑는 규칙이 서버(`campaignTaskStore.firstLineOf`)와 같아야 한다 — 같은 식(첫 포스트의 첫 줄, 공백 정리, 비면 null)임을 주석으로 남긴다.

- [ ] **Step 3: 붙이기·떼기 뒤 후보 목록도 다시 읽는다**

`attachPeek`·`detachDraft`·원고 모드의 붙이기 성공 경로 전부에서 `reloadCandidates()`를 부른다 — 안 부르면 '있는 원고 고르기 n'의 숫자가 사실과 달라진다.

- [ ] **Step 4: 검증과 커밋**

Run: `node --import tsx --test src/lib/campaignFlowView.test.ts && npx tsc --noEmit && npx eslint src/app/campaigns/flow src/lib && npm run build`

```bash
git add src/app/campaigns/flow/FlowDetail.tsx src/lib/campaignFlowView.test.ts
git commit -m "fix(campaign-v2): 원고를 고치면 표의 원고 칸도 즉시 따라간다"
```

---

### Task 7: 마무리 — 배포 안내와 문서

**Files:**
- Modify: `src/content/updates.ts`
- Modify: `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` (§5·§8)

- [ ] **Step 1: 업데이트 소식 한 건**

`UPDATES` 맨 위에. AGENTS.md "업데이트 소식 작성 규칙"을 따른다 — 제목은 사용자 말 한 줄, 내부 용어 금지, **쓰던 방식이 바뀐 것은 반드시 적는다**(원고를 만들러 콘텐츠 생성 화면으로 넘어가던 흐름이 없어졌다).

```ts
  {
    date: '2026-09-XX', type: '새 기능',
    title: '캠페인 v2에서 원고까지 만들 수 있어요 — 화면을 떠나지 않아요',
    summary: '작업 패널의 원고 칸에서 바로 시안을 만들거나, 직접 쓰거나, 이미 있는 원고를 골라 붙일 수 있어요. 원고를 만들려고 콘텐츠 생성 화면으로 넘어갔다 돌아오지 않아도 돼요.',
    bullets: [
      '쓰던 방식이 바뀐 것: 캠페인 v2의 원고 칸에서 [새로 쓰기]를 누르면 콘텐츠 생성 화면으로 가지 않고 그 자리에서 만들어요. 기존 콘텐츠 생성 화면은 그대로 있어요',
      '시안은 한 번에 여러 개 만들고 그중 하나만 붙여요 — 안 고른 시안은 "있는 원고 고르기"에 남아 다른 작업에 쓸 수 있어요',
      '직접 쓰기는 X에 올리는 화면과 같은 모양이에요 — 글자 수, 스레드, 이미지를 그대로 보면서 써요',
      '붙인 뒤에는 그 자리에서 다시 쓰기·번역·이미지·상태까지 손볼 수 있어요',
    ],
    link: { label: '캠페인 v2', href: '/campaigns/flow' },
  },
```
날짜는 머지 예정일. `node --import tsx --test src/lib/updates.test.ts`로 형식을 확인한다.

- [ ] **Step 2: 결정 문서 §5·§8**

- §5 머리에 "구현 완료(C 계획, 날짜)"를 적고, 실제와 다른 문장을 고친다. 특히 **원고 카드 편집을 X 컴포저로 통일하는 것은 이번에 하지 않았다**(§5-2 마지막 문단) — 후속으로 §8에 옮긴다.
- §8에 새 열린 항목: `DraftEditModal`을 X 컴포저로 통일 · 직접 쓰기에서 이미지 업로드가 본문 저장 뒤에 일어난다(부분 실패 시 문구로 알린다) · 레퍼런스 고르기 재설계(v2 1.5, 이미 있음).
- §9 결정 이력에 한 줄.

- [ ] **Step 3: 전체 검증**

Run: `npx tsc --noEmit && npx eslint src && npm run build && node --import tsx --test src/lib/updates.test.ts`
Expected: tsc 0 · eslint 24건(기준선) · build 성공 · updates 테스트 통과. (전체 `npm test`는 컨트롤러가 돌린다.)

- [ ] **Step 4: 커밋**

```bash
git add src/content/updates.ts docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md
git commit -m "docs(campaign-v2): 원고 모드 배포 안내 + §5·§8 갱신"
```

---

## 계획 자체 검토(작성 시 self-review)

- **스펙 커버리지**: §5 머리(패널이 원고 모드로 바뀜·잠긴 값·인플 미정에서도 열림) → Task 2 · §5-1 생성(레퍼런스·방향성·접힌 설정·시안 카드·미부착 생성·형제 시안) → Task 1·3 · §5-2 직접 쓰기(X 컴포저) → Task 4 · §5-3 고르기(두 묶음·검색) → Task 1·5 · §5-4 작업 모드의 원고 칸 → Task 2·6.
- **의도적 축소(koo 확인 필요)**: ① 원고 카드 편집(`DraftEditModal`)의 컴포저 통일은 이번 범위 밖 — koo가 "통일이 맞되 크기 보고"라 했고, `/generate`·기존 캠페인 상세까지 파급되어 별건이 맞다. ② 직접 쓰기의 이미지는 **고르는 순간 올라가고 저장은 한 번**이다(koo 09-19) — 저장하지 않고 떠나면 올라간 파일이 스토리지에 남는다(원고에서 이미지를 뗐을 때와 같은 성질). ③ 레퍼런스 고르기 창은 기존 것을 그대로 쓴다(v2 1.5에서 재설계).
- **타입 일관성**: `DraftRow.batchId`·`variantIndex`는 이미 존재한다(스토어 변경 없음) · `ComposerPost`는 Task 4가 정의하고 `composerCanSave`가 받는다 · `DraftTab`은 Task 2가 정의하고 Task 3·4·5의 자리를 가른다 · 생성 본문은 `createDraftsApi`에 `taskId`를 **넣지 않는다**(미부착).
- **테스트 없는 부분**: 컴포넌트(하네스 없음) — `npm run build` + koo 화면 확인. 순수 함수(`draftPickView`)와 스토어(`campaignDraftStore`)는 테스트로 덮는다.
