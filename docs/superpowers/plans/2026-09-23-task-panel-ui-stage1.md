# 작업 패널 UI 개편 — 1단계(보이는 것) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인 v2 작업 패널(`/campaigns/flow`)을 설계 §3~§8-1·§8-4·§10대로 다시 그린다 — 섹션 상자, 단계·유형 칸, 프로필 사진, 원고 카드와 인용 미리보기, 결제 수단·수수료 표시, 새 작업의 '보이는 금액 저장'.

**Architecture:** 판정·문구·데이터 모양은 `src/lib`의 순수 함수로 빼서 `node:test`로 검증하고(컴포넌트 하네스가 없다), 화면 조각은 `src/app/campaigns/flow/panel/` 아래 작은 컴포넌트로 나눠 `TaskPanel.tsx`가 조립한다. 서버는 조회만 늘린다(마이그레이션 없음): 작업 행에 원고 미리보기 2필드, 인플 옵션에 사진 URL, 새 조회 창구 2개(결제 수단 보기·링크로 게시물 보기).

**Tech Stack:** 이 저장소의 커스텀 Next.js(App Router — 코드 전에 `node_modules/next/dist/docs/`의 해당 가이드 확인, AGENTS.md), React 19 + React Compiler 린트, Tailwind v4 토큰(`text-content`=15px·`text-ui`=13px·`text-caption`=11px, `x-*` 색), postgres.js, `node --import tsx --test`.

**설계 문서:** `docs/superpowers/specs/2026-09-23-task-panel-ui-design.md` — 각 태스크의 §번호는 이 문서를 가리킨다. 2단계(§8-2·§8-3·§9)는 이 계획 범위 밖이며, 1단계가 끝난 코드 위에서 별도 계획으로 쓴다.

## Global Constraints

- 마이그레이션을 만들지 않는다(1단계). 서버 변경은 조회 추가뿐.
- 결제 수단(계좌·이메일·QR)은 `listOptions`·`settlementByTaskIds`·FlowRow에 싣지 않는다 — 인플 한 명/작업 한 건 단위 조회로만(§8-1).
- 도구 화면 밀도: 본문 15px(`text-content`), 칸 제목 14px(`text-[14px]`), 보조 13px 이상(`text-ui`) — `text-caption`(11px)을 새로 쓰지 않는다. 단계 칩 글자 14px.
- 문구는 §10 표가 우선: 평소 상태엔 도움말 없음, 막힘·주의만 짧게 한 줄, 긴 이유는 ⓘ(`title`). 오류 문구는 줄이지 않는다. 비활성 버튼의 이유는 짧은 보이는 문구로 남긴다(UX 원칙 2·5 — ⓘ만으로 끝내지 않는다).
- 판정 함수는 하나만 둔다 — 같은 판정을 두 파일에서 다시 만들지 않는다(기존 관례: `replaceDisabledReason`, `PANEL_FIELD_ORDER`).
- 테스트는 연습용 DB에서만: 단일 파일 `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/<파일>.test.ts`. 전체 `npm test`(약 17분)는 마지막 태스크에서 한 번.
- 린트는 기준선 대비 증감 0(Task 0에서 잰다). `react-hooks/set-state-in-effect`(이펙트 본문의 동기 setState)·`react-hooks/refs`(렌더 중 ref 읽기)는 에러다.
- 커밋은 경로를 명시해 스테이징한다(`git add -A` 금지). 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

### Task 0: 기준선

**Files:** 없음

- [ ] **Step 1: 워크트리·환경 확인**

Run: `cd ~/orca/workspaces/cb-x-deck/task-panel-ui && git status -sb && ls -la .env .env.staging && cat .vercel/project.json`
Expected: 브랜치 `cb-koo/task-panel-ui`, `.env`(링크)·`.env.staging` 존재, `"projectName":"cb-x-deck"`.

- [ ] **Step 2: 타입·린트 기준선 기록**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npm run lint 2>&1 | tail -2`
Expected: `tsc=0`. 린트 마지막 줄의 문제 개수(예: `✖ 24 problems`)를 이 계획 맨 아래 "기준선" 줄에 적어 둔다 — 이후 모든 태스크의 통과 기준.

---

### Task 1: 단계·유형 칩 색을 한 곳으로 (§5)

지금 `TYPE_CHIP`이 4벌(FlowTable·TaskTable·WeekCalendar·TargetPicker), `STAGE_CHIP`이 1벌(FlowTable) 복사돼 있다. 패널이 다섯 번째 복사본을 만들지 않게 공용 모듈로 옮긴다.

**Files:**
- Create: `src/lib/flowChips.ts`
- Create: `src/lib/flowChips.test.ts`
- Modify: `src/app/campaigns/flow/FlowTable.tsx:60-67` (두 상수 삭제 → import)
- Modify: `src/app/campaigns/TaskTable.tsx:33-35`, `src/app/campaigns/WeekCalendar.tsx:38-40`, `src/app/campaigns/TargetPicker.tsx:11`

**Interfaces:**
- Produces: `STAGE_CHIP: Record<FlowStage, string>`, `TYPE_CHIP: Record<TaskType, string>`, `FLOW_STEPS: readonly FlowStage[]`(취소 제외 흐름 순서 5개)

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/flowChips.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_CHIP, TYPE_CHIP, FLOW_STEPS } from './flowChips.ts';
import { FLOW_STAGES } from './campaignJudgment.ts';
import { TASK_TYPES } from './campaignJudgment.ts';

test('1) 모든 단계·유형에 색이 있다', () => {
  for (const s of FLOW_STAGES) assert.ok(STAGE_CHIP[s], s);
  for (const t of TASK_TYPES) assert.ok(TYPE_CHIP[t], t);
});

test('2) 흐름 줄은 취소를 뺀 5단계, 판정 순서 그대로', () => {
  assert.deepEqual([...FLOW_STEPS], ['prep', 'handed', 'posted', 'settle', 'done']);
});
```

`TASK_TYPES`가 campaignJudgment에서 export되는지 먼저 확인: `grep -n "export const TASK_TYPES" src/lib/*.ts`. 다른 파일이면 import 경로를 그쪽으로.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/flowChips.test.ts`
Expected: FAIL — `Cannot find module './flowChips.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/flowChips.ts
// 단계·유형 칩 색 — 표(FlowTable·TaskTable)·주간 달력·대상 고르기·작업 패널이 같은 표를 쓴다.
// 예전에는 파일마다 복사해 들고 있었다(4벌). 한 곳만 고치면 전 화면이 같이 바뀌게 여기 하나로 둔다.
import type { FlowStage, TaskType } from './campaignJudgment.ts';

export const STAGE_CHIP: Record<FlowStage, string> = {
  prep: 'bg-x-surface text-x-secondary', handed: 'bg-[#e8f0fe] text-[#1d4ed8]', posted: 'bg-[#e6f6ee] text-[#15803d]',
  settle: 'bg-[#f3e8ff] text-[#7e22ce]', done: 'bg-x-text text-white', canc: 'bg-slate-50 text-slate-400 line-through',
};
export const TYPE_CHIP: Record<TaskType, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
// 패널의 단계 흐름 줄 — 취소는 흐름 밖 상태라 줄에 넣지 않는다(취소면 칩 하나만, §5).
export const FLOW_STEPS: readonly FlowStage[] = ['prep', 'handed', 'posted', 'settle', 'done'];
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/flowChips.test.ts`
Expected: PASS 2/2

- [ ] **Step 5: 네 파일의 복사본을 import로 바꾼다**

각 파일에서 `const TYPE_CHIP ... };`(FlowTable은 `STAGE_CHIP`도) 블록과 그 위 "복사한다" 주석을 지우고 `import { STAGE_CHIP, TYPE_CHIP } from '@/lib/flowChips';`(필요한 것만). TargetPicker의 `Record<string, string>`은 `TYPE_CHIP[c.type as TaskType]`처럼 쓰던 곳을 확인해 그대로 동작하게(키가 TaskType이면 캐스팅 없이).

Run: `npx tsc --noEmit -p . ; echo tsc=$?`
Expected: `tsc=0`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/flowChips.ts src/lib/flowChips.test.ts src/app/campaigns/flow/FlowTable.tsx src/app/campaigns/TaskTable.tsx src/app/campaigns/WeekCalendar.tsx src/app/campaigns/TargetPicker.tsx
git commit -m "refactor(task-panel-ui): 단계·유형 칩 색을 공용 모듈 하나로

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 프로필 사진 — 공용 Avatar + 옵션에 avatarUrl (§6)

**Files:**
- Create: `src/components/Avatar.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx:18-32` (정의 삭제 → 공용 import, 다른 import는 그대로)
- Modify: `src/app/influencers/page.tsx:12` (Avatar import 경로)
- Modify: `src/lib/draftTypes.ts:16` (`InfluencerOption`에 `avatarUrl?: string`)
- Modify: `src/lib/influencerStore.ts:397-401` (`listOptions`)
- Test: `src/lib/influencerStore.test.ts` (test 9 옆에 새 test)

**Interfaces:**
- Produces: `Avatar({ url, name, size }: { url: string | null | undefined; name: string; size: number })`, `InfluencerOption.avatarUrl?: string`

- [ ] **Step 1: 실패하는 테스트** — `influencerStore.test.ts`의 test 9(265행) 바로 아래에 추가. test 9가 쓰는 픽스처 생성 방식(같은 파일 상단의 헬퍼·접두어 `P`)을 그대로 따른다:

```ts
test('9b) listOptions: 사진 URL은 있으면 avatarUrl, 없으면 undefined', async () => {
  const withPic = await createInfluencer(sql, { handle: P + 'picA', createdBy: null });
  const noPic = await createInfluencer(sql, { handle: P + 'picB', createdBy: null });
  await applyProfileSnapshot(sql, withPic.row.id, {
    id: '889' + process.pid, userName: P + 'picA', name: null,
    followers: 10, profilePicture: 'https://pbs.twimg.com/x.jpg', description: null,
  });
  const opts = await listOptions(sql);
  assert.equal(opts.find((o) => o.handle === P + 'picA')?.avatarUrl, 'https://pbs.twimg.com/x.jpg');
  assert.equal(opts.find((o) => o.handle === P + 'picB')?.avatarUrl, undefined);
  await deleteInfluencer(sql, withPic.row.id);
  await deleteInfluencer(sql, noPic.row.id);
});
```

(`createInfluencer`·`applyProfileSnapshot`·`deleteInfluencer`는 test 9가 쓰는 그대로 — 이미 import돼 있다. `applyProfileSnapshot`의 `name: null`이 타입상 안 되면 `name: ''`.)

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/influencerStore.test.ts`
Expected: 9b FAIL — `avatarUrl` undefined ≠ URL

