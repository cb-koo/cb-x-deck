# 서울 기준 시간대 통일 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 전체의 날짜·시각 표기를 한국 시간(고정 +9)으로 통일하고, '오늘'을 UTC로 계산해 하루가 밀리던 동작 버그 6건을 고친다.

**Architecture:** `src/lib/datetime.ts`를 신설해 **instant 계열**(timestamptz에서 온 ISO)과 **date-only 계열**(`YYYY-MM-DD`)을 타입으로 분리한다. 이미 정확한 구현(`tableColumns.ts`의 KST 고정 +9)을 그 모듈로 승격하고, 컴포넌트 안에 흩어진 헬퍼 8개를 끌어올려 순수 함수로 만든다 — 이 저장소에는 컴포넌트 테스트 하네스가 없어서, 끌어올리는 것이 이 값들을 검증할 수 있는 유일한 방법이다.

**Tech Stack:** TypeScript · node:test · postgres.js · Next.js(App Router)

**설계 문서:** `docs/superpowers/specs/2026-08-08-seoul-timezone-unification-design.md`
**전수 조사(사이트 번호의 출처):** `docs/superpowers/specs/2026-08-08-seoul-timezone-survey.md`

## Global Constraints

- **(C)로 분류된 18건을 건드리지 않는다.** 조사 문서 §2에 file:line과 "고치면 깨지는 것"이 있다. 특히 `src/lib/trend.ts`, `src/lib/briefing.ts`, `src/lib/tableFilter.ts`, `src/lib/collectionConflict.ts`, `src/lib/queryBuilder.ts`, `src/lib/briefingStore.ts`는 **이 작업에서 한 줄도 바뀌지 않는다.**
- **`src/lib/draftUi.ts`를 건드리지 않는다.** 다른 워크스트림이 수정 중이다(설계 §C).
- **파일 단위로 훑지 않는다.** 반드시 사이트 번호(A1…A10, B1…B6)를 짚어 그 줄만 고친다. 같은 파일에 (C)가 함께 있다.
- **고정 +9를 쓴다.** `Intl`·`toLocaleDateString`·`toLocaleString`을 새로 도입하지 않는다.
- **`npx tsc --noEmit`은 출력 없이 통과해야 한다.**
- **린트는 정확히 `✖ 25 problems (14 errors, 11 warnings)`를 유지한다.** 확인: `npm run lint 2>&1 | grep problems`. 규칙을 끄지 않는다.
- **테스트는 376건에서 줄지 않는다**(새 테스트로 늘어난다). 전체 실행은 약 5분, 실 DB를 쓴다.
- 사용자 대면 문구는 한국어. 커밋 메시지도 한국어, 저장소 형식(`feat(datetime):` / `fix(usage):` 등).
- 커밋은 경로 지정형으로: 메시지를 파일에 쓰고 `git commit -F <파일> -- <경로들>`. `git add -A` 금지.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/datetime.ts` | (신규) 앱 전체 날짜·시각 표기. instant 계열 + date-only 계열 |
| `src/lib/datetime.test.ts` | (신규) 경계값 테스트 |
| `src/lib/tableColumns.ts` | (수정) `ymd`/`ymdHm`을 새 모듈에서 re-export |
| `src/lib/usageStore.ts` · `src/app/w/[wsId]/usage/page.tsx` · `src/lib/actualCost.ts` | (수정) 사용량 — A9·B1·B2 |
| `src/lib/format.ts` · `src/lib/format.test.ts` · `src/components/TweetCard.tsx` · `QuotedCard.tsx` · `PillarPanel.tsx` · `CandidateCard.tsx` · `src/app/w/[wsId]/research/page.tsx` | (수정) 카드·표시 — A1~A6, A8 |
| `src/components/BriefingSection.tsx` · `TrendPanel.tsx` · `TweetTableView.tsx` · `src/app/api/research/density/route.ts` | (수정) 브리핑·추이·경계 — A10, B3~B6 |

**작업 순서:** Task 1 → Task 2 는 순차(모두가 의존). **Task 3·4·5는 파일이 겹치지 않아 병렬로 할 수 있다.**

---

### Task 1: `datetime.ts` 신설 — 두 계열 분리

**Files:**
- Create: `src/lib/datetime.ts`
- Test: `src/lib/datetime.test.ts`

**Interfaces:**
- Consumes: 없음(순수 모듈)
- Produces: 아래 export 전부. Task 2~5가 쓴다.
  ```ts
  type DateOnly            // 브랜딩 타입
  asDateOnly(s: string): DateOnly
  kstDate(iso: string | null): string          // YYYY-MM-DD
  kstDateTime(iso: string | null): string      // YYYY-MM-DD HH:MM
  kstShort(iso: string | null): string         // '26.07.06  (없으면 '–')
  kstMonthDay(iso: string | null): string      // M/D
  kstMonthDayKo(iso: string | null): string    // M월 D일
  kstToday(): string                           // 오늘(한국) YYYY-MM-DD
  kstDaysAgo(n: number): string                // n일 전(한국) YYYY-MM-DD
  kstTodayStart(): Date                        // 오늘 00:00 KST의 순간
  kstDaysAgoStart(n: number): Date             // n일 전 00:00 KST의 순간
  kstMonthStart(): Date                        // 이번 달 1일 00:00 KST의 순간
  dateOnlyMonthDay(d: DateOnly): string        // M/D
  weekRangeLabel(weekStart: DateOnly): string  // 6/15~21
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/datetime.test.ts`를 새로 만든다. 경계값 중심이다 — UTC 15:00이 KST 익일 00:00이라는 것이 이 모듈 전체의 핵심 경계다.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asDateOnly, kstDate, kstDateTime, kstShort, kstMonthDay, kstMonthDayKo,
  kstToday, kstDaysAgo, kstTodayStart, kstDaysAgoStart, kstMonthStart,
  dateOnlyMonthDay, weekRangeLabel,
} from './datetime.ts';

// 한국 시간은 UTC+9 고정이므로 UTC 15:00이 KST 다음 날 00:00이다. 이 경계가 모듈 전체의 축이다.
test('instant 계열: UTC 15:00을 넘으면 한국 날짜가 하루 앞선다', () => {
  assert.equal(kstDate('2026-07-10T14:59:59.000Z'), '2026-07-10');
  assert.equal(kstDate('2026-07-10T15:00:00.000Z'), '2026-07-11');   // 경계 정각
  assert.equal(kstDateTime('2026-07-10T15:00:00.000Z'), '2026-07-11 00:00');
  assert.equal(kstDateTime('2026-07-11T01:02:03.000Z'), '2026-07-11 10:02');
});

test('instant 계열: 표기 변형', () => {
  assert.equal(kstShort('2026-07-06T23:29:44.000Z'), "'26.07.07");   // UTC 7/6 23:29 = KST 7/7 08:29
  assert.equal(kstMonthDay('2026-07-06T23:29:44.000Z'), '7/7');
  assert.equal(kstMonthDayKo('2026-07-06T23:29:44.000Z'), '7월 7일');
  assert.equal(kstMonthDay('2026-12-31T15:00:00.000Z'), '1/1');      // 연말 걸침
});

test('instant 계열: 값이 없거나 못 읽으면 화면을 죽이지 않는다', () => {
  assert.equal(kstDate(null), '');
  assert.equal(kstDate('not-a-date'), '');
  assert.equal(kstShort(null), '–');            // 카드에서 '모름' 자리를 지키던 기존 표기
  assert.equal(kstMonthDay(null), '');
});

test('오늘/기간: 한국 자정을 기준으로 만든다', () => {
  // 실제 '지금'에 의존하지 않도록, 만들어진 값들 사이의 관계만 단정한다.
  assert.match(kstToday(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(kstDaysAgo(0), kstToday());
  // 7일 전은 오늘보다 정확히 7일 앞선 한국 날짜다
  const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
  assert.equal(ms(kstToday()) - ms(kstDaysAgo(7)), 7 * 86_400_000);
  // 00:00 KST의 순간은 그 날짜의 UTC 자정보다 9시간 이르다
  assert.equal(ms(kstToday()) - kstTodayStart().getTime(), 9 * 3_600_000);
  assert.equal(kstDaysAgoStart(3).getTime(), kstTodayStart().getTime() - 3 * 86_400_000);
  // 이번 달 1일 00:00 KST
  assert.equal(kstMonthStart().getTime(), ms(kstToday().slice(0, 7) + '-01') - 9 * 3_600_000);
});

test('date-only 계열: 시간대 시프트를 하지 않는다', () => {
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-07-13')), '7/13');
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-01-01')), '1/1');   // 시프트가 들어가면 12/31이 된다
  assert.equal(weekRangeLabel(asDateOnly('2026-06-15')), '6/15~21');
  assert.equal(weekRangeLabel(asDateOnly('2026-06-29')), '6/29~7/5'); // 월이 바뀌면 월까지 적는다
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/datetime.test.ts
```

