# 업데이트 소식(업데이트 피드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/updates` 페이지 — 저장소 안의 TS 배열(`src/content/updates.ts`)에 적힌 업데이트 글을 월별 타임라인으로 보여주고, 사이드바 하단에 진입 메뉴를 두고, 앞으로 글을 쓰는 규칙을 `AGENTS.md`에 남긴다.

**Architecture:** 데이터는 타입이 있는 상수 배열 하나(빌드 시 TypeScript가 검증). 순수 로직(`src/lib/updates.ts`)이 정렬·월 그룹·펼침 판정·표기를 맡고 단위 테스트를 가진다. 페이지는 서버 컴포넌트 정적 렌더(`GlobalShell` 셸, DB 0), 월 접기는 `<details>`로 JS 없이. 워크스페이스 안 화면 바로가기만 작은 클라이언트 컴포넌트(`UpdateLink`)가 localStorage의 마지막 워크스페이스로 치환한다.

**Tech Stack:** Next.js 16 (App Router, 서버 컴포넌트), React 19, Tailwind v4(`@theme` 토큰: `x-text`·`x-secondary`·`x-muted`·`x-border`·`x-border-strong`·`x-blue`·`x-blue-text`·`x-green`·`x-surface`), node:test + tsx.

스펙: `docs/superpowers/specs/2026-08-26-update-feed-design.md` (이하 §번호는 스펙 절).

## Global Constraints

- 새 의존성 추가 없음. DB·API·마이그레이션 없음.
- 텍스트는 전부 한국어, **사용자 말**(스펙 §5 문체): 제목은 `~할 수 있어요 / ~가 생겼어요 / ~를 고쳤어요`, 내부 용어(마이그레이션 번호·컬럼명·라이브러리명·포트·리전·커밋 해시) 금지.
- 페이지 타입 스케일(스펙 §3): 페이지 제목 24px · 항목 제목 18px · 본문/불릿 16px(행간 1.7) · 날짜/월 헤더 14px · 배지 12px · 바로가기 15px. 본문 폭 최대 760px, 가운데 정렬, 상단 여백 48px, 항목 간 40px.
- 배지/점 색(스펙 §3): 새 기능 `bg #e8f4fd / text x-blue-text / 점 x-blue`, 개선 `#e6f7f0 / #0a7a52 / 점 x-green`, 수정 `#fff4e0 / #9a5b00 / 점 #f59e0b`, 내부 `#f1f3f4 / x-secondary / 점 = 빈 원(흰 바탕 + x-border-strong 테두리)`. 축선 `#e1e8ed` 2px.
- 월 펼침 = **항목이 있는 최신 3개 월**(달력 기준 아님, 스펙 §2).
- 이 저장소는 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`를 붙인다.
- 테스트 실행: 단일 파일은 `node --import tsx --test <파일>`(수초). `npm test`는 실 DB가 필요해 4분 걸리고 `.env`가 없으면 일부가 실패한다 — 이 작업의 검증엔 단일 파일 실행과 `npm run build`만 쓴다.
- 워크트리엔 `.env`가 없을 수 있다. `npm run build`는 이 작업 범위(정적 페이지)에 `.env`가 필요 없다. `eslint`가 `command not found`면 `npx eslint <경로>`로 실행한다.
- 린트 기준선: 기존 경고 24개. 새 파일에서 경고·오류 0.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/content/updates.ts` (신규) | `UpdateType`·`UpdateEntry` 타입과 `UPDATES` 배열. 글 그 자체. 로직 없음 |
| `src/lib/updates.ts` (신규) | 순수 함수: `sortUpdates`·`groupByMonth`·`isMonthOpen`·`formatDay`·`monthLabel`·`isValidDate`·`resolveHref`·`WS_TOKEN` |
| `src/lib/updates.test.ts` (신규) | 위 함수 단위 테스트 + `UPDATES` 데이터 형식 검사 |
| `src/app/updates/layout.tsx` (신규) | `GlobalShell`로 감싸기 (`/usage`와 동일) |
| `src/app/updates/page.tsx` (신규) | 서버 컴포넌트. 헤더·월 `<details>`·타임라인 렌더. 배지/점 스타일 표 |
| `src/app/updates/UpdateLink.tsx` (신규) | 클라이언트. `{ws}` 토큰을 localStorage `cbx-last-ws`로 치환, 없으면 렌더하지 않음 |
| `src/components/Sidebar.tsx` (수정) | 하단 그룹 `API 사용량` 위에 `업데이트 소식` 링크 |
| `AGENTS.md` (수정) | "업데이트 소식 작성 규칙" 절 추가 |
| `docs/superpowers/specs/2026-08-26-update-feed-design.md` (수정) | §6 표의 날짜·링크 2건 보정(구현 중 확인된 사실) |

---

### Task 1: 순수 로직 `src/lib/updates.ts` (TDD)

**Files:**
- Create: `src/lib/updates.ts`
- Create: `src/lib/updates.test.ts`
- Create(타입만 먼저): `src/content/updates.ts`