- [ ] **Step 3: 구현**

```ts
// src/lib/draftTypes.ts:16
export interface InfluencerOption { id?: string; handle: string; name?: string; avatarUrl?: string; pricing?: Pricing }
```

```ts
// src/lib/influencerStore.ts — listOptions
export async function listOptions(sql: postgres.Sql): Promise<InfluencerOption[]> {
  const rows = await sql<Array<{ id: string; handle: string; display_name: string | null; avatar_url: string | null; pricing: Pricing | null }>>`
    select id, handle, display_name, avatar_url, pricing from influencer order by lower(handle)`;
  return rows.map((r) => ({
    id: r.id, handle: r.handle, name: r.display_name ?? undefined, avatarUrl: r.avatar_url ?? undefined, pricing: r.pricing ?? undefined,
  }));
}
```

(주석 한 줄 추가: "사진 URL은 작업 패널 인플 칸용(§6) — 결제 수단은 싣지 않는다(원고 생성 화면도 이 응답을 매번 받는다).")

```tsx
// src/components/Avatar.tsx
'use client';
import { useState } from 'react';

// 원형 프로필 사진 — 인플 명부·작업 패널 공용. X CDN 주소는 만료될 수 있어 불러오기 실패 시 이니셜로 바꾼다.
export function Avatar({ url, name, size }: { url: string | null | undefined; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X CDN 원본 URL
      <img src={url} alt="" style={style} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span style={style} aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full bg-x-border-strong font-bold text-white">
      <span style={{ fontSize: Math.round(size * 0.42) }}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
```

`InfluencerProfile.tsx`에서 `export function Avatar …` 블록을 지우고 `import { Avatar } from '@/components/Avatar';`를 추가(파일 안의 기존 사용처는 그대로 동작). `page.tsx:12`의 `import { Avatar } from './InfluencerProfile'`(실제 문장 확인)을 `'@/components/Avatar'`로.

- [ ] **Step 4: 통과 확인**

Run: 위 Step 2 명령 + `npx tsc --noEmit -p . ; echo tsc=$?`
Expected: influencerStore 전부 PASS, `tsc=0`

- [ ] **Step 5: 커밋**

```bash
git add src/components/Avatar.tsx src/app/influencers/InfluencerProfile.tsx src/app/influencers/page.tsx src/lib/draftTypes.ts src/lib/influencerStore.ts src/lib/influencerStore.test.ts
git commit -m "feat(task-panel-ui): 인플 옵션에 사진 URL, Avatar를 공용 컴포넌트로

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 작업 행에 원고 미리보기 두 필드 (§7)

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (TaskRow 31-32행 근처, Row 72행, toRow 101-102행, SELECT 120행)
- Modify: `src/lib/campaignFlowView.test.ts:12-17` (`mk()` 픽스처), `src/lib/campaignTaskCancel.test.ts`(FlowRow/TaskRow 리터럴이 있으면 같은 두 필드)
- Test: `src/lib/campaignTaskStore.test.ts`

**Interfaces:**
- Produces: `TaskRow.draftPreview: string | null`(첫 포스트 전문, 자르지 않음), `TaskRow.draftFirstImage: string | null`(첫 포스트 첫 미디어 `url` — 원고 이미지면 **저장소 경로**, X 이미지면 절대 URL)

- [ ] **Step 1: 실패하는 테스트** — `campaignTaskStore.test.ts` 끝에 추가(파일의 `mkCampaign`·`mkDraft`·`createClient`·`attachDraft` 헬퍼를 그대로 쓴다):

```ts
test('12) 원고 미리보기 — 첫 포스트 전문과 첫 이미지', async () => {
  const c = await createClient(sql, P + '클라미리보기');
  const camp = await mkCampaign(c.id, c.name, 'preview');
  const d = await mkDraft(c.id, c.name, {
    content: { posts: [{ text: '첫 줄\n둘째 줄', media: [{ type: 'photo', url: 'drafts/abc/1.jpg', videoUrl: null }] }, { text: '두 번째 포스트', media: [] }] },
  });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', influencers: [] });
  await attachDraft(sql, t.id, d.id);
  const got = await getTask(sql, t.id);
  assert.equal(got?.draftPreview, '첫 줄\n둘째 줄');
  assert.equal(got?.draftFirstImage, 'drafts/abc/1.jpg');
  assert.equal(got?.draftFirstLine, '첫 줄');   // 표의 원고 열은 그대로

  const [bare] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', influencers: [] });
  const none = await getTask(sql, bare.id);
  assert.equal(none?.draftPreview, null);
  assert.equal(none?.draftFirstImage, null);
});
```

`createTasks`·`attachDraft`의 실제 인자 모양은 같은 파일 test 1·2(37·72행)를 보고 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignTaskStore.test.ts`
Expected: test 12 FAIL (`undefined` ≠ `'첫 줄\n둘째 줄'`)

- [ ] **Step 3: 구현**

TaskRow(32행 `draftFirstLine` 아래):
```ts
  draftPreview: string | null;      // 붙은 원고 첫 포스트 전문 — 패널 원고 카드(2줄 말줄임은 화면이 한다, 설계 §7)
  draftFirstImage: string | null;   // 첫 포스트 첫 미디어 url — 원고 이미지는 비공개 버킷 경로라 화면이 서명해서 쓴다
```
Row(72행 끝에): `draft_first_image: string | null;`
toRow(102행 `draftFirstLine` 다음):
```ts
  draftPreview: r.draft_id ? (r.draft_first_line?.trim() ? r.draft_first_line : null) : null,
  draftFirstImage: r.draft_id ? r.draft_first_image : null,
```
SELECT(120행 다음 줄):
```sql
         coalesce(d.edited, d.content)->'posts'->0->'media'->0->>'url' as draft_first_image,
```

- [ ] **Step 4: 픽스처 갱신** — `campaignFlowView.test.ts`의 `mk()`에 `draftPreview: null, draftFirstImage: null,`을 `draftFirstLine: null,` 옆에. `grep -rn "draftFirstLine: null" src --include=*.ts`로 다른 리터럴도 전부 찾아 같은 두 필드를 넣는다(tsx는 타입 검사를 안 해서 테스트가 초록이어도 tsc에서만 깨진다).

- [ ] **Step 5: 통과 확인**

Run: Step 2 명령 + `node --import tsx --test src/lib/campaignFlowView.test.ts` + `npx tsc --noEmit -p . ; echo tsc=$?`
Expected: 전부 PASS, `tsc=0`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignTaskStore.test.ts src/lib/campaignFlowView.test.ts
# grep으로 찾은 다른 픽스처 파일도 경로를 적어 함께
git commit -m "feat(task-panel-ui): 작업 행에 원고 미리보기(첫 포스트 전문·첫 이미지)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 결제 수단 보기 — 순수 판정 + 조회 창구 (§8-1)

패널이 "이 작업에 쓰일 수단"을 한 번에 받는 창구. 편집 모드는 `taskId`로 요청 뒤 스냅샷을 먼저 보고, 없으면 `handle`로 명부 인플의 기본 수단을 본다. 새 작업은 `handle`만.

**Files:**
- Create: `src/lib/paymentView.ts`, `src/lib/paymentView.test.ts`
- Create: `src/app/api/influencers/payment-view/route.ts`
- Modify: `src/lib/influencerPayment.ts` (`feeShortLabel` 추가)
- Test: `src/lib/influencerPayment.test.ts`(있으면 거기, 없으면 paymentView.test.ts에)

**Interfaces:**
- Produces:
  - `feeShortLabel(fee: PaymentFee | null | undefined, currency: Currency): { text: string; cb: boolean }` — `인플 부담` / `CB 부담 3%` / `CB 부담 ¥300`
  - `type PaymentView = { state: 'notInRoster' } | { state: 'none' } | { state: 'ok'; label: string; fee: { text: string; cb: boolean } } | { state: 'requested'; label: string; fee: { text: string; cb: boolean } }`
  - `buildPaymentView(input: { request: { method: PaymentMethodSnapshot; fee: PaymentFee | null } | null; roster: { methods: PaymentMethod[] } | null }): PaymentView`
  - `loadPaymentView(sql, { handle: string; taskId: string | null }): Promise<PaymentView>`
  - `GET /api/influencers/payment-view?handle=<h>&taskId=<uuid?>` → `PaymentView` JSON

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/paymentView.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentView } from './paymentView.ts';
import { feeShortLabel, type PaymentMethod } from './influencerPayment.ts';

const pm = (p: Partial<PaymentMethod>): PaymentMethod => ({
  id: 'm1', type: 'paypal', isDefault: true, holder: 'Sakura', currency: 'JPY', email: 's@x.com', updatedAt: '2026-09-01T00:00:00Z', ...p,
});

test('1) 수수료 짧은 말 — 인플 부담 / CB 비율 / CB 고정액', () => {
  assert.deepEqual(feeShortLabel(undefined, 'JPY'), { text: '인플 부담', cb: false });
  assert.deepEqual(feeShortLabel({ mode: 'grossUp', percent: 3 }, 'JPY'), { text: 'CB 부담 3%', cb: true });
  assert.equal(feeShortLabel({ mode: 'fixed', amount: 300 }, 'JPY').text.startsWith('CB 부담 '), true);
  assert.equal(feeShortLabel({ mode: 'fixed', amount: 300 }, 'JPY').cb, true);
});

test('2) 요청 스냅샷이 있으면 그것이 우선(단계 정산·완료)', () => {
  const v = buildPaymentView({
    request: { method: { type: 'paypal', holder: 'Sakura', currency: 'JPY', email: 'old@x.com' }, fee: null },
    roster: { methods: [pm({ email: 'new@x.com' })] },
  });
  assert.equal(v.state, 'requested');
  assert.ok(v.state === 'requested' && v.label.includes('old@x.com'));
});

