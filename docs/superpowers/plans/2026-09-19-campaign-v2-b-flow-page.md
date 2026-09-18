# 캠페인 v2 — B 새 페이지 `/campaigns/flow` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인 하나의 작업 전체를 **한 화면**(표 하나 + 오른쪽 편집 패널)에서 만들고·채우고·게시 확인·취소·교체까지 처리하는 새 페이지 "캠페인 v2"를 기존 캠페인 페이지와 병존시킨다(ADR 0003). 원고 모드(§5)는 C 계획 — 이 계획의 패널 원고 칸은 **기존 입구**(새로 만들기 = `/generate` 링크 · 고르기 = `AttachDraftModal` · 열기 = `DraftCard` 오버레이)를 그대로 쓴다.

**Architecture:** 서버는 A 계획이 깐 것(취소·되돌리기·교체 라우트, `flowStage`, R17 모집단)을 그대로 쓰고 **읽기 필드 3개**(원고 첫 줄·북마크·인플 id)와 **라우트 2개**(성과 갱신, 작업 N개 뼈대)만 더한다. 화면 로직은 순수 함수 모듈 `campaignFlowView.ts`(필터·검색·정렬·날짜 문구·카드 숫자)에 두고 테스트로 못 박는다. 컴포넌트는 `src/app/campaigns/flow/` 아래 새로 만들되 칸 편집기(`InfluencerChip`·`CostPopover`·`ScheduledOnField`·`PostedCell`·`TargetPicker`)와 낙관적 갱신 훅(`useCampaignTaskActions`)은 기존 것을 재사용한다(R12).

**Tech Stack:** Next.js App Router(`'use client'` 컴포넌트, `src/app/api/**/route.ts`), React 19, Tailwind(X 팔레트 토큰), postgres.js, `node --test`(연습용 DB — `npm test`는 `.env.staging`, 단일 파일은 `node --import tsx --env-file-if-exists=.env.staging --test <file>`).

**입력 문서:** `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` §3(화면)·§4(패널)·§6(취소·교체)·§8, `docs/adr/0003~0006`, `CONTEXT.md`. 시안: `~/claude-outputs/20260915_캠페인v2_시안.html` 변형 F(참고용, 원본은 결정 문서).

## Global Constraints

- **R17 모집단**: 집계에서 빼는 건 취소만. 화면의 모든 숫자는 `isTaskExcluded`(= `cancelledAt !== null`)로 걸러 센다. 새 집계 코드에서 `draftStatus === 'unused'`를 제외 조건으로 쓰지 않는다.
- **6단계는 `flowStage(t, t.settlement)`**(`campaignJudgment.ts`) 하나로만 판정한다. 컴포넌트가 단계를 따로 계산하지 않는다. 라벨 `FLOW_STAGE_LABEL` = 준비·전달·게시·정산·완료·취소.
- **표(R26·R27)**: 열 6개 고정 순서 `단계 · 유형 · 인플루언서 · 원고 · 게시 예정일 · 작업 비용` + `···`. 행 한 줄(`whitespace-nowrap`, 원고 칸만 `truncate`). 굵은 글씨 없음(`font-bold`·`font-medium` 금지, 헤더 포함). 빈 값은 글자 **`미정`**(버튼·안내 문장 아님). 인플 핸들은 링크 아님. 날짜 색만으로 구분: 지남 `text-red-600` `M/D 요일 · D+N` / 예정 기본색 / 게시일 `text-x-blue-text`(게시된 작업은 예정일 대신 **게시일**). 행 배경·막대·오늘 강조·'게시' 문구·증빙 표시 없음. 기본 정렬 만든 순(`createdAt`), 헤더 클릭 오름 → 내림 → 기본, 미정은 오름차순에서 맨 뒤. 취소 행은 `opacity-60` + 비용 `line-through`.
- **필터·검색(R26)**: 드롭다운 하나(버튼 `필터 ▾`, 켠 개수 배지) 안에 세 묶음 — 단계 6 / 유형 4 / 지금 볼 것 3(지연·오늘 게시 예정·예정일 미정). 묶음 안 OR, 묶음 사이 AND. 검색 한 칸(placeholder `인플루언서 · 원고 검색`) = 인플 핸들(@ 유무 무관) + 원고 제목 + 원고 첫 줄 + 취소 스냅샷 제목. 요약 줄 `전체 N건 · 만든 순` / 필터 켜면 `<라벨들> N건 [지우기]`.
- **카드 3장(R28, §3-3)**: 제목 한 단어(작업·성과·비용) · 큰 숫자 하나(성과는 셋) · 라벨은 숫자 아래 13px · 주석은 `title` 툴팁 · 기호는 `/` 하나. 비율 `grid-cols-[0.9fr_1.1fr_1.4fr]`. 숫자는 `toLocaleString('ko-KR')`(만 단위로 접지 않음).
- **패널(R23, §4-2)**: 폭 `w-[560px]`, 오른쪽 고정(`fixed inset-y-0 right-0 z-40`), 열려 있으면 표 영역에 `opacity-60`(스크림 대신 dim 클래스 — 행 클릭으로 다른 작업 전환이 돼야 함). 헤더 = 작은 글자 `단계 · 유형` + 큰 글자 `@핸들`(미정이면 `인플루언서 미정`), 오른쪽 `···`(새 작업엔 없음)와 `✕`. 푸터 `← 이전  n / N  다음 →`(표에 보이는 순서 기준). Esc = 닫기(팝오버가 열려 있으면 그쪽 Esc 우선 — 기존 capture 관례).
- **칸 순서(§4-2)**: post `인플 → 비용 → 원고 → 게시 예정일 → 메모` / quoteRt `인플 → 비용 → 원고 → 대상 → 게시 예정일 → 메모` / rt `인플 → 비용 → 대상 → 게시 예정일 → 메모` / visit `인플 → 일정(방문일·게시 예정일) → 예산(=비용 라벨) → 원고 → 메모`.
- **비용 [확인](R24, §4-3)**: 자동 채움 값은 **저장하지 않는다** — [확인]을 눌러야 PATCH `cost`. 표의 비용 칸은 값 없고 제안 있으면 회색 `n원`(금액 표기는 `formatAmount` = `80,000원`)(툴팁 `아직 확인 전`). 3시나리오 문구 그대로: 같음 → 즉시 저장, `✓ 확정` / 다름 → 저장 후 창 `@h 프로필의 <유형> 단가도 30,000원 → 35,000원으로 바꿀까요?` [이 작업만] [프로필도 바꾸기] / 단가 없음 → 저장 후 창 `@h 프로필에 <유형> 단가 50,000원으로 저장할까요?` [이 작업만] [프로필에 저장]. 프로필 갱신 = `PATCH /api/influencers/{id}` `{ pricing: { [type]: amount } }`(통화가 프로필과 다르면 창을 띄우지 않고 작업만 저장). 인플 미정이면 비용 칸 비활성 + 문구 `인플을 정하면 프로필 단가로 채워요`.
- **대상(R25, §4-4)**: 입력은 링크 하나 + 체크 `아직 게시 전인 글이에요 — 링크는 나중에` → (체크 시) `어느 작업인가요?` 선택(기존 `TargetPicker`, 선택 안 해도 됨). 저장되는 값은 `targetTweetUrl` 또는 `targetTaskId` 둘 중 하나(기존 PATCH 규칙). **체크만 하고 작업을 안 고른 상태는 저장되지 않는다**(스키마 변경 없음 — 화면은 `미정`). 대상 작업이 게시 확인되면 `t.target.postUrl`이 채워져 링크로 보인다(알림은 두지 않음).
- **취소·교체 문구**: 사유 칩 `🙅 거절 · 🔇 무응답 · 📝 기타`(가안, `CANCEL_REASON_CHIPS` 상수 한 곳), 값 `declined | no_response | other`, 기본 선택 없음(토글). 취소 버튼 `❌ 취소하기`. 되돌리기 결과 문구: `reattached` → `되돌렸어요 — 원고도 다시 붙었어요` / `taken` → `되돌렸어요 — 원고는 그 사이 다른 작업에 붙어 있어요` / `gone` → `되돌렸어요 — 원고는 삭제돼 붙이지 못했어요` / `none` → `되돌렸어요`. 서버 오류 문구는 그대로 토스트(`r.error`).
- **정산 딥링크(R15)**: 표 위 오른쪽 `정산 대기 N건 · 정산에서 확인 →`(N = `isSettlementCandidate` 만족 작업 수, 0이면 링크 대신 회색 글자 `정산 대기 없음`) → `/settlement?tab=candidates&campaign=<id>`. 정산 페이지는 첫 렌더에서만 읽고, 탭을 바꾸면 `campaign` 파라미터를 지운다. 해당 캠페인 후보가 0건이면 필터를 풀고 안내 한 줄.
- **재사용(R12)**: 캠페인 목록·생성·헤더(`CampaignList`·`CampaignCreateModal`·`CampaignHeader`), 칸 편집기(`InfluencerChip`·`InfluencerField`·`CostPopover`·`ScheduledOnField`·`PostedCell`·`TargetPicker`·`TaskProofField`), `useCampaignTaskActions`, `AttachDraftModal`·`LinkPostModal`·`DraftCard`·`DraftEditModal`. 새 편집기를 만들지 않는다.
- **UX 원칙(AGENTS.md)**: 라벨은 이득을 말한다. 비활성 버튼의 이유는 `title`만이 아니라 화면 문구로도 말한다. 거짓 어포던스 금지 — 서버가 거절하는 조작(취소 행 편집·게시 후 교체·방문 후 교체)은 버튼을 두지 않거나 비활성 + 이유 문구.
- **코드 관례**: `'use client'`, 팝오버는 `createPortal` + 좌표 고정 + 바깥 클릭/Esc(capture)/스크롤 닫기(`CostPopover` 골격). `useEffect` 안 동기 `setState`는 `// eslint-disable-next-line react-hooks/set-state-in-effect -- 이유` 관례. API 호출은 `campaignApi.ts`의 `call<T>()` 패턴. 마이그레이션 없음(스키마 변경 0).
- **테스트**: 순수 함수는 `src/lib/*.test.ts`(빠름, DB 없음). 스토어·라우트는 연습용 DB. 픽스처 접두어 **`tcfl`**(+`process.pid`), `after()`에서 정리. 컴포넌트 테스트 하네스는 없다 — 화면 확인은 `npm run build` + koo QA.
- **커밋**: 한글 제목 `feat(campaign-v2): …` / `test(…)` / `docs(…)`, 본문에 왜, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 경로 명시 스테이징(`git add <파일>`), `git add -A` 금지.
- **린트 기준선**: `npx eslint src` 기존 오류 13·경고 11(A 계획 때 확인). 새 파일에서 새 문제 0.

---

## 파일 구조

| 파일 | 역할 | 작업 |
|---|---|---|
| `src/lib/campaignTaskStore.ts` | `TaskRow.draftFirstLine`(원고 본문 첫 줄, 표의 원고 칸) | 1 |
| `src/lib/campaignStore.ts` · `src/lib/campaignJudgment.ts` | `CampaignPerf.bookmarks` · `PerfSummary.bookmarks` · `flowStage` 그쪽-취소 처리 | 1 |
| `src/lib/influencerStore.ts` · `src/lib/draftTypes.ts` | `InfluencerOption.id`(프로필 단가 갱신용) | 1 |
| `src/lib/campaignTaskInput.ts` · `src/app/api/campaigns/[id]/tasks/route.ts` | `count`(뼈대 N개) | 1 |
| `migrations/055_campaign_task_cancel.sql` | check `not valid` · 미사용 인덱스 제거(최종 리뷰 M5·M6) | 1 |
| `src/lib/campaignFlowView.ts` (+`.test.ts`) | 표·필터·검색·정렬·날짜 문구·카드 숫자·사유 칩 — 순수 함수 | 2 |
| `src/lib/trackingStore.ts` · `src/app/api/campaigns/[id]/perf-refresh/route.ts` · `src/lib/campaignApi.ts` | 성과 [업데이트] — 캠페인 게시물 재조회 | 3 |
| `src/app/settlement/page.tsx` · `src/app/settlement/CandidateTable.tsx` · `src/components/Sidebar.tsx` | `?campaign=` 초기 필터 · 사이드바 "캠페인 v2" | 4 |
| `src/app/campaigns/flow/page.tsx` · `FlowDetail.tsx` | 페이지 골격(좌 목록 + 상세), 상세 컨테이너(로드·파생값·패널 상태) | 5 |
| `src/app/campaigns/flow/FlowFilterBar.tsx` · `FlowTable.tsx` | 필터 드롭다운·검색·요약 줄 · 표 6열 | 6 |
| `src/app/campaigns/flow/TaskPanel.tsx` · `BulkCreateDialog.tsx` · `useFlowTaskActions.ts` | 편집 패널(작업 모드·새 작업) · 한 번에 만들기 · 취소/되돌리기/교체 액션 | 7 |
| `src/app/campaigns/flow/CostConfirmField.tsx` · `PriceProfileDialog.tsx` | 비용 [확인] 3시나리오 | 8 |
| `src/app/campaigns/flow/TargetLinkField.tsx` · `src/app/campaigns/PostedCell.tsx` · `flow/PostedDialog.tsx` | 대상 링크+게시 전 체크 · 게시 확인 폼 추출·다이얼로그 | 9 |
| `src/app/campaigns/flow/FlowRowMenu.tsx` · `CancelDialog.tsx` · `ReplaceDialog.tsx` | `···` 메뉴(행·패널 공용) · 취소 · 교체 | 10 |
| `src/app/campaigns/flow/FlowCards.tsx` | 작업·성과·비용 카드 + [업데이트] | 11 |
| `src/content/updates.ts` · 결정 문서 §8 | 배포 안내 · 확정 항목 체크 | 12 |

