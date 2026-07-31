# 표 보기 필터 배치 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 항상 펼쳐져 있던 조건 행을 표 위에 떠서 열리는 패널로 옮기고, 걸린 조건은 패널을 열지 않아도 칩 줄에서 읽히게 한다 — 표 위 고정 높이를 약 190px에서 약 120px로 줄이고, 조건을 더 걸어도 표가 밀리지 않게 한다.

**Architecture:** 기존 `FilterRows`는 **패널 안의 내용**으로 남기고(조건 행 + `＋ 조건 추가` + 안내 줄), 그 바깥을 `FilterPanel`(트리거 `필터` + 개수 배지 + `<details>` 패널)이 감싼다. 걸린 상태는 `FilterChips`가 별도 줄에서 요약한다. 열고 닫기는 **React 상태 없이 DOM으로** 한다 — `Column.tsx:75`가 이미 쓰는 `removeAttribute('open')` 방식을 `useDismissible` 훅으로 뽑아 `ColumnPicker`와 `FilterPanel`이 함께 쓴다. 판정이 필요한 로직(가장 위험한 경고 고르기, 열 선택 라벨)은 `src/lib`의 순수 함수로 빼서 유닛 테스트한다.

**Tech Stack:** Next.js 16.2.10 (App Router, `'use client'`), React 19.2.4, Tailwind CSS v4, TypeScript. 테스트는 `node:test` + `tsx`. **새 의존성·새 마이그레이션·새 API·새 쿼리 없음** — 이 작업은 순수하게 화면 재배치다.

**시안:** https://claude.ai/code/artifact/3828b02a-bc9c-4362-94bb-9998c3df6ec3 (실제 앱 토큰으로 4가지 상태 + 현행 비교). 판단이 필요하면 계획이 아니라 시안을 본다.
**기존 설계:** `docs/superpowers/specs/2026-07-31-table-filter-system-design.md` — 필터 모델·모순 경고의 근거는 전부 거기 있고, 이 계획은 그 위의 배치만 바꾼다.

## Global Constraints

- **새 npm 의존성·새 API 라우트·새 쿼리·새 마이그레이션 없음.** 서버 쪽은 한 줄도 바뀌지 않는다.
- **확정 문구는 한 글자도 바꾸지 않는다.** 그대로 유지되는 것:
  - `이미 모은 N건 중에서만 걸러요 (새로 가져오지 않아서 무료)`
  - `이 열은 좋아요 300 이상만 모으고 있어서 100으로 낮춰도 더 나오지 않아요`
  - `선택한 열 중 9개는 좋아요 300 이상만 모아요`
  - `선택한 열 중 2개는 좋아요 300 이상만 모아서 그 열에서는 한 건도 나오지 않아요`
  - `조건에 맞는 글이 없어요` · `필터 지우기` · `아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다`
  - 조건 삭제 `aria-label="이 조건 지우기"`
  - 연산자 `같음` `포함` `제외` `이상` `이하` `이후` `이전`
- **이번에 새로 확정된 문구**(이 계획에서만 도입, 사용자 승인 완료):
  - 트리거: `필터` (조건 없음) / `필터` + 개수 배지 (조건 있음)
  - 패널 안 추가 버튼: `＋ 조건 추가`
  - 경고 요약 뒤 나머지 표시: `· 경고 N개 더`
  - 열 칩 삭제 `aria-label="열 선택 지우기"`