test('3) 명부 밖 / 수단 없음 / 기본 수단', () => {
  assert.deepEqual(buildPaymentView({ request: null, roster: null }), { state: 'notInRoster' });
  assert.deepEqual(buildPaymentView({ request: null, roster: { methods: [] } }), { state: 'none' });
  const v = buildPaymentView({ request: null, roster: { methods: [pm({ id: 'a', isDefault: false, type: 'paypay', currency: 'JPY', email: undefined, fee: { mode: 'grossUp', percent: 3 } }), pm({ id: 'b' })] } });
  assert.equal(v.state, 'ok');
  assert.ok(v.state === 'ok' && v.label.startsWith('PayPal') && v.fee.text === '인플 부담');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/paymentView.test.ts`
Expected: FAIL — 모듈/함수 없음

- [ ] **Step 3: 구현**

`influencerPayment.ts`의 `formatFee` 아래:
```ts
// 작업 패널 수수료 칩 — formatFee와 같은 말에서 '송금 수수료 '만 뺀 짧은 판(§8-1). cb=true면 화면이 주황으로.
export function feeShortLabel(fee: PaymentFee | null | undefined, currency: Currency): { text: string; cb: boolean } {
  const long = formatFee(fee ?? undefined, currency);
  if (!long) return { text: '인플 부담', cb: false };
  return { text: long.replace(/^송금 수수료 /, '').replace(' · ', ' '), cb: true };
}
```
(`formatFee`가 `CB 부담 · 3%`를 돌려주므로 `' · '` → `' '`로 `CB 부담 3%`.)

```ts
// src/lib/paymentView.ts
// 작업 패널의 '결제 수단' 한 줄(설계 §8-1) — 이 작업에 쓰일 수단을 한 곳에서 판정한다.
// 요청을 보낸 뒤(단계 정산·완료)에는 요청에 담긴 스냅샷이 사실이다 — 명부 수단이 그 뒤에 바뀌어도 송금은 스냅샷대로 간다.
import type postgres from 'postgres';
import { describeMethod, getDefaultPaymentMethod, feeShortLabel, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { describeSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { isUuidLike } from './uuid.ts';

export type FeeChip = { text: string; cb: boolean };
export type PaymentView =
  | { state: 'notInRoster' }
  | { state: 'none' }
  | { state: 'ok'; label: string; fee: FeeChip }
  | { state: 'requested'; label: string; fee: FeeChip };

export function buildPaymentView(input: {
  request: { method: PaymentMethodSnapshot; fee: PaymentFee | null } | null;
  roster: { methods: PaymentMethod[] } | null;
}): PaymentView {
  if (input.request) {
    const m = input.request.method;
    // describeSnapshot은 슬랙 양식(`수단 | 수취인 | 식별`)이라 패널 한 줄엔 ' · '로 바꿔 쓴다
    return { state: 'requested', label: describeSnapshot(m).split(' | ').filter(Boolean).join(' · '), fee: feeShortLabel(input.request.fee, m.currency) };
  }
  if (!input.roster) return { state: 'notInRoster' };
  const d = getDefaultPaymentMethod(input.roster.methods);
  if (!d) return { state: 'none' };
  return { state: 'ok', label: describeMethod(d), fee: feeShortLabel(d.fee, d.currency) };
}

export async function loadPaymentView(sql: postgres.Sql, q: { handle: string; taskId: string | null }): Promise<PaymentView> {
  let request: { method: PaymentMethodSnapshot; fee: PaymentFee | null } | null = null;
  if (q.taskId && isUuidLike(q.taskId)) {
    // 활성 요청만 — 단계 판정(flowStage)과 같은 조건: 우리가 취소했거나 그쪽이 취소한 요청은 없는 것으로 본다
    const rows = await sql<Array<{ payment_method: PaymentMethodSnapshot; fee: PaymentFee | null }>>`
      select payment_method, fee from payment_request
       where task_id = ${q.taskId} and status = 'requested' and coalesce(external_status, '') <> 'cancelled'
       order by created_at desc limit 1`;
    if (rows[0]) request = { method: rows[0].payment_method, fee: rows[0].fee };
  }
  const inf = await sql<Array<{ payment_methods: unknown }>>`
    select payment_methods from influencer where lower(handle) = lower(${q.handle}) limit 1`;
  const roster = inf[0] ? { methods: Array.isArray(inf[0].payment_methods) ? (inf[0].payment_methods as PaymentMethod[]) : [] } : null;
  return buildPaymentView({ request, roster });
}
```

`describeSnapshot`·`PaymentMethodSnapshot`이 settlementCalc에서 export되는지 확인(150행 `export function describeSnapshot` 있음, 타입은 `grep -n "PaymentMethodSnapshot" src/lib/settlementCalc.ts`). 순환 import가 생기면(`tsc`·실행 오류) `describeSnapshot`만 쓰는 대신 스냅샷 필드로 직접 조립한다.

```ts
// src/app/api/influencers/payment-view/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { parseXHandle } from '@/lib/xHandle';
import { loadPaymentView } from '@/lib/paymentView';

// 작업 패널 '결제 수단' 한 줄(설계 §8-1). 인플 한 명(또는 작업 한 건의 요청)만 본다 — 목록 응답에 수단을 싣지 않기 위해 따로 둔다.
// 권한은 인플 옵션 목록(/api/drafts/influencers)과 같은 단계.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const u = new URL(req.url);
  const parsed = parseXHandle(u.searchParams.get('handle') ?? '');
  if (!parsed.ok) return NextResponse.json({ error: '핸들이 올바르지 않아요' }, { status: 400 });
  return NextResponse.json(await loadPaymentView(getSql(), { handle: parsed.handle, taskId: u.searchParams.get('taskId') }));
}
```

`requireAllowedUser` 반환 모양은 `src/app/api/influencers/[id]/route.ts:13-14`와 같게 쓴다. `[id]` 동적 세그먼트와 정적 `payment-view`가 공존하는 규칙은 `node_modules/next/dist/docs/`의 라우팅 문서로 확인(정적이 우선).

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/paymentView.test.ts && npx tsc --noEmit -p . ; echo tsc=$?`
Expected: PASS 3/3, `tsc=0`

- [ ] **Step 5: `loadPaymentView` DB 테스트** — paymentView.test.ts에 DB 테스트 하나(연습용 DB): 인플 1명 + 기본 수단 1개 → `ok`; 같은 핸들 대문자로 조회해도 `ok`; 없는 핸들 → `notInRoster`. 픽스처 생성은 `influencerStore.test.ts`가 인플을 만드는 방식, 수단은 `updatePaymentMethods(sql, id, { kind: 'add', … })`(정확한 `PaymentOp` 모양은 `influencerPayment.ts:55`)로. `after`에서 접두어로 정리하고 `sql.end()`.

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/paymentView.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/paymentView.ts src/lib/paymentView.test.ts src/lib/influencerPayment.ts src/app/api/influencers/payment-view/route.ts
git commit -m "feat(task-panel-ui): 작업에 쓰일 결제 수단·수수료를 보는 조회

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 링크로 게시물 보기 — 캐시 우선 조회 (§7-1)

원고 생성의 `loadQuoteTarget`(generate.ts:86)이 하는 "캐시 → 없으면 X 1회 → 캐시에 저장"을 공용 함수로 떼고, 미리보기 창구가 같은 함수를 쓴다.

**Files:**
- Create: `src/lib/tweetPreview.ts`, `src/lib/tweetPreview.test.ts`
- Create: `src/app/api/tweets/by-link/route.ts`
- Modify: `src/lib/generate.ts:86-106` (`loadQuoteTarget`이 공용 함수를 쓰게)

**Interfaces:**
- Produces:
  - `type TweetPreview = { kind: 'ok'; tweet: DeckTweet } | { kind: 'repost' } | { kind: 'unavailable' } | { kind: 'badLink' }`
  - `fetchTweetCached(sql, tweetId: string, client: Pick<GetxapiClient, 'getTweetDetail'>): Promise<TweetPreview>`
  - `loadTweetPreview(sql, url: string, client?): Promise<TweetPreview>`
  - `GET /api/tweets/by-link?url=<x.com 링크>` → `TweetPreview`
  - `quotedFromTweet(t: DeckTweet): DeckQuoted & { enriched: DeckTweet }` (Task 6이 씀)

- [ ] **Step 1: 실패하는 테스트** — `generateQuoteTarget.test.ts`의 가짜 클라이언트·트윗 id 생성 방식을 따른다(`sed -n 1,80p src/lib/generateQuoteTarget.test.ts`로 확인):

```ts
// src/lib/tweetPreview.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { loadTweetPreview, quotedFromTweet } from './tweetPreview.ts';

const sql = getSql();
const ids: string[] = [];
const nextId = () => { const id = `96${process.pid}${ids.length + 1}00000`; ids.push(id); return id; };
after(async () => { await sql`delete from tweet where tweet_id = any(${ids})`; await sql.end(); });

// raw 모양은 generateQuoteTarget.test.ts의 가짜 getTweetDetail 응답을 그대로 복사해 쓴다
const rawOf = (id: string, text: string) => ({ /* ← 그 파일의 raw 픽스처 */ });

test('1) 캐시 없음 → X 1회 → 저장, 두 번째는 X를 부르지 않는다', async () => {
  const id = nextId();
  let calls = 0;
  const client = { getTweetDetail: async () => { calls++; return rawOf(id, '대상 본문'); } };
  const url = `https://x.com/clinic/status/${id}`;
  const a = await loadTweetPreview(sql, url, client);
  const b = await loadTweetPreview(sql, url, client);
  assert.equal(a.kind, 'ok');
  assert.equal(b.kind, 'ok');
  assert.equal(calls, 1);
});

test('2) 삭제·비공개(null) → unavailable, 잘못된 링크 → badLink', async () => {
  const client = { getTweetDetail: async () => null };
  assert.equal((await loadTweetPreview(sql, `https://x.com/a/status/${nextId()}`, client)).kind, 'unavailable');
  assert.equal((await loadTweetPreview(sql, 'https://example.com/x', client)).kind, 'badLink');
});

test('3) 인용 카드 어댑터 — 작성자·본문이 옮겨진다', () => {
  const q = quotedFromTweet({ tweetId: '1', authorHandle: 'c', authorName: 'C', authorAvatarUrl: null, authorFollowers: null, text: 'hi', media: [], quoted: null, metrics: { likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 } as never, tweetUrl: null, tweetCreatedAt: null });
  assert.equal(q.id, '1'); assert.equal(q.screenName, 'c'); assert.equal(q.userName, 'C'); assert.equal(q.enriched.text, 'hi');
});
```

`tweet` 테이블 이름·`DeckMetrics` 모양·`DeckQuoted` 필드는 `grep -n "insert into\|from tweet" src/lib/tweetStore.ts`와 `src/lib/types.ts`의 `DeckQuoted`로 확인하고 맞춘다(`as never`는 metrics 모양을 확인한 뒤 실제 필드로 바꾼다).

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/tweetPreview.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/lib/tweetPreview.ts
// 링크로 게시물 한 건 보기(설계 §7-1) — 인용 대상 미리보기와 원고 생성(loadQuoteTarget)이 같은 규칙을 쓴다:
// 캐시를 먼저 보고, 없거나 본문이 비었을 때만 X 상세를 한 번 부른 뒤 캐시에 저장한다(보관함 항목은 만들지 않는다).
// 게시물 id는 링크 그대로다 — 리포스트 링크를 원본으로 바꿔 보여주면 원고 생성만 id 불일치로 실패한다.
import type postgres from 'postgres';
import type { DeckTweet, DeckQuoted } from './types.ts';
import { parseTweetLink } from './tweetLink.ts';
import { getTweetsByIds, upsertTweets } from './tweetStore.ts';
import { makeClient, type GetxapiClient } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';

export type TweetPreview = { kind: 'ok'; tweet: DeckTweet } | { kind: 'repost' } | { kind: 'unavailable' } | { kind: 'badLink' };

export async function fetchTweetCached(sql: postgres.Sql, tweetId: string, client: Pick<GetxapiClient, 'getTweetDetail'>): Promise<TweetPreview> {
  const cached = (await getTweetsByIds(sql, [tweetId]))[0] ?? null;
  if (cached && cached.text.trim()) return { kind: 'ok', tweet: cached };
  const raw = await client.getTweetDetail(tweetId);   // 실패(throw)는 부르는 쪽이 문구를 정한다
  if (!raw) return { kind: 'unavailable' };
  if (raw.retweeted_tweet) return { kind: 'repost' };
  const mapped = mapRawTweet(raw);
  if (!mapped || !mapped.text.trim() || mapped.tweetId !== tweetId) return { kind: 'unavailable' };
  await upsertTweets(sql, [mapped]);
  return { kind: 'ok', tweet: mapped };
}

export async function loadTweetPreview(sql: postgres.Sql, url: string, client?: Pick<GetxapiClient, 'getTweetDetail'>): Promise<TweetPreview> {
  const p = parseTweetLink(url);
  if (!p.ok) return { kind: 'badLink' };
  return fetchTweetCached(sql, p.tweetId, client ?? makeClient());
}

// 보관함의 인용 카드(QuotedCard)는 DeckQuoted + enriched를 받는다 — 캐시의 DeckTweet을 그 모양으로 옮긴다.
export function quotedFromTweet(t: DeckTweet): DeckQuoted & { enriched: DeckTweet } {
  return { id: t.tweetId, text: t.text, userName: t.authorName, screenName: t.authorHandle, enriched: t };
}
```

`DeckQuoted`에 위 네 필드 말고 필수 필드가 있으면(`src/lib/types.ts:56`) null/빈 값으로 채운다. `raw.retweeted_tweet` 접근은 `addByLink.ts:28`과 같은 캐스팅을 쓴다.

`generate.ts`의 `loadQuoteTarget` 본문을 공용 함수로 바꾼다 — 문구·예외는 그대로 유지:
```ts
  if (!tweetId) return null;
  let r;
  try { r = await fetchTweetCached(sql, tweetId, xClient ?? makeClient()); }
  catch { throw new GenerateInputError('인용RT 대상 게시물을 확인하지 못했어요 — 잠시 후 다시 시도해 주세요'); }
  if (r.kind !== 'ok') throw new GenerateInputError(r.kind === 'repost'
    ? '인용RT 대상 게시물의 내용을 읽을 수 없어요'
    : '인용RT 대상 게시물을 읽을 수 없어요 — 삭제되었거나 공개 범위를 확인해 주세요');
  const tweet = r.tweet;
  return { tweetId: tweet.tweetId, handle: tweet.authorHandle, name: tweet.authorName, excerpt: tweet.text, memos: [], role: 'quoteTarget' };
```
주의: 기존 코드는 `mapped.tweetId !== tweetId`일 때 "게시물이 바뀌었어요" 문구를 냈다 — `fetchTweetCached`는 이를 `unavailable`로 합친다. `generateQuoteTarget.test.ts`가 그 문구를 단정하면 테스트를 문구 대신 "GenerateInputError가 난다"로 두지 말고, `TweetPreview`에 `{ kind: 'mismatch' }`를 추가해 기존 문구를 보존한다(기존 테스트가 기준).

```ts
// src/app/api/tweets/by-link/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { loadTweetPreview } from '@/lib/tweetPreview';

// 인용·RT 대상 미리보기(설계 §7-1) — 게시물 한 건. X 조회는 캐시에 없을 때만(게시물당 처음 한 번).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const url = new URL(req.url).searchParams.get('url') ?? '';
  try {
    return NextResponse.json(await loadTweetPreview(getSql(), url));
  } catch {
    return NextResponse.json({ error: '게시물을 확인하지 못했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/tweetPreview.test.ts src/lib/generateQuoteTarget.test.ts src/lib/generate.test.ts && npx tsc --noEmit -p . ; echo tsc=$?`
Expected: 전부 PASS, `tsc=0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/tweetPreview.ts src/lib/tweetPreview.test.ts src/lib/generate.ts src/app/api/tweets/by-link/route.ts
git commit -m "feat(task-panel-ui): 링크로 게시물 보기 — 원고 생성과 같은 캐시 우선 조회

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 인용 카드에 모양 옵션 (§7-1)

`QuotedCard`를 보관함 동작은 그대로 두고 패널용 옵션만 연다.

**Files:**
- Modify: `src/components/QuotedCard.tsx`

**Interfaces:**
- Consumes: `quotedFromTweet` (Task 5)
- Produces: `QuotedCard` 새 prop — `lines?: 2 | 3`(본문 줄 수 제한, 클릭 = 원문 열기 유지), `firstImageOnly?: boolean`, `hideMedia?: boolean`, `flush?: boolean`(바깥 `mt-3` 제거)

- [ ] **Step 1: 구현** — 시그니처에 세 prop 추가, 기본값은 지금 동작:

```tsx
export function QuotedCard({ quoted, translation, collapsible = false, lines, firstImageOnly = false, hideMedia = false, flush = false }: {
  quoted: DeckQuoted & { enriched?: DeckTweet | null }; translation?: string | null; collapsible?: boolean;
  lines?: 2 | 3; firstImageOnly?: boolean; hideMedia?: boolean; flush?: boolean;
}) {
```
- 바깥 div className의 `mt-3` → `${flush ? '' : 'mt-3'}`.
- 본문 `TweetText` className: `${collapsed ? 'line-clamp-2' : lines === 2 ? 'line-clamp-2' : lines === 3 ? 'line-clamp-3' : ''}`.
- 미디어: 조건 `{!collapsed && e && e.media.length > 0 && …}`에 `!hideMedia &&`를 더하고, `<MediaGrid media={firstImageOnly ? e.media.slice(0, 1) : e.media} compact={collapsible || firstImageOnly} />`.
- 파일 상단 주석에 한 줄: "lines·firstImageOnly·flush는 작업 패널의 인용 미리보기용(설계 §7-1) — 기본값은 보관함 동작 그대로."

- [ ] **Step 2: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/components/QuotedCard.tsx`
Expected: `tsc=0`, 새 경고 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/QuotedCard.tsx
git commit -m "feat(task-panel-ui): 인용 카드에 줄 수·첫 이미지·여백 옵션

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 새 작업 — 보이는 금액을 [만들기]에 함께 저장 + 만든 뒤 한 번 묻기 (§8)

**Files:**
- Modify: `src/lib/campaignFlowView.ts` (`profilePromptFor` 추가), `src/lib/campaignFlowView.test.ts`
- Modify: `src/app/campaigns/flow/CostConfirmField.tsx` (`mode: 'draft'`)
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` (newCost 흐름·submitNew·onCreate 시그니처)
- Modify: `src/app/campaigns/flow/FlowDetail.tsx` (createTask 시그니처, 만든 뒤 PriceProfileDialog, overlayOpen)

**Interfaces:**
- Produces:
  - `profilePromptFor(input: { option: InfluencerOption | undefined; type: TaskType; cost: TaskCost | null }): { scenario: 'differs' | 'no-profile'; profile: TaskCost | null } | null`
  - `CostConfirmField` prop `mode?: 'confirm' | 'draft'`(기본 'confirm'), `onDraftChange?: (v: TaskCost | null | 'invalid') => void`, `error?: string | null`
  - `onCreate(body, more, prompt: PricePrompt | null)`, `type PricePrompt = { option: InfluencerOption; cost: TaskCost; type: TaskType; scenario: 'differs' | 'no-profile'; profile: TaskCost | null }`

- [ ] **Step 1: 실패하는 테스트** — `campaignFlowView.test.ts` 끝에:

```ts
test('profilePromptFor — CostConfirmField.confirm과 같은 규칙', () => {
  const opt = { id: 'i1', handle: 'a', pricing: { post: 50000, currency: 'KRW' } } as const;
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: { amount: 50000, currency: 'KRW' } }), null);          // 같음
  assert.deepEqual(profilePromptFor({ option: opt, type: 'post', cost: { amount: 40000, currency: 'KRW' } }),
    { scenario: 'differs', profile: { amount: 50000, currency: 'KRW' } });
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: { amount: 400, currency: 'JPY' } }), null);            // 통화 다름
  assert.equal(profilePromptFor({ option: { handle: 'a', pricing: opt.pricing }, type: 'post', cost: { amount: 1, currency: 'KRW' } }), null); // 명부 밖(id 없음)
  assert.deepEqual(profilePromptFor({ option: { id: 'i1', handle: 'a' }, type: 'rt', cost: { amount: 1000, currency: 'KRW' } }),
    { scenario: 'no-profile', profile: null });
  assert.equal(profilePromptFor({ option: { id: 'i1', handle: 'a', pricing: { currency: 'JPY' } }, type: 'rt', cost: { amount: 1000, currency: 'KRW' } }), null); // 단가 없음 + 프로필 통화 다름
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: null }), null);
});
```
(import 줄에 `profilePromptFor` 추가. `Pricing` 모양이 `{ post?: number; currency?: Currency }`인지 `influencerPricing.ts`로 확인.)

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/campaignFlowView.test.ts`
Expected: FAIL — `profilePromptFor` 없음

