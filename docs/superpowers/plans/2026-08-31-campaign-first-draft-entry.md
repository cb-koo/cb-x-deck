# 캠페인 작업에서 원고 쓰러 가기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 만들어 둔 캠페인 작업 줄에서 원고를 새로 쓰러 갈 수 있게 하고, 그 왕복을 매끄럽게 만든다.

**Architecture:** 새 API도 새 화면도 만들지 않는다. `/generate?task=&campaign=` 딥링크는 이미 있고 잘 동작한다 — 그 주소를 캠페인 표의 작업 줄에서도 낼 수 있게 하고(`TaskTable`), 이동을 리포 표준 라우터로 바꾸고(`CampaignDetail`), 돌아오는 링크를 배너에 붙인다(`/generate`). 주소 조립만 `campaignJudgment.ts`의 순수 함수로 뽑아 단위 테스트를 건다.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind 4 · `node:test` + `tsx`

## Global Constraints

- 스키마·마이그레이션·API 라우트·서버 로직 변경 **0건**. 전부 `src/app/campaigns/`, `src/app/generate/`, `src/components/`, `src/lib/campaignJudgment.ts` 안이다.
- 사용자에게 보이는 라벨은 **"새로 만들기"** 로 통일한다. "새로 쓰기"·"직접 쓰기"를 이 동작에 쓰지 않는다(`직접 쓰기`는 LLM 없이 쓰기라는 다른 뜻이다).
- `AttachDraftModal`의 `emptyHint`는 **필수 prop**이다. 기본값을 두지 않는다 — 두면 새 호출자가 조용히 틀린 문구를 쓴다.
- 원고 칸의 분기 순서(`t.type === 'rt'`를 맨 앞에서 거르기)를 바꾸지 않는다. 바꾸면 범위 밖 동작(rt 작업에 붙은 원고 표시)이 딸려 변한다.
- 테스트 러너: `node --import tsx --test`. 전량 실행은 실 DB를 쳐서 약 4분 걸린다. 단일 파일은 수 초.
- 린트 기준선은 24개다. 늘리지 않는다.
- 스펙: `docs/superpowers/specs/2026-08-31-campaign-first-draft-entry-design.md`

---

### Task 1: 주소 조립 순수 함수

**Files:**
- Modify: `src/lib/campaignJudgment.ts` (132~133행 `TARGETABLE_TYPES`·`TARGETING_TYPES` 바로 아래에 추가)
- Test: `src/lib/campaignJudgment.test.ts` (파일 끝에 추가 — 기존 테스트는 `1)`~`4)` 네 개)

