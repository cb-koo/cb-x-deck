# 서비스 튜토리얼 (인터랙티브 투어) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 처음 cb-x-deck를 쓰는 비개발 기획자가 덱에서 첫 컬럼을 직접 만들며 핵심 기능을 익히도록, driver.js 기반 인터랙티브 코치마크 투어를 붙인다.

**Architecture:** 순수 로직(본 여부 저장 `tourState`, 스텝 정의 `tourSteps`)을 driver.js 구동 훅(`useTour`)과 분리한다. 페이지/컴포넌트는 대상 요소에 `data-tour` 속성만 부여하고, `DeckPage`가 자동시작·행동감지 진행을, `BriefingSection`이 `?` 버튼 실행을 연결한다.

**Tech Stack:** Next.js 16(App Router, `'use client'`), React 19, TypeScript, Tailwind v4, driver.js v1. 테스트: `node --test` + `node:assert/strict`(tsx).

## Global Constraints

- 저장소 `AGENTS.md` UX 원칙 준수: 라벨/문구는 내부 개념어 금지·이득을 사용자 언어로, 비용 액션은 "팀 공용·누를 때만·아주 소액"으로 안심 맥락과 함께.
- 테스트 파일은 `src/**/*.test.ts`, `import`는 확장자 `.ts` 포함(기존 관례). 프레임워크는 `node:test` + `node:assert/strict`.
- driver.js는 클라이언트 전용 — `'use client'` 파일에서만 import.
- 앵커는 반드시 `data-tour="..."` 속성으로 지정(클래스·텍스트 의존 금지).
- 본 여부 저장은 `localStorage`, 키 접두사 `tour-seen:`. 덱만 자동시작(키 `deck`), 브리핑은 자동시작 없음.
- 커밋 메시지 말미:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- `src/lib/tour/tourState.ts` (신규) — localStorage 본 여부 래퍼. 순수 함수.
- `src/lib/tour/tourState.test.ts` (신규) — 위 유닛 테스트.
- `src/lib/tour/tourSteps.ts` (신규) — `TourStep` 타입, `deckSteps()`, `BRIEFING_STEPS`. 순수 데이터.
- `src/lib/tour/tourSteps.test.ts` (신규) — 스텝 무결성 테스트.
- `src/lib/tour/useTour.ts` (신규) — driver.js 구동 훅.
- `src/components/HelpButton.tsx` (신규) — `?` 재실행 버튼.
- `src/app/globals.css` (수정) — driver.js 팝오버 테마.
- `src/components/Sidebar.tsx` (수정) — nav 앵커.
- `src/app/w/[wsId]/page.tsx` (수정) — 덱 자동시작·행동감지·`?`·앵커.
- `src/components/Column.tsx` (수정) — refresh/첫 트윗 앵커, `tourAnchor` prop.
- `src/components/TweetCard.tsx` (수정) — save 앵커, `tourAnchor` prop.
- `src/components/ColumnSettings.tsx` (수정) — 모달 앵커.
- `src/components/BriefingSection.tsx` (수정) — 앵커·`?`·투어 실행.

---

## Task 1: 본 여부 저장 모듈 (`tourState`)

**Files:**
- Create: `src/lib/tour/tourState.ts`
- Test: `src/lib/tour/tourState.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces:
  - `hasSeenTour(id: string): boolean`
  - `markTourSeen(id: string): void`
  - `resetTourSeen(id: string): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tour/tourState.test.ts`:

```ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// node 환경엔 window/localStorage가 없으므로 가짜 주입 (모듈은 호출 시점에 전역을 읽음)
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const store = new FakeStorage();
(globalThis as unknown as { window: object }).window = {};
(globalThis as unknown as { localStorage: FakeStorage }).localStorage = store;

const { hasSeenTour, markTourSeen, resetTourSeen } = await import('./tourState.ts');

beforeEach(() => store.clear());

test('처음엔 안 본 상태', () => {
  assert.equal(hasSeenTour('deck'), false);
});

test('mark 후 본 상태로', () => {
  markTourSeen('deck');
  assert.equal(hasSeenTour('deck'), true);
});

test('reset 후 다시 안 본 상태', () => {
  markTourSeen('deck');
  resetTourSeen('deck');
  assert.equal(hasSeenTour('deck'), false);
});