**Interfaces:**
- Produces:
  - `src/content/updates.ts`: `export type UpdateType = '새 기능' | '개선' | '수정' | '내부'`, `export type UpdateEntry = { date: string; type: UpdateType; title: string; summary: string; bullets?: string[]; link?: { label: string; href: string } }`, `export const UPDATES: UpdateEntry[]`(이 태스크에선 빈 배열, Task 2가 채움)
  - `src/lib/updates.ts`:
    - `sortUpdates(entries: readonly UpdateEntry[]): UpdateEntry[]` — date 내림차순, 같은 날은 입력 순서 유지
    - `type MonthGroup = { ym: string; label: string; entries: UpdateEntry[] }`
    - `groupByMonth(entries: readonly UpdateEntry[]): MonthGroup[]` — 내부에서 정렬 후 `YYYY-MM`으로 묶음, 최신 월이 앞
    - `OPEN_MONTHS = 3`, `isMonthOpen(index: number): boolean` — `index < OPEN_MONTHS`
    - `monthLabel(ym: string): string` — `'2026-08'` → `'2026년 8월'`
    - `formatDay(date: string): string` — `'2026-08-05'` → `'8월 5일'`
    - `isValidDate(date: string): boolean` — `^\d{4}-\d{2}-\d{2}$` + 실제 달력 날짜(`2026-02-30` 거부)
    - `WS_TOKEN = '{ws}'`, `resolveHref(href: string, wsId: string | null): string | null` — 토큰 없으면 href 그대로, 토큰 있고 wsId 있으면 치환, 토큰 있고 wsId 없으면 `null`

- [ ] **Step 1: 타입 파일 골격 작성**

`src/content/updates.ts`:
```ts
// 업데이트 소식 데이터 — 이 파일이 글 그 자체다. 규칙은 AGENTS.md "업데이트 소식 작성 규칙" 참조.
// 최신 항목을 맨 위에 추가한다(정렬은 src/lib/updates.ts가 다시 하므로 순서가 어긋나도 화면은 맞다).
export type UpdateType = '새 기능' | '개선' | '수정' | '내부';

export type UpdateEntry = {
  date: string;                 // 'YYYY-MM-DD' — 배포일(KST). 작성 시점의 배포 예정일
  type: UpdateType;
  title: string;                // 사용자 말 한 줄 — "~할 수 있어요", "~를 고쳤어요"
  summary: string;              // 1~3문장
  bullets?: string[];           // 세부 항목
  link?: { label: string; href: string };  // 관련 화면. 워크스페이스 안 화면은 href에 '{ws}' 토큰
};

export const UPDATES: UpdateEntry[] = [];
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/updates.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortUpdates, groupByMonth, isMonthOpen, OPEN_MONTHS, monthLabel, formatDay, isValidDate,
  resolveHref, WS_TOKEN,
} from './updates.ts';
import { UPDATES, type UpdateEntry } from '../content/updates.ts';

const e = (date: string, title = date): UpdateEntry => ({ date, type: '개선', title, summary: 's' });

test('sortUpdates: 날짜 내림차순, 같은 날은 입력 순서 유지', () => {
  const sorted = sortUpdates([e('2026-08-01', 'a'), e('2026-08-25', 'b1'), e('2026-07-19', 'c'), e('2026-08-25', 'b2')]);
  assert.deepEqual(sorted.map((x) => x.title), ['b1', 'b2', 'a', 'c']);
});

test('sortUpdates: 입력 배열을 바꾸지 않는다', () => {
  const input = [e('2026-08-01'), e('2026-08-25')];
  sortUpdates(input);
  assert.equal(input[0].date, '2026-08-01');
});

test('groupByMonth: 월 경계로 묶고 최신 월이 앞, 라벨은 한국어', () => {
  const groups = groupByMonth([e('2026-07-19'), e('2026-08-25'), e('2026-08-05'), e('2026-06-30')]);
  assert.deepEqual(groups.map((g) => g.ym), ['2026-08', '2026-07', '2026-06']);
  assert.deepEqual(groups.map((g) => g.label), ['2026년 8월', '2026년 7월', '2026년 6월']);
  assert.deepEqual(groups[0].entries.map((x) => x.date), ['2026-08-25', '2026-08-05']);
});

test('groupByMonth: 빈 입력은 빈 배열', () => {
  assert.deepEqual(groupByMonth([]), []);
});

test('isMonthOpen: 최신 3개 월만 펼침 (달력이 아니라 월 개수 기준)', () => {
  assert.equal(OPEN_MONTHS, 3);
  assert.equal(isMonthOpen(0), true);
  assert.equal(isMonthOpen(2), true);
  assert.equal(isMonthOpen(3), false);
});

test('monthLabel / formatDay: 앞자리 0을 뗀 한국어 표기', () => {
  assert.equal(monthLabel('2026-08'), '2026년 8월');
  assert.equal(monthLabel('2026-12'), '2026년 12월');
  assert.equal(formatDay('2026-08-05'), '8월 5일');
  assert.equal(formatDay('2026-12-31'), '12월 31일');
});

test('isValidDate: 형식과 실제 달력 날짜를 모두 본다', () => {
  assert.equal(isValidDate('2026-08-25'), true);
  assert.equal(isValidDate('2026-8-25'), false);      // 자릿수
  assert.equal(isValidDate('2026-02-30'), false);     // 없는 날
  assert.equal(isValidDate('2026-13-01'), false);     // 없는 달
  assert.equal(isValidDate('20260825'), false);
});

test('resolveHref: {ws} 토큰은 마지막 워크스페이스로, 없으면 null(링크 숨김)', () => {
  assert.equal(WS_TOKEN, '{ws}');
  assert.equal(resolveHref('/tracking', null), '/tracking');
  assert.equal(resolveHref('/w/{ws}/library?view=table', 'abc'), '/w/abc/library?view=table');
  assert.equal(resolveHref('/w/{ws}', null), null);
});

// ---- 데이터 검사: 타입으로 못 잡는 것(형식·빈 문자열·링크 모양)을 UPDATES 전체에 대해 확인 ----
test('UPDATES: 날짜 형식·빈 문자열·링크 모양', () => {
  for (const u of UPDATES) {
    assert.ok(isValidDate(u.date), `날짜 형식: ${u.date} (${u.title})`);
    assert.ok(u.title.trim().length > 0, `제목 비어 있음: ${u.date}`);
    assert.ok(u.summary.trim().length > 0, `요약 비어 있음: ${u.title}`);
    for (const b of u.bullets ?? []) assert.ok(b.trim().length > 0, `빈 불릿: ${u.title}`);
    if (u.link) {
      assert.ok(u.link.label.trim().length > 0, `링크 라벨 비어 있음: ${u.title}`);
      assert.ok(u.link.href.startsWith('/'), `링크는 앱 안 경로(/로 시작): ${u.title} → ${u.link.href}`);
    }
  }
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: 모듈을 찾지 못해 실패 (`Cannot find module './updates.ts'` 또는 export 없음 오류).

- [ ] **Step 4: 구현**

`src/lib/updates.ts`:
```ts
// 업데이트 소식 순수 로직 — 데이터(src/content/updates.ts)를 화면이 그릴 모양으로.
// 전부 순수 함수, 시계를 읽지 않는다(페이지가 정적 렌더라 '지금'은 빌드 시각이 되므로 — 스펙 §2).
import type { UpdateEntry } from '@/content/updates';