**Interfaces:**
- Consumes: 없음
- Produces: `draftWriteHref(taskId: string, campaignId: string): string` — Task 2와 Task 4가 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/campaignJudgment.test.ts` 파일 **맨 끝**에 추가:

```ts
test('5) 작업 맥락을 실은 원고 화면 주소', () => {
  // /generate는 task·campaign 두 파라미터가 다 있어야 배너를 켠다(generate/page.tsx:299)
  assert.equal(draftWriteHref('t1', 'c1'), '/generate?task=t1&campaign=c1');
  // 실제 값은 uuid라 이스케이프가 필요 없지만, 주소 조립이 한 곳에만 있게 하는 것이 이 함수의 목적이다
  assert.equal(
    draftWriteHref('9f1c0e2a-0000-4000-8000-000000000001', '9f1c0e2a-0000-4000-8000-000000000002'),
    '/generate?task=9f1c0e2a-0000-4000-8000-000000000001&campaign=9f1c0e2a-0000-4000-8000-000000000002',
  );
  // 예상 밖 문자가 들어와도 주소가 깨지지 않는다
  assert.equal(draftWriteHref('a&b', 'c d'), '/generate?task=a%26b&campaign=c%20d');
});
```

그리고 같은 파일 상단의 import 블록(3~7행)에 `draftWriteHref`를 넣는다. 기존 블록은 이렇게 생겼다:

```ts
import {
  isDateOnlyString, addDays, daysBetweenDates, weekStartOf, weekDays, nextWeekRange, formatDateKo,
  campaignStatus, isOutOfRange, isCampaignKind,
  suggestCampaignName, suggestCampaignCode,
} from './campaignJudgment.ts';
```

마지막 줄을 이렇게 바꾼다:

```ts
  suggestCampaignName, suggestCampaignCode, draftWriteHref,
} from './campaignJudgment.ts';
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --import tsx --test src/lib/campaignJudgment.test.ts
```

Expected: FAIL — `draftWriteHref` is not exported / is not a function

- [ ] **Step 3: 최소 구현을 쓴다**

`src/lib/campaignJudgment.ts`의 `export const TARGETING_TYPES: readonly TaskType[] = ['rt', 'quoteRt'];` 바로 **아래**에 추가:

```ts
// 작업 맥락을 실은 원고 화면 주소(스펙 2026-08-31 §3-3). /generate는 task·campaign 두 파라미터가
// 모두 있어야 배너를 켜므로(generate/page.tsx:299) 조립 규칙이 한 곳에만 있어야 한다.
// 호출자: 캠페인 표의 작업 줄(TaskTable), 작업을 만든 직후의 이동(CampaignDetail).
export function draftWriteHref(taskId: string, campaignId: string): string {
  return `/generate?task=${encodeURIComponent(taskId)}&campaign=${encodeURIComponent(campaignId)}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --import tsx --test src/lib/campaignJudgment.test.ts
```

Expected: PASS — 5 tests, 0 fail

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignJudgment.ts src/lib/campaignJudgment.test.ts
git commit -m "feat(campaign): 작업 맥락을 실은 원고 화면 주소 조립 함수"
```

---

### Task 2: 작업 줄에 '새로 만들기' 입구

**Files:**
- Modify: `src/app/campaigns/TaskTable.tsx` (import 블록 14~17행, 원고 칸 140~144행)

**Interfaces:**
- Consumes: `draftWriteHref(taskId, campaignId)` — Task 1
- Produces: 없음 (화면만)

`TaskTable`은 이미 `import Link from 'next/link'`(4행)와 `campaign: CampaignRow` prop(87행)을 갖고 있다. 새 prop을 만들 필요가 없다.

- [ ] **Step 1: `draftWriteHref`를 import에 추가한다**

14~17행의 `@/lib/campaignJudgment` import 블록은 이렇게 생겼다:

```ts
import {
  sortTasks, matchesTaskFilter, isTaskUnused, isOutOfRange, targetStatus, TARGETING_TYPES,
  TASK_TYPE_LABEL, TASK_SORT_LABEL, STAGE_FILTER_LABEL, type TaskSortKey, type StageFilter, type TypeSubtotal, type TaskSummary,
} from '@/lib/campaignJudgment';
```

두 번째 줄 끝에 `draftWriteHref`를 넣는다:

```ts
import {
  sortTasks, matchesTaskFilter, isTaskUnused, isOutOfRange, targetStatus, TARGETING_TYPES, draftWriteHref,
  TASK_TYPE_LABEL, TASK_SORT_LABEL, STAGE_FILTER_LABEL, type TaskSortKey, type StageFilter, type TypeSubtotal, type TaskSummary,
} from '@/lib/campaignJudgment';
```

- [ ] **Step 2: 원고 칸을 두 갈래로 바꾼다**

현재 코드(140~144행):

```tsx
                    <td className={`${TD} min-w-0`}>
                      {t.type === 'rt' ? <span className="text-x-muted">—</span>
                        : t.draftId ? <button type="button" onClick={() => onOpenDraft(t.draftId as string)} className="block max-w-full truncate text-left font-medium hover:underline" title={t.draftLabel ?? ''}>{t.draftLabel ?? '(제목 없음)'}</button>
                        : <button type="button" onClick={() => onAttachDraft(t)} className="text-x-muted hover:text-x-secondary hover:underline">원고 없음 · 붙이기</button>}
                    </td>
```

이렇게 바꾼다(앞의 두 분기는 **그대로 둔다** — 순서를 바꾸면 범위 밖 동작이 딸려 변한다):

```tsx
                    <td className={`${TD} min-w-0`}>
                      {t.type === 'rt' ? <span className="text-x-muted">—</span>
                        : t.draftId ? <button type="button" onClick={() => onOpenDraft(t.draftId as string)} className="block max-w-full truncate text-left font-medium hover:underline" title={t.draftLabel ?? ''}>{t.draftLabel ?? '(제목 없음)'}</button>
                        : (
                          // 원고 없는 줄의 두 갈래(스펙 2026-08-31 §3-1). 캠페인을 먼저 짜두는 방식에선
                          // '새로 만들기'가 흔한 경우라 앞에 둔다. Link인 이유는 ⌘·가운데 클릭으로
                          // 새 탭에 열어 캠페인 표를 띄워둔 채 원고만 따로 쓸 수 있게 하기 위해서다.
                          <span className="flex flex-wrap items-center gap-x-1.5 text-x-muted">
                            <span>원고 없음</span>
                            <span aria-hidden>·</span>
                            <Link href={draftWriteHref(t.id, campaign.id)} className="text-x-blue-text hover:underline">새로 만들기</Link>
                            <span aria-hidden>·</span>
                            <button type="button" onClick={() => onAttachDraft(t)} className="hover:text-x-secondary hover:underline">고르기</button>
                          </span>
                        )}
                    </td>
```

- [ ] **Step 3: 타입·린트를 확인한다**

```bash
npx tsc --noEmit && npm run lint
```

Expected: tsc 오류 0건. 린트 경고는 기준선 24개 그대로(늘어나면 안 된다).

- [ ] **Step 4: 커밋**

```bash
git add src/app/campaigns/TaskTable.tsx
git commit -m "feat(campaign): 작업 줄에서 원고를 새로 만들러 가는 입구"
```

---

### Task 3: 원고 고르기 창의 빈 상태 문구를 호출자가 정하게

**Files:**
- Modify: `src/app/campaigns/AttachDraftModal.tsx` (12~14행 시그니처, 40행 빈 상태)
- Modify: `src/app/campaigns/CampaignDetail.tsx` (455행 `AttachDraftModal` 호출)
- Modify: `src/app/campaigns/TaskAddModal.tsx` (328행 `AttachDraftModal` 호출)

**Interfaces:**
- Consumes: 없음
- Produces: `AttachDraftModal`에 **필수** prop `emptyHint: string` 추가. 이후 이 창을 쓰는 곳은 반드시 문구를 넘겨야 한다.

이 창은 두 맥락에서 쓰인다. 한 문구로 고정하면 둘 중 한쪽이 없는 버튼을 가리키는 거짓 안내가 된다 — 지금 벌어지고 있는 일이다.

- [ ] **Step 1: prop을 받게 바꾼다**

`AttachDraftModal.tsx` 12~14행 현재:

```tsx
export function AttachDraftModal({ clientId, onClose, onPick, title = '있는 원고 고르기' }: {
  clientId: string | null; onClose: () => void; onPick: (draft: DraftRow) => void; title?: string;
}) {
```

이렇게 바꾼다:

```tsx
// emptyHint에 기본값을 두지 않는다 — 이 창은 두 맥락(작업 만드는 중 / 작업 줄)에서 쓰이고
// 맥락마다 다음 행동이 다르다. 기본값이 있으면 새 호출자가 조용히 틀린 문구를 쓰게 된다.
export function AttachDraftModal({ clientId, onClose, onPick, emptyHint, title = '있는 원고 고르기' }: {
  clientId: string | null; onClose: () => void; onPick: (draft: DraftRow) => void; emptyHint: string; title?: string;
}) {
```

- [ ] **Step 2: 빈 상태에서 그 prop을 쓴다**

`AttachDraftModal.tsx` 40행 현재:

```tsx
          {state === 'ready' && shown.length === 0 && <p className="px-4 py-6 text-center text-ui text-x-muted">붙일 수 있는 원고가 없어요 — &ldquo;새로 만들기&rdquo;로 바로 써도 돼요</p>}
```

이렇게 바꾼다:

```tsx
          {state === 'ready' && shown.length === 0 && <p className="px-4 py-6 text-center text-ui text-x-muted">{emptyHint}</p>}
```

- [ ] **Step 3: 두 호출자에 맞는 문구를 넘긴다**

`CampaignDetail.tsx` 455행 — 작업 줄에서 연 창이라 **창을 닫아야** 새로 만들기에 닿는다:

```tsx
        <AttachDraftModal clientId={data.campaign.clientId} title="이 작업에 붙일 원고 고르기"
                          emptyHint="붙일 수 있는 원고가 없어요 — 창을 닫고 '새로 만들기'를 누르면 바로 쓸 수 있어요"
                          onClose={() => setAttachFor(null)}
```

(그 아래 `onPick={async (d) => {…}}` 블록은 그대로 둔다.)

`TaskAddModal.tsx` 328행 — 작업을 만드는 중이라 **같은 창 위쪽 라디오**에 새로 만들기가 있다:

```tsx
      <AttachDraftModal clientId={campaign.clientId}
                        emptyHint="붙일 수 있는 원고가 없어요 — 위 '원고' 칸에서 '새로 만들기'를 고르면 바로 써도 돼요"
                        onClose={() => { setAttachOpen(false); if (draft.kind !== 'existing') setDraft({ kind: 'none' }); }}
                        onPick={(d) => { setDraft({ kind: 'existing', draft: d }); setAttachOpen(false); if (d.influencerHandle && handles.length === 0) addHandle(d.influencerHandle); }} />
```

- [ ] **Step 4: 타입을 확인한다**

```bash
npx tsc --noEmit
```

Expected: 오류 0건. (`emptyHint`가 필수라, 넘기지 않은 호출자가 남아 있으면 여기서 잡힌다.)

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/AttachDraftModal.tsx src/app/campaigns/CampaignDetail.tsx src/app/campaigns/TaskAddModal.tsx
git commit -m "fix(campaign): 원고 고르기 창의 빈 상태 문구를 맥락에 맞게 — 없는 버튼 안내 제거"
```

---

### Task 4: 원고 화면으로 갈 때 라우터 이동

**Files:**
- Modify: `src/app/campaigns/CampaignDetail.tsx` (import 2행 근처, 컴포넌트 상단, 449행)

**Interfaces:**
- Consumes: `draftWriteHref(taskId, campaignId)` — Task 1
- Produces: 없음

`window.location.assign`은 이 저장소에서 이 한 곳뿐인 예외다. 리포 표준은 `next/navigation`의 `useRouter`다(`app/page.tsx`, `clients`, `workspaces`, `settlement`, `tracking` 전부). 전체 리로드를 없애면 앱이 다시 켜지지 않아 눈에 띄게 빨라진다.

- [ ] **Step 1: `useRouter`와 `draftWriteHref`를 import한다**

`CampaignDetail.tsx` 1~3행 현재:

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
```

2행과 3행 사이에 한 줄을 넣는다:

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/toastContext';
```

그리고 17~20행의 `@/lib/campaignJudgment` import 블록이 현재 이렇다:

```tsx
import {
  summarizeTasks, summarizeTaskPerf, deriveTaskInfluencers, taskCampaignTotal, matchesTaskFilter, subtotalsByType,
  STAGE_FILTERS, STAGE_FILTER_LABEL, TASK_TYPE_LABEL, type StageFilter, type TaskSortKey, type TaskType,
} from '@/lib/campaignJudgment';
```

첫 줄 끝에 `draftWriteHref`를 넣는다:

```tsx
import {
  summarizeTasks, summarizeTaskPerf, deriveTaskInfluencers, taskCampaignTotal, matchesTaskFilter, subtotalsByType, draftWriteHref,
  STAGE_FILTERS, STAGE_FILTER_LABEL, TASK_TYPE_LABEL, type StageFilter, type TaskSortKey, type TaskType,
} from '@/lib/campaignJudgment';
```

- [ ] **Step 2: 컴포넌트 안에서 router를 만든다**

67행이 `  const { show } = useToast();` 이다. 그 **바로 아래**에 한 줄을 넣는다:

```tsx
  const { show } = useToast();
  const router = useRouter();
```

- [ ] **Step 3: 이동을 라우터로 바꾼다**

449행 현재:

```tsx
                        if (goToGenerate) { window.location.assign(`/generate?task=${firstTaskId}&campaign=${data.campaign.id}`); return; }
```

이렇게 바꾼다:

```tsx
                        // 라우터 이동 — 전체 리로드를 하면 앱이 통째로 다시 켜진다(리포 표준은 useRouter).
                        if (goToGenerate) { router.push(draftWriteHref(firstTaskId, data.campaign.id)); return; }
```

- [ ] **Step 4: 타입·린트를 확인한다**

```bash
npx tsc --noEmit && npm run lint
```

Expected: tsc 오류 0건, 린트 기준선 24개 유지. `window.location.assign`이 더 이상 이 파일에 없는지 확인:

```bash
grep -n "window.location" src/app/campaigns/CampaignDetail.tsx
```

Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/CampaignDetail.tsx
git commit -m "perf(campaign): 원고 화면 이동을 전체 리로드에서 라우터 이동으로"
```

---

### Task 5: 딥링크 가드 단단히 + 배너에 돌아가기 링크

**Files:**
- Modify: `src/app/generate/page.tsx` (import 블록, 108행 ref, 296~300행 가드, 802~820행 배너)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

가드 변경이 Task 4와 짝이다. 지금 `taskLinkDone = useRef(false)`는 **"매번 페이지가 새로 열린다"** 는 전제 위에 있다. 전체 리로드를 없앴으니 그 전제가 약해진다 — 어느 작업을 소비했는지 기억하게 바꾼다.

- [ ] **Step 1: `Link`를 import한다**

`page.tsx` 3행이 `import { useSearchParams } from 'next/navigation';`이다. 그 **아래**에 추가:

```tsx
import Link from 'next/link';
```

- [ ] **Step 2: ref 타입을 바꾼다**

108행 현재:

```tsx
  const taskLinkDone = useRef(false); // ?task= 소비 표시 — 클라 목록이 온 뒤 1회만
```

이렇게 바꾼다:

```tsx
  // 소비한 작업 id — 참·거짓이 아니라 id로 기억한다. 예전엔 캠페인 화면이 전체 리로드로 들어와
  // 매번 새 마운트가 보장됐지만, 라우터 이동으로 바뀌면서 그 전제가 약해졌다(스펙 2026-08-31 §5-2).
  const taskLinkDone = useRef<string | null>(null);
```

- [ ] **Step 3: 가드를 id 기준으로 바꾼다**

296~300행 현재:

```tsx
    if (taskLinkDone.current || !clientsLoaded) return;
    const targetTask = searchParams.get('task');
    const targetCampaign = searchParams.get('campaign');
    if (!targetTask || !targetCampaign) return;
    taskLinkDone.current = true;
```

이렇게 바꾼다(파라미터를 먼저 읽고 나서 비교해야 한다):

```tsx
    if (!clientsLoaded) return;
    const targetTask = searchParams.get('task');
    const targetCampaign = searchParams.get('campaign');
    if (!targetTask || !targetCampaign) return;
    if (taskLinkDone.current === targetTask) return;   // 같은 작업으로 다시 들어오면 무시
    taskLinkDone.current = targetTask;
```

- [ ] **Step 4: 배너에 돌아가기 링크를 붙인다**

818행의 `해제` 버튼 한 줄이 현재 이렇다:

```tsx
            <button onClick={clearTaskCtx} className="ml-auto rounded-full border border-x-blue/40 px-2.5 py-0.5 text-ui hover:bg-white">해제</button>
```

이 한 줄을 아래 블록으로 바꾼다. `ml-auto`가 버튼에서 감싸는 `span`으로 옮겨간다:

```tsx
            <span className="ml-auto flex items-center gap-1.5">
              {/* 다 쓰고 돌아가는 것과 '역시 나중에' 하고 돌아가는 것이 같은 자리다 — 붙기 전에도 보인다.
                  Link인 이유는 새 탭으로도 열 수 있게 하기 위해서다. */}
              <Link href={`/campaigns?id=${taskCtx.campaign.id}`}
                    className="rounded-full border border-x-blue/40 px-2.5 py-0.5 text-ui hover:bg-white">
                ← {taskCtx.campaign.name}으로
              </Link>
              <button onClick={clearTaskCtx} className="rounded-full border border-x-blue/40 px-2.5 py-0.5 text-ui hover:bg-white">해제</button>
            </span>
```

- [ ] **Step 5: 타입·린트를 확인한다**

```bash
npx tsc --noEmit && npm run lint
```

Expected: tsc 오류 0건, 린트 기준선 24개 유지.

- [ ] **Step 6: 커밋**

```bash
git add src/app/generate/page.tsx
git commit -m "feat(generate): 작업 배너에 캠페인으로 돌아가기 + 딥링크 소비 판정을 작업 id 기준으로"
```

---

### Task 6: 옛 안내 문구 수정 · 업데이트 소식 · 전량 검증

**Files:**
- Modify: `src/app/campaigns/CampaignCreateModal.tsx:100`
- Modify: `src/content/updates.ts` (배열 맨 위)

**Interfaces:**
- Consumes: Task 2~5의 결과(문구가 실제 화면과 맞는지)
- Produces: 없음

- [ ] **Step 1: 새 캠페인 창의 안내를 지금 구조에 맞게 고친다**

`CampaignCreateModal.tsx` 100행 현재:

```tsx
        <p className="mt-1 text-ui text-x-muted">클라이언트 한 곳 × 기간 하나예요. 원고는 만든 뒤 [+ 원고 추가]로 넣거나 콘텐츠 생성에서 바로 만들어요.</p>
```

이렇게 바꾼다(`[+ 원고 추가]`는 2026-08-28에 `[+ 작업 추가]`로 바뀌며 사라진 버튼이다):

```tsx
        <p className="mt-1 text-ui text-x-muted">클라이언트 한 곳 × 기간 하나예요. 만든 뒤 [+ 작업 추가]로 이번 주에 나갈 일을 올리고, 원고는 각 작업에 붙여요.</p>
```

- [ ] **Step 2: 없어진 버튼을 가리키는 문구가 더 없는지 확인한다**

```bash
grep -rn "원고 추가" src/
```

Expected: 출력 없음. (있으면 같은 방식으로 고친다.)

- [ ] **Step 3: 업데이트 소식을 쓴다**

`src/content/updates.ts`의 배열 **맨 위**(현재 첫 항목인 `date: '2026-08-28'` 정산 페이지 항목 바로 앞)에 추가한다:

```ts
  {
    date: '2026-08-31',
    type: '개선',
    title: '캠페인 작업에서 바로 원고를 쓰러 갈 수 있어요',
    summary: '캠페인을 먼저 만들어 두고 나중에 원고를 채우는 순서가 편해졌어요. 작업 줄에서 바로 원고 화면으로 갈 수 있고, 다 쓰면 그 캠페인으로 돌아오는 길도 생겼어요.',
    bullets: [
      '작업 줄의 원고 칸이 "원고 없음 · 새로 만들기 · 고르기"로 바뀌었어요 — 새로 만들기를 누르면 그 작업에 붙일 원고를 바로 쓰러 갑니다. 전에는 작업을 만드는 순간에만 갈 수 있었어요',
      '원고 화면이 "어느 작업 것인지" 알고 열려요 — 클라이언트가 미리 골라져 있고, 원고를 만들면 그 작업에 저절로 붙어요',
      '원고 화면 위 안내줄에 "← 캠페인으로" 링크가 생겼어요. 새 탭으로 열면 캠페인 표를 띄워둔 채 원고만 따로 쓸 수도 있어요',
      '원고 화면으로 넘어갈 때 화면이 통째로 다시 열리지 않아 빨라졌어요',
      '원고가 하나도 없을 때 뜨던 "새로 만들기로 바로 써도 돼요" 안내가 실제로 누를 수 있는 버튼을 가리키게 고쳤어요',
      '새 캠페인 창의 안내가 없어진 [+ 원고 추가] 버튼을 가리키던 것을 [+ 작업 추가]로 고쳤어요',
    ],
    link: { label: '캠페인', href: '/campaigns' },
  },
```

- [ ] **Step 4: 업데이트 소식 형식 검사를 돌린다**

```bash
node --import tsx --test src/lib/updates.test.ts
```

Expected: PASS

- [ ] **Step 5: 전량 테스트와 린트를 돌린다**

```bash
npm test
```

Expected: 전량 통과(약 4분, 실 DB). 실패가 있으면 이 계획의 변경 때문인지 먼저 확인한다 — 이 계획은 서버·저장 로직을 건드리지 않으므로 DB 테스트가 깨지면 다른 원인이다.

```bash
npm run lint
```

Expected: 경고 24개(기준선). 늘어났으면 늘어난 것을 고친다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/campaigns/CampaignCreateModal.tsx src/content/updates.ts
git commit -m "docs(updates): 캠페인 작업에서 원고 쓰러 가기 + 새 캠페인 창 옛 안내 문구 수정"
```

---

## 구현 뒤 — koo 화면 확인 항목

OAuth 도메인 게이팅이라 화면 확인은 koo만 할 수 있다. 로컬 확인은 `npm run build && npm run start -- -p 3001` 후 `http://127.0.0.1:3001` (`next dev`는 하이드레이션이 조용히 실패하고, `localhost`는 크롬 프록시에 잡힌다).

1. 작업 줄에서 **새로 만들기** → 원고 화면이 그 작업 맥락으로 열린다(배너 문구에 캠페인·유형·핸들, 클라이언트 자동 선택)
2. 원고 생성 → 저절로 붙고 배너가 "이 작업에 원고가 붙었어요"로 바뀐다
3. **← 캠페인으로** → 그 캠페인이 선택된 채 열린다
4. 곧바로 다른 작업에서 새로 만들기 → 배너가 **새 작업으로 갱신**된다 (Task 5 가드 검증)
5. 원고 고르기 창을 두 경로(작업 추가 창 / 작업 줄)에서 열어 빈 상태 문구가 각각 맞는지
6. RT 작업 줄에는 새로 만들기가 **안 보인다**
7. 새로 만들기를 ⌘·가운데 클릭 → 새 탭에서 열리고 캠페인 표가 그대로 남는다