---

### Task 1: 읽기 필드 보강 + 뼈대 N개 + 055 정리

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (TaskRow · toRow)
- Modify: `src/lib/campaignStore.ts` (perf 쿼리 · CampaignPerf)
- Modify: `src/lib/campaignJudgment.ts` (PerfSummary · summarizeTaskPerf · flowStage)
- Modify: `src/lib/influencerStore.ts` (listOptions) · `src/lib/draftTypes.ts` (InfluencerOption)
- Modify: `src/lib/campaignTaskInput.ts` (parseTaskCreate) · `src/app/api/campaigns/[id]/tasks/route.ts`
- Modify: `migrations/055_campaign_task_cancel.sql`
- Test: `src/lib/campaignTaskJudgment.test.ts`, `src/lib/campaignTaskInput.test.ts`, `src/lib/campaignTaskStore.test.ts`

**Interfaces:**
- Produces: `TaskRow.draftFirstLine: string | null` · `CampaignPerf.bookmarks: number | null` · `PerfSummary.bookmarks: number | null` · `InfluencerOption.id?: string` · `TaskCreateRequest.count?: number`(1~20, `influencers`가 비고 `draftId` 없을 때만) · `flowStage`: 활성 요청의 `externalStatus === 'cancelled'`는 `'posted'`.

- [ ] **Step 1: 판정 테스트 먼저 — flowStage 그쪽-취소 · summarizeTaskPerf 북마크**

`src/lib/campaignTaskJudgment.test.ts` 끝에 추가:

```ts
test('flowStage — 그쪽이 요청을 취소하면(externalStatus cancelled) 다시 게시로 돌아간다(§3-1 정산 정의에 없음)', () => {
  const t = { type: 'post' as const, draftStatus: 'delivered' as const, postedAt: '2026-09-10', removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, influencerHandle: 'a' };
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'cancelled' }), 'posted');
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'on_hold' }), 'settle');
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'paid' }), 'done');
  assert.equal(flowStage(t, { status: 'cancelled', externalStatus: null }), 'posted');   // 우리가 취소한 요청도 게시로
});

test('summarizeTaskPerf — 북마크도 합산, 취소 작업은 제외', () => {
  const b = { type: 'post' as const, draftStatus: null, postedAt: '2026-09-10', removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, linkClicks: null };
  const s = summarizeTaskPerf([
    { ...b, perf: { views: 100, likes: 5, bookmarks: 2 } },
    { ...b, perf: { views: 50, likes: null, bookmarks: 1 } },
    { ...b, cancelledAt: '2026-09-11', perf: { views: 999, likes: 9, bookmarks: 9 } },
  ]);
  assert.equal(s.views, 150); assert.equal(s.likes, 5); assert.equal(s.bookmarks, 3); assert.equal(s.publishedCount, 2);
});
```

`flowStage`·`summarizeTaskPerf`가 import 목록에 없으면 추가.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/campaignTaskJudgment.test.ts`
Expected: 새 테스트 2건 실패(`bookmarks` 없음 / cancelled → 'settle').

- [ ] **Step 3: 판정 구현**

`src/lib/campaignJudgment.ts`:

```ts
export interface PerfSummary { publishedCount: number; views: number | null; likes: number | null; bookmarks: number | null; linkClicks: number | null }
// …
export interface TaskPerfInput extends TaskStageInput { perf: { views: number | null; likes: number | null; bookmarks: number | null } | null; linkClicks: number | null }
export function summarizeTaskPerf(items: TaskPerfInput[]): PerfSummary {
  const out: PerfSummary = { publishedCount: 0, views: null, likes: null, bookmarks: null, linkClicks: null };
  const add = (k: 'views' | 'likes' | 'bookmarks' | 'linkClicks', v: number | null) => { if (v !== null) out[k] = (out[k] ?? 0) + v; };
  for (const it of items) {
    if (isTaskExcluded(it)) continue;
    if (it.postedAt) out.publishedCount += 1;
    add('views', it.perf?.views ?? null);
    add('likes', it.perf?.likes ?? null);
    add('bookmarks', it.perf?.bookmarks ?? null);
    add('linkClicks', it.linkClicks);
  }
  return out;
}
```

`flowStage`의 정산 분기를 바꾼다(§3-1: 정산 = 요청됨·접수·지급 예정·보류. 그쪽이 취소한 요청은 목록에 없다 → 게시로):

```ts
export function flowStage(t: TaskStageInput & { influencerHandle: string | null }, settlement: FlowSettlementInput | null): FlowStage {
  if (t.cancelledAt) return 'canc';
  if (settlement?.status === 'requested' && settlement.externalStatus !== 'cancelled') {
    return settlement.externalStatus === 'paid' ? 'done' : 'settle';
  }
  if (t.postedAt) return 'posted';
  if (!t.influencerHandle) return 'prep';
  if (t.draftStatus && t.draftStatus !== 'delivered' && t.draftStatus !== 'unused') return 'prep';
  return 'handed';
}
```

`src/lib/campaignStore.ts`: `CampaignPerf`에 `bookmarks: number | null` 추가, perf 쿼리에 `sum(s.bookmarks) as bookmarks`, lateral select에 `bookmarks` 추가, `PerfRow` 타입에 `bookmarks: string | number | null`, items 매핑에 `bookmarks: num(p.bookmarks)`. `SummaryCards.tsx`·`campaignTableView.perfSub`는 새 필드를 안 써도 컴파일된다(추가 필드).

`src/lib/campaignTaskStore.ts`: `TaskRow`에 `draftFirstLine: string | null;   // 붙은 원고 본문 첫 줄(v2 표의 원고 칸, R26) — 제목이 아니라 내용` 추가(`draftLabel` 옆). `toRow`에 `draftFirstLine: r.draft_id ? firstLineOf(r) : null,` 추가하고 헬퍼:

```ts
// v2 표의 원고 칸(R26) — 제목·상태가 아니라 본문 첫 줄. 화면이 truncate하므로 길이는 여기서 자르지 않는다(툴팁에 전체).
function firstLineOf(r: Row): string | null {
  const first = (r.draft_first_line ?? '').split('\n')[0].trim();
  return first || null;
}
```

`DraftCard.tsx` 등 `TaskRow` 리터럴을 만드는 곳이 있으면 tsc가 알려준다 — `draftFirstLine: null` 추가.

`src/lib/draftTypes.ts`: `export interface InfluencerOption { id?: string; handle: string; name?: string; pricing?: Pricing }`. `src/lib/influencerStore.ts` `listOptions`: select에 `id` 추가, 매핑에 `id: r.id`.

- [ ] **Step 4: 통과 확인 + tsc**

Run: `node --import tsx --test src/lib/campaignTaskJudgment.test.ts && npx tsc --noEmit`
Expected: 전부 pass, tsc 0.

- [ ] **Step 5: `count` 파서 테스트**

`src/lib/campaignTaskInput.test.ts`에 추가:

```ts
test('parseTaskCreate — count: 인플·원고 없는 뼈대만 1~20, 그 외는 거절', () => {
  const base = { type: 'post' };
  assert.equal(parseTaskCreate({ ...base, count: 5 }).ok && (parseTaskCreate({ ...base, count: 5 }) as { value: { count: number | null } }).value.count, 5);
  assert.equal((parseTaskCreate(base) as { value: { count: number | null } }).value.count, null);
  assert.equal(parseTaskCreate({ ...base, count: 0 }).ok, false);
  assert.equal(parseTaskCreate({ ...base, count: 21 }).ok, false);
  assert.equal(parseTaskCreate({ ...base, count: 2, influencers: [{ handle: 'a' }] }).ok, false);
  assert.equal(parseTaskCreate({ ...base, count: 2, draftId: '00000000-0000-0000-0000-000000000000' }).ok, false);
});
```

- [ ] **Step 6: 파서 구현**

`src/lib/campaignTaskInput.ts`: `TaskCreateBody`에 `count: number | null` 추가. 상수 `export const COUNT_MESSAGE = '만들 개수는 1~20 사이여야 해요';` `export const COUNT_WITH_ITEMS_MESSAGE = '개수로 만들 때는 인플루언서·원고 없이 빈 작업만 만들어요';`. `parseTaskCreate` 끝(return 직전):

```ts
  let count: number | null = null;
  if (b.count !== undefined) {
    if (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > 20) return fail(COUNT_MESSAGE);
    if (influencers.length > 0 || draftId.value) return fail(COUNT_WITH_ITEMS_MESSAGE);
    count = b.count;
  }
```

return value에 `count` 포함. `src/app/api/campaigns/[id]/tasks/route.ts`의 items:

```ts
      items: v.count ? Array.from({ length: v.count }, () => ({ handle: null, cost: v.cost }))
           : v.influencers.length ? v.influencers : (v.cost ? [{ handle: null, cost: v.cost }] : []),
```

`src/lib/campaignApi.ts` `TaskCreateRequest`에 `count?: number;   // 뼈대 N개(§4-1 한 번에 만들기) — influencers 비고 draftId 없을 때만` 추가.

- [ ] **Step 7: 스토어 테스트 — 뼈대 N행**

`src/lib/campaignTaskStore.test.ts`에 추가(기존 픽스처 헬퍼 관례 따라 캠페인 하나 만들고):

```ts
test('createTasks — items N개(뼈대)는 N행, 전부 미배정·비용 없음, created_at 순서 보존', async () => {
  const c = await mkCampaign('bulk');   // 파일의 기존 헬퍼 이름에 맞춘다
  const rows = await createTasks(sql, c.id, { type: 'quoteRt', targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: Array.from({ length: 3 }, () => ({ handle: null, cost: null })) });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.influencerHandle === null && r.cost === null && r.draftFirstLine === null));
  assert.ok(rows[0].createdAt <= rows[1].createdAt && rows[1].createdAt <= rows[2].createdAt);
});
```

- [ ] **Step 8: 055 정리(최종 리뷰 M5·M6)**

`migrations/055_campaign_task_cancel.sql`: check 재추가에 `not valid` 붙이고(기존 행은 상호 배제를 이미 만족 — 스키마 재실행 때 전 스캔·ACCESS EXCLUSIVE 락을 피한다, `influencer_log` 제약과 같은 이유), 미사용 인덱스는 `drop index if exists idx_campaign_task_cancelled;`로 바꾼다(뜨거운 조회는 전부 `cancelled_at is null`). 주석에 이유. 적용: `scripts/apply-migrations.sh .env.staging`(연습용) — 운영 적용은 배포 절차에서.

- [ ] **Step 9: 전체 확인·커밋**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/campaignTaskInput.test.ts src/lib/campaignTaskStore.test.ts src/lib/campaignTaskJudgment.test.ts && npx tsc --noEmit`

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignStore.ts src/lib/campaignJudgment.ts src/lib/influencerStore.ts src/lib/draftTypes.ts src/lib/campaignTaskInput.ts "src/app/api/campaigns/[id]/tasks/route.ts" src/lib/campaignApi.ts migrations/055_campaign_task_cancel.sql src/lib/campaignTaskJudgment.test.ts src/lib/campaignTaskInput.test.ts src/lib/campaignTaskStore.test.ts
git commit -m "feat(campaign-v2): 읽기 필드 보강(원고 첫 줄·북마크·인플 id) + 뼈대 N개 생성 + flowStage 그쪽-취소는 게시로"
```

---

### Task 2: 화면 순수 함수 `campaignFlowView.ts`

**Files:**
- Create: `src/lib/campaignFlowView.ts`
- Test: `src/lib/campaignFlowView.test.ts`

