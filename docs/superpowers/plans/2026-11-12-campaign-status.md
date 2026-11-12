# 캠페인 현황 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이번 주 전체 X 주차 캠페인의 수량 진행과 캠페인별 성과(조회수, 저장수, CPV, 흐름 차트)를 한 화면에서 보는 읽기 전용 페이지 `/campaigns/overview`를 만든다.

**Architecture:** 순수 계산 모듈(`campaignOverview.ts`)이 캠페인, 작업, 날짜별 측정값을 받아 화면이 그릴 값 전부(`Overview`)를 만든다. 스토어(`campaignOverviewStore.ts`)는 기존 `listCampaigns`와 `getCampaignDetail`을 그대로 써서 캠페인 상세와 같은 숫자를 보장하고, 흐름 차트용 날짜별 측정값만 새 쿼리 하나로 읽는다. API는 서버에서 계산을 끝낸 `Overview`를 내려주고, 화면 컴포넌트는 그리기만 한다.

**Tech Stack:** Next.js(이 저장소의 버전, 아래 제약 참고), TypeScript, postgres.js, node:test + tsx, 자체 차트 부품(`src/components/charts/`, d3-scale, d3-shape).

**Spec:** `docs/superpowers/specs/2026-11-12-campaign-status-design.md`
**시안(모양의 기준):** `docs/mockups/campaign-status-20261112.html` — 브라우저로 열어 CSS 값을 직접 읽는다.

## Global Constraints

- 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 안내를 읽는다(AGENTS.md: 이 Next.js는 학습 데이터와 다르다).
- 마이그레이션 없음. 외부 API 호출 없음. 데이터를 바꾸는 코드 없음(읽기 전용).
- 새 라이브러리를 들이지 않는다. 차트는 `src/components/charts/tokens.ts`의 `C`, `T`, `S`, `compact`, `NUM`만 쓴다.
- 간격, 글자 크기, 색, 문구는 시안 파일의 값을 그대로 옮긴다. 문구를 바꾸거나 줄이지 않는다.
- 화면 문구 규칙: 가운뎃점(·) 구분자 금지(나열은 쉼표), 상태 라벨은 짧은 명사형, 내부 용어 금지.
- 글자 14~15px, 표의 행 44px 이상, 한 행 정보 6개 이하.
- 날짜와 "오늘"은 전부 한국 시각(`src/lib/datetime.ts`의 `kstToday`, `kstDate`).
- 테스트는 연습용 DB에서만(`npm test`가 `.env.staging`을 읽고 `scripts/testGuard.ts`가 운영을 막는다). 단일 파일: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test <파일>`.
- 이 워크트리에는 `.env`, `.env.staging`이 없다. `../same-visit-posts/`에서 두 파일을 복사한다(gitignore 대상, 커밋 금지).
- 스테이징은 경로를 명시해 `git add`한다(`git add -A` 금지). push는 koo 지시가 있을 때만. main과 브랜치를 동시에 push하지 않는다.
- 린트 기준선은 기존 경고 24개. 새 경고를 늘리지 않는다.

## Review Focus

1. **게시됐지만 측정값이 없는 작업만 있는 캠페인**(방금 게시, 링크 없이 게시 확인, RT만): 지표는 0이 아니라 "-", CPV도 "-", 차트 자리는 안내 문구. → Task 2 테스트.
2. **엔화 비용이 섞인 캠페인**: CPV는 원 환산 합으로 계산(`toKrw`). → Task 2 테스트.
3. **월이 바뀌는 주에 같은 클라이언트 캠페인이 둘**: 카드 두 장, 제목은 캠페인 이름. → Task 3 테스트.
4. **지난 주 보기**: 차트 범위가 오늘 또는 일요일+14일까지 늘고 마지막 점이 카드 숫자와 같다. 예정일 지난 미게시는 실제 오늘 기준. → Task 2, Task 3 테스트.
5. **잘못된 `?week=`**(월요일이 아닌 날짜, 미래 주, 쓰레기 값): 그 날짜가 속한 주의 월요일로 맞추고, 미래이거나 형식이 틀리면 이번 주. → Task 1 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/campaignOverview.ts` (새로) | 순수 계산 전부. 주 정하기, 수량, 상태, 성과, 날짜별 누적, 패널 줄, 장기 줄, `buildOverview` |
| `src/lib/campaignOverview.test.ts` (새로) | 위 단위 테스트(DB 없음) |
| `src/lib/campaignOverviewStore.ts` (새로) | 한 주에 필요한 재료 읽기 + `buildOverview` 호출 |
| `src/lib/campaignOverviewStore.test.ts` (새로) | 연습용 DB 통합 테스트 |
| `src/app/api/campaigns/overview/route.ts` (새로) | `GET ?week=` |
| `src/components/charts/CumulativeArea.tsx` (새로) | 단일 계열 누적 선 + 옅은 면, 오늘 점 강조, 점 위 글자 |
| `src/app/campaigns/overview/page.tsx` (새로) | 불러오기, 주 이동, 지표 전환, 패널 열림 상태 |
| `src/app/campaigns/overview/OverviewTiles.tsx` (새로) | 수량 네 칸 |
| `src/app/campaigns/overview/CampaignCard.tsx` (새로) | 카드 한 장(다섯 층) |
| `src/app/campaigns/overview/CampaignPanel.tsx` (새로) | 오른쪽 패널 |
| `src/app/campaigns/overview/LongCampaignTable.tsx` (새로) | 장기 캠페인 표 |
| `src/components/Sidebar.tsx` (수정) | `globalNav` 맨 앞에 "캠페인 현황" |
| `src/content/updates.ts` (수정, 머지 직전) | 업데이트 소식 한 건 |