Expected: FAIL — `Cannot find module './datetime.ts'`. 통과하면 안 된다.

- [ ] **Step 3: 모듈을 만든다**

`src/lib/datetime.ts`:

```ts
// 앱 전체의 날짜·시각 표기. 두 계열로 갈라져 있고 섞으면 하루가 밀린다(설계 §A).
//
//  · instant 계열  — 입력은 timestamptz에서 온 ISO(시각 성분이 있다). 한국 시간으로 옮겨 찍는다.
//  · date-only 계열 — 입력은 'YYYY-MM-DD'. 시간대 시프트를 절대 하지 않는다. 그게 계약이다.
//
// 고정 +9인 이유: 한국은 1988년 이후 서머타임이 없어 Asia/Seoul은 항상 UTC+9다.
// Intl에 맡기면 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다.
// (이 판단과 toKstIso 구현은 tableColumns.ts에 있던 것을 그대로 승격했다.)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 파싱 불가한 값에는 빈 문자열을 돌려준다. 표의 셀마다 불리므로 던지면 표 전체 렌더가 죽는다 —
// 셀 하나가 비는 것보다 나쁘다.
function toKstIso(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + KST_OFFSET_MS).toISOString();
}

// 'YYYY-MM-DD' 자정(한국)이 실제로 가리키는 순간. UTC 자정보다 9시간 이르다.
function kstMidnightInstant(kstYmd: string): Date {
  return new Date(Date.parse(kstYmd + 'T00:00:00Z') - KST_OFFSET_MS);
}

// ─────────────────────────── instant 계열 ───────────────────────────

/** YYYY-MM-DD (한국). 표의 날짜 칸이 쓴다. */
export function kstDate(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 10);
}

/** YYYY-MM-DD HH:MM (한국). 같은 날 09시와 22시를 구분해야 하는 '최종 수집 시간'이 쓴다. */
export function kstDateTime(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 16).replace('T', ' ');
}

/** '26.07.07 (한국). 값이 없으면 '–' — 카드가 '모름'을 그렇게 표시해 왔다. */
export function kstShort(iso: string | null): string {
  if (!iso) return '–';
  const k = toKstIso(iso);
  if (!k) return '–';
  return `'${k.slice(2, 4)}.${k.slice(5, 7)}.${k.slice(8, 10)}`;
}