**Interfaces:**
- Consumes: `flowStage`·`FLOW_STAGES`·`FLOW_STAGE_LABEL`·`isTaskExcluded`·`isSettlementCandidate`·`TASK_TYPES`·`formatDateKo`·`daysBetweenDates`(`campaignJudgment.ts`), `CampaignTaskItem`(`campaignStore.ts`), `TaskCost`·`sumMoney`·`toKrw`류(`campaignCost.ts`·`clientBudget.ts`), `CancelReason`(`campaignTaskInput.ts`).
- Produces(전부 export):
  - `type FlowRow = CampaignTaskItem`(별칭)
  - `type ExtraFilter = 'late' | 'today' | 'none'`, `EXTRA_FILTERS`, `EXTRA_FILTER_LABEL = { late: '지연', today: '오늘 게시 예정', none: '예정일 미정' }`
  - `interface FlowFilter { stages: Set<FlowStage>; types: Set<TaskType>; extras: Set<ExtraFilter>; q: string }`, `EMPTY_FLOW_FILTER()`, `filterCount(f)`, `isFilterActive(f)`
  - `matchesExtra(t, key, today)`, `matchesSearch(t, q)`, `matchesFlowFilter(t, f, today)`
  - `type FlowSortKey = 'stage' | 'type' | 'influencer' | 'draft' | 'date' | 'cost'`, `interface FlowSort { key: FlowSortKey | null; dir: 1 | -1 }`, `nextSort(cur, key)`(null→오름→내림→null), `sortFlowRows(rows, sort)`, `FLOW_SORT_LABEL`
  - `dateCell(t, today): { text: string; tone: 'late' | 'posted' | 'plain' | 'muted' }`
  - `draftCell(t): { text: string; muted: boolean; title: string }`
  - `costCell(t, suggestion): { text: string; tone: 'plain' | 'muted' | 'struck' | 'suggested'; title?: string }`
  - `DISPLAY_TYPE_ORDER = ['post','quoteRt','rt','visit']`(화면에 유형을 나열하는 순서 — 하단 줄과 필터 드롭다운이 함께 쓴다. TASK_TYPES는 도메인 순서라 건드리지 않는다)
  - `flowFooter(rows, today): string` = `투고 2 · 인용RT 5 · RT 3 · 비용 880,000원 · 게시 4 / 12 · 밀림 1`
  - `filterSummary(f, shown, total): string`
  - `flowStats(rows): { planned; posted; perf: { views; likes; bookmarks; withPerf; noLink }; spent: MoneyByCurrency; plannedCost: MoneyByCurrency }`
  - `settleWaitCount(rows)`
  - `CANCEL_REASON_CHIPS: Array<{ value: CancelReason; label: string }>` = 🙅 거절 · 🔇 무응답 · 📝 기타
  - `restoreMessage(result: 'reattached' | 'taken' | 'gone' | 'none'): string`
  - `PANEL_FIELD_ORDER: Record<TaskType, PanelField[]>`, `type PanelField = 'influencer' | 'cost' | 'draft' | 'target' | 'scheduled' | 'dates' | 'note'`

- [ ] **Step 1: 테스트 작성**

`src/lib/campaignFlowView.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FLOW_FILTER, matchesFlowFilter, matchesSearch, matchesExtra, filterCount, filterSummary,
  nextSort, sortFlowRows, dateCell, draftCell, costCell, flowFooter, flowStats, settleWaitCount, restoreMessage, PANEL_FIELD_ORDER,
} from './campaignFlowView.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

const T = '2026-09-18';
let n = 0;
const mk = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '',
  proof: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null,
  createdAt: `2026-09-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null, target: null,
  published: false, perf: null, linkClicks: null, settlement: null, ...p,
});

test('1) 필터 — 묶음 안 OR, 묶음 사이 AND, 빈 필터는 전부 통과', () => {
  const a = mk({ influencerHandle: 'a', draftStatus: 'delivered', draftId: 'd' });   // handed
  const b = mk({ type: 'rt' });                                                        // prep(인플 미정)
  const c = mk({ postedAt: '2026-09-10', published: true });                           // posted
  const f = EMPTY_FLOW_FILTER();
  assert.ok([a, b, c].every((t) => matchesFlowFilter(t, f, T)));
  f.stages.add('prep'); f.stages.add('posted');
  assert.deepEqual([a, b, c].filter((t) => matchesFlowFilter(t, f, T)).map((t) => t.id), [b.id, c.id]);
  f.types.add('rt');
  assert.deepEqual([a, b, c].filter((t) => matchesFlowFilter(t, f, T)).map((t) => t.id), [b.id]);
  assert.equal(filterCount(f), 3);
});

test('2) 지금 볼 것 — 지연·오늘·미정은 게시·취소 작업을 세지 않는다', () => {
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17' }), 'late', T), true);
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17', postedAt: '2026-09-17' }), 'late', T), false);
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17', cancelledAt: '2026-09-17' }), 'late', T), false);
  assert.equal(matchesExtra(mk({ scheduledOn: T }), 'today', T), true);
  assert.equal(matchesExtra(mk({}), 'none', T), true);
  assert.equal(matchesExtra(mk({ postedAt: '2026-09-10' }), 'none', T), false);
});

test('3) 검색 — 핸들(@ 무관, 대소문자 무관)·원고 제목·첫 줄·취소 스냅샷 제목', () => {
  const t = mk({ influencerHandle: 'Toppogi', draftId: 'd', draftLabel: '치아미백 후기', draftFirstLine: 'ホワイトニングして3日目' });
  assert.ok(matchesSearch(t, '@toppo')); assert.ok(matchesSearch(t, '미백')); assert.ok(matchesSearch(t, '3日目')); assert.ok(matchesSearch(t, '  '));
  assert.equal(matchesSearch(t, 'zzz'), false);
  assert.ok(matchesSearch(mk({ cancelledAt: '2026-09-10', cancelledDraftTitle: '스케일링 루틴' }), '스케일'));
});

test('4) 정렬 — 기본 만든 순, 헤더 클릭 순환, 미정은 오름차순에서 맨 뒤, 취소는 단계 맨 뒤', () => {
  assert.deepEqual(nextSort({ key: null, dir: 1 }, 'date'), { key: 'date', dir: 1 });
  assert.deepEqual(nextSort({ key: 'date', dir: 1 }, 'date'), { key: 'date', dir: -1 });
  assert.deepEqual(nextSort({ key: 'date', dir: -1 }, 'date'), { key: null, dir: 1 });
  assert.deepEqual(nextSort({ key: 'date', dir: -1 }, 'cost'), { key: 'cost', dir: 1 });
  const a = mk({ scheduledOn: '2026-09-20' }), b = mk({}), c = mk({ scheduledOn: '2026-09-15' });
  assert.deepEqual(sortFlowRows([a, b, c], { key: null, dir: 1 }).map((t) => t.id), [a.id, b.id, c.id]);
  assert.deepEqual(sortFlowRows([a, b, c], { key: 'date', dir: 1 }).map((t) => t.id), [c.id, a.id, b.id]);
  assert.deepEqual(sortFlowRows([a, b, c], { key: 'date', dir: -1 }).map((t) => t.id), [a.id, c.id, b.id]);
  const x = mk({ influencerHandle: 'b' }), y = mk({ influencerHandle: 'A' }), z = mk({});
  assert.deepEqual(sortFlowRows([x, y, z], { key: 'influencer', dir: 1 }).map((t) => t.id), [y.id, x.id, z.id]);
  const p = mk({ postedAt: '2026-09-10' }), q = mk({ cancelledAt: '2026-09-10' }), r = mk({});
  assert.deepEqual(sortFlowRows([q, p, r], { key: 'stage', dir: 1 }).map((t) => t.id), [r.id, p.id, q.id]);
});

test('5) 날짜 칸 — 지남 빨강 D+N, 오늘·예정 기본, 게시된 건 게시일 파랑, 미정 회색, 취소는 취소일', () => {
  assert.deepEqual(dateCell(mk({ scheduledOn: '2026-09-15' }), T), { text: '9/15 화 · D+3', tone: 'late' });
  assert.deepEqual(dateCell(mk({ scheduledOn: T }), T), { text: '9/18 목', tone: 'plain' });
  assert.deepEqual(dateCell(mk({ scheduledOn: '2026-09-15', postedAt: '2026-09-16' }), T), { text: '9/16 수', tone: 'posted' });
  assert.deepEqual(dateCell(mk({}), T), { text: '미정', tone: 'muted' });
  assert.deepEqual(dateCell(mk({ cancelledAt: '2026-09-17', scheduledOn: '2026-09-15' }), T), { text: '9/17 수 취소', tone: 'muted' });
});

test('6) 원고 칸 — 첫 줄, RT는 —, 없으면 미정, 취소는 사유·메모·있었던 원고', () => {
  assert.equal(draftCell(mk({ draftId: 'd', draftFirstLine: '첫 줄', draftLabel: '제목' })).text, '첫 줄');
  assert.equal(draftCell(mk({ draftId: 'd', draftFirstLine: null, draftLabel: '제목' })).text, '제목');   // 본문이 비면 라벨
  assert.deepEqual(draftCell(mk({ type: 'rt' })), { text: '—', muted: true, title: '' });
  assert.equal(draftCell(mk({})).text, '미정');
  const c = draftCell(mk({ cancelledAt: '2026-09-17', cancelReason: 'declined', cancelNote: '일정 안 맞음', cancelledDraftTitle: '치아미백 후기' }));
  assert.equal(c.text, '🙅 거절 · 일정 안 맞음 · 원고 있었음: 치아미백 후기');
  assert.equal(draftCell(mk({ cancelledAt: '2026-09-17', cancelReason: null, cancelNote: '' })).text, '취소');
});

test('7) 비용 칸 — 값·제안(회색)·미정·취소 취소선', () => {
  assert.deepEqual(costCell(mk({ cost: { amount: 80000, currency: 'KRW' } }), null), { text: '80,000원', tone: 'plain' });
  assert.deepEqual(costCell(mk({}), { amount: 30000, currency: 'KRW' }), { text: '30,000원', tone: 'suggested', title: '아직 확인 전 — 프로필 단가로 채운 값이에요' });
  assert.deepEqual(costCell(mk({}), null), { text: '미정', tone: 'muted' });
  assert.deepEqual(costCell(mk({ cancelledAt: '2026-09-17', cost: { amount: 1000, currency: 'JPY' } }), null), { text: '1,000엔', tone: 'struck' });
});