- [ ] **Step 3: 구현(순수)** — `costConfirmScenario` 아래:

```ts
// 비용을 확정한 뒤 "프로필에도 반영할까요?"를 물을지(설계 §8) — CostConfirmField.confirm()과 새 작업의 [만들기] 뒤가
// 같은 판정을 쓴다. 명부 밖(id 없음)·통화 불일치·같은 값이면 묻지 않는다.
export function profilePromptFor({ option, type, cost }: { option: InfluencerOption | undefined; type: TaskType; cost: TaskCost | null }):
  { scenario: 'differs' | 'no-profile'; profile: TaskCost | null } | null {
  if (!cost || !option?.id) return null;
  const profile = suggestTaskCost(option.pricing, type);
  const scenario = costConfirmScenario({ profile, entered: cost });
  if (scenario === 'differs') return { scenario, profile };
  if (scenario === 'no-profile') {
    if (option.pricing && normalizeCurrency(option.pricing) !== cost.currency) return null;
    return { scenario, profile: null };
  }
  return null;
}
```
(필요한 import: `suggestTaskCost` from './campaignCost.ts', `normalizeCurrency` from './influencerPricing.ts', `InfluencerOption` type from './draftTypes.ts' — 이미 있는지 확인.)

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/campaignFlowView.test.ts`
Expected: PASS

- [ ] **Step 5: `CostConfirmField` — 'draft' 모드**

- props에 `mode = 'confirm'`, `onDraftChange`, `error: externalError` 추가.
- `mode === 'draft'`이면: [확인] 버튼을 그리지 않고, 입력칸 테두리는 항상 실선(`border-x-border-strong`), Enter로 `confirm()`을 부르지 않는다, 상태 줄은 `entered === null && amount.trim() === '' ? (profile ? '' : '프로필에 단가 없음') : scenario === 'same' ? '프로필 단가' : scenario === 'differs' && profile ? \`프로필 ${formatAmount(profile.amount, profile.currency)}\` : ''` (§10 문구).
- 값이 바뀔 때마다 부모에 알린다 — 이펙트 동기 setState 금지 규칙을 피하려고 이펙트가 아니라 **핸들러와 초기값에서** 올린다:
  ```tsx
  const report = (a: string, c: Currency) => {
    if (mode !== 'draft' || !onDraftChange) return;
    if (a.trim() === '') { onDraftChange(null); return; }
    const n = parseAmount(a);
    onDraftChange(n === null ? 'invalid' : { amount: n, currency: c });
  };
  ```
  입력 `onChange`에서 `report(e.target.value, currency)`, 통화 `onChange`에서 `report(amount, next)`. 마운트 시 초기값(프로필 단가)도 올려야 하므로 `useEffect(() => { report(amount, currency); }, [])` — 이 이펙트는 부모 콜백 호출이지 자기 setState가 아니라 린트에 걸리지 않는다(걸리면 `// eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 초기값을 한 번 올린다`).