---

### Task 1: 주 정하기, 수량, 카드 상태

**Files:**
- Create: `src/lib/campaignOverview.ts`, `src/lib/campaignOverview.test.ts`

**Interfaces:**
- Consumes: `weekStartOf`, `addDays`, `isTaskExcluded`, `isTaskOverdue`, `daysBetweenDates`(`campaignJudgment.ts`), `CampaignTaskItem`, `CampaignRow`(`campaignStore.ts`).
- Produces:

```ts
export interface OverviewWeek { weekStart: string; weekEnd: string; isCurrent: boolean }
export function resolveWeek(param: string | null, today: string): OverviewWeek;
// 계획 수량 — 나중에 최소 작업량이 생기면 여기만 바꾼다(스펙 §6)
export function plannedCount(tasks: CampaignTaskItem[]): number;
export interface Quantity { planned: number; posted: number; overdue: number; open: number; undated: number; cancelled: number }
// open = planned − posted(게시 전 전부, overdue 포함). undated = 게시 전이고 예정일 없음.
export function quantityOf(tasks: CampaignTaskItem[], today: string): Quantity;
export type CardStatus = 'unset' | 'done' | 'late' | 'onTrack';
export function cardStatus(q: Quantity): CardStatus;
export const CARD_STATUS_LABEL: (s: CardStatus, overdue: number) => string;
// 'unset' → '세팅 전', 'done' → '✓ 계획 완료', 'late' → `예정일 지난 ${overdue}건`, 'onTrack' → '예정대로'
```

- [ ] **Step 1: 실패하는 테스트 작성** — `campaignOverview.test.ts`. 작업 픽스처는 `campaignFlowView.test.ts`의 행 만들기 방식을 따라 `CampaignTaskItem`을 최소 필드로 만든다(헬퍼 `task(over: Partial<CampaignTaskItem>)`).

```ts
test('resolveWeek: 주 중 날짜는 그 주 월요일로, 틀린 값과 미래 주는 이번 주', () => {
  const today = '2026-11-12';
  assert.deepEqual(resolveWeek(null, today), { weekStart: '2026-11-09', weekEnd: '2026-11-15', isCurrent: true });
  assert.deepEqual(resolveWeek('2026-11-05', today), { weekStart: '2026-11-02', weekEnd: '2026-11-08', isCurrent: false });
  assert.equal(resolveWeek('2026-11-16', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('garbage', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('2026-13-40', today).weekStart, '2026-11-09');
});
test('quantityOf: 취소는 계획에서 빼고 따로 센다, 예정일 지난 것과 미정을 가른다', () => {
  const today = '2026-11-12';
  const q = quantityOf([
    task({ postedAt: '2026-11-10' }),
    task({ scheduledOn: '2026-11-10' }),            // 예정일 지남
    task({ scheduledOn: '2026-11-14' }),
    task({ scheduledOn: null }),                    // 미정
    task({ cancelledAt: '2026-11-09' }),
  ], today);
  assert.deepEqual(q, { planned: 4, posted: 1, overdue: 1, open: 3, undated: 1, cancelled: 1 });
});
test('cardStatus 네 가지와 문구', () => {
  const q = (o: Partial<Quantity>) => ({ planned: 5, posted: 2, overdue: 0, open: 3, undated: 0, cancelled: 0, ...o });
  assert.equal(cardStatus(q({ planned: 0, posted: 0, open: 0 })), 'unset');
  assert.equal(cardStatus(q({ posted: 5, open: 0 })), 'done');
  assert.equal(cardStatus(q({ overdue: 2 })), 'late');
  assert.equal(cardStatus(q({})), 'onTrack');
  assert.equal(CARD_STATUS_LABEL('late', 2), '예정일 지난 2건');
  assert.equal(CARD_STATUS_LABEL('done', 0), '✓ 계획 완료');
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/campaignOverview.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. `resolveWeek`는 `isDateOnlyString`으로 형식을 거른 뒤 실제 달력 날짜인지(예: `addDays(x, 0) === x`)도 확인한다. `overdue`는 기존 `isTaskOverdue(t, today)`만 쓴다(직접 비교 금지).
- [ ] **Step 4: 통과 확인** — 같은 명령, PASS.
- [ ] **Step 5: 커밋** — `git add src/lib/campaignOverview.ts src/lib/campaignOverview.test.ts && git commit -m "feat(overview): 주 정하기, 수량, 카드 상태 계산"`

---

### Task 2: 성과와 날짜별 누적

**Files:**
- Modify: `src/lib/campaignOverview.ts`, `src/lib/campaignOverview.test.ts`

**Interfaces:**
- Consumes: `flowStats`(`campaignFlowView.ts` — 조회수, 저장수, `cpvKrw`, `spent`), `toKrw`(`clientBudget.ts`), Task 1.
- Produces:

```ts
// 나중에 판정을 얹을 자리(스펙 §6) — 지금은 항상 null
export interface Metric { value: number | null; judgment: null }
export type CpvView = { kind: 'value'; krw: number } | { kind: 'free' } | { kind: 'none' };
export interface Perf { views: Metric; bookmarks: Metric; cpv: CpvView; spentKrw: number }
export function perfOf(tasks: CampaignTaskItem[]): Perf;
export function formatCpv(c: CpvView): string;   // '1.6원' | '무상' | '-'