test('8) 하단 줄·요약 줄·카드 숫자·정산 대기 — 취소 제외, 소진 = 게시된 작업 비용', () => {
  const rows = [
    mk({ type: 'post', cost: { amount: 80000, currency: 'KRW' }, postedAt: '2026-09-10', influencerHandle: 'a', perf: { postCount: 1, views: 100, likes: 3, bookmarks: 1 } }),
    mk({ type: 'rt', cost: { amount: 30000, currency: 'KRW' }, scheduledOn: '2026-09-15' }),
    mk({ type: 'rt', cost: { amount: 30000, currency: 'KRW' }, cancelledAt: '2026-09-17' }),
    mk({ type: 'post', postedAt: '2026-09-11', influencerHandle: 'b', cost: { amount: 50000, currency: 'KRW' } }),
  ];
  assert.equal(flowFooter(rows, T), '투고 2 · RT 1 · 비용 160,000원 · 게시 2 / 3 · 밀림 1');
  const s = flowStats(rows);
  assert.equal(s.planned, 3); assert.equal(s.posted, 2);
  assert.deepEqual(s.spent, { KRW: 130000 }); assert.deepEqual(s.plannedCost, { KRW: 160000 });
  assert.deepEqual(s.perf, { views: 100, likes: 3, bookmarks: 1, withPerf: 1, noLink: 1 });
  assert.equal(settleWaitCount(rows), 2);
  const f = EMPTY_FLOW_FILTER();
  assert.equal(filterSummary(f, 4, 4), '전체 4건');
  f.stages.add('posted'); f.q = 'a';
  assert.equal(filterSummary(f, 1, 4), '게시 · "a" 1건');
  assert.equal(restoreMessage('taken'), '되돌렸어요 — 원고는 그 사이 다른 작업에 붙어 있어요');
  assert.deepEqual(PANEL_FIELD_ORDER.visit, ['influencer', 'dates', 'cost', 'draft', 'note']);
  assert.deepEqual(PANEL_FIELD_ORDER.quoteRt, ['influencer', 'cost', 'draft', 'target', 'scheduled', 'note']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/campaignFlowView.test.ts` → 모듈 없음으로 실패.

- [ ] **Step 3: 구현**

`src/lib/campaignFlowView.ts`:

```ts
import type { CampaignTaskItem } from './campaignStore.ts';
import {
  flowStage, FLOW_STAGES, FLOW_STAGE_LABEL, isTaskExcluded, isSettlementCandidate, isTaskOverdue,
  TASK_TYPES, TASK_TYPE_LABEL, formatDateKo, daysBetweenDates, type FlowStage, type TaskType,
} from './campaignJudgment.ts';
import { formatAmount, formatMoneyBy, sumMoney, type MoneyByCurrency, type TaskCost } from './campaignCost.ts';
import type { CancelReason } from './campaignTaskInput.ts';

// 캠페인 v2 화면(결정 문서 §3·§4)의 판정·문구 — 컴포넌트는 그리기만 한다. 단계는 flowStage 하나(R21), 모집단은 취소 제외(R17).
export type FlowRow = CampaignTaskItem;
const stageOf = (t: FlowRow): FlowStage => flowStage(t, t.settlement);

// ── 필터(R26): 드롭다운 하나, 세 묶음 — 묶음 안 OR, 묶음 사이 AND ──
export type ExtraFilter = 'late' | 'today' | 'none';
export const EXTRA_FILTERS: readonly ExtraFilter[] = ['late', 'today', 'none'];
export const EXTRA_FILTER_LABEL: Record<ExtraFilter, string> = { late: '지연', today: '오늘 게시 예정', none: '예정일 미정' };
export interface FlowFilter { stages: Set<FlowStage>; types: Set<TaskType>; extras: Set<ExtraFilter>; q: string }
export const EMPTY_FLOW_FILTER = (): FlowFilter => ({ stages: new Set(), types: new Set(), extras: new Set(), q: '' });
export const filterCount = (f: FlowFilter) => f.stages.size + f.types.size + f.extras.size;
export const isFilterActive = (f: FlowFilter) => filterCount(f) > 0 || f.q.trim() !== '';

// '지금 볼 것'은 진행 중(게시 전·취소 아님) 작업만 센다 — 게시된 건은 이미 할 일이 아니다.
export function matchesExtra(t: FlowRow, key: ExtraFilter, today: string): boolean {
  if (isTaskExcluded(t) || t.postedAt) return false;
  if (key === 'late') return isTaskOverdue(t, today);
  if (key === 'today') return t.scheduledOn === today;
  return t.scheduledOn === null;
}
export function matchesSearch(t: FlowRow, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^@/, '');
  if (!s) return true;
  const hay = [t.influencerHandle, t.draftLabel, t.draftFirstLine, t.cancelledDraftTitle].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  return hay.some((h) => h.includes(s));
}
export function matchesFlowFilter(t: FlowRow, f: FlowFilter, today: string): boolean {
  if (!matchesSearch(t, f.q)) return false;
  if (f.stages.size && !f.stages.has(stageOf(t))) return false;
  if (f.types.size && !f.types.has(t.type)) return false;
  if (f.extras.size && ![...f.extras].some((k) => matchesExtra(t, k, today))) return false;
  return true;
}
export function filterSummary(f: FlowFilter, shown: number, total: number): string {
  if (!isFilterActive(f)) return `전체 ${total}건`;
  const labels = [...f.stages].map((k) => FLOW_STAGE_LABEL[k])
    .concat([...f.types].map((k) => TASK_TYPE_LABEL[k]), [...f.extras].map((k) => EXTRA_FILTER_LABEL[k]));
  if (f.q.trim()) labels.push(`"${f.q.trim()}"`);
  return `${labels.join(' · ')} ${shown}건`;
}

// ── 정렬(R26): 기본 만든 순, 헤더 클릭 오름 → 내림 → 기본. 미정은 오름차순에서 맨 뒤. 취소는 단계 순에서 맨 뒤 ──
export type FlowSortKey = 'stage' | 'type' | 'influencer' | 'draft' | 'date' | 'cost';
export interface FlowSort { key: FlowSortKey | null; dir: 1 | -1 }
export const FLOW_SORT_LABEL: Record<FlowSortKey, string> = { stage: '단계', type: '유형', influencer: '인플루언서', draft: '원고', date: '게시 예정일', cost: '작업 비용' };
export function nextSort(cur: FlowSort, key: FlowSortKey): FlowSort {
  if (cur.key !== key) return { key, dir: 1 };
  if (cur.dir === 1) return { key, dir: -1 };
  return { key: null, dir: 1 };
}
const LAST = '￿';
const sortValue = (t: FlowRow, key: FlowSortKey): string | number => {
  switch (key) {
    case 'stage': return FLOW_STAGES.indexOf(stageOf(t));
    case 'type': return TASK_TYPES.indexOf(t.type);
    case 'influencer': return t.influencerHandle ? t.influencerHandle.toLowerCase() : LAST;
    case 'draft': { const d = draftCell(t).text; return d === '미정' || d === '—' ? LAST : d.toLowerCase(); }
    case 'date': return t.postedAt ?? t.scheduledOn ?? LAST;
    case 'cost': return t.cost ? t.cost.amount : LAST;   // 미정은 0원이 아니라 '값 없음' — 다른 키와 같이 맨 뒤로
  }
};
export function sortFlowRows<T extends FlowRow>(rows: T[], sort: FlowSort): T[] {
  const byCreated = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  if (!sort.key) return [...rows].sort(byCreated);
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    // 미정(LAST)은 방향과 무관하게 맨 뒤 — 내림차순에서 미정이 맨 위로 올라오면 "가장 큰 값"처럼 읽힌다
    const ax = x === LAST, bx = y === LAST;
    if (ax !== bx) return ax ? 1 : -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * sort.dir || byCreated(a, b);
  });
}

// ── 칸 문구(R26·R27) ──
export function dateCell(t: FlowRow, today: string): { text: string; tone: 'late' | 'posted' | 'plain' | 'muted' } {
  if (t.cancelledAt) return { text: `${formatDateKo(t.cancelledAt)} 취소`, tone: 'muted' };
  if (t.postedAt) return { text: formatDateKo(t.postedAt), tone: 'posted' };
  if (!t.scheduledOn) return { text: '미정', tone: 'muted' };
  if (t.scheduledOn < today) return { text: `${formatDateKo(t.scheduledOn)} · D+${daysBetweenDates(t.scheduledOn, today)}`, tone: 'late' };
  return { text: formatDateKo(t.scheduledOn), tone: 'plain' };
}
export const CANCEL_REASON_CHIPS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'declined', label: '🙅 거절' }, { value: 'no_response', label: '🔇 무응답' }, { value: 'other', label: '📝 기타' },
];   // 가안(§8) — 이모지는 koo 확정 뒤 여기 한 곳만 바꾼다
export const cancelReasonLabel = (r: CancelReason | null) => CANCEL_REASON_CHIPS.find((c) => c.value === r)?.label ?? null;
export function draftCell(t: FlowRow): { text: string; muted: boolean; title: string } {
  if (t.cancelledAt) {
    const parts = [cancelReasonLabel(t.cancelReason), t.cancelNote.trim() || null, t.cancelledDraftTitle ? `원고 있었음: ${t.cancelledDraftTitle}` : null].filter((x): x is string => !!x);
    const text = parts.length ? parts.join(' · ') : '취소';
    return { text, muted: true, title: text };
  }
  if (t.type === 'rt') return { text: '—', muted: true, title: '' };
  if (t.draftId) { const text = t.draftFirstLine ?? t.draftLabel ?? '(내용 없음)'; return { text, muted: false, title: text }; }
  return { text: '미정', muted: true, title: '' };
}
export function costCell(t: FlowRow, suggestion: TaskCost | null): { text: string; tone: 'plain' | 'muted' | 'struck' | 'suggested'; title?: string } {
  if (t.cost) return { text: formatAmount(t.cost.amount, t.cost.currency), tone: t.cancelledAt ? 'struck' : 'plain' };
  if (!t.cancelledAt && suggestion) return { text: formatAmount(suggestion.amount, suggestion.currency), tone: 'suggested', title: '아직 확인 전 — 프로필 단가로 채운 값이에요' };
  return { text: '미정', tone: 'muted' };
}

// ── 하단 줄·카드(§3-2 하단 한 줄, §3-3) — 모집단은 취소 제외(R17) ──
export function flowFooter(rows: FlowRow[], today: string): string {
  const live = rows.filter((t) => !isTaskExcluded(t));
  const types = TASK_TYPES.filter((k) => live.some((t) => t.type === k)).map((k) => `${TASK_TYPE_LABEL[k]} ${live.filter((t) => t.type === k).length}`);
  const cost = sumMoney(live.flatMap((t) => (t.cost ? [t.cost] : [])));
  const posted = live.filter((t) => t.postedAt).length;
  const late = live.filter((t) => isTaskOverdue(t, today)).length;
  return [...types, `비용 ${formatMoneyBy(cost)}`, `게시 ${posted} / ${live.length}`, ...(late ? [`밀림 ${late}`] : [])].join(' · ');
}
export interface FlowStats {
  planned: number; posted: number;
  perf: { views: number; likes: number; bookmarks: number; withPerf: number; noLink: number };
  spent: MoneyByCurrency; plannedCost: MoneyByCurrency;
}
export function flowStats(rows: FlowRow[]): FlowStats {
  const live = rows.filter((t) => !isTaskExcluded(t));
  const posted = live.filter((t) => t.postedAt);
  const withPerf = posted.filter((t) => t.perf);
  const perf = withPerf.reduce((a, t) => ({
    views: a.views + (t.perf?.views ?? 0), likes: a.likes + (t.perf?.likes ?? 0), bookmarks: a.bookmarks + (t.perf?.bookmarks ?? 0),
  }), { views: 0, likes: 0, bookmarks: 0 });
  return {
    planned: live.length, posted: posted.length,
    perf: { ...perf, withPerf: withPerf.length, noLink: posted.length - withPerf.length },
    spent: sumMoney(posted.flatMap((t) => (t.cost ? [t.cost] : []))),
    plannedCost: sumMoney(live.flatMap((t) => (t.cost ? [t.cost] : []))),
  };
}
// 정산 대기 = 정산 후보인데 활성 요청이 없는 것. 우리가 취소했거나 그쪽이 취소한 요청은 후보로 돌아온다(§3-1 정산 정의).
export const settleWaitCount = (rows: FlowRow[]) => rows.filter((t) =>
  isSettlementCandidate(t) && (!t.settlement || t.settlement.status === 'cancelled' || t.settlement.externalStatus === 'cancelled')).length;

export function restoreMessage(r: 'reattached' | 'taken' | 'gone' | 'none'): string {
  return r === 'reattached' ? '되돌렸어요 — 원고도 다시 붙었어요'
    : r === 'taken' ? '되돌렸어요 — 원고는 그 사이 다른 작업에 붙어 있어요'
    : r === 'gone' ? '되돌렸어요 — 원고는 삭제돼 붙이지 못했어요'
    : '되돌렸어요';
}