- **`react-hooks/set-state-in-effect`는 에러다.** effect 본문에서 setState를 직접 호출하지 않는다. 열고 닫기는 DOM 속성으로 한다.
- **린트 기준선 24개(에러 13 + 경고 11).** `npm run lint`는 원래 비정상 종료한다. 총계가 24에서 **늘지 않는 것**이 기준이다. 억제 주석으로 숫자를 맞추지 않는다.
- **`npx tsc --noEmit`은 클린이어야 한다.**
- **컴포넌트 테스트 하네스가 없다.** React 컴포넌트에 유닛 테스트를 만들지 않는다. 테스트 글로브가 `src/**/*.test.ts`라 `.tsx` 테스트 파일을 만들지 않는다.
- **DB가 필요 없는 테스트**는 `npx tsx --test <파일>`로 돌린다. 이 계획의 테스트는 전부 여기 해당한다.
- **AGENTS.md UX 원칙**이 적용된다. 특히 원칙 1(라벨은 메커니즘이 아니라 사용자 언어)과 원칙 4(라벨과 값은 항상 일치).
- **커밋 메시지**: `<type>(x-research): <한국어 요약>`, 본문 한국어, 마지막 줄 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. 본문이 여러 줄이면 파일로 써서 `git commit -F <path>`.
- **작업 에이전트는 git 명령을 실행하지 않는다.** 커밋은 오케스트레이터가 태스크당 하나씩 순차 실행한다.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/useDismissible.ts` | `<details>`를 바깥 클릭·Esc로 닫는 훅 (DOM만, 상태 없음) | 생성 |
| `src/lib/tableFilter.ts` | `columnSelectionLabel` 추가 (트리거·칩이 같은 출처를 쓰게) | 수정 |
| `src/lib/tableFilter.test.ts` | 위 테스트 | 수정 |
| `src/lib/collectionConflict.ts` | `summarizeConflicts` 추가 (칩 줄에 한 줄만 세울 때 무엇을 세울지) | 수정 |
| `src/lib/collectionConflict.test.ts` | 위 테스트 | 수정 |
| `src/components/ColumnPicker.tsx` | `useDismissible` 적용 + 라벨을 `columnSelectionLabel`로 | 수정 |
| `src/components/FilterChips.tsx` | 적용 칩 줄 + 경고 한 줄 요약 | 생성 |
| `src/components/FilterRows.tsx` | 패널 **안의 내용**으로 축소(`+ 필터`·`필터 지우기` 제거, `＋ 조건 추가` 추가) | 수정 |
| `src/components/FilterPanel.tsx` | 트리거(`필터` + 배지) + `<details>` 패널 껍데기 | 생성 |
| `src/components/TweetTableView.tsx` | 배선(패널을 툴바로, 칩 줄 추가, 옛 띠 제거) | 수정 |

**의존 관계:**

```
[T2 순수 헬퍼 2개] → [T1 useDismissible + ColumnPicker] ─┐
        └────────────→ [T3 FilterChips] ────────────────┼→ [T5 배선] → [T6 검증]
                       [T4 FilterRows 축소 + FilterPanel] ┘   (T4는 T1의 훅을 쓴다)
```

**T2를 먼저 한다.** T1이 `ColumnPicker`에서 라벨을 `columnSelectionLabel`로 바꾸는데 그 함수를 T2가 만들기 때문이다. T3와 T4는 T1이 끝난 뒤 서로 독립이다(각각 새 파일 하나 + `FilterRows.tsx`로 파일이 겹치지 않는다).

---

### Task 1: `useDismissible` 훅 + `ColumnPicker` 적용

> **선행:** Task 2가 먼저 끝나야 한다 — Step 3이 T2의 `columnSelectionLabel`을 쓴다.

**Files:**
- Create: `src/lib/useDismissible.ts`
- Modify: `src/components/ColumnPicker.tsx`

**Interfaces:**
- Consumes: T2의 `columnSelectionLabel`
- Produces (T4가 쓴다): `useDismissible(ref: RefObject<HTMLDetailsElement | null>): void`

**왜 React 상태를 쓰지 않는가:** 이 저장소는 `react-hooks/set-state-in-effect`가 **에러**라 열림 상태를 `useState`로 들면 리스너 콜백에서 닫을 때 문제가 되기 쉽고, 무엇보다 `<details>`는 이미 자기 상태를 DOM에 들고 있다. `Column.tsx:75`가 같은 이유로 `viewRef.current?.removeAttribute('open')`을 쓴다. 그 방식을 그대로 훅으로 뽑는다.

**IME 주의:** Esc 처리에 `e.isComposing` 검사가 반드시 있어야 한다. 일본어·한국어 입력 중 Esc는 조합 취소이지 패널 닫기가 아니다. `ColumnSettings.tsx:49`가 같은 검사를 한다.

**`pointerdown`을 쓰는 이유:** `click`으로 달면 패널 안의 버튼을 누를 때 그 버튼의 `onClick`보다 늦게 도착해 이미 닫힌 뒤에 동작하거나, 반대로 닫힘이 한 박자 늦는다. `pointerdown`은 눌리는 즉시 발생해 판정이 단순하다.

- [ ] **Step 1: 훅 작성**

`src/lib/useDismissible.ts`:

```ts
'use client';
import { useEffect, type RefObject } from 'react';

// <details> 드롭다운을 바깥 클릭과 Esc로 닫는다.
//
// React 상태를 두지 않는 이유: <details>는 열림 상태를 이미 DOM(open 속성)에 들고 있고,
// 이 저장소는 react-hooks/set-state-in-effect가 에러라 상태를 이중으로 들면 손해만 본다.
// Column.tsx가 같은 이유로 removeAttribute('open')을 쓴다 — 같은 방식을 공유한다.
export function useDismissible(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open');

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.target instanceof Node && el.contains(e.target)) return;   // 패널 안을 누른 것
      close();
    };
    // IME 조합 중 Esc는 조합 취소다 — 패널을 닫으면 입력하던 글자가 사라진 것처럼 느껴진다.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && ref.current?.open) close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref]);
}
```

- [ ] **Step 2: `ColumnPicker`에 적용**

`src/components/ColumnPicker.tsx`에서 import에 `useRef`(react)와 `useDismissible`을 더하고, 컴포넌트 본문 맨 위에 ref를 만든 뒤 `<details>`에 붙인다:

```tsx
import { useRef } from 'react';
import { useDismissible } from '@/lib/useDismissible';
```

```tsx
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissible(ref);
```

```tsx
    <details ref={ref} className="relative shrink-0">