// 스토어가 주는 재료: 본 게시물의 한국 날짜별 마지막 실측값
export interface DayPoint { taskId: string; day: string; views: number | null; bookmarks: number | null }
export interface FlowChart {
  days: string[];              // 'YYYY-MM-DD' 가로 칸 전부
  todayIndex: number;          // 선이 끝나는 칸(이번 주 = 오늘, 지난 주 = 마지막 칸)
  views: Array<number | null>; // todayIndex 뒤는 null
  bookmarks: Array<number | null>;
  postedPerDay: number[];      // 그날 게시된 작업 수(postedAt 기준)
}
export function chartDays(weekStart: string, today: string): { days: string[]; todayIndex: number };
// 게시된(취소 아님) 작업의 점만 쓴다. 점이 하나도 없으면 null.
export function flowChart(tasks: CampaignTaskItem[], points: DayPoint[], weekStart: string, today: string): FlowChart | null;
```

규칙(스펙 §5):
- `perfOf`의 조회수, 저장수, `cpvKrw`는 `flowStats(tasks)`의 값을 그대로 쓴다(캠페인 상세와 같은 숫자).
- `cpv`: `cpvKrw`가 있으면 `value`. 없을 때, 게시된 작업이 1건 이상이고 전부 `noCost`이거나 비용 0원이면 `free`, 그 밖은 `none`.
- `chartDays`: 이번 주(`weekStart ≤ today ≤ weekStart+6`)는 7칸, `todayIndex` = 오늘의 칸. 지난 주는 `weekStart`부터 `min(today, weekStart+6+14)`까지, `todayIndex` = 마지막 칸.
- 날짜 D의 값 = 게시물마다 D 이하에서 가장 늦은 점의 값(없으면 0)의 합. 한 게시물의 값이 null인 점은 건너뛰고 그 앞 값을 쓴다.
- 차트 마지막 점은 `perfOf`의 값과 같아야 한다 — 오늘 칸은 점 대신 `task.perf`의 최신값으로 덮는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('perfOf: 엔화 비용은 원으로 환산, 측정값 없으면 none, 전부 비용 없음이면 free', () => {
  const a = perfOf([
    task({ postedAt: '2026-11-10', cost: { amount: 10000, currency: 'JPY' }, perf: { postCount: 1, views: 100000, likes: 10, bookmarks: 300 } }),
    task({ postedAt: '2026-11-11', cost: { amount: 50000, currency: 'KRW' }, perf: { postCount: 1, views: 50000, likes: 5, bookmarks: 100 } }),
  ]);
  assert.equal(a.views.value, 150000); assert.equal(a.bookmarks.value, 400);
  assert.deepEqual(a.cpv, { kind: 'value', krw: 1 });           // (100,000원 + 50,000원) ÷ 150,000
  assert.equal(formatCpv(a.cpv), '1.0원');
  const noSnap = perfOf([task({ postedAt: '2026-11-12', cost: { amount: 50000, currency: 'KRW' }, perf: null })]);
  assert.equal(noSnap.views.value, null); assert.equal(formatCpv(noSnap.cpv), '-');
  const free = perfOf([task({ postedAt: '2026-11-10', noCost: true, cost: null, perf: { postCount: 1, views: 9000, likes: 1, bookmarks: 20 } })]);
  assert.equal(formatCpv(free.cpv), '무상');
});
test('chartDays: 이번 주는 7칸에 오늘까지, 지난 주는 일요일+14일 또는 오늘까지', () => {
  assert.deepEqual(chartDays('2026-11-09', '2026-11-12'), { days: ['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'], todayIndex: 3 });
  const past = chartDays('2026-11-02', '2026-11-12');
  assert.equal(past.days.at(-1), '2026-11-12'); assert.equal(past.todayIndex, past.days.length - 1);
  assert.equal(chartDays('2026-10-05', '2026-11-12').days.at(-1), '2026-10-25');
});
test('flowChart: 측정 없는 날은 앞 값을 잇고, 측정 전은 0, 오늘 뒤는 null, 마지막 점은 최신값', () => {
  const tasks = [
    task({ id: 'a', postedAt: '2026-11-09', perf: { postCount: 1, views: 5200, likes: 0, bookmarks: 52 } }),
    task({ id: 'b', postedAt: '2026-11-11', perf: { postCount: 1, views: 800, likes: 0, bookmarks: 8 } }),
    task({ id: 'c', cancelledAt: '2026-11-09', postedAt: '2026-11-09', perf: { postCount: 1, views: 99999, likes: 0, bookmarks: 0 } }),
  ];
  const pts: DayPoint[] = [
    { taskId: 'a', day: '2026-11-09', views: 1000, bookmarks: 10 },
    { taskId: 'a', day: '2026-11-11', views: 4000, bookmarks: 40 },   // 11/10은 측정 없음
    { taskId: 'b', day: '2026-11-11', views: 500, bookmarks: 5 },
    { taskId: 'c', day: '2026-11-09', views: 99999, bookmarks: 0 },   // 취소 — 제외
  ];
  const c = flowChart(tasks, pts, '2026-11-09', '2026-11-12')!;
  assert.deepEqual(c.views, [1000, 1000, 4500, 6000, null, null, null]);
  assert.deepEqual(c.postedPerDay, [1, 0, 1, 0, 0, 0, 0]);
  assert.equal(flowChart([task({ postedAt: '2026-11-12', perf: null })], [], '2026-11-09', '2026-11-12'), null);
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/campaignOverview.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 시그니처와 규칙대로.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `git commit -m "feat(overview): 성과와 날짜별 누적 계산"` (두 파일만 add)

---

### Task 3: 화면 값 조립 (`buildOverview`)

**Files:**
- Modify: `src/lib/campaignOverview.ts`, `src/lib/campaignOverview.test.ts`

**Interfaces:**
- Consumes: Task 1, 2. `isLongCampaign`, `staysInLongSection`, `weekKey`, `weekName`(`campaignListView.ts`), `TASK_TYPE_LABEL`, `hasXPost`(`campaignJudgment.ts`), `VisitPhase`(`reservationPolicy.ts`), `weekRangeLabel` 또는 `formatDateKo`(날짜 문구).
- Produces:

```ts
export interface OverviewInput {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; points: DayPoint[];
  visitPhases: Record<string, VisitPhase>;   // 장기 캠페인의 방문 작업만. 없는 작업 id는 'unregistered'로 본다
  perfUpdatedAt: string | null;
}
export interface OverviewTiles {
  campaignCount: number; unsetCount: number;
  planned: number; posted: number; overdue: number; remaining: number; undated: number;
  overdueBy: Array<{ title: string; count: number }>;   // 많은 순 최대 3개
  overdueMore: number;                                  // 그 밖의 캠페인 수
}
export interface PostedRow { taskId: string; handle: string | null; typeLabel: string; postedOn: string; url: string | null;
  views: number | null; bookmarks: number | null; likes: number | null; cpvKrw: number | null }