// 패널 칸 순서(§4-2, koo 09-18)
export type PanelField = 'influencer' | 'cost' | 'draft' | 'target' | 'scheduled' | 'dates' | 'note';
export const PANEL_FIELD_ORDER: Record<TaskType, PanelField[]> = {
  post: ['influencer', 'cost', 'draft', 'scheduled', 'note'],
  quoteRt: ['influencer', 'cost', 'draft', 'target', 'scheduled', 'note'],
  rt: ['influencer', 'cost', 'target', 'scheduled', 'note'],
  visit: ['influencer', 'dates', 'cost', 'draft', 'note'],
};
```

`isTaskOverdue`가 export돼 있는지 확인(`campaignJudgment.ts:167` — 있음). `settleWaitCount`는 `flowStage`의 정산 판정과 같은 기준을 쓴다 — 취소된 요청(우리 취소·그쪽 취소)은 '게시'로 돌아오므로 정산 대기에도 다시 잡힌다. 테스트 8의 기대(2)는 배지 없는 두 건.

- [ ] **Step 4: 통과 확인·커밋**

Run: `node --import tsx --test src/lib/campaignFlowView.test.ts && npx tsc --noEmit`

```bash
git add src/lib/campaignFlowView.ts src/lib/campaignFlowView.test.ts
git commit -m "feat(campaign-v2): 화면 순수 함수 — 필터·검색·정렬·날짜/원고/비용 칸 문구·카드 숫자·사유 칩"
```

---

### Task 3: 성과 [업데이트] — 캠페인 게시물 재조회 라우트

**Files:**
- Modify: `src/lib/trackingStore.ts` (`listTrackedPostIdsForCampaign`)
- Create: `src/app/api/campaigns/[id]/perf-refresh/route.ts`
- Modify: `src/lib/campaignApi.ts` (`refreshCampaignPerfApi`)
- Test: `src/lib/trackingStore.test.ts`

**Interfaces:**
- Produces: `listTrackedPostIdsForCampaign(sql, campaignId): Promise<Array<{ id: string; tweetId: string }>>`(취소 아닌·게시 확인된 작업에 붙은 게시물, `unavailable_at` 무관) · `POST /api/campaigns/[id]/perf-refresh` → `{ total: number; refreshed: number; unavailable: number; failed: number }` · `refreshCampaignPerfApi(campaignId)`.

- [ ] **Step 1: 스토어 테스트**

`src/lib/trackingStore.test.ts`에 추가(파일의 기존 픽스처 헬퍼로 캠페인·작업·tracked_post를 만든다 — 없으면 `campaignTaskCancel.test.ts`의 `mkCampaign`을 참고해 이 파일 접두어로 작성):

```ts
test('listTrackedPostIdsForCampaign — 게시 확인된·취소 아닌 작업의 게시물만, 다른 캠페인 제외', async () => {
  // 캠페인 c1에 작업 a(게시·게시물 1), b(게시·취소 → 제외), c(미게시·게시물 있음 → 제외); 캠페인 c2에 d(게시·게시물) → 제외
  // … 픽스처 생성(addTrackedPost + linkTrackedPost 또는 update tracked_post set task_id) …
  const ids = await listTrackedPostIdsForCampaign(sql, c1.id);
  assert.deepEqual(ids.map((x) => x.id).sort(), [postA.id].sort());
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file-if-exists=.env.staging --test src/lib/trackingStore.test.ts`

- [ ] **Step 3: 구현**

`src/lib/trackingStore.ts`:

```ts
// 캠페인 v2 성과 [업데이트](§3-3) — 다시 조회할 게시물 = 이 캠페인의 게시 확인된·취소 아닌 작업에 붙은 것(R17 모집단).
// unavailable_at이 찍힌 것도 포함한다(복귀 수용은 appendSnapshot이 한다).
export async function listTrackedPostIdsForCampaign(sql: postgres.Sql, campaignId: string): Promise<Array<{ id: string; tweetId: string }>> {
  if (!isUuidLike(campaignId)) return [];
  const rows = await sql<Array<{ id: string; tweet_id: string }>>`
    select tp.id, tp.tweet_id from tracked_post tp
      join campaign_task t on t.id = tp.task_id
     where t.campaign_id = ${campaignId} and t.posted_at is not null and t.cancelled_at is null
     order by tp.created_at asc`;
  return rows.map((r) => ({ id: r.id, tweetId: r.tweet_id }));
}
```

`src/app/api/campaigns/[id]/perf-refresh/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { fetchPost } from '@/lib/postMetrics';
import { listTrackedPostIdsForCampaign, appendSnapshot, markUnavailable } from '@/lib/trackingStore';

// 성과 [업데이트](캠페인 v2 §3-3) — 이 캠페인의 게시 확인된 작업에 붙은 게시물을 다시 조회해 스냅샷을 쌓는다.
// 비용 유발(게시물당 API 1회) — 버튼 opt-in(UX 원칙 6). 개별 실패는 건너뛰고 숫자로 돌려준다(틀린 기록보다 빈 기록, 트래킹 스펙).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const posts = await listTrackedPostIdsForCampaign(sql, id);
  let refreshed = 0, unavailable = 0, failed = 0;
  for (const p of posts) {
    const r = await fetchPost(p.tweetId);
    if (r.kind === 'error') { failed += 1; continue; }
    if (r.kind === 'unavailable') { await markUnavailable(sql, p.id); unavailable += 1; continue; }
    await appendSnapshot(sql, p.id, r.post.metrics, r.post.raw);
    refreshed += 1;
  }
  return NextResponse.json({ total: posts.length, refreshed, unavailable, failed });
}
```

`src/lib/campaignApi.ts`:

```ts
// 성과 [업데이트](v2 §3-3) — 비용 유발(게시물당 API 1회), 버튼 opt-in
export const refreshCampaignPerfApi = (campaignId: string) =>
  call<{ total: number; refreshed: number; unavailable: number; failed: number }>(`/api/campaigns/${campaignId}/perf-refresh`, { method: 'POST' });
```

- [ ] **Step 4: 통과·커밋**

```bash
git add src/lib/trackingStore.ts src/lib/trackingStore.test.ts "src/app/api/campaigns/[id]/perf-refresh/route.ts" src/lib/campaignApi.ts
git commit -m "feat(campaign-v2): 성과 업데이트 라우트 — 캠페인 게시물 재조회(게시 확인·취소 아닌 작업만)"
```

---

### Task 4: 정산 딥링크 `?campaign=` + 사이드바 "캠페인 v2"

**Files:**
- Modify: `src/app/settlement/page.tsx`, `src/app/settlement/CandidateTable.tsx`, `src/components/Sidebar.tsx`

- [ ] **Step 1: CandidateTable에 초기 캠페인 필터**

`CandidateTable({ onCreated, initialCampaignId }: { onCreated?: () => void; initialCampaignId?: string | null })`. `filter` 초기값 `campaignId: initialCampaignId ?? ''`. `load()` 성공 뒤(setEdits 다음):

```ts
    // 딥링크(v2 R15) — 그 캠페인의 후보가 0건이면 빈 표 대신 전체를 보이고 한 줄로 알린다
    if (initialCampaignId && !r.data.candidates.some((c) => c.campaignId === initialCampaignId)) {
      setFilter((f) => (f.campaignId === initialCampaignId ? { ...f, campaignId: '' } : f));
      setDeepLinkNote('링크의 캠페인에는 정산 대기가 없어요 — 전체를 보여요');
    }
```

`const [deepLinkNote, setDeepLinkNote] = useState('')`, 필터 줄 아래 `{deepLinkNote && <p className="mt-2 text-ui text-x-muted">{deepLinkNote}</p>}`. `load`의 deps에 `initialCampaignId` 추가.

- [ ] **Step 2: 페이지가 파라미터를 읽고 탭 전환 때 지운다**

`page.tsx`: `const [focusCampaignId] = useState<string | null>(() => sp.get('campaign'));` · `setTab` 안 `p.delete('campaign');` · `<CandidateTable onCreated={…} initialCampaignId={focusCampaignId} />`. 주석의 "딥링크 두 개"를 "세 개(… 캠페인 v2 → ?tab=candidates&campaign=)"로 고친다.

- [ ] **Step 3: 사이드바**

`Sidebar.tsx` `globalNav`의 `/campaigns` 바로 아래에 `{ href: '/campaigns/flow', label: '캠페인 v2', Ic: CampaignIcon },` 추가(주석: `// 캠페인 v2(ADR 0003) — 새 업무흐름 화면, 자리 잡으면 위 캠페인을 대체`). 활성 판정은 `pathname === n.href` 정확 일치라 `/campaigns`와 겹치지 않는다.

- [ ] **Step 4: 확인·커밋**

Run: `npx tsc --noEmit && node --import tsx --test src/lib/updates.test.ts`(무관하지만 빠른 sanity) 

```bash
git add src/app/settlement/page.tsx src/app/settlement/CandidateTable.tsx src/components/Sidebar.tsx
git commit -m "feat(campaign-v2): 정산 검토 대기 캠페인 딥링크(?campaign=) + 사이드바 캠페인 v2"
```

---

### Task 5: 페이지 골격 `/campaigns/flow` + `FlowDetail` 컨테이너

**Files:**
- Create: `src/app/campaigns/flow/page.tsx`, `src/app/campaigns/flow/FlowDetail.tsx`

**Interfaces:**
- `FlowDetail({ id, campaigns, onChanged, onDeleted })` — `CampaignDetail`과 같은 계약. 내부 상태: `data: DetailState`(`CampaignDetail.tsx`의 `DetailState`와 같은 모양) · `filter: FlowFilter` · `sort: FlowSort` · `panel: { taskId: string } | { fresh: true } | null` · `influencerOptions`.
- Produces(자식에 넘김): `rows`(정렬·필터 적용 후 표시 순서 — 패널 이전/다음도 이 순서), `actions = useCampaignTaskActions(...)` + Task 7의 `useFlowTaskActions`, `openPanel(taskId)`, `openNew()`, `openBulk()`, `reload()`.

- [ ] **Step 1: page.tsx**

`src/app/campaigns/page.tsx`를 복사해 `flow/page.tsx`로. 바뀌는 것: import `FlowDetail`; `view`/`DetailView` 관련 상태·props 제거(달력 없음, R10); 상세 렌더 `<FlowDetail key={picked.id} id={picked.id} campaigns={rows} onChanged={…} onDeleted={…} />`; `LIST_COLLAPSED_KEY`는 같은 키 `'campaigns-list-collapsed'` 그대로(두 화면이 접힘 상태를 공유 — 같은 목록이다). 파일 머리 주석: `// 캠페인 v2(ADR 0003) — 기존 /campaigns와 병존. 좌측 목록·생성은 같은 부품, 상세만 FlowDetail.`

- [ ] **Step 2: FlowDetail 골격**

`FlowDetail.tsx` — `CampaignDetail.tsx`의 로드·토큰·influencerOptions·clientData·peek(원고 카드)·patchCampaign·removeCampaign·saveCostRow는 **그대로 옮긴다**(복붙, 인플별 비용 표 `InfluencerCostTable`은 R10에 따라 렌더하지 않되 `saveCostRow`는 두지 않는다 — 안 쓰는 코드는 넣지 않는다). 새로 쥐는 상태:

```ts
const [filter, setFilter] = useState<FlowFilter>(EMPTY_FLOW_FILTER);
const [sort, setSort] = useState<FlowSort>({ key: null, dir: 1 });
const [panel, setPanel] = useState<{ taskId: string } | { fresh: true } | null>(null);
const [bulkOpen, setBulkOpen] = useState(false);
```

파생값:

```ts
const shown = useMemo(() => (data ? sortFlowRows(data.tasks.filter((t) => matchesFlowFilter(t, filter, data.today)), sort) : []), [data, filter, sort]);
const stats = useMemo(() => (data ? flowStats(data.tasks) : null), [data]);
const settleWait = useMemo(() => (data ? settleWaitCount(data.tasks) : 0), [data]);
```

렌더 순서(§3): `PANEL` 헤더(`CampaignHeader` 재사용) → 카드 3장(`FlowCards`, Task 11 — 이 작업에서는 자리만 `<div className={PANEL}>카드(Task 11)</div>`) → `PANEL` 안에 `[+ 작업 추가] [한 번에 만들기]` 버튼 줄 + `FlowFilterBar`(Task 6) + `FlowTable`(Task 6) → `TaskPanel`(Task 7) · `BulkCreateDialog`(Task 7) · 원고 카드 오버레이(`CampaignDetail`의 peek 블록 그대로) · `AttachDraftModal` · `LinkPostModal` · `DraftEditModal`. 표 영역 래퍼에 `className={panel ? 'opacity-60 transition-opacity' : ''}`(패널 열림 dim).

이 작업에서는 자식 컴포넌트가 아직 없으므로 **임시로** 표 자리에 `<pre>{JSON.stringify(shown.map(t => t.id))}</pre>` 같은 것을 두지 않는다 — 대신 Task 6·7·11 컴포넌트의 **빈 껍데기 파일**(props 타입만 받고 `return null`)을 함께 만들어 tsc·build가 통과하게 한다. 각 껍데기 파일 머리에 `// TODO(Task N): 구현` 한 줄.

- [ ] **Step 3: 빌드 확인·커밋**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -3`(빌드 실패 시 원인만 고친다 — 화면 확인은 koo)

```bash
git add src/app/campaigns/flow/
git commit -m "feat(campaign-v2): /campaigns/flow 페이지 골격 — 좌측 목록 재사용 + FlowDetail 컨테이너(필터·정렬·패널 상태)"
```

---

### Task 6: 필터 바 + 표 6열

**Files:**
- Create/Replace: `src/app/campaigns/flow/FlowFilterBar.tsx`, `src/app/campaigns/flow/FlowTable.tsx`

- [ ] **Step 1: FlowFilterBar**

Props: `{ filter: FlowFilter; onChange: (f: FlowFilter) => void; counts: { stage: Record<FlowStage, number>; type: Record<TaskType, number>; extra: Record<ExtraFilter, number> }; summary: string; sortNote: string; settleWait: number; campaignId: string }`.

구조(한 줄, `flex flex-wrap items-center gap-3`):
1. 드롭다운 버튼 `<Button variant="subtle">필터{n > 0 && <b>…</b>}▾</Button>` — **b 태그 금지**(굵은 글씨 없음) → 개수는 `<span className="ml-1 rounded-full bg-x-blue/10 px-1.5 text-x-blue-text">{n}</span>`. 팝오버는 `createPortal` + `CostPopover` 골격(바깥 클릭·Esc·스크롤 닫기), 폭 260. 안에 세 묶음: 제목(`text-caption text-x-muted`) + 체크박스 라벨 줄 `<label className="flex h-8 items-center gap-2 text-ui"><input type="checkbox" …/> {label}<span className="ml-auto text-x-muted tabular-nums">{n}</span></label>`. 토글 = `Set` 복사 후 add/delete → `onChange({ ...filter, stages: next })`.
2. 검색 `<input placeholder="인플루언서 · 원고 검색" aria-label="인플루언서·원고 검색" value={filter.q} onChange=… className="h-9 w-[260px] rounded-md border border-x-border-strong bg-white px-3 text-ui outline-none focus:border-x-blue" />`.
3. 요약 `summary`(`text-ui text-x-secondary`) + 필터 활성이면 `[지우기]`(`onChange(EMPTY_FLOW_FILTER())`) + `sortNote`(`· 만든 순` / `· 게시 예정일 오름차순`).
4. 오른쪽(`ml-auto`): `settleWait > 0 ? <Link href={`/settlement?tab=candidates&campaign=${campaignId}`} className="text-ui text-x-blue-text hover:underline">정산 대기 {settleWait}건 · 정산에서 확인 →</Link> : <span className="text-ui text-x-muted">정산 대기 없음</span>`.

- [ ] **Step 2: FlowTable**

Props: `{ rows: FlowRow[]; total: number; today: string; influencerOptions: InfluencerOption[]; sort: FlowSort; onSortChange: (s: FlowSort) => void; footer: string; selectedId: string | null; onRowClick: (t: FlowRow) => void; renderMenu: (t: FlowRow) => ReactNode }`.

- `<table className="w-full table-fixed text-content">` colgroup 폭 `84 · 104 · 200 · (가변) · 170 · 120 · 40`. 최소 폭 `min-w-[960px]` + 바깥 `overflow-x-auto`.
- 헤더 셀: `<th className="px-3 py-2 text-left text-ui font-normal text-x-muted"><button type="button" onClick={() => onSortChange(nextSort(sort, key))} aria-sort={…} className="inline-flex items-center gap-1 hover:text-x-text">{FLOW_SORT_LABEL[key]}<span aria-hidden className="text-caption">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span></button></th>`. 비용 헤더는 `text-right`. 마지막 `<th />`.
- 행: `<tr onClick={() => onRowClick(t)} className={`h-11 cursor-pointer border-b border-x-border whitespace-nowrap hover:bg-x-hover ${t.id === selectedId ? 'bg-x-blue/5' : ''} ${cancelled ? 'opacity-60' : ''}`}>`
  - 단계: `<span className={`rounded-full px-2 py-0.5 text-ui ${STAGE_CHIP[stage]}`}>{FLOW_STAGE_LABEL[stage]}</span>` — `STAGE_CHIP: Record<FlowStage, string> = { prep: 'bg-x-surface text-x-secondary', handed: 'bg-[#e8f0fe] text-[#1d4ed8]', posted: 'bg-[#e6f6ee] text-[#15803d]', settle: 'bg-[#f3e8ff] text-[#7e22ce]', done: 'bg-x-text text-white', canc: 'bg-slate-50 text-slate-400 line-through' }`.
  - 유형: `TaskTable.tsx`의 `TYPE_CHIP` 색을 같은 값으로 복사(문자열 상수 4개 — import는 하지 않는다, 그 파일의 비공개 상수).
  - 인플: `t.influencerHandle ? `@${t.influencerHandle}` : <span className="text-x-muted">미정</span>` — 링크·볼드·아바타 없음.
  - 원고: `const d = draftCell(t)` → `<td className="px-3 truncate" title={d.title}><span className={d.muted ? 'text-x-muted' : ''}>{d.text}</span></td>`.
  - 날짜: `const dc = dateCell(t, today)` → tone 매핑 `late: 'text-red-600' · posted: 'text-x-blue-text' · plain: '' · muted: 'text-x-muted'`.
  - 비용: `costCell(t, suggestTaskCost(optionFor(t.influencerHandle)?.pricing, t.type))` → tone `plain: 'tabular-nums' · muted: 'text-x-muted' · struck: 'text-x-muted line-through' · suggested: 'text-x-muted'` + `title`. `text-right`.
  - 마지막 셀: `<td onClick={(e) => e.stopPropagation()}>{renderMenu(t)}</td>`.
- 빈 상태: `total === 0` → `아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가] 또는 [한 번에 만들기]로 시작해요.` / `rows.length === 0` → `조건에 맞는 작업이 없어요 — 필터를 지우면 전체가 보여요.`
- `<tfoot>` 한 줄 `text-ui text-x-secondary`: `footer`.

- [ ] **Step 3: FlowDetail에 연결**

`counts` 계산(`useMemo`): `stage` = `FLOW_STAGES`별 `data.tasks.filter(t => flowStage(t, t.settlement) === k).length`, `type` = 유형별, `extra` = `matchesExtra`. `summary = filterSummary(filter, shown.length, data.tasks.length)`, `sortNote = sort.key ? `· ${FLOW_SORT_LABEL[sort.key]} ${sort.dir === 1 ? '오름차순' : '내림차순'}` : '· 만든 순'`, `footer = flowFooter(data.tasks, data.today)`. `renderMenu`는 Task 10까지 `() => null`.

- [ ] **Step 4: 빌드·커밋**

```bash
git add src/app/campaigns/flow/FlowFilterBar.tsx src/app/campaigns/flow/FlowTable.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 표 6열(단계·유형·인플·원고 첫 줄·게시 예정일·비용) + 필터 드롭다운·검색·헤더 정렬"
```

---

### Task 7: 편집 패널(작업 모드·새 작업) + 한 번에 만들기 + 취소/되돌리기/교체 액션 훅

**Files:**
- Create/Replace: `src/app/campaigns/flow/TaskPanel.tsx`, `src/app/campaigns/flow/BulkCreateDialog.tsx`, `src/app/campaigns/flow/useFlowTaskActions.ts`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`