- 오류 줄: `{(err ?? externalError) && <p role="alert" className="mt-1 text-ui text-red-600">{err ?? externalError}</p>}` — 기존 `text-caption`도 `text-ui`로(밀도 규칙).
- `confirm()` 안의 시나리오 분기를 `profilePromptFor`로 바꿀 수 있는 부분은 바꾼다(같은 판정 하나) — 단 `note` 문구(명부 밖·통화 다름 사유)는 지금 그대로 유지.

- [ ] **Step 6: `TaskPanel` — 새 작업 비용 흐름**

- 상태: `newCost` → `const [newCost, setNewCost] = useState<TaskCost | null | 'invalid'>(null);` + `const [costErr, setCostErr] = useState<string | null>(null);`
- `renderNewField('cost')`:
  ```tsx
  const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
  // key에 옵션 도착 여부를 넣는다 — 인플 목록이 늦게 오면 빈 칸으로 마운트돼 프로필 단가가 안 채워지고,
  // '보이는 값 저장'이 비용 없이 저장된다(설계 §8). 목록이 오면 다시 마운트돼 채워진다.
  <CostConfirmField key={`${handle}:${opt ? 'o' : '-'}`} mode="draft" value={null} option={opt} type={newType as TaskType}
                    label={fieldLabel('cost', newType as TaskType)} error={costErr}
                    onDraftChange={(v) => { setNewCost(v); setCostErr(null); }}
                    onSave={async () => true} onSaveProfile={(o, c) => onSaveProfilePricing(o, c, newType as TaskType)}
                    disabledReason={handle ? undefined : '인플 선택 후'} />
  ```
- `isFormFieldsFilled`의 `newCost !== null`은 그대로 둔다('invalid'도 입력한 것).
- `commitNewHandle`의 `setNewCost(null)`은 그대로(새 사람 → 새 프로필 단가로 재마운트되며 다시 올라온다).
- `submitNew`:
  ```ts
  if (newCost === 'invalid') { setCostErr(AMOUNT_MESSAGE); return; }
  const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
  const prompt = profilePromptFor({ option: opt, type: newType, cost: newCost });
  const body = buildTaskCreateBody({ type: newType, handle: handle || null, cost: newCost, scheduledOn, visitOn, note, target, draftId: newDraft?.id ?? null });
  const result = await onCreate(body, more, prompt && opt ? { option: opt, cost: newCost as TaskCost, type: newType, ...prompt } : null);
  ```
  (`AMOUNT_MESSAGE` import from '@/lib/campaignCost'.)
- `onCreate` prop 타입: `(body: TaskCreateRequest, more: boolean, prompt: PricePrompt | null) => Promise<'ok' | 'draft-taken' | 'error'>`. `PricePrompt` 타입은 TaskPanel.tsx에서 export.

- [ ] **Step 7: `FlowDetail` — 만든 뒤 한 번 묻기**

```tsx
const [pricePrompt, setPricePrompt] = useState<PricePrompt | null>(null);
// createTask 시그니처에 prompt 추가, 성공('ok') 직후:
if (prompt) setPricePrompt(prompt);
```
렌더(다른 다이얼로그들 옆):
```tsx
{pricePrompt && (
  <PriceProfileDialog scenario={pricePrompt.scenario} handle={pricePrompt.option.handle} type={pricePrompt.type}
                      profile={pricePrompt.profile} entered={pricePrompt.cost}
                      onAnswer={(toProfile) => {
                        const p = pricePrompt; setPricePrompt(null);
                        if (toProfile) void saveProfilePricing(p.option, p.cost, p.type).then((ok) => { if (ok) show('프로필 단가도 바꿨어요'); });
                      }} />
)}
```
`overlayOpen` 식에 `|| !!pricePrompt` 추가. `PriceProfileDialog` import(`./PriceProfileDialog`).

- [ ] **Step 8: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/CostConfirmField.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx src/lib/campaignFlowView.ts ; node --import tsx --test src/lib/campaignFlowView.test.ts`
Expected: `tsc=0`, 세 파일에서 기준선 대비 새 문제 없음, PASS

- [ ] **Step 9: 커밋**

```bash
git add src/lib/campaignFlowView.ts src/lib/campaignFlowView.test.ts src/app/campaigns/flow/CostConfirmField.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(task-panel-ui): 새 작업은 보이는 금액을 함께 저장하고 만든 뒤 프로필 반영을 묻는다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 패널 골격 — 헤더·섹션 상자·단계·유형 칸·게시 칸 (§3·§4·§5·§8-4·§10)

**Files:**
- Create: `src/app/campaigns/flow/panel/PanelSection.tsx`
- Create: `src/app/campaigns/flow/panel/StageTypeBox.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` (본문·헤더·푸터 렌더 부분, 626행 이후)
- Modify: `src/app/campaigns/flow/FlowDetail.tsx:1024-1035` (게시 칸 미배정 문구)

**Interfaces:**
- Consumes: `STAGE_CHIP`, `TYPE_CHIP`, `FLOW_STEPS` (Task 1)
- Produces: `PanelSection({ title, aside, children })`, `StageTypeBox({ task })`

- [ ] **Step 1: 컴포넌트 두 개**

```tsx
// src/app/campaigns/flow/panel/PanelSection.tsx
import type { ReactNode } from 'react';

// 작업 패널의 칸 하나 = 흰 상자 하나(설계 §4, 시안 B). 기존 작업·새 작업이 같은 래퍼를 써야 한쪽만 모양이 어긋나지 않는다.
export function PanelSection({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-x-border bg-white px-4 py-3.5">
      {(title || aside) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h3 className="text-[14px] font-semibold text-x-secondary">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
```

```tsx
// src/app/campaigns/flow/panel/StageTypeBox.tsx
import { flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { STAGE_CHIP, TYPE_CHIP, FLOW_STEPS } from '@/lib/flowChips';
import type { FlowRow } from '@/lib/campaignFlowView';
import { PanelSection } from './PanelSection';

// 본문 첫 상자(설계 §5) — 단계는 흐름 줄(지금 단계만 검은 칩), 유형은 칩. 둘 다 읽기 전용이라 입력칸처럼 보이는 테두리·호버를 주지 않는다.
export function StageTypeBox({ task }: { task: FlowRow }) {
  const stage = flowStage(task, task.settlement);
  return (
    <PanelSection>
      <dl className="grid grid-cols-[76px_1fr] items-center gap-3">
        <dt className="text-[14px] font-semibold text-x-secondary">단계</dt>
        <dd>
          {stage === 'canc'
            ? <span className={`rounded-full px-2.5 py-1 text-[14px] ${STAGE_CHIP.canc}`}>{FLOW_STAGE_LABEL.canc}</span>
            : (
              <ol className="flex flex-wrap items-center gap-1 text-[14px]" aria-label="진행 단계">
                {FLOW_STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-[12px] text-x-border-strong">›</span>}
                    <span aria-current={s === stage ? 'step' : undefined}
                          className={`rounded-full border px-2.5 py-1 ${s === stage ? 'border-x-text bg-x-text font-semibold text-white' : 'border-x-border bg-x-surface text-x-muted'}`}>
                      {FLOW_STAGE_LABEL[s]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
        </dd>
        <dt className="text-[14px] font-semibold text-x-secondary">유형</dt>
        <dd><span className={`rounded-full px-2.5 py-1 text-[14px] font-medium ${TYPE_CHIP[task.type]}`}>{TASK_TYPE_LABEL[task.type]}</span></dd>
      </dl>
    </PanelSection>
  );
}
```

- [ ] **Step 2: `TaskPanel` 조립**