export interface OpenRow { taskId: string; handle: string | null; typeLabel: string; scheduledOn: string | null; overdueDays: number | null }
export interface OverviewCard {
  campaignId: string; title: string; status: CardStatus; statusLabel: string;
  quantity: Quantity; perf: Perf; chart: FlowChart | null;
  posted: PostedRow[];   // 조회수 많은 순, 측정값 없는 줄은 뒤
  open: OpenRow[];       // 예정일 지난 것 먼저(오래된 순), 그다음 예정일 순, 미정은 맨 뒤
}
export interface LongRow { campaignId: string; title: string; stages: Array<{ label: string; count: number }>; postedThisWeek: number; perf: Perf }
export interface Overview {
  week: OverviewWeek; weekName: string; today: string; perfUpdatedAt: string | null;
  tiles: OverviewTiles; cards: OverviewCard[]; long: LongRow[];
}
export function pickWeekly(campaigns: CampaignRow[], weekStart: string): CampaignRow[];   // 장기 아님 && weekKey(startsOn) === weekStart
export function pickLong(campaigns: CampaignRow[], today: string): CampaignRow[];         // staysInLongSection
export function buildOverview(weekly: OverviewInput[], long: OverviewInput[], week: OverviewWeek, today: string): Overview;
```

규칙:
- `title`: 클라이언트 이름(없으면 캠페인 이름). 같은 주 카드 중 같은 `clientId`가 둘 이상이면 그 카드들만 캠페인 이름.
- 카드 순서: 세팅 전은 맨 뒤 → `overdue` 많은 순 → `title` 한글 이름순(`localeCompare(…, 'ko')`).
- `tiles`: 주차 카드만 합친다. `remaining = planned − posted − overdue`.
- `PostedRow.url`: 작업의 `postUrl`(없으면 null — 누를 수 없는 줄). `cpvKrw`: 그 작업 비용(원 환산) ÷ 조회수, 못 구하면 null. `typeLabel`: `TASK_TYPE_LABEL[type]`, 기타 협찬은 `otherKind`가 있으면 그것.
- `OpenRow.overdueDays`: `isTaskOverdue`면 `daysBetweenDates(scheduledOn, today)`, 아니면 null.
- `LongRow.stages` — 취소 아닌 작업을 아래로 묶고 0건은 뺀다. 순서는 표의 순서.

| 작업 | 조건 | 라벨 |
|---|---|---|
| 방문협찬 | phase `unregistered`, `waiting` | 예약 대기 |
| 방문협찬 | `confirmed` | 예약 확정 |
| 방문협찬 | `visited` | 방문 완료 |
| 모든 유형 | `postedAt` 있음(방문은 phase `uploaded`, `settling`, `completed`) | 게시 |
| 방문협찬 | `cancelled`, `visit_no_show`, `upload_no_show` | 세지 않음 |
| 방문 아님 | 게시 전 | 준비 |

- `LongRow.postedThisWeek`: `postedAt`이 `week.weekStart`~`week.weekEnd`인 취소 아닌 작업 수. `perf`는 캠페인 전체 누적(`perfOf(tasks)`).

- [ ] **Step 1: 실패하는 테스트 작성** — 캠페인 픽스처 헬퍼 `camp(over: Partial<CampaignRow>)`.

```ts
test('pickWeekly, pickLong: 그 주에 시작한 주차 캠페인과 장기 캠페인을 가른다', () => {
  const cs = [
    camp({ id: 'w', startsOn: '2026-11-09', endsOn: '2026-11-15' }),
    camp({ id: 'prev', startsOn: '2026-11-02', endsOn: '2026-11-08' }),
    camp({ id: 'long', startsOn: '2026-10-01', endsOn: '2026-12-31' }),
  ];
  assert.deepEqual(pickWeekly(cs, '2026-11-09').map((c) => c.id), ['w']);
  assert.deepEqual(pickLong(cs, '2026-11-12').map((c) => c.id), ['long']);
});
test('buildOverview: 네 칸 합계, 카드 순서, 같은 클라이언트 둘이면 캠페인 이름', () => {
  const week = resolveWeek(null, '2026-11-12');
  const input = (c: Partial<CampaignRow>, tasks: CampaignTaskItem[]): OverviewInput =>
    ({ campaign: camp(c), tasks, points: [], visitPhases: {}, perfUpdatedAt: null });
  const o = buildOverview([
    input({ id: '1', clientId: 'A', clientName: '가', name: '가_11월2주차' }, [task({ postedAt: '2026-11-10' }), task({ scheduledOn: '2026-11-14' })]),
    input({ id: '2', clientId: 'B', clientName: '나', name: '나_11월2주차' }, [task({ scheduledOn: '2026-11-10' }), task({ scheduledOn: null })]),
    input({ id: '3', clientId: 'C', clientName: '다', name: '다_11월2주차' }, []),
    input({ id: '4', clientId: 'A', clientName: '가', name: '가_추가' }, [task({ postedAt: '2026-11-11' })]),
  ], [], week, '2026-11-12');
  assert.deepEqual(o.cards.map((c) => c.campaignId), ['2', '1', '4', '3']);          // 지연 → 이름순 → 세팅 전
  assert.deepEqual(o.cards.map((c) => c.title), ['나', '가_11월2주차', '가_추가', '다']);
  assert.deepEqual({ ...o.tiles, overdueBy: undefined }, { campaignCount: 4, unsetCount: 1, planned: 5, posted: 2, overdue: 1, remaining: 2, undated: 1, overdueBy: undefined, overdueMore: 0 });
  assert.deepEqual(o.tiles.overdueBy, [{ title: '나', count: 1 }]);
  assert.equal(o.weekName, '11월2주차');
});
test('overdueBy는 많은 순 3개, 나머지는 overdueMore', () => { /* 지연 캠페인 5개 → overdueBy.length 3, overdueMore 2 */ });
test('패널 줄: 게시된 것은 조회수 많은 순(측정 없음은 뒤), 게시 전은 지난 것 먼저, 미정은 맨 뒤', () => {
  /* posted 3건(views 100, null, 900) → [900, 100, null]; open 3건(예정 11/14, 11/10, null) → overdueDays [2, null, null], 순서 11/10, 11/14, 미정 */
});
test('지난 주를 볼 때도 예정일 지난 미게시는 실제 오늘 기준', () => {
  /* week = resolveWeek('2026-11-02', '2026-11-12'), 게시 전 작업 scheduledOn '2026-11-07' → overdue 1, overdueDays 5 */
});
test('장기 줄: 단계 묶음, 0건 생략, 노쇼 제외, 이 주 게시', () => {
  /* visit 작업 5개 phases: waiting, confirmed, visited, uploaded(postedAt 11/10), visit_no_show + post 작업 1개(게시 전)
     → stages [{예약 대기,1},{예약 확정,1},{방문 완료,1},{게시,1},{준비,1}], postedThisWeek 1 */
});
```

주석으로 적힌 네 테스트는 주석의 입력과 기대값 그대로 완성한다.

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 위 시그니처와 규칙대로.
- [ ] **Step 4: 통과 확인** — `node --import tsx --test src/lib/campaignOverview.test.ts` PASS(Task 1~3 전부).
- [ ] **Step 5: 커밋** — `git commit -m "feat(overview): 화면 값 조립"`

---

### Task 4: 스토어와 API

**Files:**
- Create: `src/lib/campaignOverviewStore.ts`, `src/lib/campaignOverviewStore.test.ts`, `src/app/api/campaigns/overview/route.ts`

**Interfaces:**
- Consumes: `listCampaigns`, `getCampaignDetail`(`campaignStore.ts` — `tasks`, `perfUpdatedAt`), `pickTaskMainPost`(`selfReplies.ts`), `loadTaskFacts`(`extensionReadStore.ts`) + `classifyTask`(`extensionTasks.ts`)로 방문 단계, `requireAllowedUser`(`authGuard.ts`), Task 1~3.
- Produces:

```ts
export async function getCampaignOverview(sql: postgres.Sql, weekParam: string | null, today?: string): Promise<Overview>;
// GET /api/campaigns/overview?week=YYYY-MM-DD → Overview(JSON)
```

읽는 순서:
1. `listCampaigns(sql)` → `pickWeekly`, `pickLong`.
2. 고른 캠페인마다 `getCampaignDetail(sql, id, today)`. **동시에 3개까지만** 돌린다(연결 수 5개 풀 — 2026-08 연결 고갈 사고가 있었다). 캠페인 상세와 같은 함수를 써서 숫자가 어긋날 길을 없앤다.
3. 날짜별 측정값 — 새 쿼리 하나. 주차 캠페인의 작업에 붙은 게시물 전부에 대해 (게시물, 한국 날짜)마다 마지막 실측값:

```sql
select distinct on (tp.id, d.day) tp.task_id, tp.tweet_id, tp.posted_at,
       d.day, s.views, s.bookmarks, (s.raw->>'isReply')::boolean as is_reply
  from tracked_post tp
  join post_metric_snapshot s on s.tracked_post_id = tp.id
  cross join lateral (select to_char(s.captured_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day) d
 where tp.task_id in ${sql(taskIds)}
 order by tp.id, d.day, s.captured_at desc
```

   작업마다 `pickTaskMainPost(task.postUrl, 그 작업의 게시물들)`로 본 게시물 하나를 골라 그 게시물의 줄만 `DayPoint`로 남긴다. `taskIds`가 비면 쿼리를 건너뛴다. 추정값 테이블(`post_metric_estimate`)은 읽지 않는다.
4. 방문 단계 — 장기 캠페인의 방문 작업이 있을 때만. 그 작업들의 핸들로 `loadTaskFacts`를 부르고 `classifyTask(f, today).visitPhase`를 작업 id로 모은다(장기 캠페인 작업 id만 남긴다). 예약 테이블이 없는 DB에서 이 호출이 실패하면 빈 맵으로 두고 계속한다(`campaignStore.reservationByTaskIds`가 같은 조건으로 건너뛴다 — 그 조건을 따른다).
5. `perfUpdatedAt` = 주차 캠페인 상세들의 `perfUpdatedAt` 중 가장 늦은 것.
6. `buildOverview(...)` 반환.

라우트는 `src/app/api/influencers/performance/route.ts`와 같은 모양: `requireAllowedUser()` 통과 후 `getCampaignOverview(getSql(), searchParams.get('week'))`.

- [ ] **Step 1: 실패하는 통합 테스트 작성** — `influencerPerformanceStore.test.ts`의 준비, 정리 방식을 그대로 따른다(접두어 `P = 'tcov' + process.pid`, `after`에서 접두어로 지우기). 정산 요청은 만들지 않는다(그쪽 폴링 노출 사고 방지).

```ts
test('이번 주 주차 캠페인의 수량과 성과, 날짜별 누적이 캠페인 상세와 같은 값으로 나온다', async () => {
  // today 고정: '2026-11-12'. 캠페인 P+'캠'(2026-11-09~11-15), 작업 4개:
  //  ① 게시 11/10, 비용 50,000원, 게시물 + 실측 2개(11/10 15:00 KST views 1000 bookmarks 10, 11/12 09:00 KST views 4000 bookmarks 40)
  //     + 같은 작업에 댓글 게시물 1개(실측 views 99999) — 합산되면 안 된다
  //  ② 예정 11/10 게시 전  ③ 예정 미정  ④ 취소
  const o = await getCampaignOverview(sql, null, '2026-11-12');
  const card = o.cards.find((c) => c.title === P + '클라')!;
  assert.deepEqual(card.quantity, { planned: 3, posted: 1, overdue: 1, open: 2, undated: 1, cancelled: 1 });
  assert.equal(card.perf.views.value, 4000); assert.equal(card.perf.bookmarks.value, 40);
  assert.deepEqual(card.perf.cpv, { kind: 'value', krw: 12.5 });
  assert.deepEqual(card.chart!.views.slice(0, 4), [0, 1000, 1000, 4000]);
  assert.equal(card.status, 'late');
});
test('지난 주(?week=)를 주면 그 주 캠페인만, 장기 캠페인은 long으로', async () => {
  // P+'지난'(2026-11-02~11-08), P+'장기'(2026-10-01~2026-12-31, 방문 작업 1개 게시 전)
  const o = await getCampaignOverview(sql, '2026-11-04', '2026-11-12');
  assert.equal(o.week.weekStart, '2026-11-02');
  assert.ok(o.cards.some((c) => c.title === P + '지난클라'));
  assert.ok(!o.cards.some((c) => c.title === P + '클라'));
  assert.ok(o.long.some((r) => r.title === P + '장기클라'));
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignOverviewStore.test.ts` → FAIL.
- [ ] **Step 3: 스토어와 라우트 구현.**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS. 테스트가 만든 행이 남지 않았는지 `after` 정리를 확인한다.
- [ ] **Step 5: 커밋** — `git commit -m "feat(overview): 스토어와 API"` (세 파일만 add)

---

### Task 5: 차트 부품, 페이지, 수량 칸, 카드, 사이드바

**Files:**
- Create: `src/components/charts/CumulativeArea.tsx`, `src/app/campaigns/overview/page.tsx`, `OverviewTiles.tsx`, `CampaignCard.tsx`
- Modify: `src/components/Sidebar.tsx`(`globalNav` 배열 맨 앞)

**Interfaces:**
- Consumes: `Overview`, `OverviewCard`, `OverviewTiles`, `formatCpv`(Task 1~3), `apiFetch`, `compact`/`NUM`/`C`/`T`/`S`(`charts/tokens.ts`), `useWidth`(`charts/ChartCard.tsx`).
- Produces:

```tsx
// 단일 계열 누적 선 + 옅은 면. values의 null은 그리지 않는다. 눈금은 카드마다 자기 최댓값(niceMax).
export function CumulativeArea(props: {
  labels: string[];                 // 가로 칸 글자('월'…'일' 또는 '11/2')
  values: Array<number | null>;
  todayIndex: number;               // 이 칸의 점을 크게, 글자를 굵게
  height?: number;                  // 카드 136, 패널 220
  marks?: Array<string | null>;     // 점 위 글자('게시 2건') — 패널만
  ariaLabel: string;
}): React.ReactNode;
export function OverviewTiles(props: { tiles: OverviewTiles }): React.ReactNode;
export function CampaignCard(props: { card: OverviewCard; metric: 'views' | 'bookmarks'; open: boolean; onOpen: () => void }): React.ReactNode;
```

화면 규칙(스펙 §4-1~4-3, 시안):
- `page.tsx`는 `'use client'` + `Suspense`(기존 `influencers/performance/page.tsx` 관례). 주는 주소 `?week=`가 첫 상태이고, 이동은 `history.replaceState`로 주소만 바꾼 뒤 다시 불러온다(`router.replace` 금지 — 09-27 클릭 멈춤 사례).
- 머리글: "캠페인 현황", "성과 최종 업데이트 11/12 (목) 14:05"(`perfUpdatedAt` 없으면 줄 숨김), `‹ {weekName} {11/9 (월) ~ 11/15 (일)} ›`(이번 주에서 `›` 비활성). `weekName`은 "11월2주차"로 오므로 화면에는 "11월 2주차"로 띄어 쓴다.
- 구역 머리 "주차 캠페인" + 도움말(시안 문구 그대로) + `조회수 | 저장수` 전환(모든 카드와 패널에 함께 적용, 페이지 상태 `metric`).
- 카드 격자: 페이지 본문 폭 기준 880px 이상 3열, 560px 이상 2열, 그 밖 1열(시안의 container query 값). 수량 칸은 560px 이상 4칸, 그 밖 2칸.
- 수량 네 칸 문구: "캠페인 10개, 1개는 세팅 전" / 막대 / "백수약국 3건, 벤자민 2건" + `overdueMore > 0`이면 ", 외 N곳" / "예정일 미정 N건 포함"(0이면 줄 없음). 예정일 지난 미게시가 0건이면 주황 바탕 없이 보조 글 "없음".
- 카드 다섯 층과 상태 칩 네 가지는 스펙 §4-3과 시안 그대로. 진행 층 아래 줄: "게시 전 4건 (3건은 예정일 지남)" / "남은 작업 없음", 오른쪽 "취소 1건".
- 게시된 작업이 없거나 `chart`가 null이면 지표 "-", 흐름 층에 "게시되면 여기에 성과 흐름이 나와요."
- 세팅 전 카드: 점선 테두리, "아직 작업이 등록되지 않았어요." 다음 줄 "세팅이 끝나면 진행과 성과가 여기에 나와요."
- 차트 가로 글자: 이번 주는 요일 한 글자, 지난 주(7칸 초과)는 `M/D`로 하고 폭에 맞춰 솎는다(`LineChart`의 솎기 방식).
- 불러오는 중, 실패는 기존 화면의 표시 방식을 따른다. 캠페인이 하나도 없는 주는 "이 주에 시작한 주차 캠페인이 없어요."
- 사이드바: `{ href: '/campaigns/overview', label: '캠페인 현황', Ic: TrendIcon }`을 `globalNav` 첫 줄에, 한 줄 주석으로 이유(전체를 먼저 보고 캠페인으로 들어간다).

- [ ] **Step 1:** `node_modules/next/dist/docs/01-app`에서 클라이언트 페이지, `useSearchParams` 관련 안내를 읽는다.
- [ ] **Step 2:** `CumulativeArea.tsx` 구현 후 `/debug/charts` 샘플 페이지에 예시 한 칸을 추가한다(기존 부품들이 거기 모여 있다).
- [ ] **Step 3:** `OverviewTiles.tsx`, `CampaignCard.tsx`, `page.tsx` 구현, 사이드바 수정.
- [ ] **Step 4: 확인** — `npx tsc --noEmit` 오류 0, `npm run lint` 경고가 기준선(24)에서 늘지 않음.
- [ ] **Step 5: 화면 확인** — `npm run build && npx next start -p 3001` 후 `http://127.0.0.1:3001/campaigns/overview`(`next dev`는 하이드레이션이 조용히 실패한다. 로그인 게이팅 때문에 화면이 안 열리면 여기서 멈추지 말고 Task 7의 스테이징 확인으로 넘긴다고 기록).
- [ ] **Step 6: 커밋** — 만든 파일과 `Sidebar.tsx`, `/debug/charts` 수정 파일만 add. `git commit -m "feat(overview): 페이지, 수량 칸, 카드, 흐름 차트"`

---

### Task 6: 게시물별 지표 패널, 장기 캠페인 표

**Files:**
- Create: `src/app/campaigns/overview/CampaignPanel.tsx`, `LongCampaignTable.tsx`
- Modify: `src/app/campaigns/overview/page.tsx`

**Interfaces:**
- Consumes: `OverviewCard`(`posted`, `open`, `chart`, `perf`, `quantity`), `LongRow`, `CumulativeArea`, `formatCpv`.
- Produces:

```tsx
export function CampaignPanel(props: { card: OverviewCard; weekLabel: string; metric: 'views' | 'bookmarks'; onClose: () => void }): React.ReactNode;
export function LongCampaignTable(props: { rows: LongRow[]; isCurrentWeek: boolean }): React.ReactNode;
```

화면 규칙(스펙 §4-4, §4-5, 시안):
- 패널은 오른쪽에서 열리고 폭은 `min(600px, 100%)`. ✕, 어두운 바깥, Esc로 닫는다. 열려 있는 동안 연 카드에 파란 테두리. 기존 패널 부품(`src/app/campaigns/flow/panel/`, `TaskPanel.tsx`)에 재사용할 껍데기가 있으면 그것을 쓴다.
- 패널 내용 순서: 제목과 "11월 2주차, 게시 3 / 7건" → 지표 셋(CPV 아래 "비용 15만원" = `perf.spentKrw`) → "날짜별 누적 조회수" 큰 차트(`marks`에 "게시 N건", 0건은 null) → "게시된 작업 N건" 표 → "게시 전 작업 N건" 표(0건이면 구역 숨김) → "{제목} 캠페인 열기 →"(`/campaigns/flow?id={campaignId}`).
- 게시된 작업 표 열: 인플루언서, 작업 내용, 게시일, 조회수, 저장수, 좋아요, CPV. `url`이 있는 줄만 누를 수 있고 새 창(`target="_blank" rel="noreferrer"`)으로 연다. 값이 없으면 "-". 도움말: "조회수가 많은 순서예요. 줄을 누르면 X 게시물이 새 창으로 열려요."
- 게시 전 작업 표 열: 인플루언서(없으면 "미정"), 작업 내용, 게시 예정일. `overdueDays`가 있으면 주황 "11/10 화 (2일 지남)", 예정일 없으면 "미정".
- 장기 표 열: 클라이언트, 지금 단계("예약 대기 **2**" 식으로 나열), 이번 주 게시(`isCurrentWeek`가 아니면 열 이름 "이 주 게시"), 조회수, 저장수, CPV. 줄을 누르면 `/campaigns/flow?id=`로 이동. `rows`가 비면 구역 전체를 그리지 않는다.
- 구역 제목 "방문협찬 (장기 캠페인)", 도움말은 시안 문구 그대로.

- [ ] **Step 1:** 두 컴포넌트 구현, `page.tsx`에 패널 열림 상태(`openId`)와 Esc 처리 연결.
- [ ] **Step 2: 확인** — `npx tsc --noEmit` 오류 0, `npm run lint` 기준선 유지.
- [ ] **Step 3: 커밋** — `git commit -m "feat(overview): 게시물별 지표 패널, 장기 캠페인 표"`

---

### Task 7: 전체 검증과 마무리

**Files:**
- Modify(머지 직전): `src/content/updates.ts`

- [ ] **Step 1:** `node --import tsx --test src/lib/campaignOverview.test.ts` PASS.
- [ ] **Step 2:** `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignOverviewStore.test.ts src/lib/campaignFlowView.test.ts src/lib/campaignListView.test.ts` PASS(건드린 모듈과 쓰는 모듈).
- [ ] **Step 3:** `npm run lint`(기준선 유지), `npx tsc --noEmit`(0), `npx next build`(성공 — `npm run build`는 마이그레이션을 먼저 돌리므로 쓰지 않는다).
- [ ] **Step 4: 시안 대조** — `docs/mockups/campaign-status-20261112.html`을 옆에 두고 간격, 글자 크기, 색, 문구를 항목별로 대조한 결과를 표로 남긴다(다른 곳이 있으면 고친다).
- [ ] **Step 5: 스테이징 QA 준비** — 브랜치를 push해도 되는지 koo에게 묻는다(main과 동시에 push하지 않는다). 승인되면 미리보기 주소와 확인할 항목(이번 주 숫자가 캠페인 상세와 같은지, 지난 주 이동, 패널, 장기 표)을 koo에게 전달한다.
- [ ] **Step 6: 업데이트 소식**(koo QA 통과 뒤, 머지 직전) — `src/content/updates.ts` 맨 위에 추가하고 `node --import tsx --test src/lib/updates.test.ts` PASS.
  - 유형 `새 기능`, 날짜는 머지 예정일.
  - 제목: "이번 주 전체 캠페인을 한 화면에서 볼 수 있어요"
  - 불릿: 계획 대비 게시 수량과 예정일 지난 미게시를 한눈에 / 캠페인마다 조회수, 저장수, CPV와 날짜별 흐름 / 카드에서 게시물별 지표와 게시 전 작업 확인 / 방문협찬(장기) 캠페인은 단계별로 따로.
  - `link`: `/campaigns/overview`.
- [ ] **Step 7:** main 머지와 push는 koo 지시가 있을 때만. push 뒤에는 CLI 배포를 따로 돌리지 않고 상태만 확인한다.