export type MonthGroup = { ym: string; label: string; entries: UpdateEntry[] };

/** 펼친 채로 보여줄 월 수 — "항목이 있는 최신 N개 월". 달력 기준(최근 90일)이 아니다. */
export const OPEN_MONTHS = 3;

/** href 안에서 마지막 방문 워크스페이스 id로 치환되는 토큰 */
export const WS_TOKEN = '{ws}';

/** date 내림차순. Array.prototype.sort는 안정 정렬이라 같은 날은 입력(파일) 순서가 유지된다. */
export function sortUpdates(entries: readonly UpdateEntry[]): UpdateEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function monthLabel(ym: string): string {
  return `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
}

/** 'YYYY-MM-DD' → '8월 5일'. 문자열이 이미 KST 달력일이라 시간대 변환이 없다(datetime.ts의 kstMonthDayKo는 인스턴트용). */
export function formatDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

export function groupByMonth(entries: readonly UpdateEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of sortUpdates(entries)) {
    const ym = entry.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.entries.push(entry);
    else groups.push({ ym, label: monthLabel(ym), entries: [entry] });
  }
  return groups;
}

export function isMonthOpen(index: number): boolean {
  return index < OPEN_MONTHS;
}

/** 형식(YYYY-MM-DD)과 실제 달력 날짜를 모두 본다 — 2026-02-30 같은 오타를 테스트에서 잡기 위함. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 토큰이 없으면 그대로, 있으면 wsId로 치환. wsId가 없으면 null — 갈 곳 없는 링크를 그리지 않기 위해
 * (거짓 어포던스 방지, 스펙 §3).
 */
export function resolveHref(href: string, wsId: string | null): string | null {
  if (!href.includes(WS_TOKEN)) return href;
  if (!wsId) return null;
  return href.split(WS_TOKEN).join(wsId);
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: `# pass 10`, `# fail 0` (데이터 검사는 빈 배열에 대해 통과).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/updates.ts src/lib/updates.test.ts src/content/updates.ts
git commit -m "feat(updates): 업데이트 소식 순수 로직 — 정렬·월 그룹·펼침 판정·표기·{ws} 치환 + 데이터 타입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 소급 데이터 25건 `src/content/updates.ts`

**Files:**
- Modify: `src/content/updates.ts` (`UPDATES` 배열 채움)
- Modify: `docs/superpowers/specs/2026-08-26-update-feed-design.md` §6 표 2건 보정
- Test: `src/lib/updates.test.ts` (Task 1의 데이터 검사가 이 배열을 훑는다)

**Interfaces:**
- Consumes: Task 1의 `UpdateEntry` 타입, `WS_TOKEN`(문자열 `{ws}`를 href에 직접 쓴다).
- Produces: `UPDATES` 25건. 페이지(Task 3)가 그대로 렌더.

- [ ] **Step 1: 스펙 §6 표 보정**

구현 중 git 이력으로 확인된 사실 두 가지를 스펙 표에 반영한다(`docs/superpowers/specs/2026-08-26-update-feed-design.md`):
- `| 08-14 | 새 기능 | 게시된 콘텐츠의 반응을 추적할 수 있어요 | \`/tracking\` |` → 날짜를 **`08-15`**로 (main 머지 `fb9f8d2` = 2026-08-15).
- `| 08-10 | 새 기능 | 링크로 트윗을 덱에 추가할 수 있어요 | \`/w/{ws}\` |` → 제목 **`링크로 트윗을 보관함에 추가할 수 있어요`**, 링크 **`/w/{ws}/library`** (진입점이 보관함 헤더·레퍼런스 고르기 창이다).

- [ ] **Step 2: `UPDATES` 채우기**

`src/content/updates.ts`의 `export const UPDATES: UpdateEntry[] = [];`를 아래로 교체한다(최신이 위):

```ts
export const UPDATES: UpdateEntry[] = [
  {
    date: '2026-08-25',
    type: '새 기능',
    title: '트래킹 링크를 앱 안에서 만들 수 있어요',
    summary: '인플루언서에게 줄 랜딩 링크를 원고 카드에서 바로 만듭니다. 클라이언트 정보로 UTM이 자동으로 채워지고, 짧은 주소로 줄여지며, 클릭 수를 여기서 볼 수 있어요.',
    bullets: [
      "원고 카드 아래 '트래킹 링크' 칸에서 만들기",
      '트래킹 → 링크 탭에서 전체 목록과 날짜별 클릭 확인(클릭 열의 작은 추이선은 최근 7일)',
      "클라이언트 화면에 '기본 랜딩 URL'을 넣어두면 자동으로 채워져요",
      '링크 주소는 읽을 수 있는 단어형 코드로, 콘텐츠 구분은 핸들-날짜로 자동 제안돼요',
    ],
    link: { label: '트래킹에서 보기', href: '/tracking?view=links' },
  },
  {
    date: '2026-08-25',
    type: '새 기능',
    title: '인플루언서 프로필에 협찬 단가와 계정 분석이 생겼어요',
    summary: "프로필이 계정 정보·협업 콘텐츠·거래 정보 세 탭으로 나뉩니다. 협찬 단가를 유형별로 기록하고 바뀐 이력을 볼 수 있고, '계정 분석'을 누르면 최근 게시물을 읽어 업로드 빈도·반응 수준·주로 다루는 주제를 정리해 줍니다.",
    bullets: [
      '요일×시간 발행 히트맵으로 언제 주로 올리는지 확인',
      '단가는 통화를 골라 입력하고, 수정하면 타임라인에 남아요',
      '탭은 주소에 남아 새로고침하거나 링크를 공유해도 유지돼요',
    ],
    link: { label: '인플루언서에서 보기', href: '/influencers' },
  },
  {
    date: '2026-08-16',
    type: '개선',
    title: '트래킹 표에서 측정 이력을 펼쳐 볼 수 있어요',
    summary: '게시물 행을 클릭하면 그동안 측정한 조회·좋아요 수치가 날짜순으로 펼쳐집니다. 어느 시점에 반응이 붙었는지 한눈에 보여요.',
    link: { label: '트래킹에서 보기', href: '/tracking' },
  },
  {
    date: '2026-08-15',
    type: '개선',
    title: '보관함이 더 많이 보이고, 표로도 볼 수 있어요',
    summary: "카드의 긴 본문과 인용을 접어 한 화면에 더 많은 트윗이 들어갑니다. 오른쪽 위 세그먼트에서 '표'를 고르면 정렬 가능한 표로 훑고, 행을 클릭하면 카드가 팝업으로 열려요.",
    link: { label: '보관함에서 보기', href: '/w/{ws}/library?view=table' },
  },
  {
    date: '2026-08-15',
    type: '새 기능',
    title: '레퍼런스를 링크로 바로 추가할 수 있어요',
    summary: '콘텐츠 생성에서 X 게시물 링크를 붙이면 레퍼런스로 들어가고, 칩에 마우스를 올리면 원문 미리보기가 떠요. 번역 버튼 위치도 덱·미리보기·시트 모두 본문 아래로 통일했습니다.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-15',
    type: '개선',
    title: '트래킹 표가 읽기 쉬워졌어요',
    summary: "열 순서를 '누가 → 무엇을 → 숫자 → 신선도 → 행동' 순으로 다시 잡고, 계정 열을 분리하고, 열 폭을 끌어서 조절할 수 있어요. 원고 연결 창에는 생성일과 배정 핸들이 보여 같은 제목의 원고를 구분할 수 있습니다.",
    link: { label: '트래킹에서 보기', href: '/tracking' },
  },
  {
    date: '2026-08-15',
    type: '새 기능',
    title: '게시된 콘텐츠의 반응을 추적할 수 있어요',
    summary: '인플루언서가 올린 게시물 링크를 등록하면 조회·좋아요·리포스트·북마크를 측정해 표로 보여줍니다. 원고와 연결해 두면 어떤 원고가 어떻게 됐는지 이어서 볼 수 있어요.',
    bullets: [
      "사이드바 '트래킹'에서 게시물 등록",
      "'새로고침'으로 수치를 다시 측정",
      '리포스트 링크를 넣으면 원본 게시물 기준으로 측정돼요',
    ],
    link: { label: '트래킹에서 보기', href: '/tracking' },
  },
  {
    date: '2026-08-14',
    type: '새 기능',
    title: 'AI 없이 원고를 직접 쓸 수 있어요',
    summary: "콘텐츠 생성 패널의 '직접 쓰기'로 빈 원고를 만들어 본문을 바로 적습니다. 직접 쓴 원고도 상태·배정·다시 쓰기 등 다른 원고와 똑같이 다룰 수 있어요.",
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-13',
    type: '새 기능',
    title: '인플루언서 명부가 생겼어요',
    summary: '함께 일하는 인플루언서를 핸들로 등록해 프로필·팔로워·태그·메모를 한곳에서 관리합니다. 원고에 배정한 인플루언서와 자동으로 이어져요.',
    link: { label: '인플루언서에서 보기', href: '/influencers' },
  },
  {
    date: '2026-08-13',
    type: '개선',
    title: '원고를 한 번에 여러 개 처리할 수 있어요',
    summary: '원고를 여러 개 선택해 상태 변경·배정·삭제를 한 번에 합니다. 원고에 제목 칸이 생겼고, 스레드는 칸 단위로 편집할 수 있어요.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-13',
    type: '개선',
    title: '원고 목록이 전부 보여요',
    summary: "목록이 50건에서 끊기던 상한을 없앴습니다. 칸반은 '지금 할 일' 보드로 성격을 정리했어요.",
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-12',
    type: '새 기능',
    title: '원고에 이미지를 붙일 수 있어요',
    summary: '원고 카드에 이미지를 첨부하고 클릭해 크게 볼 수 있어요. 카드 구성도 본문·이미지·도구가 구분되도록 다시 잡았습니다.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-11',
    type: '새 기능',
    title: '원고에 인플루언서를 배정할 수 있어요',
    summary: '원고마다 어느 인플루언서에게 줄지 핸들로 기록합니다. 카드와 패널에서 배정 상태가 보여요.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-11',
    type: '개선',
    title: '콘텐츠 생성 화면을 새로 짰어요',
    summary: '왼쪽 목록·오른쪽 작업 공간의 2단 구조로 바꾸고, 카드·표·칸반 세 가지 보기와 필터·검색을 넣었습니다. 한국어 대역과 제목이 함께 보여 훑기가 쉬워요.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-10',
    type: '새 기능',
    title: '링크로 트윗을 보관함에 추가할 수 있어요',
    summary: 'X 게시물 링크를 붙여 넣으면 보관함에 저장됩니다. 보관함 헤더와 레퍼런스 고르기 창 두 곳에서 쓸 수 있어요.',
    link: { label: '보관함에서 보기', href: '/w/{ws}/library' },
  },
  {
    date: '2026-08-09',
    type: '개선',
    title: '워크스페이스를 관리하는 페이지가 생겼어요',
    summary: '이름 변경·순서 바꾸기·삭제를 한 페이지에서 합니다. 클라이언트 화면은 목록·상세 2단으로 나눴고, 사이드바는 매일 쓰는 메뉴와 설정을 구분했어요.',
    link: { label: '워크스페이스 관리로 가기', href: '/workspaces' },
  },
  {
    date: '2026-08-08',
    type: '개선',
    title: '원고에 상태가 생기고, 편집 중 유실을 막았어요',
    summary: '원고를 초안·검수 대기·사용 확정·전달됨·미사용으로 표시하고 탭으로 걸러 봅니다. 편집 창을 실수로 닫아도 내용이 사라지지 않고, 시안을 여러 개 만들어 고를 수 있어요.',
    bullets: ['생성 1회 비용 안내(≈ $0.02)', '원고 검색·정렬'],
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-08-08',
    type: '개선',
    title: '모든 시간 표기를 서울 시간대로 통일했어요',
    summary: "날짜·시간이 화면마다 다르게 보이던 것을 서울 시간 기준으로 맞췄습니다. '이번 달' 같은 기간 계산도 서울 자정을 경계로 삼아요.",
  },
  {
    date: '2026-08-05',
    type: '새 기능',
    title: 'X 원고 생성이 생겼어요',
    summary: '보관함의 레퍼런스와 클라이언트 정보를 재료로 X 원고를 만듭니다. 다시 쓰기, 버전 이력, 번역이 함께 들어 있어요.',
    link: { label: '콘텐츠 생성에서 보기', href: '/generate' },
  },
  {
    date: '2026-07-22',
    type: '내부',
    title: '외부에서 데이터베이스에 직접 접근할 수 있던 경로를 닫았어요',
    summary: '보안 점검에서 발견된 항목입니다. 앱은 다른 경로로 데이터를 읽기 때문에 사용하는 데는 달라지는 게 없어요.',
  },
  {
    date: '2026-07-22',
    type: '수정',
    title: '번역이 긴 트윗에서 잘리거나 실패하던 문제를 고쳤어요',
    summary: '여러 트윗을 한 번에 번역할 때 긴 글이 잘리거나 통째로 실패하던 원인을 없앴습니다. 이제 트윗 단위로 번역해 하나씩 바로 표시돼요.',
  },
  {
    date: '2026-07-21',
    type: '수정',
    title: '브리핑이 가끔 오류로 멈추던 문제를 고쳤어요',
    summary: '트윗 본문에 이모지가 있을 때 요약 요청이 실패하던 원인을 찾아 수정했습니다. 이제 이모지가 있어도 정상적으로 브리핑이 만들어져요.',
  },
  {
    date: '2026-07-21',
    type: '수정',
    title: "덱에 '트윗 없음'이 뜨던 문제를 고쳤어요",
    summary: '컬럼 헤더는 보이는데 목록만 비던 문제입니다. 서버가 동시에 여러 요청을 받을 때 데이터베이스 연결이 부족해지는 원인이었고, 연결 방식을 바꿔 해결했어요.',
  },
  {
    date: '2026-07-20',
    type: '내부',
    title: '저녁 시간대에 느려지던 원인을 해결했어요',
    summary: '사용량 기록이 다른 요청과 데이터베이스 연결을 다투던 문제와, 서버와 데이터베이스가 서로 먼 지역에 있던 문제를 함께 고쳤습니다. 화면에서 달라지는 건 없고, 전반적으로 응답이 빨라져요.',
  },
  {
    date: '2026-07-19',
    type: '개선',
    title: '덱 화면 정돈 — 글자 크기와 여백을 다시 잡았어요',
    summary: '카드 본문 15px, 도구 글자 13px로 역할별 크기를 통일하고 헤더·패널 여백을 넉넉하게 바꿨어요. 요약의 강조와 좋아요 표기도 스스로 설명되게 다듬었습니다.',
    link: { label: '덱에서 보기', href: '/w/{ws}' },
  },
];
```

- [ ] **Step 3: 데이터 검사 통과 확인**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: `# pass 10`, `# fail 0`. 실패하면 메시지에 어느 항목인지 나온다(날짜 형식·빈 문자열·링크).

- [ ] **Step 4: 건수·오타 점검**

Run: `node --import tsx -e "import('./src/content/updates.ts').then(m => { console.log(m.UPDATES.length); console.log(m.UPDATES.filter(u => u.type === '내부').length, '내부'); })"`
Expected: `25` 그리고 `2 내부`. 파일을 한 번 훑어 자판 오타가 없는지 본다.

- [ ] **Step 5: 커밋**

```bash
git add src/content/updates.ts docs/superpowers/specs/2026-08-26-update-feed-design.md
git commit -m "feat(updates): 소급 글 25건(7/19~8/25) — 새 기능·개선·수정·내부, 사용자 말로 / 스펙 §6 날짜·링크 보정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 페이지 `/updates` — layout·page·UpdateLink

**Files:**
- Create: `src/app/updates/layout.tsx`
- Create: `src/app/updates/page.tsx`
- Create: `src/app/updates/UpdateLink.tsx`

**Interfaces:**
- Consumes: `UPDATES`, `UpdateType`(Task 1·2); `groupByMonth`·`isMonthOpen`·`formatDay`·`resolveHref`(Task 1); `GlobalShell`·`LAST_WS_KEY`(`src/components/GlobalShell.tsx`, 기존).
- Produces: 라우트 `/updates`. Task 4의 사이드바가 링크한다.

- [ ] **Step 1: layout**

`src/app/updates/layout.tsx`:
```tsx
import { GlobalShell } from '@/components/GlobalShell';

export default function UpdatesLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
```

- [ ] **Step 2: UpdateLink (클라이언트)**

`src/app/updates/UpdateLink.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import { resolveHref, WS_TOKEN } from '@/lib/updates';

// 바로가기 링크. 워크스페이스 안 화면(href에 '{ws}')은 정적 페이지가 wsId를 모르므로
// 마지막 방문 워크스페이스(localStorage)로 치환한다. 값이 없으면 링크를 그리지 않는다 — 갈 곳 없는
// 링크를 보여주는 것이 거짓 어포던스(스펙 §3). 서버 렌더에서는 토큰 링크를 그리지 않고 마운트 뒤에만
// 그려서 하이드레이션 불일치를 피한다(스펙 §8).
export function UpdateLink({ label, href }: { label: string; href: string }) {
  const needsWs = href.includes(WS_TOKEN);
  const [resolved, setResolved] = useState<string | null>(needsWs ? null : href);
  useEffect(() => {
    if (!needsWs) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage는 마운트 뒤에만 읽을 수 있다(기존 코드베이스 관례)
    setResolved(resolveHref(href, localStorage.getItem(LAST_WS_KEY)));
  }, [needsWs, href]);
  if (!resolved) return null;
  return (
    <Link href={resolved}
          className="mt-2.5 inline-block text-[15px] font-medium text-x-blue-text hover:underline">
      → {label}
    </Link>
  );
}
```

- [ ] **Step 3: page (서버 컴포넌트)**

`src/app/updates/page.tsx`:
```tsx
import { UPDATES, type UpdateType } from '@/content/updates';
import { groupByMonth, isMonthOpen, formatDay } from '@/lib/updates';
import { UpdateLink } from './UpdateLink';

// 정적 렌더 — 데이터가 빌드 시점 상수라 force-dynamic 없음, DB 조회 0 (스펙 §3).

// 유형별 배지·점 색 (스펙 §3). 색은 배지 글자와 함께 쓰므로 색만으로 전하지 않는다.
// 내부는 빈 원 — 축선만 훑어도 "큰 소식 / 잔잔한 소식" 리듬이 보이게.
const TYPE_STYLE: Record<UpdateType, { badge: string; node: string }> = {
  '새 기능': { badge: 'bg-[#e8f4fd] text-x-blue-text', node: 'bg-x-blue' },
  '개선':   { badge: 'bg-[#e6f7f0] text-[#0a7a52]',   node: 'bg-x-green' },
  '수정':   { badge: 'bg-[#fff4e0] text-[#9a5b00]',   node: 'bg-[#f59e0b]' },
  '내부':   { badge: 'bg-[#f1f3f4] text-x-secondary', node: 'bg-white border-2 border-x-border-strong' },
};

export default function UpdatesPage() {
  const groups = groupByMonth(UPDATES);

  return (
    <main className="mx-auto max-w-[760px] px-10 pt-12 pb-28 text-x-text">
      <h1 className="text-[24px] font-bold">업데이트 소식</h1>
      <p className="mt-2.5 text-[16px] leading-[1.65] text-x-secondary">
        기능이 추가되거나 바뀌면 여기에 올립니다. 눈에 보이지 않는 변화도 모두 적어요.
      </p>

      {groups.length === 0 ? (
        <p className="mt-10 text-[16px] text-x-secondary">아직 올라온 소식이 없어요</p>
      ) : (
        // 축선 하나가 월 헤더 뒤로 이어진다 — 접힌 월에서도 "아래로 더 있다"가 보인다 (스펙 §3)
        <div className="relative mt-10">
          <span aria-hidden className="absolute bottom-0 left-1 top-0 w-0.5 bg-[#e1e8ed]" />
          {groups.map((g, i) => (
            <details key={g.ym} open={isMonthOpen(i)} className="group pb-2">
              <summary className="flex cursor-pointer list-none items-baseline gap-2 pl-7 text-[14px] font-bold tracking-[0.02em] text-x-secondary [&::-webkit-details-marker]:hidden">
                <span>{g.label}</span>
                {/* 접힌 월만 건수 — 펼치면 항목이 보여 숫자가 중복 신호가 된다 */}
                <span className="font-normal text-x-muted group-open:hidden">· {g.entries.length}건 ▸</span>
              </summary>
              <ol className="mt-3 list-none p-0">
                {g.entries.map((e, j) => {
                  const style = TYPE_STYLE[e.type];
                  return (
                    <li key={`${e.date}-${j}`} className="relative pb-10 pl-7 last:pb-4">
                      <span aria-hidden
                            className={`absolute left-0 top-[5px] h-2.5 w-2.5 rounded-full ring-3 ring-white ${style.node}`} />
                      <div className="flex items-center gap-2 text-[14px] text-x-secondary">
                        <span className="tabular-nums">{formatDay(e.date)}</span>
                        <span className="text-x-border-strong">·</span>
                        <span className={`rounded-full px-[9px] py-0.5 text-[12px] font-semibold leading-normal ${style.badge}`}>{e.type}</span>
                      </div>
                      <h2 className="mt-1.5 text-[18px] font-bold leading-snug text-balance">{e.title}</h2>
                      <p className="mt-2 text-[16px] leading-[1.7]">{e.summary}</p>
                      {e.bullets && e.bullets.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-[16px] leading-[1.7] marker:text-x-secondary">
                          {e.bullets.map((b, k) => <li key={k} className="mb-1 last:mb-0">{b}</li>)}
                        </ul>
                      )}
                      {e.link && <UpdateLink label={e.link.label} href={e.link.href} />}
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
```

메모: `text-balance`·`ring-3`·`marker:`·`group-open:`·`last:`·`[&::-webkit-details-marker]:hidden`은 Tailwind v4 유틸리티다. `open={false}`는 React가 속성을 생략하므로 접힌 상태가 된다.

- [ ] **Step 4: 빌드로 검증**

Run: `npm run build 2>&1 | tail -25`
Expected: 성공, 라우트 목록에 `○ /updates` (정적, `○` 표시). 타입 오류가 나면 메시지의 파일:줄을 고친다. `.env`가 없어 다른 라우트가 실패하는 경우는 이 작업과 무관하므로 메모리 `cb-x-deck-env-from-vercel` 절차(`vercel link` → `vercel env pull .env --environment=production`)로 받는다.

- [ ] **Step 5: 린트**

Run: `npx eslint src/app/updates src/lib/updates.ts src/lib/updates.test.ts src/content/updates.ts`
Expected: 출력 없음(경고·오류 0). `react-hooks/set-state-in-effect`가 `UpdateLink`에서 걸리면 이미 넣어둔 disable 주석의 위치가 `setResolved(...)` 바로 위 줄인지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/updates
git commit -m "feat(updates): /updates 페이지 — 월 <details> 타임라인·유형 배지/점·{ws} 바로가기(UpdateLink), 정적 렌더

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 사이드바 진입 메뉴

**Files:**
- Modify: `src/components/Sidebar.tsx:130-137` (하단 `API 사용량` 블록)

**Interfaces:**
- Consumes: 라우트 `/updates`(Task 3), 기존 `guardedNavigate`·`pathname`.

- [ ] **Step 1: 링크 추가**

`src/components/Sidebar.tsx`에서 아래 블록을 찾는다:
```tsx
      <div className="mb-2 border-t border-x-border pt-2">
        <Link href="/usage" onNavigate={guardedNavigate('/usage')}
```
그 `<div ...>` 바로 다음 줄, `<Link href="/usage"` 앞에 삽입:
```tsx
        {/* 업데이트 소식 — 가끔 들어와 읽는 곳이라 매일 쓰는 메뉴·설정과 분리해 하단에 (업데이트 피드 스펙 §4) */}
        <Link href="/updates" onNavigate={guardedNavigate('/updates')}
              aria-current={pathname === '/updates' ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/updates' ? 'text-x-text' : 'text-x-muted'}`}>
          업데이트 소식
        </Link>
```

- [ ] **Step 2: 빌드·린트**

Run: `npm run build 2>&1 | tail -5 && npx eslint src/components/Sidebar.tsx`
Expected: 빌드 성공, 린트 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): 하단에 '업데이트 소식' 메뉴 — API 사용량 위

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 작성 규칙 `AGENTS.md`

**Files:**
- Modify: `AGENTS.md` (파일 끝에 절 추가)

- [ ] **Step 1: 절 추가**

`AGENTS.md` 끝에 추가:
```markdown
# 업데이트 소식 작성 규칙 (`src/content/updates.ts`)

사용자에게 배포되는 변화를 main에 머지할 때(QA 완료 후, 머지 직전) `src/content/updates.ts` 맨 위에 항목을 추가해 같은 브랜치에 커밋한다. 배포되면 `/updates`에 자동으로 나타난다 — 별도 게시 절차 없음.

- **무엇을: 변화 종류를 가리지 않는다.** 새 기능·개선·버그 수정은 물론 성능·안정성·보안·데이터 구조 변경(내부)도 올린다. 화면에 변화가 없어도 "무엇을 왜 했고, 사용자에게 달라지는 점이 무엇인지(없으면 없다고)"를 적는다.
- **단위:** 하나의 작업(스펙/브랜치) = 한 건. 커밋 수와 무관. QA 후속 수정은 새 항목이 아니라 기존 항목의 불릿을 고친다. 내부 변화가 기능 작업의 일부면 그 건의 불릿으로 흡수, 단독 작업이면 별도 건.
- **유형:** `새 기능`(없던 화면·동작) / `개선`(있던 동작이 더 좋아짐·바뀜) / `수정`(잘못 동작하던 것을 고침) / `내부`(화면 변화 없는 성능·안정성·보안·기반).
- **문체(UX 원칙 1·3·5):** 제목은 사용자 말 한 줄 — `~할 수 있어요` / `~가 생겼어요` / `~를 고쳤어요`. 메커니즘 대신 이득. 내부 용어 금지(마이그레이션 번호·컬럼명·라이브러리명·포트·리전·커밋 해시). ✗ "PGPORT 6543 트랜잭션 모드 전환" → ✓ "덱에 '트윗 없음'이 뜨던 문제를 고쳤어요 — 서버가 동시에 여러 요청을 받을 때 연결이 부족해지는 원인이었어요". **쓰던 방식이 바뀐 것은 반드시 적는다**(안 알리면 "왜 바뀌었지?"가 된다).
- **바로가기:** 갈 화면이 있을 때만 `link`. 워크스페이스 안 화면(덱·보관함·브리핑·리서치)은 `href`에 `{ws}` 토큰(`/w/{ws}/library`) — 화면이 마지막 방문 워크스페이스로 치환한다.
- **날짜:** `YYYY-MM-DD`, 배포(머지) 예정일. 형식·빈 문자열은 `src/lib/updates.test.ts`가 잡는다(`node --import tsx --test src/lib/updates.test.ts`).
- 강제 장치(커밋 훅)는 두지 않는다 — 머지 마무리 절차에서 "업데이트 글 있나?"를 확인한다.
```

- [ ] **Step 2: 커밋**

```bash
git add AGENTS.md
git commit -m "docs(agents): 업데이트 소식 작성 규칙 — 종류 불문·작업 단위 한 건·사용자 말·{ws} 링크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 전체 검증 + 화면 확인

**Files:** 없음(검증만). 문제가 나오면 해당 태스크 파일을 고치고 `fix(updates): …`로 커밋.

- [ ] **Step 1: 단위 테스트**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 2: 빌드·린트 기준선**

Run: `npm run build 2>&1 | grep -E "updates|error|Error" ; npx eslint . 2>&1 | tail -3`
Expected: `○ /updates` 정적 라우트, 오류 없음. eslint 총 문제 수가 기준선 24개(경고)를 넘지 않는다.

- [ ] **Step 3: 로컬 화면 확인 (프로젝트 관례: dev 아님, build+start)**

Run: `npm run build && (PORT=3001 npx next start -p 3001 &) && sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/updates`
Expected: `200`(OAuth 게이팅으로 리다이렉트되면 `307`도 정상 — 이 경우 화면 확인은 koo가 `127.0.0.1:3001/updates`에 로그인해서 본다).

koo 확인 항목(브라우저, 시안 `~/claude-outputs/cb-x-deck-업데이트피드-타임라인-시안-20260826.html`과 대조):
1. 사이드바 하단 `업데이트 소식`이 `API 사용량` 위에 있고, 들어가면 굵게 표시된다.
2. 본문이 가운데 정렬(760px), 제목 24px·본문 16px로 시안과 같은 크기감.
3. 축선 하나가 위에서 아래로 이어지고, 항목마다 점 — 내부 2건은 빈 원.
4. 8월·7월 두 월이 모두 펼쳐져 있다(월 3개 이하). 월 헤더를 클릭하면 접히고 `· N건 ▸`가 붙는다.
5. `/tracking` 등 바로가기는 항상 보이고, `보관함에서 보기`·`덱에서 보기`는 워크스페이스를 한 번 방문한 뒤에만 보인다(개발자 도구 → Application → Local Storage에서 `cbx-last-ws`를 지우고 새로고침하면 사라진다).
6. Ctrl+F로 접힌 월 안의 글자(예: 월을 접은 뒤 "히트맵")를 찾으면 자동으로 펼쳐진다.

확인이 끝나면 `kill %1`(또는 `pkill -f "next start -p 3001"`)로 서버를 내린다.

- [ ] **Step 4: 완료 처리**

머지 전 `finishing-a-development-branch` 절차. 이 기능 자체도 업데이트 글 대상이다 — Task 2의 배열 맨 위에 다음 항목을 추가하고 `feat(updates): 업데이트 소식 자체를 첫 글로` 커밋(날짜는 머지 예정일로):
```ts
  {
    date: '2026-08-26',
    type: '새 기능',
    title: "'업데이트 소식' 페이지가 생겼어요",
    summary: '기능이 추가되거나 바뀔 때마다 여기에 적습니다. 눈에 보이지 않는 성능·안정성 변화도 함께 올려요. 지난 7월 19일 이후 변화를 소급해서 채워 두었습니다.',
    bullets: ['사이드바 맨 아래, API 사용량 위', '월별로 묶여 있고, 오래된 월은 접혀 있어요'],
    link: { label: '업데이트 소식 보기', href: '/updates' },
  },
```