**Interfaces:**
- `useFlowTaskActions({ campaignId, show, reload, onChanged })` → `{ cancel(t, body) · restore(t) · replace(t, body) }` — 셋 다 성공 시 `reload()`(정산 배지·원고 상태·로그가 서버에만 있어 낙관 갱신 대신 재조회) + `onChanged()`; 실패 시 `show(r.error)`. `restore`는 `restoreMessage(r.data.draft)`를 토스트.
- `TaskPanel` props: `{ mode: { kind: 'edit'; task: FlowRow; index: number; total: number } | { kind: 'new' }; campaign: CampaignRow; today: string; influencerOptions: InfluencerOption[]; actions: ReturnType<typeof useCampaignTaskActions>; onClose; onPrev; onNext; onCreate(body: TaskCreateRequest, more: boolean): Promise<boolean>; menu: ReactNode(헤더 ···, edit 모드만); onOpenDraft(draftId); onAttachDraft(t); onGenerateHref(t): string; onDetachDraft(t); slots: { cost: ReactNode; target: ReactNode } }` — `cost`·`target` 칸은 Task 8·9 컴포넌트를 부모가 넣는다(이 작업에서는 자리 표시 `<div className="text-ui text-x-muted">비용 칸(Task 8)</div>`).

- [ ] **Step 1: useFlowTaskActions**

```ts
'use client';
import { useMemo } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import type { TaskCost } from '@/lib/campaignCost';
import type { CancelReason } from '@/lib/campaignTaskInput';
import { cancelTaskApi, restoreTaskApi, replaceInfluencerApi } from '@/lib/campaignApi';
import { restoreMessage } from '@/lib/campaignFlowView';

// 취소·되돌리기·교체(ADR 0002·0005)는 PATCH가 아니라 액션 라우트 — 원고 상태·증빙·로그·정산 배지까지 서버가 한 트랜잭션으로
// 바꾸므로 낙관적 갱신 대신 성공 뒤 상세를 다시 읽는다(useCampaignTaskActions의 patch 롤백 규칙을 여기 얹지 않는다).
export function useFlowTaskActions({ campaignId, show, reload, onChanged }: {
  campaignId: string; show: (m: string) => void; reload: () => Promise<void>; onChanged: () => void;
}) {
  return useMemo(() => ({
    cancel: async (t: CampaignTaskItem, body: { reason: CancelReason | null; note: string }) => {
      const r = await cancelTaskApi(campaignId, t.id, body);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(t.draftId ? '작업을 취소했어요 — 붙어 있던 원고는 떼어져 다른 작업에 쓸 수 있어요' : '작업을 취소했어요');
      return true;
    },
    restore: async (t: CampaignTaskItem) => {
      const r = await restoreTaskApi(campaignId, t.id);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(restoreMessage(r.data.draft));
      return true;
    },
    replace: async (t: CampaignTaskItem, body: { handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) => {
      const r = await replaceInfluencerApi(campaignId, t.id, body);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(`@${body.handle}로 바꿨어요 — 작업·대상·예정일은 그대로예요`);
      return true;
    },
  }), [campaignId, show, reload, onChanged]);
}
```

- [ ] **Step 2: TaskPanel**

레이아웃: `<aside role="dialog" aria-label="작업 편집" className="fixed inset-y-0 right-0 z-40 flex w-[560px] flex-col border-l border-x-border bg-white shadow-xl">` → 헤더(`px-6 pt-5 pb-4 border-b`): 왼쪽 `<p className="text-ui text-x-secondary">{crumb}</p><h2 className="text-[20px]">{title}</h2>`(볼드 없음), 오른쪽 `{menu}<button aria-label="닫기">✕</button>`. 몸통 `flex-1 overflow-y-auto px-6 py-4 space-y-5`. 푸터 `border-t px-6 py-3 flex items-center gap-3`.

- crumb/title: edit → `${FLOW_STAGE_LABEL[flowStage(t, t.settlement)]} · ${TASK_TYPE_LABEL[t.type]}` / `t.influencerHandle ? '@'+h : <span className="text-x-muted">인플루언서 미정</span>`. new → `새 작업` / `type ? `새 ${TASK_TYPE_LABEL[type]} 작업` : '어떤 작업인가요?'`.
- new 모드 로컬 상태: `type: TaskType | null`, `handle: string`(InfluencerField 값), `cost: TaskCost | null`(Task 8 슬롯이 결정 — 이 작업에서는 `CostPopover` 임시), `scheduledOn`, `visitOn`, `note`, `target: { taskId } | { url } | null`(Task 9 슬롯). 유형 선택은 세그먼트 4버튼(`aria-pressed`). `[만들기]`/`[만들고 하나 더]`는 `type`이 있어야 활성; 비활성 이유 문구 `유형을 먼저 골라요`. 제출 → `onCreate({ type, influencers: handle ? [{ handle, cost }] : [], cost: handle ? undefined : cost ?? undefined, scheduledOn, visitOn, note, targetTaskId/targetTweetUrl }, more)`; 성공하고 `more`면 상태 초기화(유형은 유지).
- edit 모드 칸(`PANEL_FIELD_ORDER[t.type]` 순, 각 칸 `<div><p className="text-ui text-x-secondary">{label}</p><div className="mt-1">…</div></div>`):
  - `influencer`: 인플 있음 → `<span className="text-content">@{h}</span>` + `[바꾸기]`(`menu`의 교체와 같은 핸들러 — props `onReplace(t)`) ; 없음 → `InfluencerField`(`hideLabel hideHelp`, `onEnter`/`onBlur` → `parseXHandle` 검증 후 `actions.assignInfluencer(t, handle)`). 취소 행이면 읽기 전용 텍스트. 게시된 작업은 `[바꾸기]` 없음(서버가 거절) + 문구 없음(칸 자체가 값만).
  - `cost`: `slots.cost`(Task 8). visit는 라벨 `예산`.
  - `draft`: 원고 있음 → `제목(draftLabel) · 상태(STATUS_LABEL)` + `[열기]`(`onOpenDraft`) `[떼기]`(`onDetachDraft`, confirm 없음 — 원고는 남는다고 토스트가 말한다). 없음 → `<Link href={onGenerateHref(t)}>새로 만들기</Link> · <button onClick={() => onAttachDraft(t)}>있는 원고 고르기</button>` + `<p className="text-caption text-x-muted">인플루언서가 직접 쓰면 비워 둬요</p>`. 취소 행 → `원고 있었음: …` 또는 `—`.
  - `target`: `slots.target`(Task 9).
  - `scheduled`: `ScheduledOnField`(`value=t.scheduledOn`, `overdueDays=taskOverdueDays(t, today)`, `outOfRange=isOutOfRange(...)`, `emptyLabel="미정"`, `onChange → actions.changeScheduledOn`).
  - `dates`(visit): 두 칸 grid — 방문일 `ScheduledOnField`(`onChange → actions.changeVisitOn`, `overdueDays={null}`, `ariaLabel="방문일"`) · 게시 예정일. 라벨 옆 보조 `방문일이 지나면 인플루언서를 바꿀 수 없어요`(`text-caption text-x-muted`).
  - `note`: `<input>` + blur/Enter로 `actions.setNote(t, value)`(값이 바뀌었을 때만).
  - 취소 행: 모든 칸 읽기 전용(메모만 편집), 맨 위에 `<p className="rounded-lg bg-slate-50 px-3 py-2 text-ui text-slate-600">취소된 작업이에요 — ··· 메뉴의 [되돌리기]로 살릴 수 있어요</p>`.
- 푸터: edit → `<Button onClick={onPrev} disabled={index<=0}>← 이전</Button><span className="text-ui text-x-muted tabular-nums">{index+1} / {total}</span><Button onClick={onNext} disabled={index>=total-1}>다음 →</Button>`(`ml-auto`로 오른쪽 정렬). new → 왼쪽 `비어 있는 칸은 나중에 채워도 돼요` + 오른쪽 `[만들고 하나 더]` `[만들기](primary)`.
- Esc: `document keydown` 리스너(비 capture) — 팝오버들이 capture에서 `stopPropagation`하므로 열린 팝오버가 먼저 닫힌다.

- [ ] **Step 3: BulkCreateDialog**

Props `{ onClose; onCreate(counts: Record<TaskType, number>): Promise<void> }`. 모달(`fixed inset-0 z-50 bg-black/40`, 폭 440): 안내 `유형별로 몇 건 만들지 적으면 빈 작업이 그 수만큼 생겨요. 인플루언서·원고·비용은 만든 뒤 각 작업에서 채워요.`, 4행 `라벨 · <input inputMode="numeric" min=0 max=20>`(기본 0), 버튼 `작업 N개 만들기`(N=합, 0이면 비활성 + `한 유형이라도 1 이상 적어요`). 제출 → 부모가 유형별로 `createTasksApi(campaignId, { type, count, influencers: [] })`를 순서대로(`quoteRt → post → rt → visit`) 호출, 첫 성공 응답의 `tasks[0].id`로 패널을 연다.