/** M/D (한국). */
export function kstMonthDay(iso: string | null): string {
  if (!iso) return '';
  const k = toKstIso(iso);
  if (!k) return '';
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
}

/** M월 D일 (한국). */
export function kstMonthDayKo(iso: string | null): string {
  if (!iso) return '';
  const k = toKstIso(iso);
  if (!k) return '';
  return `${Number(k.slice(5, 7))}월 ${Number(k.slice(8, 10))}일`;
}

/** 오늘(한국) YYYY-MM-DD. '오늘'을 UTC로 자르면 한국 새벽 0~9시에 어제가 된다. */
export function kstToday(): string {
  return toKstIso(new Date().toISOString()).slice(0, 10);
}

/** n일 전(한국) YYYY-MM-DD. */
export function kstDaysAgo(n: number): string {
  return toKstIso(new Date(Date.now() - n * 86_400_000).toISOString()).slice(0, 10);
}

/** 오늘 00:00(한국)이 가리키는 순간. SQL 경계로 넘길 때 쓴다. */
export function kstTodayStart(): Date {
  return kstMidnightInstant(kstToday());
}

/** n일 전 00:00(한국)이 가리키는 순간. */
export function kstDaysAgoStart(n: number): Date {
  return kstMidnightInstant(kstDaysAgo(n));
}

/** 이번 달 1일 00:00(한국)이 가리키는 순간. */
export function kstMonthStart(): Date {
  return kstMidnightInstant(`${kstToday().slice(0, 7)}-01`);
}

// ─────────────────────────── date-only 계열 ───────────────────────────

// 브랜딩 타입 — instant를 실수로 넘기면 컴파일이 막힌다. 이 작업에서 (C) 사고를 막는
// 유일한 기계적 장치다(나머지는 사람의 주의력에 의존한다).
export type DateOnly = string & { readonly __dateOnly: unique symbol };