- 헤더(630~654행): 편집 모드 윗줄 `crumb`(`<p className="text-ui text-x-secondary">{crumb}</p>`)를 지운다 — 원고 모드의 `← 작업으로` 분기는 그대로. `crumb` 상수도 삭제(다른 곳에서 안 쓰면). 제목은 그대로(`@핸들` / `인플루언서 미정` / `새 투고 작업`).
- 본문 컨테이너(656행) `className="flex-1 space-y-5 overflow-y-auto px-6 py-4"` → `"flex-1 space-y-2.5 overflow-y-auto bg-x-surface px-4 py-4"`.
- 편집 모드: 취소 띠(`task.cancelledAt` 안내)를 지금처럼 맨 위에 두되 문구 유지. 그 아래 `<StageTypeBox task={task} />`. 칸 루프를
  ```tsx
  {PANEL_FIELD_ORDER[task.type].map((field) => (
    <PanelSection key={field} title={fieldLabel(field, task.type)}>{renderEditField(field, task)}</PanelSection>
  ))}
  {slots.posted && <PanelSection title="게시">{slots.posted}</PanelSection>}
  ```
- 새 작업 모드: 유형 칸 전체(`<div><p>유형</p>…</div>`)를 `<PanelSection title="유형">…</PanelSection>`로 감싸고, 잠김 도움말 `원고를 떼면 바꿀 수 있어요` → `<span title="원고를 떼면 바꿀 수 있어요" aria-label="원고를 떼면 바꿀 수 있어요" className="text-ui text-x-muted">🔒 ⓘ</span>`(§10). 칸 루프도 `PanelSection`으로.
- `fieldLabel('cost')`는 Task 10에서 `비용 · 정산`/`예산 · 정산`으로 바꾼다(여기선 그대로).
- 푸터(새 작업): `<p className="text-ui text-x-muted">{newType ? '비어 있는 칸은 나중에 채워도 돼요' : '유형을 먼저 골라요'}</p>` 삭제(§10). 버튼은 그대로(`disabled={!newType || busy}`).
- 방문일 라벨(`renderEditField` 'dates'): `방문일 — 지나면 인플루언서를 바꿀 수 없어요` → `방문일` + 뒤에 `<span title="방문일이 지나면 인플루언서를 바꿀 수 없어요" className="cursor-help text-x-muted">ⓘ</span>`. 라벨들의 `text-caption` → `text-ui`.
- 이 파일 안의 다른 `text-caption` 도움말도 `text-ui`로(밀도 규칙).

- [ ] **Step 3: 게시 칸 문구(FlowDetail 1024~1035행)** — 미배정일 때 `title="인플루언서를 먼저 정해요"`는 그대로 두고 아래 `<p>인플루언서를 먼저 정해요</p>`를 `<p className="mt-1 text-ui text-x-muted">인플 선택 후</p>`로(§10). 나머지(게시 후 값·증빙·내림)는 그대로.

- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/panel/`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/flow/panel/PanelSection.tsx src/app/campaigns/flow/panel/StageTypeBox.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(task-panel-ui): 패널을 칸별 상자로, 단계 흐름 줄·유형 칩을 첫 칸에

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 인플루언서 칸 — 사진·이름·핸들 (§6)

**Files:**
- Create: `src/app/campaigns/flow/panel/InfluencerSummary.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` (`renderEditField('influencer')`, `renderNewField('influencer')`)

**Interfaces:**
- Consumes: `Avatar` (Task 2), `InfluencerOption.avatarUrl`
- Produces: `InfluencerSummary({ handle, option, muted?, actions? })`

- [ ] **Step 1: 컴포넌트**

```tsx
// src/app/campaigns/flow/panel/InfluencerSummary.tsx
import type { ReactNode } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { Avatar } from '@/components/Avatar';

// 배정된 인플 한 줄(설계 §6) — 사진 36px + 표시 이름 / @핸들. 이름이 없으면 @핸들 한 줄. 명부 밖이면 option이 없어 이니셜 원.
export function InfluencerSummary({ handle, option, muted = false, actions }: {
  handle: string; option: InfluencerOption | undefined; muted?: boolean; actions?: ReactNode;
}) {
  const name = option?.name?.trim();
  return (
    <div className={`flex items-center gap-3 ${muted ? 'opacity-60' : ''}`}>
      <Avatar url={option?.avatarUrl} name={name || handle} size={36} />
      <div className="min-w-0">
        {name
          ? <><p className="truncate text-content font-semibold">{name}</p><p className="truncate text-ui text-x-secondary">@{handle}</p></>
          : <p className="truncate text-content font-semibold">@{handle}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 편집 모드에 적용** — `renderEditField('influencer')`에서 `optionFor`에 해당하는 조회를 이 파일에 둔다: `const optionOf = (h: string | null) => h ? influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase()) : undefined;`
  - 취소됨: `t.influencerHandle ? <InfluencerSummary handle={t.influencerHandle} option={optionOf(t.influencerHandle)} muted /> : <span className="text-content text-x-muted">미정</span>`
  - 게시됨(`t.postedAt`): `<InfluencerSummary handle={…} option={…} />`(버튼 없음, 지금과 같음)
  - 배정됨: `<InfluencerSummary … actions={<>{바꾸기 버튼}{해제 버튼}</>} />` — 두 버튼 JSX·`disabledReason` 판정·title은 지금 코드 그대로 옮긴다. 비활성 이유 한 줄(`{disabledReason && <p …>}`)도 유지하되 `text-caption` → `text-ui`.
  - 미배정 입력(`InfluencerField`)과 게시된 미배정 안내 문구는 그대로(2단계에서 바뀐다). 안내 문구 `text-caption` → `text-ui`.
- [ ] **Step 3: 새 작업에 적용** — `renderNewField('influencer')`의 잠김 분기(`newDraft`가 있을 때):
  ```tsx
  <div className="flex items-center gap-2">
    {handle ? <InfluencerSummary handle={handle} option={optionOf(handle)} muted /> : <span className="text-content text-x-muted">미정</span>}
    <span title="원고를 떼면 바꿀 수 있어요" aria-label="원고를 떼면 바꿀 수 있어요" className="cursor-help text-ui text-x-muted">🔒 ⓘ</span>
  </div>
  ```
  배정 직후(`handle`이 있고 잠김 아님)에도 입력칸 대신 요약을 보여준다: `handle ? <InfluencerSummary handle={handle} option={optionOf(handle)} actions={<button type="button" onClick={() => commitNewHandle('')} className="text-ui text-x-secondary hover:underline">바꾸기</button>} /> : <InfluencerField …/>` — `바꾸기`는 핸들을 비워 입력칸으로 되돌린다(서버 호출 없음).
- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/panel/InfluencerSummary.tsx`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/flow/panel/InfluencerSummary.tsx src/app/campaigns/flow/TaskPanel.tsx
git commit -m "feat(task-panel-ui): 인플루언서 칸에 프로필 사진·이름·핸들

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 비용 · 정산 칸 — 결제 수단·수수료 한 줄 (§8·§8-1)

**Files:**
- Create: `src/app/campaigns/flow/panel/PaymentLine.tsx`
- Create: `src/app/campaigns/flow/panel/usePaymentView.ts`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` (`fieldLabel('cost')`, 'cost' 칸 두 모드)

**Interfaces:**
- Consumes: `GET /api/influencers/payment-view` → `PaymentView` (Task 4)
- Produces: `usePaymentView(handle: string | null, taskId: string | null, refreshKey: string): { view: PaymentView | null; loading: boolean; failed: boolean }`, `PaymentLine({ handle, view, loading, failed })`

- [ ] **Step 1: 훅** — 이펙트 본문에서 동기 setState 금지 규칙에 맞춰, 초기 상태를 `useState` 초기값으로 주고 `await` 뒤에서만 setState:

```ts
// src/app/campaigns/flow/panel/usePaymentView.ts
'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { PaymentView } from '@/lib/paymentView';

// 패널이 열린 작업의 결제 수단 한 줄(설계 §8-1). 같은 (핸들, 작업, refreshKey)는 모듈 캐시로 한 번만 부른다 —
// 이전/다음으로 오가며 같은 인플을 다시 볼 때 매번 부르지 않게. refreshKey는 정산 요청 상태가 바뀌면 달라진다.
const cache = new Map<string, PaymentView>();

export function usePaymentView(handle: string | null, taskId: string | null, refreshKey: string) {
  const key = handle ? `${handle.toLowerCase()}|${taskId ?? ''}|${refreshKey}` : '';
  const [state, setState] = useState<{ key: string; view: PaymentView | null; failed: boolean }>(
    () => ({ key, view: key ? cache.get(key) ?? null : null, failed: false }));
  useEffect(() => {
    if (!key || cache.has(key)) return;
    let alive = true;
    (async () => {
      const qs = new URLSearchParams({ handle: handle as string, ...(taskId ? { taskId } : {}) });
      const r = await apiFetch(`/api/influencers/payment-view?${qs}`).catch(() => null);
      const v = r && r.ok ? ((await r.json()) as PaymentView) : null;
      if (v) cache.set(key, v);
      if (alive) setState({ key, view: v, failed: !v });
    })();
    return () => { alive = false; };
  }, [key, handle, taskId]);
  const current = state.key === key ? state : { key, view: key ? cache.get(key) ?? null : null, failed: false };
  return { view: current.view, loading: !!key && !current.view && !current.failed, failed: current.failed };
}
```

- [ ] **Step 2: 한 줄 컴포넌트**

```tsx
// src/app/campaigns/flow/panel/PaymentLine.tsx
import type { PaymentView } from '@/lib/paymentView';

// '결제 수단' 한 줄(설계 §8-1·§10) — 평소엔 수단 + 수수료 칩만. 막힘·주의만 짧게. CB 부담은 비용이 늘어나는 쪽이라 주황.
export function PaymentLine({ view, loading, failed }: { view: PaymentView | null; loading: boolean; failed: boolean }) {
  if (loading) return <p className="text-content text-x-muted">불러오는 중…</p>;
  if (failed || !view) return <p className="text-content text-x-muted">결제 수단을 불러오지 못했어요</p>;
  switch (view.state) {
    case 'notInRoster': return <p className="text-content text-x-muted">명부에 등록하면 보여요</p>;
    case 'none': return <p className="text-content text-amber-700">결제 수단 없음</p>;
    case 'ok':
    case 'requested':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {view.state === 'requested' && (
            <span title="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" className="cursor-help text-ui text-x-secondary">🔒 정산 요청됨 ⓘ</span>
          )}
          <span className="min-w-0 truncate text-content" title={view.label}>{view.label}</span>
          <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui ${view.fee.cb ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-x-border bg-x-surface text-x-secondary'}`}>
            {view.fee.text}
          </span>
        </div>
      );
  }
}
```

- [ ] **Step 3: 'cost' 칸 조립(TaskPanel)**

- `fieldLabel('cost')` → `type === 'visit' ? '예산 · 정산' : '비용 · 정산'`. (FlowDetail이 `CostConfirmField`에 주는 접근성 `label`은 '예산'/'비용' 그대로.)
- 편집 모드 `renderEditField('cost')`:
  ```tsx
  const pay = usePaymentView(...)   // ← 훅은 렌더 함수 안에서 못 부른다: TaskPanel 본문 최상단에서
  ```
  TaskPanel 컴포넌트 본문(상태 선언부 근처)에 한 번:
  ```ts
  const payHandle = task ? task.influencerHandle : (handle || null);
  const payRefresh = task ? `${task.settlement?.status ?? ''}:${task.settlement?.externalStatus ?? ''}:${task.updatedAt}` : '';
  const pay = usePaymentView(payHandle, task?.id ?? null, payRefresh);
  ```
  'cost' 칸 본문(두 모드 공통 모양):
  ```tsx
  <div>
    <p className="mb-1.5 text-ui font-semibold text-x-secondary">금액</p>
    {/* 편집: 취소가 아니면 slots.cost, 취소면 지금의 costCell 표시 / 새 작업: Task 7의 CostConfirmField */}
    <p className="mb-1.5 mt-3.5 text-ui font-semibold text-x-secondary">결제 수단 <span className="font-normal text-x-muted">· 이 작업에만 적용</span></p>
    {payHandle ? <PaymentLine {...pay} /> : <p className="text-content text-x-muted">인플 선택 후</p>}
  </div>
  ```
  `· 이 작업에만 적용`은 2단계(선택 기능)가 들어가야 참이 되는 말이다 — **1단계에서는 빼고** 소제목을 `결제 수단`만 둔다(라벨-값 일치, UX 원칙 4). 2단계 계획에서 붙인다.
  미배정일 때 금액 칸의 `disabledReason`도 `인플 선택 후`(FlowDetail 974행 `'인플을 정하면 프로필 단가로 채워요'` → `'인플 선택 후'`)로 — §10 "비용·정산 상자에 한 번만": 금액 쪽은 비활성 입력만 보이고 문구는 결제 수단 줄 하나에만 남긴다. 즉 FlowDetail의 `disabledReason`을 빈 문자열이 아니라 **`CostConfirmField`에 문구 없는 비활성**을 주려면 `disabledReason`이 문구를 그리지 않는 경로가 필요하다 → `CostConfirmField`의 disabled 분기에서 `disabledReason === ''`이면 `<p>`를 그리지 않게 한 줄 조건 추가(`{disabledReason && <p …>}`), FlowDetail·TaskPanel은 `disabledReason={handle ? undefined : ''}`. `if (disabledReason)` 판정은 `disabledReason !== undefined`로 바꾼다.

- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/flow/panel/PaymentLine.tsx src/app/campaigns/flow/panel/usePaymentView.ts src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/CostConfirmField.tsx
git commit -m "feat(task-panel-ui): 비용 · 정산 칸에 결제 수단과 수수료 부담

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 원고 칸 — 카드·버튼 세 개·인용 미리보기, 대상 칸 카드 (§7·§7-1)

**Files:**
- Create: `src/lib/targetPreviewView.ts`, `src/lib/targetPreviewView.test.ts`
- Create: `src/app/campaigns/flow/panel/useTweetPreview.ts`
- Create: `src/app/campaigns/flow/panel/DraftSummaryCard.tsx`
- Create: `src/app/campaigns/flow/panel/DraftEntryButtons.tsx`
- Create: `src/app/campaigns/flow/panel/TargetPreview.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` ('draft'·'target' 칸 두 모드)

**Interfaces:**
- Consumes: `TaskRow.draftPreview/draftFirstImage` (Task 3), `GET /api/tweets/by-link` (Task 5), `quotedFromTweet` (Task 5), `QuotedCard` 옵션 (Task 6), `InfluencerOption.avatarUrl` (Task 2)
- Produces:
  - `targetPreviewState(t: { targetTaskId: string | null; targetTweetUrl: string | null; target: TaskRow['target'] }): { kind: 'none' } | { kind: 'pending' } | { kind: 'cancelled' } | { kind: 'link'; url: string }`
  - `useTweetPreview(url: string | null): { preview: TweetPreview | null; loading: boolean; failed: boolean }`
  - `DraftSummaryCard({ title, status, preview, image, quote?, author?, onOpen, onDetach })`
  - `DraftEntryButtons({ pickCount, onPick })`
  - `TargetPreview({ state, preview, loading, failed, compact })`

- [ ] **Step 1: 실패하는 테스트(대상 상태 판정)**

```ts
// src/lib/targetPreviewView.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetPreviewState } from './targetPreviewView.ts';