- [ ] **Step 4: FlowDetail 연결**

- `panel` 상태 → `TaskPanel` 렌더. edit 모드의 `index/total`은 `shown`(표시 순서) 기준; 패널이 가리키는 작업이 필터로 사라져도 패널은 유지(`data.tasks`에서 찾음), 이전/다음은 `shown` 안에서만.
- `[+ 작업 추가]` → `setPanel({ fresh: true })`, `[한 번에 만들기]` → `setBulkOpen(true)`.
- `onCreate` → `createTasksApi` 성공 시 `load()`·`onChanged()`; `more`가 아니면 만든 작업 패널로 전환(`setPanel({ taskId: r.data.tasks[0].id })`).
- `onDetachDraft(t)` → `patchDraftApi(t.draftId, { taskId: null })` 성공 시 `load()` + 토스트 `작업에서 뗐어요 — 작업도 원고도 남아 있어요`.
- `onGenerateHref(t) = draftWriteHref(t.id, id)`.

- [ ] **Step 5: 빌드·커밋**

```bash
git add src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/BulkCreateDialog.tsx src/app/campaigns/flow/useFlowTaskActions.ts src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 편집 패널(행 클릭·이전/다음·새 작업 만들기) + 한 번에 만들기 + 취소/되돌리기/교체 액션 훅"
```

---

### Task 8: 비용 [확인] — `CostConfirmField` + `PriceProfileDialog`

**Files:**
- Create: `src/app/campaigns/flow/CostConfirmField.tsx`, `src/app/campaigns/flow/PriceProfileDialog.tsx`
- Modify: `src/lib/campaignApi.ts` (`patchInfluencerPricingApi`), `src/lib/campaignFlowView.ts` (+test: `costConfirmScenario`)
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` 슬롯 연결(`FlowDetail`)

**Interfaces:**
- `costConfirmScenario(input: { profile: TaskCost | null; entered: TaskCost | null }): 'empty' | 'same' | 'differs' | 'no-profile' | 'currency-mismatch'` (순수 함수, 테스트)
- `patchInfluencerPricingApi(influencerId, patch: Pricing)` → `PATCH /api/influencers/{id}` `{ pricing }`.
- `CostConfirmField({ task, option, label, onSave(cost: TaskCost): Promise<boolean>, onSaveProfile(option, cost): Promise<boolean>, disabledReason?: string })`.

- [ ] **Step 1: 순수 함수 테스트 → 구현**

`campaignFlowView.test.ts`에:

```ts
test('9) 비용 확인 시나리오 — 같음 / 다름 / 프로필 없음 / 통화 다름 / 빈칸', () => {
  const k = (amount: number, currency: 'KRW' | 'JPY' = 'KRW') => ({ amount, currency });
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(30000) }), 'same');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(35000) }), 'differs');
  assert.equal(costConfirmScenario({ profile: null, entered: k(50000) }), 'no-profile');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(3000, 'JPY') }), 'currency-mismatch');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: null }), 'empty');
});
```

구현(`campaignFlowView.ts`):

```ts
// 비용 [확인](R24·§4-3) — 확정은 '저장'이다(확정 전 값은 저장하지 않는다). 프로필 반영 질문은 differs·no-profile 때만.
export type CostConfirmScenario = 'empty' | 'same' | 'differs' | 'no-profile' | 'currency-mismatch';
export function costConfirmScenario({ profile, entered }: { profile: TaskCost | null; entered: TaskCost | null }): CostConfirmScenario {
  if (!entered) return 'empty';
  if (!profile) return 'no-profile';
  if (profile.currency !== entered.currency) return 'currency-mismatch';
  return profile.amount === entered.amount ? 'same' : 'differs';
}
```

- [ ] **Step 2: API**

`campaignApi.ts`: `import type { Pricing } from './influencerPricing.ts';` · `export const patchInfluencerPricingApi = (influencerId: string, pricing: Pricing) => call<unknown>(`/api/influencers/${influencerId}`, json('PATCH', { pricing }));`

- [ ] **Step 3: CostConfirmField**

상태: `amount: string`(초기 = `task.cost?.amount ?? profileSuggestion?.amount ?? ''`), `currency`(초기 = `task.cost?.currency ?? profileSuggestion?.currency ?? 'KRW'`), `confirmed = task.cost !== null`(저장된 값 = 확정), `dialog: { scenario: 'differs' | 'no-profile'; entered: TaskCost } | null`, `busy`.
- 인플 미정 → `<input disabled placeholder="₩" className="… border-dashed" />` + `<p className="text-caption text-x-muted">인플을 정하면 프로필 단가로 채워요</p>`.
- 렌더: `<div className="flex items-center gap-2"><input inputMode="numeric" value={amount} onChange=… className={`h-10 flex-1 rounded-md border px-3 text-content tabular-nums ${confirmed && !dirty ? 'border-x-border-strong' : 'border-dashed border-x-border-strong text-x-secondary'}`} /><select currency …/>{(!confirmed || dirty) && <Button onClick={confirm} disabled={!parsed}>확인</Button>}</div>` + 상태 줄(`text-caption`): 확정·안 바뀜 → `✓ 확정{profileNote}`; 비었음 → profile 없으면 `프로필에 단가 없음 — 직접 입력` 아니면 `금액을 넣어 주세요`; 입력 있고 `same` → `프로필 단가 · {TASK_TYPE_LABEL[type]}`; `differs` → `프로필 단가 {formatAmount(profile)}과 다름`(`text-amber-700`); `no-profile` → `프로필에 단가 없음`; `currency-mismatch` → `프로필 단가는 {통화}로 적혀 있어요 — 이 작업만 저장돼요`.
- `confirm()`: `entered = { amount: parseAmount(amount), currency }`(`parseAmount` null이면 `AMOUNT_MESSAGE` 표시) → `ok = await onSave(entered)` → 실패면 끝. 성공이면 시나리오 `same`·`currency-mismatch` → 끝(`✓ 확정`); `differs`·`no-profile` → `setDialog({ scenario, entered })`.
- `PriceProfileDialog({ scenario, handle, type, profile, entered, onAnswer(toProfile: boolean) })`: 제목 `프로필 단가`, 본문 `differs` → `@{handle} 프로필의 {유형} 단가도 {formatAmount(profile)} → {formatAmount(entered)}으로 바꿀까요?` / `no-profile` → `@{handle} 프로필에 {유형} 단가 {formatAmount(entered)}으로 저장할까요?`, 보조 `이 작업의 비용은 어느 쪽을 골라도 지금 값으로 확정돼요. 프로필을 바꾸면 인플루언서 타임라인에 단가 변경이 남아요.`, 버튼 `[이 작업만]` `[프로필도 바꾸기 | 프로필에 저장](primary)`. `toProfile` → `onSaveProfile(option, entered)` → 성공 시 `profileNote = ' · 프로필 단가 갱신됨'`.
- `onSaveProfile` 구현(FlowDetail): `option.id`가 없으면 토스트 `이 인플루언서는 명부에 없어 프로필을 바꿀 수 없어요` return false; 있으면 `patchInfluencerPricingApi(option.id, { [type]: amount, currency })` → 성공 시 `influencerOptions` 재조회(`/api/drafts/influencers`).

- [ ] **Step 4: 슬롯 연결·빌드·커밋**

`FlowDetail`에서 `slots.cost = <CostConfirmField task={t} option={optionFor(t.influencerHandle)} label={t.type === 'visit' ? '예산' : '비용'} onSave={(c) => actions.changeCost(t, c)} onSaveProfile={saveProfilePricing} />`. new 모드에서는 같은 컴포넌트를 로컬 상태 버전으로(`onSave`가 로컬 `setCost`만 하고 true 반환, 프로필 저장은 생성 뒤가 아니라 즉시 — 인플 명부 값이므로 작업 생성과 무관).

```bash
git add src/app/campaigns/flow/CostConfirmField.tsx src/app/campaigns/flow/PriceProfileDialog.tsx src/lib/campaignApi.ts src/lib/campaignFlowView.ts src/lib/campaignFlowView.test.ts src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/TaskPanel.tsx
git commit -m "feat(campaign-v2): 비용 [확인] — 프로필 단가 같음/다름/없음 3시나리오, 확정 = 저장"
```

---

### Task 9: 대상 링크 칸 + 게시 확인 다이얼로그

**Files:**
- Create: `src/app/campaigns/flow/TargetLinkField.tsx`, `src/app/campaigns/flow/PostedDialog.tsx`
- Modify: `src/app/campaigns/PostedCell.tsx` (게시 확인 폼을 `PostedForm`으로 추출 — 동작 변화 없음)
- Modify: `TaskPanel.tsx`·`FlowDetail.tsx` 슬롯 연결

- [ ] **Step 1: TargetLinkField**

Props `{ task: FlowRow; campaign: CampaignRow; onChange(next: { taskId } | { url } | null) }`(= `actions.changeTarget`).
- 현재 값 표시: `t.targetTweetUrl` → 입력칸에 그 URL; `t.target` → 입력칸 비활성 + 아래 카드 `@{h} {유형}{t.target.postUrl ? ` · 게시됨` : ` · 게시 확인 전`}{다른 캠페인이면 · campaignName}{t.target.cancelledAt ? ' · 대상 작업 취소됨'(빨강) : ''}` + `[바꾸기]`(→ 값 비우고 입력 모드) — 링크가 채워졌으면(`postUrl`) 그 링크를 `<a target=_blank>`로 보인다(R25 "게시 확인되면 링크 자동 채움").
- 입력 모드: `<input placeholder="https://x.com/…" onBlur/Enter → normalizeTargetTweetUrl → ok면 onChange({ url }) / 실패면 오류 문구 'X 게시물 주소가 아니에요 — x.com/계정/status/숫자 형식이어야 해요'>` + 체크박스 `아직 게시 전인 글이에요 — 링크는 나중에` → 체크 시 아래 `어느 작업인가요? <TargetPicker value={null} clientId campaignId excludeTaskId={task.id} onChange={(n) => n && 'taskId' in n && onChange({ taskId: n.taskId })} />` + `<p className="text-caption text-x-muted">선택 안 해도 돼요 — 그 글이 게시 확인되면 링크가 자동으로 채워져요</p>`. 값이 있으면 `[대상 비우기]`(`onChange(null)`).
- 취소 행: 읽기 전용 텍스트(`targetLabel` 재사용).

- [ ] **Step 2: PostedCell에서 폼 추출**

`PostedCell.tsx`의 `!task.postedAt` 분기 내용(제목·설명·날짜·링크·증빙·오류·버튼 줄)을 `export function PostedForm({ task, today, onSubmit(date, postUrl?, proof?), onCancel, submitLabel = '게시됨으로 표시' })`로 뺀다 — 상태(`date/url/err/pendingProof`)와 `submitPosted` 로직을 함께 옮기고, `PostedCell`은 `<PostedForm … onSubmit={(d,u,p) => { onMarkPosted(d,u,p); close(); }} onCancel={close} />`를 렌더. 동작·문구 변화 0(기존 표에서 그대로 보이는지 build로만 확인).

- [ ] **Step 3: PostedDialog**

`PostedDialog({ task, today, onClose, onSubmit })` — 모달(폭 520) 안에 `PostedForm` + 위에 요약 줄 `{유형} · @{h} · 예정 {날짜}` + 아래 안내 `확인하면 이 작업이 게시로 내려가고, 비용·인플루언서가 있으면 정산 대기에 잡혀요. 게시 확인은 되돌리지 않아요.`(§4-5). RT면 폼이 증빙 필수를 이미 강제한다.

- [ ] **Step 4: 연결**

`FlowDetail`: `postedFor: FlowRow | null` 상태; 다이얼로그 `onSubmit → actions.markPosted(t, date, url, proof)`(기존 `CampaignDetail`처럼 링크가 있으면 `load()`). 패널 edit 모드에서 게시 전·취소 아닌 작업이면 칸 목록 끝에 `[게시 확인]` 버튼 한 줄(`Button variant="subtle"`) → `setPostedFor(t)`; 게시된 작업은 `게시 {formatDateKo(postedAt)}{postUrl ? ' · 게시물 보기 ↗' : ''}` 텍스트(+ RT 증빙은 `증빙 보기` 기존 라이트박스 패턴 — `useSignedTaskProofUrls`).

```bash
git add src/app/campaigns/flow/TargetLinkField.tsx src/app/campaigns/flow/PostedDialog.tsx src/app/campaigns/PostedCell.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 대상은 링크 하나 + 게시 전 체크(작업 선택) · 게시 확인 다이얼로그(PostedCell 폼 재사용)"
```

---

### Task 10: `···` 메뉴(행·패널 공용) + 취소·교체 다이얼로그

**Files:**
- Create: `src/app/campaigns/flow/FlowRowMenu.tsx`, `src/app/campaigns/flow/CancelDialog.tsx`, `src/app/campaigns/flow/ReplaceDialog.tsx`
- Modify: `FlowDetail.tsx`(renderMenu·패널 menu·다이얼로그 상태)

- [ ] **Step 1: FlowRowMenu**

`TaskTable.tsx`의 `RowMenu` 골격(포털·좌표·닫기)을 복사해 항목만 바꾼다. Props `{ task: FlowRow; on: { posted; schedule; openDraft; attachDraft; generateHref; linkPost; replace; cancel; restore; remove } }`. 항목(§3-2, 순서 고정):
- 게시 전·취소 아님: `게시 확인` · `예정일 바꾸기`(→ 패널 열기) 
- 원고: 있으면 `원고 열기`; 없고 RT 아니고 취소 아님 → `원고 붙이기` + `새로 만들기`(Link)
- 게시 전·취소 아님·RT 아님: `게시물 연결(트래킹)`
- 구분선 · 게시 전·취소 아님: `인플루언서 교체`(인플 없으면 비활성 + title `배정부터 해요`; visit이고 `visitOn < today`면 비활성 + `방문한 인플루언서가 게시해야 해요`) · `작업 취소`(빨강)
- 취소 행: `되돌리기`
- 구분선 · `삭제`(빨강, `window.confirm` 기존 문구)
메뉴 폭 200, 항목 높이 32.

- [ ] **Step 2: CancelDialog**

`{ task, onClose, onConfirm(body: { reason: CancelReason | null; note: string }) }`. 요약 줄 `{유형} · @{h} · 예정 {날짜} · {비용}`, 안내 `취소한 작업은 표에 '취소'로 남고 되돌릴 수 있어요. 비용 합계·밀림에서는 빠져요.{t.draftId ? ` 붙어 있던 원고 "${draftLabel}"는 떼어져 다른 작업에 쓸 수 있어요.` : ''}`, 사유 칩(`CANCEL_REASON_CHIPS`, 토글, `aria-pressed`) + `거절·무응답은 이 인플루언서 프로필의 타임라인에도 한 줄 남아요`, 메모 입력(선택), 버튼 `[닫기] [❌ 취소하기](primary)`.

- [ ] **Step 3: ReplaceDialog**

`{ task, influencerOptions, onClose, onConfirm(body: { handle; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) }`. 요약 줄, `새 인플루언서` = `InfluencerField`(`hideLabel`, 현재 핸들과 같으면 오류 `같은 인플루언서예요 — 바꿀 사람을 골라요`), `교체 후 비용` = 라디오 2개 `지금 금액 유지 {formatAmount(t.cost)}`(cost 없으면 이 항목 대신 `비용 없음 — 그대로`) / `새 단가로 {formatAmount(suggest)} (명부 {유형} 단가)`(새 핸들의 `suggestTaskCost`가 있을 때만; 통화가 다르면 표시 안 함) — 기본 선택 = 유지. 사유 칩(라벨 `@{h}가 빠지는 이유 · 선택`), 안내 `작업·대상·예정일은 그대로예요.{t.type === 'rt' && t.proof ? ' 올려둔 RT 증빙은 지워져요.' : ''}{t.draftStatus === 'delivered' ? " 원고 상태는 '전달됨'에서 '사용 확정'으로 돌아가요." : ''}`, 버튼 `[닫기] [교체하기](primary)`. `onConfirm({ handle, cost: 라디오가 새 단가면 suggest, 아니면 undefined, reason, note })`.

- [ ] **Step 4: 연결**

`FlowDetail`: 상태 `cancelFor`·`replaceFor`; `renderMenu={(t) => <FlowRowMenu task={t} on={…} />}`; 패널 `menu`도 같은 컴포넌트(`task=panel task`). `restore` 는 confirm 없이 즉시. `remove` 는 기존 confirm 문구 + `actions.remove`(패널이 그 작업을 보고 있었으면 닫기).

```bash
git add src/app/campaigns/flow/FlowRowMenu.tsx src/app/campaigns/flow/CancelDialog.tsx src/app/campaigns/flow/ReplaceDialog.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): ··· 메뉴(게시 확인·예정일·원고·연결·교체·취소·되돌리기·삭제) + 취소·교체 다이얼로그"
```

---

### Task 11: 요약 카드 3장 + 성과 [업데이트]

**Files:**
- Create/Replace: `src/app/campaigns/flow/FlowCards.tsx`
- Modify: `FlowDetail.tsx`

- [ ] **Step 1: FlowCards**

Props `{ stats: FlowStats; budget: CampaignMonthBudget | null; clientId: string | null; cancelledCount: number; refreshing: boolean; onRefresh(): void }`.

`<div className="grid grid-cols-[0.9fr_1.1fr_1.4fr] gap-0">`, 칸은 `SummaryCards.Card`처럼 왼쪽 구분선(`border-l first:border-l-0 px-5`). 각 칸:
1. **작업** — 제목 `<p className="text-ui text-x-secondary">작업</p>`, 큰 숫자 `<p className="text-[26px] tabular-nums">{posted} <span className="text-content text-x-muted">/ {planned}</span></p>`, 라벨 `게시`, 막대(`h-1.5 rounded bg-x-border` 안 `bg-x-text` 폭 `posted/planned`). `title={`취소 ${cancelledCount}건은 빼고 셉니다`}`.
2. **성과** — 제목 줄 오른쪽에 `<Button variant="subtle" disabled={refreshing || withPerf === 0} onClick={onRefresh} title={`게시물 ${withPerf}건을 다시 조회해요 — 게시물당 API 1회`}>{refreshing ? '조회 중…' : '업데이트'}</Button>`(`withPerf === 0`이면 title `조회할 게시물 링크가 없어요`). 숫자 셋 가로(`flex gap-6`): 조회·좋아요·북마크(`toLocaleString('ko-KR')`). 칸 `title={`게시물 링크가 있는 ${withPerf}건 합계${noLink ? ` · 링크 없는 게시물 ${noLink}건은 합계 밖` : ''}`}`. **기준 시각은 넣지 않는다** — 상세 응답에 최신 스냅샷 시각이 없다(§8 후속 항목).
3. **비용** — 왼쪽 `{formatMoneyBy(spent)} <span muted>/ {formatMoneyBy(plannedCost)}</span>` 라벨 `소진 / 계획`; 오른콽(`text-right`) 예산: `budget?.amount != null ? formatAmount(budget.amount, 'KRW')` 라벨 `{monthShort(budget.month)} 예산` / 예산 없음 → `—` + 라벨 `예산 미설정`(clientId 있으면 `Link /clients?client=`). 막대(예산이 전체 길이, 예산 없으면 막대 없음): 회색 `budget.othersKrw` → 진한 파랑 `toKrw(spent).krw` → 연한 파랑 `toKrw(plannedCost).krw - toKrw(spent).krw` → 빈칸. 폭은 `Math.min(100, v / amount * 100)`. `title={`${monthShort(month)} 예산 ${formatAmount(amount)} · 회색은 이달 다른 캠페인 계획 ${formatAmount(othersKrw)} · 인플별 추가 비용은 계획에 포함 · 송금 수수료 미포함`}`.

- [ ] **Step 2: 연결**

`FlowDetail`: `refreshing` 상태; `onRefresh` → `refreshCampaignPerfApi(id)` → 성공 시 `load()` + 토스트 `게시물 ${r.data.refreshed}건을 다시 조회했어요${r.data.unavailable ? ` · ${r.data.unavailable}건은 찾을 수 없어요` : ''}${r.data.failed ? ` · ${r.data.failed}건은 실패했어요` : ''}`; 실패 시 `show(r.error)`. `cancelledCount = data.tasks.filter(isTaskExcluded).length`.

```bash
git add src/app/campaigns/flow/FlowCards.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(campaign-v2): 요약 카드 작업·성과·비용(예산 막대) + 성과 업데이트 버튼"
```

---

### Task 12: 마무리 — 문서·업데이트 소식·전체 검증

**Files:**
- Modify: `src/content/updates.ts`, `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` §8, `CONTEXT.md`(필요 시)

- [ ] **Step 1: updates.ts 항목(맨 위)**

```ts
  {
    date: '2026-09-XX', type: '새 기능',
    title: '캠페인 v2 — 한 화면에서 작업을 만들고 채우고 게시 확인·정산까지 이어갈 수 있어요',
    summary: '사이드바 "캠페인 v2"에 새 캠페인 화면이 생겼어요. 표 하나에 작업이 한 줄씩 놓이고, 행을 누르면 오른쪽 패널에서 인플루언서·비용·원고·대상·예정일을 차례로 채워요. 기존 캠페인 화면은 그대로 있어요.',
    bullets: [
      '단계가 여섯 개로 정리됐어요 — 준비 · 전달 · 게시 · 정산 · 완료 · 취소. 저장하는 값이 아니라 데이터에서 자동으로 판정해요',
      '인플루언서가 거절했거나 응답이 없으면 작업을 "취소"로 남기고(사유·메모), 되돌릴 수 있어요. 같은 작업에서 인플루언서만 바꾸는 "교체"도 생겼어요',
      '작업은 유형별 개수로 뼈대를 먼저 만들고([한 번에 만들기]) 나중에 채울 수 있어요',
      '비용은 인플루언서 프로필 단가로 채워지고 [확인]을 눌러 확정해요 — 단가가 다르거나 없으면 프로필에도 반영할지 물어요',
      '위 카드 3장: 게시 / 계획 작업 수 · 조회·좋아요·북마크 합계([업데이트]로 다시 조회) · 소진 / 계획 비용과 이달 예산',
      '정산 요청은 지금처럼 정산 화면에서 — 표 위 "정산 대기 N건" 링크가 그 캠페인만 골라 열어요',
    ],
    link: { label: '캠페인 v2', href: '/campaigns/flow' },
  },