test('id별로 독립', () => {
  markTourSeen('deck');
  assert.equal(hasSeenTour('briefing'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tour/tourState.test.ts`
Expected: FAIL — `Cannot find module './tourState.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tour/tourState.ts`:

```ts
// 투어 '본 여부'를 브라우저 localStorage에 저장한다.
// 브라우저=실사용자(도메인 게이팅 OAuth) 기준이라 멤버별 DB 추적 없이 충분.
const KEY_PREFIX = 'tour-seen:';

export function hasSeenTour(id: string): boolean {
  if (typeof window === 'undefined') return true; // SSR: 자동시작 방지 위해 '본 것'으로 취급
  try {
    return localStorage.getItem(KEY_PREFIX + id) === '1';
  } catch {
    return true;
  }
}

export function markTourSeen(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + id, '1');
  } catch {
    /* 사파리 프라이빗 모드 등 — 조용히 무시 */
  }
}

export function resetTourSeen(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    /* 무시 */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tour/tourState.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour/tourState.ts src/lib/tour/tourState.test.ts
git commit -m "feat(tour): 투어 본 여부 localStorage 저장 모듈

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 스텝 정의 (`tourSteps`)

**Files:**
- Create: `src/lib/tour/tourSteps.ts`
- Test: `src/lib/tour/tourSteps.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces:
  - `interface TourStep { id: string; element?: string; title: string; description: string; side?: 'top'|'bottom'|'left'|'right'; align?: 'start'|'center'|'end'; }`
  - `deckSteps(hasColumns: boolean): TourStep[]` — `hasColumns=false`면 생성 유도 포함 6단계, `true`면 컬럼 위 설명 3단계.
  - `BRIEFING_STEPS: TourStep[]` — 5단계.
  - 행동감지 진행에 쓰는 스텝 id: `'add-column'`(모달 열림 감지), `'create-modal'`(컬럼 생성 감지).
- 앵커 셀렉터 집합(구현 태스크가 부여할 `data-tour`값): `add-column`, `column-modal`, `col-refresh`, `col-save`, `nav-deck`, `nav-briefing`, `bf-column`, `bf-period`, `bf-generate`, `bf-history`, `help-button`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tour/tourSteps.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckSteps, BRIEFING_STEPS, type TourStep } from './tourSteps.ts';

const ALLOWED_SELECTORS = new Set([
  '[data-tour="add-column"]', '[data-tour="column-modal"]',
  '[data-tour="col-refresh"]', '[data-tour="col-save"]',
  '[data-tour="bf-column"]', '[data-tour="bf-period"]',
  '[data-tour="bf-generate"]', '[data-tour="bf-history"]',
]);

function assertWellFormed(steps: TourStep[]) {
  const ids = new Set<string>();
  for (const s of steps) {
    assert.ok(s.id, 'id 필수');
    assert.ok(!ids.has(s.id), `id 중복: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title.trim().length > 0, `title 필수: ${s.id}`);
    assert.ok(s.description.trim().length > 0, `description 필수: ${s.id}`);
    if (s.element) assert.ok(ALLOWED_SELECTORS.has(s.element), `허용되지 않은 셀렉터: ${s.element}`);
  }
}

test('덱: 컬럼 없으면 6단계(생성 유도 포함), 있으면 3단계', () => {
  assert.equal(deckSteps(false).length, 6);
  assert.equal(deckSteps(true).length, 3);
});

test('덱 스텝 무결성 (양 갈래)', () => {
  assertWellFormed(deckSteps(false));
  assertWellFormed(deckSteps(true));
});

test('덱 생성 유도 갈래는 행동감지용 id를 포함', () => {
  const ids = deckSteps(false).map((s) => s.id);
  assert.ok(ids.includes('add-column'));
  assert.ok(ids.includes('create-modal'));
});

test('덱 마지막은 항상 마무리(요소 없는 중앙 스텝)', () => {
  for (const steps of [deckSteps(false), deckSteps(true)]) {
    const last = steps[steps.length - 1];
    assert.equal(last.element, undefined);
  }
});

test('브리핑: 5단계 무결성, 자동시작 안내 문구 포함', () => {
  assert.equal(BRIEFING_STEPS.length, 5);
  assertWellFormed(BRIEFING_STEPS);
  assert.ok(BRIEFING_STEPS[0].description.includes('쌓인'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tour/tourSteps.test.ts`
Expected: FAIL — `Cannot find module './tourSteps.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tour/tourSteps.ts`:

```ts
// 투어 스텝 정의 — 순수 데이터. 문구는 AGENTS.md UX 원칙(이득을 사용자 언어로,
// 비용 액션은 '팀 공용·누를 때만·아주 소액')을 따른다.
export interface TourStep {
  id: string;
  element?: string; // CSS 셀렉터. 없으면 화면 중앙 표시.
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

// 첫 컬럼을 직접 만들게 유도하는 도입부 (컬럼 0개일 때만)
const DECK_INTRO_STEPS: TourStep[] = [
  {
    id: 'deck-intro',
    title: '덱에 오신 걸 환영해요',
    description: '여기 <b>덱</b>은 관심 주제·계정의 X 글을 컬럼으로 모아 한눈에 보는 곳이에요. 첫 컬럼을 직접 만들어볼까요?',
  },
  {
    id: 'add-column',
    element: '[data-tour="add-column"]',
    title: '컬럼 만들기',
    description: '여기를 눌러 <b>키워드</b>(관심 주제)나 <b>인플루언서</b>(특정 계정) 컬럼을 만들어요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'create-modal',
    element: '[data-tour="column-modal"]',
    title: '주제나 계정 넣기',
    description: '주제나 계정을 넣고 만들면 돼요. 입력창 옆 도움말이 어떤 값을 넣을지 알려줘요.',
    side: 'left',
    align: 'start',
  },
];

// 만들어진 컬럼 위에서 핵심 사용법 설명
const DECK_COLUMN_STEPS: TourStep[] = [
  {
    id: 'col-refresh',
    element: '[data-tour="col-refresh"]',
    title: '새로고침으로 최신 글 가져오기',
    description: '컬럼은 <b>새로고침을 눌러야</b> 최신 글을 가져와요. 팀 공용이고 누를 때만, 아주 소액이라 부담 없이 눌러도 돼요. 새로 올라온 글엔 파란 <b>NEW</b> 배지가 붙어요.',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'col-save',
    element: '[data-tour="col-save"]',
    title: '마음에 드는 글 저장하기',
    description: '마음에 드는 글은 <b>저장</b>하면 보관함에 모여, 팀원과 코멘트를 나눌 수 있어요.',
    side: 'top',
    align: 'start',
  },
  {
    id: 'deck-outro',
    title: '준비 끝!',
    description: '오른쪽 위 <b>?</b> 로 언제든 이 안내를 다시 볼 수 있어요. 글이 며칠 쌓이면 <b>브리핑</b>에서 흐름을 보고서로 받아보세요.',
  },
];

export function deckSteps(hasColumns: boolean): TourStep[] {
  return hasColumns ? DECK_COLUMN_STEPS : [...DECK_INTRO_STEPS, ...DECK_COLUMN_STEPS];
}

export const BRIEFING_STEPS: TourStep[] = [
  {
    id: 'bf-intro',
    title: '브리핑이란',
    description: '<b>브리핑</b>은 컬럼 하나의 최근 몇 주를 AI가 읽고 보고서로 정리해줘요. 컬럼에 글이 며칠~몇 주 쌓인 뒤에 유용해요.',
  },
  {
    id: 'bf-column',
    element: '[data-tour="bf-column"]',
    title: '컬럼 고르기',
    description: '먼저 정리할 <b>컬럼을 하나</b> 고르세요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-period',
    element: '[data-tour="bf-period"]',
    title: '기간 정하기',
    description: '<b>몇 주간</b>을 볼지 정해요. 빈 주가 있으면 채우기 안내가 떠요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-generate',
    element: '[data-tour="bf-generate"]',
    title: '보고서 생성',
    description: '<b>브리핑 생성</b>을 누르면 보고서가 만들어져요. 누를 때만, 아주 소액(약 $0.1 이하)이에요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-history',
    element: '[data-tour="bf-history"]',
    title: '지난 보고서 다시 보기',
    description: '만든 보고서는 여기 <b>지난 브리핑</b>에 쌓여 언제든 다시 봐요.',
    side: 'top',
    align: 'start',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tour/tourSteps.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour/tourSteps.ts src/lib/tour/tourSteps.test.ts
git commit -m "feat(tour): 덱·브리핑 스텝 정의(순수 데이터)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: driver.js 구동 훅 + `?` 버튼 + 테마

**Files:**
- Modify: `package.json` (driver.js 의존성)
- Create: `src/lib/tour/useTour.ts`
- Create: `src/components/HelpButton.tsx`
- Modify: `src/app/globals.css` (driver 팝오버 테마)

**Interfaces:**
- Consumes: `TourStep`(Task 2), `markTourSeen`(Task 1).
- Produces:
  - `useTour(): { start(tourId: string, steps: TourStep[]): void; advance(fromId: string): void; activeTour: string | null }`
  - `<HelpButton onClick={() => void} label?: string />` — `data-tour="help-button"` 부여된 `?` 버튼.
- 이 태스크엔 유닛 테스트 없음(DOM/브라우저 의존). 대신 타입체크·빌드로 검증.

- [ ] **Step 1: driver.js 설치**

Run: `npm install driver.js@^1.3.1`
Expected: `package.json` dependencies에 `driver.js` 추가, 종료코드 0.

- [ ] **Step 2: `useTour` 훅 작성**

Create `src/lib/tour/useTour.ts`:

```ts
'use client';
import { useCallback, useRef, useState } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { TourStep } from './tourSteps';
import { markTourSeen } from './tourState';

function toDriverSteps(steps: TourStep[]) {
  return steps.map((s) => ({
    element: s.element,
    popover: {
      title: s.title,
      description: s.description,
      side: s.side,
      align: s.align,
    },
  }));
}

export function useTour() {
  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStep[]>([]);
  const [activeTour, setActiveTour] = useState<string | null>(null);

  const start = useCallback((tourId: string, steps: TourStep[]) => {
    driverRef.current?.destroy();
    stepsRef.current = steps;
    const d = driver({
      showProgress: true,
      nextBtnText: '다음',
      prevBtnText: '이전',
      doneBtnText: '완료',
      progressText: '{{current}} / {{total}}',
      steps: toDriverSteps(steps),
      // 완료·건너뛰기·바깥클릭 어느 경로든 종료 시 '본 것'으로 저장
      onDestroyed: () => {
        markTourSeen(tourId);
        setActiveTour(null);
        driverRef.current = null;
      },
    });
    driverRef.current = d;
    setActiveTour(tourId);
    d.drive();
  }, []);

  // 현재 활성 스텝 id가 fromId일 때만 다음으로 진행 — 행동 유도형 자동 전진
  const advance = useCallback((fromId: string) => {
    const d = driverRef.current;
    if (!d || !d.isActive()) return;
    const idx = d.getActiveIndex();
    if (idx == null) return;
    if (stepsRef.current[idx]?.id === fromId) d.moveNext();
  }, []);

  return { start, advance, activeTour };
}
```

- [ ] **Step 3: `HelpButton` 작성**

Create `src/components/HelpButton.tsx`:

```tsx
'use client';

export function HelpButton({ onClick, label = '사용법 다시 보기' }: { onClick: () => void; label?: string }) {
  return (
    <button
      data-tour="help-button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-x-border-strong text-ui text-x-secondary hover:bg-x-text/5"
    >
      ?
    </button>
  );
}
```

- [ ] **Step 4: driver 팝오버 테마 추가**

Append to `src/app/globals.css` (파일 맨 끝):

```css
/* driver.js 팝오버를 앱 톤에 맞춤 (라운드·파랑 버튼) */
.driver-popover {
  border-radius: 12px;
  font-family: inherit;
}
.driver-popover-title { font-size: 15px; font-weight: 700; }
.driver-popover-description { font-size: 13px; line-height: 1.5; }
.driver-popover-next-btn,
.driver-popover-done-btn {
  background: #1d9bf0; /* x-blue */
  color: #fff;
  text-shadow: none;
  border: none;
  border-radius: 9999px;
  padding: 4px 14px;
  font-size: 13px;
}
.driver-popover-next-btn:hover,
.driver-popover-done-btn:hover { opacity: 0.9; background: #1d9bf0; }
.driver-popover-prev-btn {
  border-radius: 9999px;
  font-size: 13px;
  text-shadow: none;
}
```

- [ ] **Step 5: 타입체크·빌드 검증**

Run: `npx tsc --noEmit`
Expected: 오류 없음(종료코드 0). driver.js 타입이 잡히는지 확인.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/tour/useTour.ts src/components/HelpButton.tsx src/app/globals.css
git commit -m "feat(tour): driver.js 구동 훅·? 버튼·팝오버 테마

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 덱 앵커 부여 (Sidebar·+컬럼·Column·TweetCard·ColumnSettings)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Column.tsx`
- Modify: `src/components/TweetCard.tsx`
- Modify: `src/components/ColumnSettings.tsx`

**Interfaces:**
- Consumes: 없음(순수 마크업 속성 추가).
- Produces: DOM에 `data-tour` 앵커 — `nav-deck`, `col-refresh`, `col-save`, `column-modal`. (`add-column`은 Task 5에서 DeckPage 버튼에 부여.)
  - `Column`에 새 prop `tourAnchor?: boolean` 추가 — true면 refresh 버튼과 첫 트윗 save에 앵커 부여.
  - `TweetCard`에 새 prop `tourAnchor?: boolean` 추가 — true면 save 버튼에 `data-tour="col-save"`.

- [ ] **Step 1: Sidebar nav에 앵커 부여**

`src/components/Sidebar.tsx` — `nav` 배열을 렌더하는 링크에 `data-tour` 부여. `nav` 정의(현재):

```ts
  const nav = [
    { href: `/w/${wsId}/research`, label: '리서치', Ic: SearchIcon },
    { href: `/w/${wsId}`, label: '덱', Ic: ColumnsIcon },
    { href: `/w/${wsId}/briefing`, label: '브리핑', Ic: DocIcon },
    { href: `/w/${wsId}/library`, label: '보관함', Ic: FolderIcon },
  ];
```

각 항목에 `tour` 키를 추가:

```ts
  const nav = [
    { href: `/w/${wsId}/research`, label: '리서치', Ic: SearchIcon, tour: undefined as string | undefined },
    { href: `/w/${wsId}`, label: '덱', Ic: ColumnsIcon, tour: 'nav-deck' },
    { href: `/w/${wsId}/briefing`, label: '브리핑', Ic: DocIcon, tour: 'nav-briefing' },
    { href: `/w/${wsId}/library`, label: '보관함', Ic: FolderIcon, tour: undefined },
  ];
```

그리고 `nav.map(...)`로 렌더하는 `<a>`/`<Link>` 요소에 `data-tour={n.tour}` 속성을 추가한다(요소 태그는 기존 코드 그대로 두고 속성만 추가). 렌더 부분에서 map 콜백 변수가 `n`이 아니면 그 변수명에 맞춰 `data-tour={<var>.tour}`로 넣는다.

- [ ] **Step 2: Column에 `tourAnchor` prop과 refresh 앵커 추가**

`src/components/Column.tsx`:

(a) props 타입에 `tourAnchor?: boolean` 추가. 컴포넌트 시그니처가 `export function Column({ column, autoRefresh, onEdit, onDelete, onPickTag }: ColumnProps)` 형태이면 구조분해에 `tourAnchor`를 추가하고 타입에도 추가.

(b) refresh 버튼(현재):

```tsx
          <Button variant="icon" onClick={refresh} disabled={busy} title="새로고침" className={busy ? 'text-x-blue' : ''}>
```

를 다음으로:

```tsx
          <Button variant="icon" onClick={refresh} disabled={busy} title="새로고침"
                  data-tour={tourAnchor ? 'col-refresh' : undefined}
                  className={busy ? 'text-x-blue' : ''}>
```

(c) 트윗 렌더 map(현재 `visible.map((t) => (`)에 인덱스를 추가하고 첫 트윗에 앵커 전달:

```tsx
          : visible.map((t, i) => (
              <TweetCard key={t.tweetId} tweet={t} meId={member?.id ?? null}
                         tourAnchor={tourAnchor && i === 0}
```

(나머지 TweetCard props는 기존 그대로 유지.)

- [ ] **Step 3: TweetCard에 `tourAnchor` prop과 save 앵커 추가**

`src/components/TweetCard.tsx`:

(a) `TweetCardProps`에 `tourAnchor?: boolean;` 추가, 구조분해 `{ tweet: t, meId, onSave, onUnsave, onDismiss, onUndismiss, dismissedView }`에 `tourAnchor`를 추가.

(b) save 버튼 두 갈래(현재):

```tsx
            {savedByMe
              ? <Button variant="ghost" onClick={() => onUnsave?.(t.tweetId)} className="font-medium text-amber-500">★ 저장됨</Button>
              : <Button variant="ghost" onClick={() => onSave?.(t.tweetId)}>☆ 저장</Button>}
```

를 다음으로(두 버튼 모두 앵커 부여 — 실제로는 하나만 렌더됨):

```tsx
            {savedByMe
              ? <Button variant="ghost" onClick={() => onUnsave?.(t.tweetId)} data-tour={tourAnchor ? 'col-save' : undefined} className="font-medium text-amber-500">★ 저장됨</Button>
              : <Button variant="ghost" onClick={() => onSave?.(t.tweetId)} data-tour={tourAnchor ? 'col-save' : undefined}>☆ 저장</Button>}
```

- [ ] **Step 4: ColumnSettings 모달에 앵커 부여**

`src/components/ColumnSettings.tsx` — 내부 흰색 패널 div(현재):

```tsx
      <div className="max-h-[90vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
```

에 `data-tour="column-modal"` 추가:

```tsx
      <div data-tour="column-modal" className="max-h-[90vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
```

- [ ] **Step 5: 타입체크 검증**

Run: `npx tsc --noEmit`
Expected: 오류 없음. (`tourAnchor` prop 추가가 타입 정합하는지 확인. `Button`은 `ButtonHTMLAttributes`를 spread하므로 `data-tour` 허용됨.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Column.tsx src/components/TweetCard.tsx src/components/ColumnSettings.tsx
git commit -m "feat(tour): 덱 코치마크 앵커(data-tour) 부여

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 덱 페이지 배선 (자동시작·행동감지·? 버튼)

**Files:**
- Modify: `src/app/w/[wsId]/page.tsx`

**Interfaces:**
- Consumes: `useTour`(Task 3), `deckSteps`(Task 2), `hasSeenTour`(Task 1), `HelpButton`(Task 3), `Column.tourAnchor`(Task 4).
- Produces: 덱 첫 방문 자동시작, 컬럼 생성 행동감지 자동전진, `?` 재실행, `add-column` 앵커.

- [ ] **Step 1: import·훅 추가**

`src/app/w/[wsId]/page.tsx` 상단 import에 추가:

```tsx
import { useTour } from '@/lib/tour/useTour';
import { deckSteps } from '@/lib/tour/tourSteps';
import { hasSeenTour } from '@/lib/tour/tourState';
import { HelpButton } from '@/components/HelpButton';
import { useRef } from 'react';
```

(`useEffect`, `useState`는 이미 import되어 있음. `useRef`가 이미 있으면 중복 추가하지 않음.)

`DeckPage` 함수 본문 상단(기존 `useState`들 아래)에 추가:

```tsx
  const { start, advance, activeTour } = useTour();
  const prevColCount = useRef(0);
```

- [ ] **Step 2: 자동시작 effect 추가**

`load`를 부르는 `useEffect(() => { load(); }, [load]);` 아래에 추가:

```tsx
  // 덱 첫 방문 시 1회 자동 투어 (렌더 안정화 후). 첫 사용자는 컬럼 0개라 생성 유도 갈래로 진입.
  useEffect(() => {
    if (hasSeenTour('deck')) return;
    const t = setTimeout(() => start('deck', deckSteps(columns.length > 0)), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: 행동감지 자동전진 effect 추가**

Step 2의 effect 아래에 추가:

```tsx
  // 행동 유도형 자동 전진: 모달이 열리면 add-column→create-modal
  useEffect(() => {
    if (activeTour === 'deck' && modal) advance('add-column');
  }, [modal, activeTour, advance]);

  // 컬럼이 새로 생기면 create-modal→col-refresh
  useEffect(() => {
    if (activeTour === 'deck' && columns.length > prevColCount.current) advance('create-modal');
    prevColCount.current = columns.length;
  }, [columns.length, activeTour, advance]);
```

- [ ] **Step 4: 상단바에 `+ 컬럼` 앵커와 `?` 버튼 추가**

상단바(현재):

```tsx
      <div className="flex items-center gap-3 border-b border-x-border bg-x-surface px-4 py-2">
        <button onClick={() => setModal({ mode: 'create' })}
                className="rounded-full bg-x-text px-4 py-1.5 text-ui font-bold text-white hover:opacity-90">
          + 컬럼
        </button>
      </div>
```

를 다음으로:

```tsx
      <div className="flex items-center gap-3 border-b border-x-border bg-x-surface px-4 py-2">
        <button onClick={() => setModal({ mode: 'create' })}
                data-tour="add-column"
                className="rounded-full bg-x-text px-4 py-1.5 text-ui font-bold text-white hover:opacity-90">
          + 컬럼
        </button>
        <HelpButton onClick={() => start('deck', deckSteps(columns.length > 0))} />
      </div>
```

- [ ] **Step 5: 첫 컬럼에 `tourAnchor` 전달**

컬럼 렌더 map(현재 `columns.map((c) => (`)를 인덱스 포함으로 바꾸고 첫 컬럼에 앵커 전달:

```tsx
        {columns.map((c, i) => (
          <Column key={c.id} column={c}
                  tourAnchor={i === 0}
                  autoRefresh={c.id === autoRefreshId}
                  onEdit={() => setModal({ mode: 'edit', column: c })}
                  onDelete={() => remove(c)}
                  onPickTag={(tag) => setModal({ mode: 'create', presetKeyword: tag })} />
        ))}
```

- [ ] **Step 6: 타입체크·빌드·수동 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

Run: `npm run dev` 후 브라우저에서 확인(수동):
- `localStorage.removeItem('tour-seen:deck')` 실행 후 덱 새로고침 → 투어 자동 시작.
- 안내 따라 `+컬럼` 클릭 → 모달 강조로 자동 전진.
- 컬럼 생성 → refresh 강조로 자동 전진.
- 완료 후 새로고침 시 자동 시작 안 됨. `?` 클릭 시 재실행(컬럼 있으면 3단계).

- [ ] **Step 7: Commit**

```bash
git add "src/app/w/[wsId]/page.tsx"
git commit -m "feat(tour): 덱 투어 배선 — 자동시작·행동감지 전진·? 재실행

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 브리핑 투어 (앵커·? 버튼, 자동시작 없음)

**Files:**
- Modify: `src/components/BriefingSection.tsx`

**Interfaces:**
- Consumes: `useTour`(Task 3), `BRIEFING_STEPS`(Task 2), `HelpButton`(Task 3).
- Produces: 브리핑 앵커(`bf-column`, `bf-period`, `bf-generate`, `bf-history`), `?`로만 실행되는 브리핑 투어.

- [ ] **Step 1: import·훅 추가**

`src/components/BriefingSection.tsx` 상단 import에 추가:

```tsx
import { useTour } from '@/lib/tour/useTour';
import { BRIEFING_STEPS } from '@/lib/tour/tourSteps';
import { HelpButton } from '@/components/HelpButton';
```

컴포넌트 본문 상단(기존 상태 훅들 근처)에 추가:

```tsx
  const { start } = useTour();
```

- [ ] **Step 2: 헤더에 `?` 버튼 추가**

헤더 h2(현재):

```tsx
      <h2 className="font-bold">📋 기간 종합 브리핑 <span className="text-sm font-normal text-x-muted">컬럼 하나를 골라 최근 몇 주간 무슨 일이 있었는지 보고서로 정리해요</span></h2>
```

를 다음으로(같은 줄 우측에 `?`):

```tsx
      <div className="flex items-center gap-2">
        <h2 className="font-bold">📋 기간 종합 브리핑 <span className="text-sm font-normal text-x-muted">컬럼 하나를 골라 최근 몇 주간 무슨 일이 있었는지 보고서로 정리해요</span></h2>
        <HelpButton onClick={() => start('briefing', BRIEFING_STEPS)} />
      </div>
```

- [ ] **Step 3: 컬럼 선택·기간·생성 버튼 앵커**

컬럼 select(현재):

```tsx
        <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                className="rounded border border-x-border-strong bg-transparent px-2 py-1">
```
→ `<select data-tour="bf-column" value={columnId} ...>`

기간 select(현재):

```tsx
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as typeof weeks)}
                className="rounded border border-x-border-strong bg-transparent px-2 py-1">
```
→ `<select data-tour="bf-period" value={weeks} ...>`

생성 button(현재):

```tsx
        <button onClick={generate} disabled={busy || backfilling || !columnId || preview?.total === 0}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
                title="이 기간의 트윗을 AI가 읽고 보고서를 만들어요 (약 $0.1 이하)">
```
→ 같은 button에 `data-tour="bf-generate"` 속성 추가.

- [ ] **Step 4: 지난 브리핑 목록 앵커**

지난 브리핑 컨테이너(현재):

```tsx
      {list.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-x-muted">지난 브리핑</p>
```

를:

```tsx
      {list.length > 0 && (
        <div data-tour="bf-history" className="mt-3">
          <p className="text-xs text-x-muted">지난 브리핑</p>
```

(목록이 없으면 이 요소가 없어 driver.js가 해당 스텝을 자동 건너뜀 — 첫 사용자에게 정상.)

- [ ] **Step 5: 타입체크·수동 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

수동(브라우저): 브리핑 페이지는 자동 시작 안 됨. `?` 클릭 시 5단계 투어 시작, 지난 브리핑 없으면 해당 스텝 건너뜀.

- [ ] **Step 6: Commit**

```bash
git add src/components/BriefingSection.tsx
git commit -m "feat(tour): 브리핑 투어 — ?로만 실행, 앵커 부여

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 최종 검증

**Files:** 없음(검증 전용).

- [ ] **Step 1: 전체 유닛 테스트**

Run: `npm test`
Expected: 전부 PASS(신규 tourState·tourSteps 포함, 기존 테스트 회귀 없음).

- [ ] **Step 2: 린트**

Run: `npm run lint`
Expected: 오류 없음(경고는 기존 수준 유지).

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 수동 E2E 체크리스트 (`npm run dev`)**

- [ ] 덱: `localStorage.removeItem('tour-seen:deck')` → 새로고침 → 6단계 투어 자동 시작(컬럼 0개 기준).
- [ ] `+컬럼` 클릭 시 모달 강조로 자동 전진, 컬럼 생성 시 refresh 강조로 자동 전진.
- [ ] 새로고침 후 트윗이 뜨면 첫 트윗 저장 버튼 강조 정상.
- [ ] 완료/Esc 후 재방문 시 자동 시작 안 됨.
- [ ] 덱 `?` 클릭 → 재실행(컬럼 있으면 3단계).
- [ ] 브리핑: 자동 시작 안 됨. `?` 클릭 → 5단계, 지난 브리핑 없으면 마지막 스텝 건너뜀.
- [ ] 팝오버 문구·버튼이 앱 톤과 어울림(파랑 버튼, 라운드), 한글 정상.

- [ ] **Step 5: 계획 문서 완료 표시 커밋(선택)**

수동 체크 결과에 문제가 없으면 별도 코드 변경 없음. 문제 발견 시 해당 태스크로 돌아가 수정.

---

## Self-Review 결과

- **Spec 커버리지:** 형태(driver.js·Task 3) / 덱 행동유도 6단계(Task 2·5) / 브리핑 ?전용 5단계(Task 2·6) / 자동시작·재실행·본여부(Task 1·5) / 앵커(Task 4·5·6) / 문구 톤(Task 2) / 엣지(컬럼0개·요소없음 건너뜀: Task 2·5·6) / 테스트(Task 1·2·7) — 모두 매핑됨.
- **범위 밖 확인:** 리서치·보관함 투어, 멤버별 DB 추적 — 계획에 없음(스펙과 일치).
- **타입 일관성:** `hasSeenTour/markTourSeen/resetTourSeen`, `deckSteps/BRIEFING_STEPS/TourStep`, `useTour().{start,advance,activeTour}`, `tourAnchor` prop — 정의(Task 1~4)와 사용(Task 5~6) 시그니처 일치.
- **플레이스홀더:** 없음.