const tg = (p: Partial<NonNullable<Parameters<typeof targetPreviewState>[0]['target']>>) => ({
  taskId: 'x', type: 'post' as const, influencerHandle: 'c', campaignId: 'c1', campaignName: '캠', postUrl: null, postedAt: null, cancelledAt: null, ...p,
});

test('대상 상태 — 미정 / 게시 전 / 링크 없는 게시 확인 / 취소 / 링크', () => {
  assert.deepEqual(targetPreviewState({ targetTaskId: null, targetTweetUrl: null, target: null }), { kind: 'none' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({}) }), { kind: 'pending' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ postedAt: '2026-09-20' }) }), { kind: 'pending' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ cancelledAt: '2026-09-20' }) }), { kind: 'cancelled' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ postUrl: 'https://x.com/c/status/1' }) }), { kind: 'link', url: 'https://x.com/c/status/1' });
  assert.deepEqual(targetPreviewState({ targetTaskId: null, targetTweetUrl: 'https://x.com/d/status/2', target: null }), { kind: 'link', url: 'https://x.com/d/status/2' });
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/targetPreviewView.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현(순수)**

```ts
// src/lib/targetPreviewView.ts
// 인용·RT 대상 미리보기의 상태(설계 §7-1) — 판정은 campaignJudgment.targetStatus/targetUrlOf와 같은 규칙:
// 대상 작업은 postUrl이 있어야 보인다(게시 확인만 되고 링크가 없으면 아직 '게시 전'과 같다, campaignTaskStore:36).
import { targetStatus, targetUrlOf } from './campaignJudgment.ts';
import type { TaskRow } from './campaignTaskStore.ts';

export type TargetPreviewState = { kind: 'none' } | { kind: 'pending' } | { kind: 'cancelled' } | { kind: 'link'; url: string };

export function targetPreviewState(t: Pick<TaskRow, 'targetTaskId' | 'targetTweetUrl' | 'target'>): TargetPreviewState {
  const input = { targetTaskId: t.targetTaskId, targetTweetUrl: t.targetTweetUrl, targetPostUrl: t.target?.postUrl ?? null };
  const s = targetStatus({ ...input, targetCancelledAt: t.target?.cancelledAt ?? null });
  if (s === 'none') return { kind: 'none' };
  if (s === 'cancelled') return { kind: 'cancelled' };
  if (s === 'pending') return { kind: 'pending' };
  const url = targetUrlOf(input);
  return url ? { kind: 'link', url } : { kind: 'none' };
}
```
`TargetInput`의 실제 필드명은 `campaignJudgment.ts:180` 근처 정의로 확인해 맞춘다.

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/targetPreviewView.test.ts` → PASS

- [ ] **Step 5: 훅(게시물 미리보기)** — Task 10의 `usePaymentView`와 같은 모양(모듈 캐시, 초기값 useState, await 뒤 setState). 키는 url, 호출은 `apiFetch(\`/api/tweets/by-link?url=${encodeURIComponent(url)}\`)`, 결과 타입 `TweetPreview`. `unavailable`·`repost`·`badLink`도 캐시에 넣는다(삭제·비공개 게시물을 세션 동안 다시 부르지 않게, 설계 §7-1). 파일: `src/app/campaigns/flow/panel/useTweetPreview.ts`.

- [ ] **Step 6: 화면 조각 세 개**

```tsx
// src/app/campaigns/flow/panel/DraftEntryButtons.tsx
import type { DraftTab } from '../draft/DraftMode';

// 원고가 비어 있을 때 세 입구(설계 §7·§10) — 글자 링크 대신 버튼 셋, AI로 만들기만 강조. 보조 글·도움말 없음.
export function DraftEntryButtons({ pickCount, onPick }: { pickCount: number | null; onPick: (tab: DraftTab) => void }) {
  const base = 'rounded-lg border px-2 py-2.5 text-content transition-colors';
  return (
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => onPick('generate')} className={`${base} border-x-blue bg-[#f0f8fe] font-semibold text-x-blue-text hover:bg-[#e3f2fd]`}>AI로 만들기</button>
      <button type="button" onClick={() => onPick('write')} className={`${base} border-x-border-strong hover:bg-x-hover`}>직접 쓰기</button>
      <button type="button" onClick={() => onPick('pick')} className={`${base} border-x-border-strong hover:bg-x-hover`}>
        있는 원고{pickCount !== null ? ` ${pickCount}` : ''}
      </button>
    </div>
  );
}
```

```tsx
// src/app/campaigns/flow/panel/DraftSummaryCard.tsx
'use client';
import type { ReactNode } from 'react';
import { useSignedMedia } from '@/components/useSignedMedia';
import { Avatar } from '@/components/Avatar';

// 붙은 원고 카드(설계 §7·§7-1). quote가 있으면(인용RT) X 게시 미리보기 모양 — 작성자 줄 → 본문 2줄 → 인용 카드.
// 첫 이미지는 원고 이미지면 비공개 버킷 경로라 useSignedMedia로 서명 URL을 받는다(DraftCard와 같은 방식).
export function DraftSummaryCard({ title, status, preview, image, quote, author, onOpen, onDetach, detachLabel = '떼기' }: {
  title: string; status: string | null; preview: string | null; image: string | null;
  quote?: ReactNode; author?: { name: string; handle: string; avatarUrl?: string };
  onOpen: () => void; onDetach: () => void; detachLabel?: string;
}) {
  const { posts, resign } = useSignedMedia(image ? [{ text: '', media: [{ type: 'photo', url: image, videoUrl: null }] }] : []);
  const shown = posts[0]?.media[0]?.url ?? null;
  const body = preview ? <p className={`${quote ? 'text-content' : 'text-ui text-x-secondary'} mt-1 line-clamp-2 whitespace-pre-line`}>{preview}</p> : null;
  return (
    <div className="flex gap-3 rounded-lg border border-x-border-strong px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-content font-semibold">
          <span className="min-w-0 truncate" title={title}>{title}</span>
          {status && <span className="shrink-0 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-ui font-medium text-[#1d4ed8]">{status}</span>}
        </p>
        {quote && author ? (
          <div className="mt-2.5 flex gap-2.5">
            <Avatar url={author.avatarUrl} name={author.name} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ui"><b className="text-x-text">{author.name}</b> <span className="text-x-secondary">@{author.handle}</span></p>
              {body}
              <div className="mt-2">{quote}</div>
            </div>
          </div>
        ) : body}
        <p className="mt-2 flex gap-4 text-ui">
          <button type="button" onClick={onOpen} className="text-x-blue-text hover:underline">열기</button>
          <button type="button" onClick={onDetach} className="text-x-secondary hover:underline">{detachLabel}</button>
        </p>
      </div>
      {shown && !quote && (
        // eslint-disable-next-line @next/next/no-img-element -- 서명 URL
        <img src={shown} alt="" onError={() => image && resign(image)} className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover" />
      )}
    </div>
  );
}
```
`useSignedMedia`는 인자 배열 참조가 바뀌면 다시 계산한다 — 렌더마다 새 배열을 만들지 않도록 `useMemo(() => image ? [...] : [], [image])`로 감싼다(훅 주석 참고). `DeckMedia.type` 값('photo')은 `draftMedia.ts`가 쓰는 값으로 맞춘다.

```tsx
// src/app/campaigns/flow/panel/TargetPreview.tsx
import { QuotedCard } from '@/components/QuotedCard';
import { quotedFromTweet, type TweetPreview } from '@/lib/tweetPreview';
import type { TargetPreviewState } from '@/lib/targetPreviewView';