```

날짜는 머지 예정일로. `node --import tsx --test src/lib/updates.test.ts`.

- [ ] **Step 2: 결정 문서 §8 갱신**

- `[ ] 거절·무응답 사유 이모지` → 가안 그대로 구현됨(`CANCEL_REASON_CHIPS` 한 곳) — koo 확정 대기 표기.
- `[ ] 성과 [업데이트] 버튼에 비용 안내` → 툴팁 `게시물 n건 · 게시물당 API 1회`로 구현(금액 없음) — koo 확인.
- `[ ] 패널 ··· 위치` → 헤더 오른쪽으로 구현 — koo "만들어진 거 보고 결정".
- 새 항목: `[ ] R25 부분 구현 — '게시 전' 체크만 하고 작업을 안 고른 상태는 저장되지 않는다(스키마 변경 없음). 필요해지면 컬럼 하나(target_pending) 추가` · `[ ] 성과 카드 기준 시각 표시(상세 응답에 최신 captured_at 없음)` · `[ ] M4 REPLACE_AFTER_VISIT 문구가 배정·해제에도 나옴(A 이월)` · `[ ] WeekCalendar 취소 작업 빈 주 행(A 이월, 기존 화면)`.

- [ ] **Step 3: 전체 검증**

Run: `npx tsc --noEmit && npx eslint src/app/campaigns/flow src/lib/campaignFlowView.ts src/lib/campaignFlowView.test.ts && npm run build 2>&1 | tail -3 && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: tsc 0 · 새 파일 lint 0 · build OK · fail 0(연습용 DB, ~20분).

- [ ] **Step 4: 커밋**

```bash
git add src/content/updates.ts docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md
git commit -m "docs(campaign-v2): B 새 페이지 배포 안내 + §8 확정·미결 항목 갱신"
```

---

## 계획 자체 검토(작성 시 self-review)

- **스펙 커버리지**: §3-1 단계(Task 1·2) · §3-2 표·필터·검색·정렬·하단 줄·정산 링크(2·6) · §3-3 카드 3장·[업데이트](3·11) · §4-1 입구 둘(7) · §4-2 패널·칸 순서·이전/다음(7) · §4-3 비용 확인(8) · §4-4 대상(9) · §4-5 게시 확인(9) · §6 취소·교체 UI(10) · R15 딥링크(4) · R2 사이드바(4) · R20 기존 화면은 A에서 완료. **§5 원고 모드는 C 계획**(패널 원고 칸은 기존 입구).
- **의도적 축소(koo 확인 항목)**: R25 '게시 전 체크만' 미저장 · 성과 기준 시각 없음 · 사유 이모지 가안 · 게시 확인 알림 없음.
- **타입 일관성**: `FlowRow = CampaignTaskItem`(`draftFirstLine`은 Task 1에서 `TaskRow`에 추가) · `flowStage(t, t.settlement)` 시그니처 `FlowSettlementInput`은 `SettlementBadge`가 구조적으로 만족(`status`·`externalStatus`) · `useCampaignTaskActions` 반환 타입 그대로 사용 · `TaskCreateRequest.count`.
- **테스트 없는 부분**: 컴포넌트(하네스 없음) — build + koo QA. 라우트 `perf-refresh`는 외부 API 호출이라 스토어 함수만 테스트.