```

다른 부분은 건드리지 않는다.

- [ ] **Step 3: 트리거 라벨을 공용 함수로 바꾼다**

지금 `ColumnPicker` 안에 라벨 조립이 인라인으로 있다. 칩 줄(T3)이 같은 문구를 써야 하므로 T2가
만든 함수로 바꾼다 — 두 곳에 복사하면 갈라진다.

import에 `columnSelectionLabel`을 더하고:

```tsx
import { columnSelectionLabel } from '@/lib/tableFilter';
```

이 세 줄을

```tsx
  const label = names.length === 0 ? '전체'
    : names.length === 1 ? names[0]
    : `${names[0]} +${names.length - 1}`;
```

한 줄로 바꾼다:

```tsx
  const label = columnSelectionLabel(names);
```

`names`를 만드는 줄은 그대로 둔다.

- [ ] **Step 4: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 24 유지(늘지 않음).

- [ ] **Step 5: 커밋**

메시지 요약: `feat(x-research): 드롭다운을 바깥 클릭·Esc로 닫는다`

---

### Task 2: 순수 헬퍼 2개 — 열 선택 라벨과 경고 요약

**Files:**
- Modify: `src/lib/tableFilter.ts` (파일 끝에 추가)
- Modify: `src/lib/tableFilter.test.ts` (테스트 추가)
- Modify: `src/lib/collectionConflict.ts` (파일 끝에 추가)
- Modify: `src/lib/collectionConflict.test.ts` (테스트 추가)

**Interfaces:**
- Produces:
  - `columnSelectionLabel(names: string[]): string` — `'전체'` / `'PDRN 크림'` / `'PDRN 크림 +2'`
  - `summarizeConflicts(conflicts: Conflict[]): { primary: Conflict; extra: number } | null`

**`columnSelectionLabel`이 필요한 이유:** 지금 이 문자열 조립이 `ColumnPicker` 안에 인라인으로 있다. 칩 줄이 같은 문구를 써야 하는데 두 곳에 복사하면 갈라진다 — 이 저장소가 축 라벨에서 이미 겪은 문제다(`FIELD_SPECS`가 `SORT_LABEL`을 재사용하는 이유).

**`summarizeConflicts`가 필요한 이유:** 칩 줄에는 경고를 **한 줄만** 세운다(사용자 결정). 여러 개일 때 무엇을 세울지가 판정이다 — `alwaysEmpty`(항상 0건)가 `noEffect`(무효)보다 위험하므로 먼저다. 이 판정이 컴포넌트 안에 있으면 테스트할 수 없다.

- [ ] **Step 1: `columnSelectionLabel` 실패하는 테스트 작성**

`src/lib/tableFilter.test.ts` 끝에 추가하고 import에 `columnSelectionLabel`을 더한다:

```ts
test('columnSelectionLabel: 트리거와 칩이 같은 문구를 쓴다', () => {
  assert.equal(columnSelectionLabel([]), '전체');
  assert.equal(columnSelectionLabel(['PDRN 크림']), 'PDRN 크림');
  assert.equal(columnSelectionLabel(['PDRN 크림', '스킨케어 관련']), 'PDRN 크림 +1');
  assert.equal(columnSelectionLabel(['A', 'B', 'C']), 'A +2');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: FAIL — `columnSelectionLabel is not a function` (또는 import 오류)

- [ ] **Step 3: 구현**

`src/lib/tableFilter.ts` 끝에 추가:

```ts
// 열 선택을 한 줄로 말한다. 트리거와 칩이 같은 함수를 써야 갈라지지 않는다 —
// '3개'처럼 개수만 쓰면 무엇이 걸렸는지 열어봐야 안다(AGENTS.md 원칙 4).
export function columnSelectionLabel(names: string[]): string {
  if (names.length === 0) return '전체';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}
```

- [ ] **Step 4: `summarizeConflicts` 실패하는 테스트 작성**

`src/lib/collectionConflict.test.ts` 끝에 추가하고 import에 `summarizeConflicts`를 더한다:

```ts
const cf = (kind: 'noEffect' | 'alwaysEmpty', id: string) =>
  ({ conditionId: id, kind, message: `${id} 메시지` } as const);

test('summarizeConflicts: 경고가 없으면 null', () => {
  assert.equal(summarizeConflicts([]), null);
});

test('summarizeConflicts: 항상 0건이 무효보다 먼저 — 순서가 뒤여도', () => {
  const out = summarizeConflicts([cf('noEffect', 'a'), cf('alwaysEmpty', 'b')])!;
  assert.equal(out.primary.conditionId, 'b');
  assert.equal(out.extra, 1);
});

test('summarizeConflicts: 같은 종류면 먼저 온 것 — 조건 순서를 따른다', () => {
  const out = summarizeConflicts([cf('noEffect', 'a'), cf('noEffect', 'b')])!;
  assert.equal(out.primary.conditionId, 'a');
  assert.equal(out.extra, 1);
});

test('summarizeConflicts: 하나뿐이면 나머지는 0', () => {
  const out = summarizeConflicts([cf('alwaysEmpty', 'z')])!;
  assert.equal(out.primary.conditionId, 'z');
  assert.equal(out.extra, 0);
});
```

- [ ] **Step 5: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/collectionConflict.test.ts`
Expected: FAIL — `summarizeConflicts is not a function`

- [ ] **Step 6: 구현**

`src/lib/collectionConflict.ts` 끝에 추가:

```ts
// 칩 줄에는 경고를 한 줄만 세운다(사용자 결정 2026-07-31). 여러 개일 때 무엇을 세울지가 판정이다.
// '항상 0건'은 '무효'보다 위험하다 — 무엇을 해도 안 나오는데 이유를 알 수 없기 때문이다.
// 같은 종류끼리는 조건이 놓인 순서를 따른다(사용자가 위에서부터 읽는다).
export function summarizeConflicts(
  conflicts: Conflict[],
): { primary: Conflict; extra: number } | null {
  if (conflicts.length === 0) return null;
  const primary = conflicts.find((c) => c.kind === 'alwaysEmpty') ?? conflicts[0];
  return { primary, extra: conflicts.length - 1 };
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts && npx tsx --test src/lib/collectionConflict.test.ts`
Expected: 두 파일 모두 PASS, `# fail 0`

- [ ] **Step 8: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 9: 커밋**

메시지 요약: `feat(x-research): 열 선택 라벨·경고 요약을 순수 함수로`

---

### Task 3: 적용 칩 줄 (`FilterChips`)

**Files:**
- Create: `src/components/FilterChips.tsx`

**Interfaces:**
- Consumes: T2의 `columnSelectionLabel`·`summarizeConflicts`, `describeCondition`·`isComplete`(`@/lib/tableFilter`), `Conflict`(`@/lib/collectionConflict`)
- Produces (T5가 쓴다):

```ts
FilterChips({ conditions, conflicts, columnNames, onRemoveCondition, onClearColumns, onClearAll, onOpenCondition }: {
  conditions: FilterCondition[];        // 완성된 것만 칩이 된다 — 걸러서 넘기지 말고 여기서 isComplete로 거른다
  conflicts: Conflict[];
  columnNames: string[];                // 선택된 열 이름. 빈 배열이면 열 칩 없음
  onRemoveCondition: (id: string) => void;
  onClearColumns: () => void;
  onClearAll: () => void;
  onOpenCondition: (id: string) => void; // 칩 본문 클릭 — 패널을 열고 그 조건에 초점
})
```

**칩 문구는 `describeCondition`이 만든다.** 이 함수는 원래 칩 라벨용으로 만들어졌다가 배치가 바뀌면서 호출부가 사라져 최종 리뷰에서 "쓰이는 데가 없다"고 지적됐다. 이 배치가 원래 자리를 돌려준다.

**미완성 조건은 칩이 되지 않는다.** 값이 비었거나 형식이 안 맞는 조건은 쿼리에도 안 가므로 칩으로 보이면 라벨과 실제가 어긋난다(원칙 4). 부수 효과로 `describeCondition`이 `NaN` 문자열을 만들 수 있는 경로도 닫힌다.

**칩이 하나도 없으면 이 컴포넌트는 아무것도 렌더하지 않는다** — 조건도 없고 열도 안 좁혀졌으면 줄 자체가 없어야 한다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/FilterChips.tsx`:

```tsx
'use client';
import { columnSelectionLabel, describeCondition, isComplete, type FilterCondition } from '@/lib/tableFilter';
import { summarizeConflicts, type Conflict } from '@/lib/collectionConflict';

// 걸린 필터를 패널을 열지 않아도 읽을 수 있게 하는 줄.
// 패널 안에 상태가 있고, 트리거에 개수 배지가 있고, 여기에 요약이 있다 — 세 겹으로 두는 것이
// 의도된 중복이다. 어느 하나만 두면 "뭐가 걸렸는지 열어봐야 아는" 상태가 된다.
export function FilterChips({
  conditions, conflicts, columnNames,
  onRemoveCondition, onClearColumns, onClearAll, onOpenCondition,
}: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  columnNames: string[];
  onRemoveCondition: (id: string) => void;
  onClearColumns: () => void;
  onClearAll: () => void;
  onOpenCondition: (id: string) => void;
}) {
  // 미완성 조건은 쿼리에 안 가므로 칩으로도 보이면 안 된다 — 라벨과 실제가 어긋난다.
  const ready = conditions.filter(isComplete);
  const hasColumns = columnNames.length > 0;
  if (ready.length === 0 && !hasColumns) return null;

  const summary = summarizeConflicts(conflicts);
  const byCondition = new Map(conflicts.map((c) => [c.conditionId, c]));

  const chip = 'inline-flex items-center gap-1.5 rounded-full border bg-x-hover py-0.5 pl-2.5 pr-0.5 text-ui text-x-text';
  const del = 'inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center rounded-full text-caption text-x-muted hover:bg-x-border hover:text-x-text';

  return (
    <div className="flex flex-col gap-0.5 border-b border-x-border px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {hasColumns && (
          <span className={`${chip} border-x-border-strong`}>
            열 {columnSelectionLabel(columnNames)}
            <button aria-label="열 선택 지우기" title="열 선택 지우기" onClick={onClearColumns} className={del}>✕</button>
          </span>
        )}
        {ready.map((c) => {
          const conflict = byCondition.get(c.id);
          // 경고를 색으로만 구분하지 않는다 — 점을 함께 둔다(색을 구분 못 해도 읽힌다).
          const border = conflict?.kind === 'alwaysEmpty' ? 'border-red-400'
            : conflict ? 'border-amber-400' : 'border-x-border-strong';
          return (
            <span key={c.id} className={`${chip} ${border}`}>
              {conflict && (
                <span aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${conflict.kind === 'alwaysEmpty' ? 'bg-red-500' : 'bg-amber-600'}`} />
              )}
              <button onClick={() => onOpenCondition(c.id)} className="hover:underline">
                {describeCondition(c)}
              </button>
              <button aria-label="이 조건 지우기" title="이 조건 지우기"
                      onClick={() => onRemoveCondition(c.id)} className={del}>✕</button>
            </span>
          );
        })}
        <button onClick={onClearAll} className="ml-0.5 text-ui text-x-blue-text underline hover:no-underline">
          필터 지우기
        </button>
      </div>
      {summary && (
        <p className={`text-caption ${summary.primary.kind === 'alwaysEmpty' ? 'text-red-500' : 'text-amber-600'}`}>
          {summary.primary.message}
          {summary.extra > 0 && <span className="text-x-muted"> · 경고 {summary.extra}개 더</span>}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음(`FilterChips.tsx`를 가리키는 오류 0). 린트 총계 24 유지.

- [ ] **Step 3: 커밋**

메시지 요약: `feat(x-research): 걸린 필터를 칩 줄로 요약해 보여준다`

---

### Task 4: `FilterRows`를 패널 내용으로 축소 + `FilterPanel` 껍데기

**Files:**
- Modify: `src/components/FilterRows.tsx`
- Create: `src/components/FilterPanel.tsx`

**Interfaces:**
- Consumes: T1의 `useDismissible`
- Produces (T5가 쓴다):

```ts
FilterPanel({ conditions, conflicts, onChange, totalLabel, countsLoaded, focusRequest, panelRef }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
  countsLoaded: boolean;
  focusRequest: { id: string; n: number } | null;  // 칩 클릭으로 열렸을 때 초점 줄 조건
  panelRef: RefObject<HTMLDetailsElement | null>;   // 부모가 프로그램적으로 열 수 있게
})
```

`FilterRows`의 prop에서 `hasColumnFilter`·`onClearAll`이 **빠지고**(칩 줄로 이동) `focusRequest`가 **들어온다**.

**`focusRequest`가 `{ id, n }`인 이유:** 같은 칩을 두 번 눌러도 다시 초점이 가야 한다. `id`만 넘기면 값이 안 바뀌어 effect가 다시 돌지 않는다. `n`은 부모가 클릭 핸들러에서 증가시키는 카운터다(이벤트 핸들러의 setState라 `set-state-in-effect`와 무관하다).

**초점은 setState가 아니라 `focus()`다.** effect 안에서 DOM 메서드를 부르는 것은 이 저장소가 금지한 것이 아니다 — 금지된 것은 effect 본문의 setState다.

- [ ] **Step 1: `FilterRows` 수정**

`src/components/FilterRows.tsx`에서:

1. import 줄을 바꾼다(`Button` 제거, react 훅 추가):

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, type FilterCondition, type FilterField } from '@/lib/tableFilter';
import type { Conflict } from '@/lib/collectionConflict';
```

2. 시그니처에서 `hasColumnFilter`·`onClearAll`을 빼고 `focusRequest`를 더한다:

```tsx
export function FilterRows({ conditions, conflicts, onChange, totalLabel, countsLoaded, focusRequest }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
  countsLoaded: boolean;      // totalLabel이 실제로 로드됐는지 — 실패 시 0으로 남아 있는 것과 구분한다
  focusRequest: { id: string; n: number } | null;   // 칩을 눌러 열렸을 때 그 조건에 초점
}) {
```

3. `add()`·`patch()`는 그대로 두고, 그 아래에 초점 처리를 더한다:

```tsx
  // 칩을 눌러 패널이 열렸으면 그 조건의 첫 컨트롤에 초점을 준다 — 어느 줄을 눌렀는지 잃지 않게.
  // focus()는 DOM 메서드라 set-state-in-effect와 무관하다.
  const rowRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  useEffect(() => {
    if (focusRequest) rowRefs.current[focusRequest.id]?.focus();
  }, [focusRequest]);
```

4. 반환문에서 **맨 위 버튼 줄을 지우고**, 조건 목록 다음에 `＋ 조건 추가`를 둔다. 첫 `<select>`에 ref를 붙인다. 최종 형태:

```tsx
  return (
    <div className="flex flex-col gap-1">
      {conditions.map((c) => {
        const spec = FIELD_SPECS[c.field];
        // 알려지지 않은 축이 들어오면 이 행은 건너뛴다 (차후 축 정의 변경 시에도 안정적)
        if (!spec) return null;
        const conflict = conflicts.find((x) => x.conditionId === c.id);
        const warningId = conflict ? `filter-warning-${c.id}` : undefined;
        return (
          <div key={c.id} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <select ref={(el) => { rowRefs.current[c.id] = el; }}
                      aria-label="필터 항목" aria-describedby={warningId} value={c.field} className={sel}
                      onChange={(e) => patch(c.id, { field: e.target.value as FilterField })}>
                {FILTER_FIELDS.map((f) => <option key={f} value={f}>{FIELD_SPECS[f].label}</option>)}
              </select>
              <select aria-label="조건" aria-describedby={warningId} value={c.op} className={sel}
                      onChange={(e) => patch(c.id, { op: e.target.value as FilterCondition['op'] })}>
                {spec.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select>
              <input aria-label="값" aria-describedby={warningId} value={c.value} className={`${sel} w-44`}
                     inputMode={spec.kind === 'number' ? 'numeric' : undefined}
                     placeholder={spec.kind === 'date' ? '2026-07-01' : ''}
                     onChange={(e) => patch(c.id, { value: e.target.value })} />
              <button aria-label="이 조건 지우기" title="이 조건 지우기"
                      onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
                      className="rounded px-1.5 py-1 text-ui text-x-muted hover:bg-x-hover hover:text-x-text">✕</button>
            </div>
            {conflict && (
              // 항상 0건은 무효보다 위험하다 — 무엇을 해도 안 나오는데 이유를 알 수 없다. 색으로도 구분한다.
              <p id={warningId} className={`pl-1 text-caption ${conflict.kind === 'alwaysEmpty' ? 'text-red-500' : 'text-amber-600'}`}>
                {conflict.message}
              </p>
            )}
          </div>
        );
      })}
      <button onClick={add} className="self-start rounded px-1.5 py-1 text-ui font-medium text-x-blue-text hover:bg-x-hover">
        ＋ 조건 추가
      </button>
      {conditions.length > 0 && countsLoaded && (
        // 건수를 아직 모르는 것과 진짜 0건은 다르다 — countsLoaded가 false면(최초 로딩 중이거나
        // 건수 요청이 실패해 조용히 넘어간 경우) 줄 자체를 감춘다. 없는 편이 틀린 것보다 낫다.
        <p className="border-t border-x-border pt-1.5 pl-1 text-caption text-x-muted">
          이미 모은 {totalLabel}건 중에서만 걸러요 (새로 가져오지 않아서 무료)
        </p>
      )}
    </div>
  );
```

- [ ] **Step 2: `FilterPanel` 작성**

`src/components/FilterPanel.tsx`:

```tsx
'use client';
import type { RefObject } from 'react';
import type { FilterCondition } from '@/lib/tableFilter';
import type { Conflict } from '@/lib/collectionConflict';
import { useDismissible } from '@/lib/useDismissible';
import { FilterRows } from './FilterRows';
import { ChevronDownIcon } from './XIcons';

// 조건을 만드는 자리 — 표 위에 떠서 열린다. 조건이 늘어도 표가 밀리지 않는다(시안 2026-07-31).
// 걸린 조건을 읽는 자리는 여기가 아니라 FilterChips다.
export function FilterPanel({ conditions, conflicts, onChange, totalLabel, countsLoaded, focusRequest, panelRef }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
  countsLoaded: boolean;
  focusRequest: { id: string; n: number } | null;
  panelRef: RefObject<HTMLDetailsElement | null>;
}) {
  useDismissible(panelRef);
  const n = conditions.length;

  return (
    <details ref={panelRef} className="relative shrink-0">
      <summary className={`flex cursor-pointer list-none items-center gap-1 rounded-full border px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover [&::-webkit-details-marker]:hidden ${n > 0 ? 'border-x-blue' : 'border-x-border-strong'}`}>
        필터
        {n > 0 && (
          // 개수는 배지로 — '필터'만 있으면 걸려 있는지 알 수 없다(AGENTS.md 원칙 4)
          <span className="ml-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-x-blue px-1 text-caption font-bold tabular-nums text-white">
            {n}
          </span>
        )}
        <ChevronDownIcon className="h-3 w-3" />
      </summary>
      {/* left-0: 트리거가 툴바 왼쪽이다 — ColumnPicker와 같은 이유 */}
      <div className="absolute left-0 z-20 mt-1 max-h-[26rem] w-[25rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-x-border bg-white p-2 shadow-lg">
        <FilterRows conditions={conditions} conflicts={conflicts} onChange={onChange}
                    totalLabel={totalLabel} countsLoaded={countsLoaded} focusRequest={focusRequest} />
      </div>
    </details>
  );
}
```

- [ ] **Step 3: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc`는 `TweetTableView.tsx`에서만 오류가 난다 — 아직 `FilterRows`에 옛 prop(`hasColumnFilter`·`onClearAll`)을 넘기고 있기 때문이다. **T5에서 고친다.** 오류가 그 파일 하나에만 있는지 확인하고 다음으로 간다. 린트 총계는 24 유지.

- [ ] **Step 4: 커밋**

메시지 요약: `feat(x-research): 조건 편집을 표 위에 뜨는 패널로 옮긴다`

---

### Task 5: 배선 — 툴바에 패널, 그 아래 칩 줄

**Files:**
- Modify: `src/components/TweetTableView.tsx`

**Interfaces:**
- Consumes: T3의 `FilterChips`, T4의 `FilterPanel`

**이 태스크가 끝나면 재배치가 완성된다.** 서버·쿼리·API는 한 줄도 바뀌지 않는다.

- [ ] **Step 1: import와 상태 정리**

import에서 `FilterRows`를 빼고 `FilterPanel`·`FilterChips`를 더한다. `useRef`가 이미 import돼 있는지 확인하고 없으면 더한다:

```tsx
import { FilterPanel } from './FilterPanel';
import { FilterChips } from './FilterChips';
```

`conditions` 상태 아래에 두 가지를 더한다:

```tsx
  const filterPanelRef = useRef<HTMLDetailsElement>(null);
  // 칩을 눌러 패널을 열 때 어느 조건에 초점을 줄지. n은 같은 칩을 두 번 눌러도 다시 초점이 가게 하는 카운터.
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
```

- [ ] **Step 2: 칩 클릭 핸들러**

`saveCsv` 정의 근처(컴포넌트 본문, 반환문 위)에 추가한다. 이벤트 핸들러 안의 setState라 `set-state-in-effect`와 무관하다:

```tsx
  // 칩 본문을 누르면 패널을 열고 그 조건으로 데려간다 — 어느 줄을 고치려 했는지 잃지 않게.
  function openCondition(id: string) {
    if (filterPanelRef.current) filterPanelRef.current.open = true;
    setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  }
```

- [ ] **Step 3: 툴바에 패널 넣기**

툴바의 `bar-left`에 해당하는 영역 — `<ColumnPicker … />` 바로 뒤에 `FilterPanel`을 둔다. 두 트리거가 한 묶음으로 보이도록 감싸는 요소가 없다면 `flex items-center gap-2` div로 묶는다:

```tsx
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columns} counts={counts} countsLoaded={countsLoaded}
                        selected={activeColumnIds} onChange={setColumnIds} />
          <FilterPanel conditions={conditions} onChange={setConditions}
                       conflicts={findConflicts(conditions.filter(isComplete), columns, activeColumnIds)}
                       totalLabel={workspaceTotal.toLocaleString('en-US')}
                       countsLoaded={countsLoaded}
                       focusRequest={focusRequest}
                       panelRef={filterPanelRef} />
        </div>
```

- [ ] **Step 4: 옛 조건 행 띠를 칩 줄로 교체**

툴바 다음에 있던 `{/* 조건 행 — … */}` div 전체(`<FilterRows …/>`를 감싸던 `border-b … px-4 py-2` div)를 지우고 이것으로 바꾼다:

```tsx
      <FilterChips conditions={conditions}
                   conflicts={findConflicts(conditions.filter(isComplete), columns, activeColumnIds)}
                   columnNames={activeColumnIds.map((id) => columns.find((c) => c.id === id)?.title ?? '').filter(Boolean)}
                   onRemoveCondition={(id) => setConditions(conditions.filter((c) => c.id !== id))}
                   onClearColumns={() => setColumnIds([])}
                   onClearAll={() => { setColumnIds([]); setConditions([]); }}
                   onOpenCondition={openCondition} />
```

`FilterChips`는 걸린 게 없으면 스스로 아무것도 렌더하지 않으므로 바깥을 조건부로 감쌀 필요가 없다.

**`findConflicts(...)`가 두 번 호출되는 것이 신경 쓰이면** 반환문 위에서 한 번만 계산해 변수에 담고 두 곳에서 쓴다 — 순수 함수이고 열 수가 수십 개라 성능 문제는 아니지만, 두 곳이 갈라질 수 없게 하는 편이 낫다:

```tsx
  const conflicts = findConflicts(conditions.filter(isComplete), columns, activeColumnIds);
```

- [ ] **Step 5: 타입 체크 + 린트 + 빌드**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: `tsc` 출력 없음(T4에서 남았던 오류가 사라진다). 린트 총계 24 유지. 빌드 성공.

- [ ] **Step 6: 커밋**

메시지 요약: `feat(x-research): 필터를 툴바 패널 + 칩 줄로 재배치`

---

### Task 6: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전부 통과, `# fail 0`. 약 4분(실 DB). 기준선 323개 + 이 계획의 신규 5개 = 328개.

- [ ] **Step 2: 타입 체크 · 린트 · 프로덕션 빌드**

Run: `npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 | tail -3; npm run build 2>&1 | tail -5`
Expected: `tsc=0`, 린트 **24**(늘지 않음), 빌드 성공.

- [ ] **Step 3: 죽은 코드 확인**

Run: `grep -rn "hasColumnFilter\|onClearAll" src/components/FilterRows.tsx; grep -rn "FilterRows" src/components/TweetTableView.tsx`
Expected: 둘 다 출력 없음 — 옛 prop과 옛 import가 남아 있지 않아야 한다.

- [ ] **Step 4: 브라우저 확인**

`npm run dev` → `http://localhost:3000/w/d40e4b21-d53f-4dd0-a2b3-bccc5f078f83?view=table`

1. 조건이 없으면 표 위가 **툴바 한 줄**이다(칩 줄도 없다). `열: 전체 ▾`와 `필터 ▾`가 나란히 있다
2. `필터`를 누르면 패널이 **표 위에 떠서** 열리고 표는 움직이지 않는다
3. 패널 바깥을 클릭하면 닫힌다. Esc로도 닫힌다. **일본어를 입력하다 Esc를 누르면 조합만 취소되고 패널은 안 닫힌다**
4. 같은 동작이 `열: 전체 ▾` 드롭다운에서도 된다
5. `＋ 조건 추가` → 조건 한 줄이 패널 안에 생긴다. 값을 비워둔 동안 칩은 생기지 않고 표도 0건으로 튀지 않는다
6. 값을 채우면 **칩 줄이 한 줄 생기고** 트리거에 개수 배지가 붙는다
7. `PDRN 크림`만 고르고 `좋아요 이상 100` → 칩에 주황 점, 칩 줄 아래에 주황 경고 한 줄
8. `이하 200`으로 바꾸면 → 칩에 빨간 점, 빨간 경고. 경고가 둘이면 **위험한 것이 먼저**, 뒤에 `· 경고 1개 더`
9. 칩 본문을 누르면 패널이 열리고 **그 조건의 첫 컨트롤에 초점**이 간다. 같은 칩을 다시 눌러도 또 간다
10. 칩의 ✕는 그 조건만 지운다. 열 칩의 ✕는 열 선택만 지운다. `필터 지우기`는 둘 다 지운다
11. 조건을 5개까지 늘려도 표 위 높이는 **툴바 + 칩 줄(+경고 한 줄)**에서 더 늘지 않는다
12. 조건 없이 열만 좁혀도 칩 줄에 `열 …` 칩과 `필터 지우기`가 보인다
13. CSV 저장·더보기·정렬·워크스페이스 전환이 그대로 동작한다

- [ ] **Step 5: 사용자 확인 요청**

로그인 게이팅으로 볼 수 없는 것과 판단이 필요한 것을 전달한다: 패널 폭(25rem)이 조건 문구에 충분한지, 칩이 8~10개일 때 줄바꿈이 답답하지 않은지, 배지 파랑이 툴바에서 과하지 않은지.