// 대상 게시물 카드(설계 §7-1) — lines: 원고 카드 안(인용 미리보기)은 2줄, 대상 칸 단독은 3줄 + 첫 이미지.
export function TargetPreview({ state, preview, loading, failed, lines }: {
  state: TargetPreviewState; preview: TweetPreview | null; loading: boolean; failed: boolean; lines: 2 | 3;
}) {
  const box = 'rounded-2xl border border-dashed border-x-border-strong px-3.5 py-3 text-center text-ui text-x-secondary';
  if (state.kind === 'none') return null;
  if (state.kind === 'pending') return <div className={box}>게시되면 여기에 보여요</div>;
  if (state.kind === 'cancelled') return <div className={box}>대상 작업이 취소됐어요</div>;
  if (loading) return <div className={box}>게시물 불러오는 중…</div>;
  if (failed || !preview || preview.kind !== 'ok') {
    const msg = preview?.kind === 'repost' ? '리포스트 링크예요 — 원본 게시물 링크로 바꿔 주세요' : '게시물을 불러올 수 없어요';
    return (
      <div className={box}>
        {msg}<br />
        <a href={state.url} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">{state.url.replace(/^https?:\/\//, '')} ↗</a>
      </div>
    );
  }
  return <QuotedCard quoted={quotedFromTweet(preview.tweet)} lines={lines} firstImageOnly={lines === 3} flush />;
}
```
(원고 카드 안(2줄)은 이미지 없이 — 마지막 줄을 `<QuotedCard … lines={lines} firstImageOnly={lines === 3} hideMedia={lines === 2} flush />`로.)

- [ ] **Step 7: TaskPanel 조립 — 'draft' 칸**

TaskPanel 본문 최상단(훅 자리)에서:
```ts
const tState = task ? targetPreviewState(task) : (target && 'url' in target ? { kind: 'link' as const, url: target.url } : target && 'taskId' in target ? (target.postUrl ? { kind: 'link' as const, url: target.postUrl } : { kind: 'pending' as const }) : { kind: 'none' as const });
const tUrl = tState.kind === 'link' ? tState.url : null;
const tPrev = useTweetPreview(tUrl);
const isQuote = (task?.type ?? newType) === 'quoteRt';
const authorHandle = task ? task.influencerHandle : (handle || null);
const authorOpt = authorHandle ? influencerOptions.find((o) => o.handle.toLowerCase() === authorHandle.toLowerCase()) : undefined;
const quoteNode = isQuote && tState.kind !== 'none' ? <TargetPreview state={tState} {...tPrev} lines={2} /> : undefined;
const author = authorHandle ? { name: authorOpt?.name?.trim() || `@${authorHandle}`, handle: authorHandle, avatarUrl: authorOpt?.avatarUrl } : undefined;
```
(`TargetValue`의 url/taskId 모양·`postUrl` 필드는 `TargetPicker.tsx`의 `TargetValue` 정의로 확인.)

편집 모드 'draft'(붙어 있음):
```tsx
<DraftSummaryCard title={t.draftLabel ?? '(제목 없음)'} status={t.draftStatus ? STATUS_LABEL[t.draftStatus] : null}
                  preview={t.draftPreview} image={t.draftFirstImage} quote={quoteNode} author={author}
                  onOpen={() => setDraftMode('draft')} onDetach={() => onDetachDraft(t)} />
```
편집 모드 'draft'(비어 있음): `<DraftEntryButtons pickCount={pickCount} onPick={(tab) => { setDraftTab(tab); setDraftMode('draft'); }} />` — 도움말 `인플루언서가 직접 쓰면 비워 둬요` 삭제(§10).
새 작업 'draft'(골랐음): `draftLabel(newDraft).text`, `STATUS_LABEL[newDraft.status]`, preview = `(newDraft.edited ?? newDraft.content).posts[0]?.text ?? null`, image = `(newDraft.edited ?? newDraft.content).posts[0]?.media[0]?.url ?? null`, `detachLabel="떼기"`, `onDetach={detachNewDraft}` — 도움말 `만들기를 누르면 이 원고가 함께 붙어요`는 §10에 따라 삭제하지 않고 유지한다(표에 없는 문구 — 행동 결과를 알려주는 유일한 줄). **이 판단은 리뷰 때 koo 확인 항목에 올린다.**
새 작업 'draft'(비어 있음): `DraftEntryButtons` + 409 경고(`draftGone`)는 지금 JSX 그대로(자리·톤 유지), 중립 도움말만 삭제.
취소된 작업: 지금 텍스트 그대로.

- [ ] **Step 8: TaskPanel 조립 — 'target' 칸**

- 편집 모드(취소 아님): 원고가 붙은 인용RT면(`isQuote && t.draftId`) 지금의 `slots.target`(`TargetLinkField` — 링크 한 줄 + 바꾸기)만. 그 밖(RT, 원고 없는 인용RT)은 `slots.target` 아래에 `<div className="mt-2.5"><TargetPreview state={tState} {...tPrev} lines={3} /></div>`.
- 새 작업: `TargetPicker` 아래에 같은 규칙(`isQuote && newDraft`면 카드 없음).
- 대상이 다른 캠페인 작업이면 `TargetLinkField`가 이미 캠페인 이름(`targetLabel` sub)을 보여주는지 확인하고, 안 보여주면 한 줄 추가하지 말고 koo 확인 항목으로(기존 컴포넌트 동작 변경).

- [ ] **Step 9: 확인**

Run: `node --import tsx --test src/lib/targetPreviewView.test.ts && npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/ src/components/QuotedCard.tsx`
Expected: PASS, `tsc=0`, 새 문제 없음

- [ ] **Step 10: 커밋**

```bash
git add src/lib/targetPreviewView.ts src/lib/targetPreviewView.test.ts src/app/campaigns/flow/panel/useTweetPreview.ts src/app/campaigns/flow/panel/DraftSummaryCard.tsx src/app/campaigns/flow/panel/DraftEntryButtons.tsx src/app/campaigns/flow/panel/TargetPreview.tsx src/app/campaigns/flow/TaskPanel.tsx src/components/QuotedCard.tsx
git commit -m "feat(task-panel-ui): 원고 카드·입구 버튼, 인용 미리보기와 대상 카드

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: 1단계 검증과 확인 준비

**Files:**
- Modify: `src/content/updates.ts` (맨 위에 한 건 — 날짜는 머지 예정일, 머지 직전에 다시 확인)

- [ ] **Step 1: 전체 검증**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npm run lint 2>&1 | tail -2`
Expected: `tsc=0`, 린트 개수 = Task 0 기준선

Run: `npm test` (약 17분, 출력이 늦게 나온다 — 파이프로 자르지 말 것)
Expected: 실패 0

Run: `npm run build`
Expected: 성공(빌드 첫 단계의 마이그레이션은 새 파일이 없어 변화 없음)

- [ ] **Step 2: 업데이트 글 초안** — `src/content/updates.ts` 맨 위(파일의 기존 항목 모양을 그대로 따른다):
  - 유형 `개선`, 제목 `작업 패널이 한눈에 들어오게 바뀌었어요`
  - 불릿: 칸마다 상자로 나뉘고 단계는 흐름 줄로 보여요 / 인플루언서가 사진·이름과 함께 보여요 / 원고가 카드로 보이고, 인용RT는 인용된 게시물까지 실제 모습으로 미리 봐요 / 비용 칸에서 결제 수단과 수수료를 누가 내는지 바로 보여요 / **바뀐 방식:** 새 작업에서 비용 칸에 보이는 금액이 [만들기]를 누르면 그대로 저장돼요(예전엔 [확인]을 따로 눌러야 했어요). 프로필 단가와 다르면 만든 뒤 프로필에도 반영할지 물어봐요
  - `link`: `{ href: '/campaigns/flow', label: '캠페인에서 보기' }` — 실제 경로와 label 필드명은 기존 항목을 보고 맞춘다
  Run: `node --import tsx --test src/lib/updates.test.ts` → PASS

- [ ] **Step 3: 커밋**

```bash
git add src/content/updates.ts
git commit -m "docs(task-panel-ui): 업데이트 소식 — 작업 패널 1단계

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: koo 화면 확인 넘기기** — 프리뷰 배포(`npx vercel@58.9.1 --yes --scope clinic-bridge`, `--prod` 없이; 배포 전 `.vercel/project.json`이 `cb-x-deck`인지 확인). 프리뷰 URL 로그인이 막히면(Supabase OAuth 허용 목록) `npm run build && npx next start -p 3001` + `http://127.0.0.1:3001`. 확인 목록: ① 투고·인용RT·RT·방문협찬 각 1건 편집 ② 새 작업(프로필 단가 있는 인플로 [확인] 없이 만들기 → 비용 저장·다른 금액이면 만든 뒤 질문) ③ 수단 없음/CB 부담 인플 ④ 취소된 작업 ⑤ 인용RT 원고+대상 미리보기, 대상 게시 전 ⑥ 원고 썸네일 ⑦ 1단계에서 남긴 판단 두 가지(새 작업 원고 도움말 유지, 다른 캠페인 대상 표시).

---

## 기준선

- 린트: (Task 0에서 기록)