/** 'YYYY-MM-DD'임이 확실한 값에만 쓴다 — date 컬럼, 주 시작일, <input type="date">. */
export function asDateOnly(s: string): DateOnly {
  return s as DateOnly;
}

/** M/D. 시간대 시프트 없음 — 넣으면 1/1이 12/31이 된다. */
export function dateOnlyMonthDay(d: DateOnly): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

/** 주 시작일 → '6/15~21' (월이 바뀌면 '6/29~7/5'). 시간대 시프트 없음. */
export function weekRangeLabel(weekStart: DateOnly): string {
  const s = new Date(weekStart + 'T00:00:00Z');
  const e = new Date(s.getTime() + 6 * 86_400_000);
  const end = s.getUTCMonth() === e.getUTCMonth()
    ? `${e.getUTCDate()}`
    : `${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
  return `${s.getUTCMonth() + 1}/${s.getUTCDate()}~${end}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/datetime.test.ts
npx tsc --noEmit
npx eslint src/lib/datetime.ts src/lib/datetime.test.ts
```

Expected: 테스트 `# fail 0`, tsc 무출력, eslint 무출력.

- [ ] **Step 5: 커밋**

```
feat(datetime): 날짜·시각 표기 공용 모듈 — instant/date-only 두 계열

시간대 처리가 앱 곳곳에 흩어져 헬퍼 12개가 서로를 모르고, 그중 8개는
컴포넌트 안에 박혀 테스트도 화면 확인도 불가능했다.

두 계열을 타입으로 가른다: instant(timestamptz ISO)는 한국 시간으로 옮기고,
date-only('YYYY-MM-DD')는 시프트를 절대 하지 않는다. 브랜딩 타입이라 섞으면
컴파일이 막힌다 — 이 통일 작업에서 하루 밀림을 막는 유일한 기계적 장치다.

고정 +9와 toKstIso는 tableColumns.ts에 있던 정답 구현을 그대로 승격했다.
동작 변화 없음(아직 아무도 이 모듈을 쓰지 않는다).
```

---

### Task 2: 정답 구현 이관 — `tableColumns`는 re-export만

**Files:**
- Modify: `src/lib/tableColumns.ts`

**Interfaces:**
- Consumes: `kstDate`, `kstDateTime` (Task 1)
- Produces: `tableColumns.ts`의 `ymd`/`ymdHm` export는 **이름과 동작 그대로 유지**된다. 호출부 5곳(`tableColumns` 내부 4 + `TweetCardModal.tsx:249`)은 건드리지 않는다.

- [ ] **Step 1: 구현을 빼고 re-export로 바꾼다**

`src/lib/tableColumns.ts`에서 `KST_OFFSET_MS` 상수, `toKstIso` 함수, `ymd`·`ymdHm` 함수 **네 덩어리와 그 위 주석 블록**을 지우고, 파일 상단 import에 `datetime`을 더한 뒤 그 자리에 re-export를 남긴다.

지우는 범위: `// 표의 날짜·시각은 전부 한국 시간으로 보여준다…` 주석부터 `ymdHm` 함수의 닫는 `}`까지(현재 `:38`~`:69`).

그 자리에 넣는 것:

```ts
// 날짜·시각 표기는 src/lib/datetime.ts 한 곳에서 나온다(설계 §A). 여기 있던 고정 +9 구현이
// 그 모듈로 승격됐다 — 표 밖(카드·브리핑·사용량)도 같은 규칙을 써야 하는데 표 전용 파일에
// 갇혀 있었기 때문이다. 표 쪽 호출부를 건드리지 않으려고 이름 그대로 다시 내보낸다.
export const ymd = kstDate;
export const ymdHm = kstDateTime;
```

파일 상단 import 블록에 추가:

```ts
import { kstDate, kstDateTime } from './datetime.ts';
```

- [ ] **Step 2: 동작이 안 바뀌었는지 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/tableColumns.test.ts
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/tableExport.test.ts
npx tsc --noEmit
```

Expected: 두 테스트 모두 `# fail 0`. `tableColumns.test.ts:44-58`의 KST 경계 단언이 그대로 통과해야 한다 — 이게 이관이 무손실이라는 증거다.

- [ ] **Step 3: 커밋**

```
refactor(datetime): 표에 갇혀 있던 KST 구현을 공용 모듈로 이관

고정 +9 구현이 tableColumns.ts — 표 칸 정의 파일 — 에 있어서 카드·브리핑·사용량이
같은 규칙을 쓰지 못했다. 새 사람은 범용 이름의 format.ts를 먼저 집는데 거기 있는
formatDate는 UTC라 틀렸다.

ymd/ymdHm는 이름 그대로 re-export해 표 쪽 호출부 5곳을 건드리지 않는다.
tableColumns.test.ts의 KST 경계 단언이 그대로 통과하는 것이 무손실의 증거다.
동작 변화 없음.
```

---

### Task 3 (병렬 가능): 사용량 — A9 + B1 + B2

**Files:**
- Modify: `src/lib/usageStore.ts` (A9), `src/app/w/[wsId]/usage/page.tsx` (B1), `src/lib/actualCost.ts` (B2)

**Interfaces:**
- Consumes: `kstMonthStart`, `kstDaysAgoStart`, `kstDate` (Task 1)
- Produces: 없음

> **A9과 B1은 반드시 같은 커밋이다**(설계 §D, 조사 §6-1). 라벨은 +9 버킷인데 데이터 경계가 UTC라 지금 첫·마지막 막대가 부분 집계다. 한쪽만 고치면 그 불일치가 남는다.

- [ ] **Step 1: A9 — SQL 버킷의 시간대 이름을 바로잡는다**

`src/lib/usageStore.ts`의 `dailyAggregate` 안에서:

```
    select to_char(date_trunc('day', created_at at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as day,
```

를 아래로 바꾼다. `Asia/Tokyo`와 `Asia/Seoul`은 둘 다 +9에 DST가 없어 **출력은 바뀌지 않는다** — 이름만 바로잡는 것이다.

```
    -- Asia/Seoul: 이 화면의 다른 값들과 같은 기준. 예전엔 Asia/Tokyo였는데 오프셋이 같아
    -- 출력은 동일했지만, 기간 경계(usage/page.tsx)가 KST로 바뀌면서 이름이 어긋나 보인다.
    select to_char(date_trunc('day', created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as day,
```

- [ ] **Step 2: B1 — 기간 경계를 한국 자정으로 만든다**

`src/app/w/[wsId]/usage/page.tsx`의 `ranges` 함수 전체를 바꾼다. 현재는 서버 로컬(Vercel=UTC)로 경계를 만들어 ①매월 1일 오전 9시간이 '이번 달'에서 빠지고 ②한국 시간 1일 00:00~09:00에 열면 `setDate(1)`이 **전달** 1일을 가리킨다.

```tsx
// 현재 기간 + 동일 길이 직전 기간(추세 비교용)
// 경계는 한국 자정이다 — 막대 라벨이 KST 버킷(usageStore.dailyAggregate)이라 경계도 같아야
// 첫·마지막 막대가 부분 집계가 되지 않는다. 서버 로컬(Vercel=UTC)로 만들면 매월 1일 오전
// 9시간이 빠지고, 한국 1일 새벽에는 전달을 보여준다.
function ranges(period: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const to = new Date();
  const from = period === 'month' ? kstMonthStart()
    : period === '7d' ? kstDaysAgoStart(7)
    : kstDaysAgoStart(30);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);
  return { from, to, prevFrom, prevTo };
}
```

import에 추가:

```tsx
import { kstMonthStart, kstDaysAgoStart } from '@/lib/datetime';
```

- [ ] **Step 3: B2 — Exa 쿼리 파라미터를 한국 날짜로**

`src/lib/actualCost.ts`의 지역 함수 `ymd`를 지우고 공용 모듈을 쓴다. 이 `ymd`는 `tableColumns`의 `ymd`와 **이름만 같고 용도가 다르다**(표시가 아니라 외부 API 파라미터) — 헷갈리지 않게 지역 이름을 남기지 않는다.

지우는 줄:

```ts
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
```

import에 추가:

```ts
import { kstDate } from './datetime.ts';
```

`:58`의 사용처를 바꾼다:

```ts
    `${EXA_ADMIN_BASE}/team-management/api-keys/${encodeURIComponent(k.id)}/usage?start_date=${kstDate(from.toISOString())}&end_date=${kstDate(to.toISOString())}`,
```

`:64-65`의 `periodStart`/`periodEnd`, `:79`의 캐시 키도 같은 방식으로 `kstDate(...)`로 바꾼다 — 한 함수 안에서 두 기준이 섞이면 캐시 키와 조회 구간이 어긋난다.

- [ ] **Step 4: 검증**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/usageStore.test.ts
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/actualCost.test.ts
npx tsc --noEmit
npx eslint src/lib/usageStore.ts src/lib/actualCost.ts "src/app/w/[wsId]/usage/page.tsx"
```

Expected: 두 테스트 `# fail 0`, tsc 무출력, eslint 무출력. `actualCost.test.ts:49`가 간접적으로 `ymd`를 타므로 여기서 깨지면 B2가 잘못된 것이다.

- [ ] **Step 5: 커밋**

```
fix(usage): 사용량 기간을 한국 자정 기준으로 — '이번 달'이 전달을 보여주던 문제

기간 경계를 서버 로컬(Vercel=UTC)로 만들고 있었다. 그래서 ①매월 1일 오전
9시간치가 '이번 달'에서 빠지고 ②한국 시간 1일 00:00~09:00에 열면 setDate(1)이
전달 1일을 가리켜 지난달 수치를 보여줬다. 표시 오차가 아니라 집계가 다른 버그다.

일별 막대의 버킷은 이미 +9였는데 경계만 UTC라, 첫·마지막 막대는 라벨이
'하루'라고 말하면서 실제로는 그날 09:00부터만 담고 있었다. 그래서 버킷 이름
(Asia/Tokyo→Asia/Seoul, 오프셋이 같아 출력 무변화)과 경계를 한 커밋으로 묶는다.

Exa 실비 조회의 start_date/end_date도 같은 기준으로 맞춘다.
```

---

### Task 4 (병렬 가능): 카드·표시 — A1~A6, A8

**Files:**
- Modify: `src/lib/format.ts` (A1), `src/lib/format.test.ts`, `src/components/TweetCard.tsx` (A2·A4), `src/components/QuotedCard.tsx` (A5), `src/components/PillarPanel.tsx` (A6), `src/components/CandidateCard.tsx` (A8), `src/app/w/[wsId]/research/page.tsx` (A3)

**Interfaces:**
- Consumes: `kstShort`, `kstMonthDay`, `kstMonthDayKo` (Task 1)
- Produces: 없음

- [ ] **Step 1: A1 — `formatDate`를 공용 모듈로 대체한다**

`src/lib/format.ts`에서 `formatDate` 함수를 통째로 지운다(현재 `:19-24`). 이 파일은 숫자 표기만 남는다.

`src/lib/format.test.ts`에서 `formatDate` import와 그 테스트 블록을 지운다 — 같은 검증이 `datetime.test.ts`의 `kstShort` 단언으로 옮겨갔다(Task 1에서 `'26.07.07`로 이미 들어가 있다).

호출부 두 곳을 `kstShort`로 바꾼다.

**A2** — `src/components/TweetCard.tsx:252`:

```tsx
            수집 {kstShort(t.firstSeenAt)} · 갱신 {kstShort(t.lastFetchedAt)}
```

**A3** — `src/app/w/[wsId]/research/page.tsx:125`:

```tsx
                  <p className="text-[11px] text-gray-400">{new URL(r.url).hostname} · {kstShort(r.publishedDate)}</p>
```

두 파일의 `formatDate` import를 `kstShort`(`@/lib/datetime`)로 교체한다. `formatCount`·`formatFull`을 함께 import하고 있으면 그건 `@/lib/format`에 그대로 남긴다.

- [ ] **Step 2: A4 — `timeAgo`의 폴백만 바꾼다**

`src/components/TweetCard.tsx`의 `timeAgo`에서 **마지막 두 줄만** 바꾼다. 앞의 `분`/`시간` 분기는 초 차이 계산이라 시간대와 무관하다(조사 (D)).

```tsx
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return kstMonthDayKo(iso);   // 24시간이 넘으면 달력 날짜 — 한국 기준으로 고정한다
}
```

- [ ] **Step 3: A5 — `QuotedCard.shortDate`**

`src/components/QuotedCard.tsx`의 지역 함수 `shortDate`(`:6-10`)를 지우고, 호출부 `:35`의 `shortDate(...)`를 `kstMonthDayKo(...)`로 바꾼다. import에 `import { kstMonthDayKo } from '@/lib/datetime';`를 더한다.

- [ ] **Step 4: A6 — `PillarPanel.fmtDay`**

`src/components/PillarPanel.tsx`의 지역 함수 `fmtDay`(`:8-11`)를 지우고 `fmtPeriod` 안의 두 호출을 `kstMonthDay`로 바꾼다.

```tsx
function fmtPeriod(p: [string, string] | null): string {
  return p ? ` (${kstMonthDay(p[0])}~${kstMonthDay(p[1])})` : '';
}
```

import에 `import { kstMonthDay } from '@/lib/datetime';`를 더한다.

> **주의:** 이 `fmtDay`는 instant를 받는다. `BriefingSection.tsx`에 같은 이름의 **date-only** 함수가 따로 있다(조사 §4-1) — 그건 Task 5의 대상이고 다른 함수로 간다. 이름이 같다고 함께 고치지 않는다.

- [ ] **Step 5: A8 — `CandidateCard`의 저장일**

`src/components/CandidateCard.tsx:91`:

```tsx
      {e.member.name} · {kstDate(e.savedAt)}
```

`toLocaleDateString('ko-KR')`은 브라우저 로컬이라 해외 접속·서버 렌더에서 어긋난다. import에 `import { kstDate } from '@/lib/datetime';`를 더한다.

- [ ] **Step 6: 검증**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/format.test.ts
npx tsc --noEmit
npx eslint src/lib/format.ts src/lib/format.test.ts src/components/TweetCard.tsx src/components/QuotedCard.tsx src/components/PillarPanel.tsx src/components/CandidateCard.tsx "src/app/w/[wsId]/research/page.tsx"
```

Expected: `format.test.ts` `# fail 0`(테스트 수가 줄어든다 — `formatDate` 블록이 `datetime.test.ts`로 옮겨갔다), tsc 무출력, eslint는 각 파일의 **기존** 경고만.

- [ ] **Step 7: 커밋**

```
fix(card): 카드·리서치의 날짜를 한국 기준으로

formatDate가 instant를 UTC 달력으로 찍고 있어서, 한국 시간 오전 9시 이전에
수집된 글이 전날로 보였다. 표는 이미 KST라 같은 트윗을 표와 카드에서 나란히
놓으면 날짜가 하루 달랐다.

지역 헬퍼로 흩어져 있던 것들(timeAgo 폴백·shortDate·PillarPanel.fmtDay·
CandidateCard의 toLocaleDateString)도 함께 공용 모듈로 모은다 — 그중 셋은
브라우저 로컬이라 한국에선 맞게 보였지만 고정돼 있지 않았다.

formatDate 테스트는 datetime.test.ts의 kstShort 단언으로 옮겼다:
2026-07-06T23:29:44Z는 한국 시간 7월 7일 08:29이므로 기대값이 '26.07.07이다.
```

---

### Task 5 (병렬 가능): 브리핑·추이·경계 — A10, B3~B6

**Files:**
- Modify: `src/components/BriefingSection.tsx` (A10·B3), `src/components/TrendPanel.tsx` (B4), `src/components/TweetTableView.tsx` (B5), `src/app/api/research/density/route.ts` (B6)

**Interfaces:**
- Consumes: `kstMonthDay`, `kstToday`, `kstDaysAgo`, `dateOnlyMonthDay`, `weekRangeLabel`, `asDateOnly` (Task 1)
- Produces: 없음

> **이 태스크가 가장 위험하다.** `BriefingSection.tsx`는 네 줄 반경에 (C)·(A)·(C)·(B)가 다 있다. 사이트 번호를 반드시 확인하고, 아래에 적힌 줄만 고친다.

- [ ] **Step 1: A10 — `fmtDayJst`를 공용 모듈로 (출력 무변화)**

`src/components/BriefingSection.tsx`의 `fmtDayJst`(`:33-36`)를 지운다. 수동 +9 시프트라 **출력은 이미 정확했고**, 중복을 없애는 것이다. 호출부 `:554`·`:645`의 `fmtDayJst(...)`를 `kstMonthDay(...)`로 바꾼다.

- [ ] **Step 2: 같은 파일의 (C) 두 개를 공용 date-only 계열로 (출력 무변화)**

`fmtDay`(`:27-30`)와 `fmtWeekRange`(`:39-44`)를 지우고 호출부를 바꾼다. **이 둘은 date-only라 시프트가 없다** — 공용화만 하는 것이고 동작은 그대로다.

- `:554`·`:643`의 `fmtDay(x)` → `dateOnlyMonthDay(asDateOnly(x))`
- `:572`의 `fmtWeekRange(x)` → `weekRangeLabel(asDateOnly(x))`

`asDateOnly`로 감싸는 이유: 인자가 `period_from`/`period_to`(`date` 컬럼)와 `weekStart`라 date-only임이 확실하고, 브랜딩 타입이 그걸 명시적으로 표시한다. 이 자리에 instant를 넣으면 컴파일이 막힌다.

- [ ] **Step 3: B3 — 브리핑 백필의 `until:`을 한국 오늘로**

`src/components/BriefingSection.tsx:450`:

```tsx
        : { sinceDate: preview.since, untilDate: kstToday() };
```

**`sinceDate`는 그대로 둔다** — date-only weekStart라 (C)다. 한 객체 안에 (B)와 (C)가 섞여 있다.

- [ ] **Step 4: B4 — 추이 백필도 같은 수정**

`src/components/TrendPanel.tsx:40`:

```tsx
        : { sinceDate: data.weekly[0].weekStart, untilDate: kstToday() };
```

같은 파일의 `fmtWeek`(`:9-12`)도 지우고 호출부 `:72`·`:83`을 `dateOnlyMonthDay(asDateOnly(...))`로 바꾼다 — date-only라 **출력 무변화**다.

- [ ] **Step 5: B5 — CSV 파일명의 날짜**

`src/components/TweetTableView.tsx:208`:

```tsx
        date: kstToday(),
```

- [ ] **Step 6: B6 — 밀도 프로브의 `since:`**

`src/app/api/research/density/route.ts:14`:

```ts
  const since = kstDaysAgo(7);
```

import에 `import { kstDaysAgo } from '@/lib/datetime';`를 더한다.

- [ ] **Step 7: 검증**

```bash
npx tsc --noEmit
npx eslint src/components/BriefingSection.tsx src/components/TrendPanel.tsx src/components/TweetTableView.tsx "src/app/api/research/density/route.ts"
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/briefing.test.ts src/lib/trend.test.ts src/lib/tableExport.test.ts
```

Expected: tsc 무출력, eslint는 기존 경고만, 세 테스트 `# fail 0`. **`trend.test.ts`와 `briefing.test.ts`가 깨지면 (C)를 건드린 것이다** — 되돌리고 사이트 번호를 다시 확인한다.

- [ ] **Step 8: 커밋**

```
fix(briefing,trend,table): '오늘'을 한국 기준으로 + 날짜 헬퍼 공용화

브리핑·추이의 백필 재수집이 X 검색의 until:을 UTC 오늘로 넘기고 있었다.
한국 시간 0~9시에 누르면 어제가 되어 그날치 수집 범위가 빠진다. CSV 파일명과
리서치 밀도 프로브의 since:도 같은 문제였다.

같은 파일에 있던 날짜 헬퍼들(fmtDayJst·fmtDay·fmtWeekRange·fmtWeek)도 공용
모듈로 모은다 — 이쪽은 출력이 바뀌지 않는다. fmtDayJst는 이미 +9였고, 나머지
셋은 date-only라 시간대와 무관하다. date-only 계열은 브랜딩 타입으로 받아
instant가 섞여 들어오면 컴파일이 막히게 했다.

sinceDate(주 시작일)는 date-only라 손대지 않았다 — 같은 객체 안에서 untilDate만
바뀐다.
```

---

## 완료 후 — 전체 검증과 사용자 확인

모든 태스크가 끝난 뒤 컨트롤러가 한 번 돌린다:

```bash
npx tsc --noEmit
npm run lint 2>&1 | grep problems      # ✖ 25 problems (14 errors, 11 warnings)
npm test 2>&1 | tail -8                # 376건에서 늘어야 하고 fail 0
npx next build 2>&1 | tail -3
```

**사용자 확인이 필요한 것** (화면은 OAuth 게이팅이라 구현자가 볼 수 없다):

1. **`/usage`에서 '이번 달'을 열어 기간이 이번 달 1일부터인지** — 특히 한국 시간 새벽에 확인하면 전달이 나오던 버그가 사라졌는지 보인다
2. 같은 화면 일별 막대의 첫·마지막 막대가 더 이상 유난히 낮지 않은지(부분 집계였던 것)
3. 덱 카드 하단 `수집 · 갱신` 날짜가 표의 `최종 수집 시간`과 **같은 날짜**인지
4. 브리핑 목록의 기간 표기(`6/15~21`)와 주차 라벨이 **바뀌지 않았는지** — 바뀌었으면 (C)를 건드린 것이다
5. 추이 패널 x축 주 라벨이 **바뀌지 않았는지** — 같은 이유
6. 인용 카드·주제 분석 패널·보관함 저장일의 날짜가 자연스러운지
