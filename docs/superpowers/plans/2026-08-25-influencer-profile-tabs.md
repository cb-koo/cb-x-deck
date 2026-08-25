# 인플루언서 프로필 3구역 탭 재구성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필 패널을 계정 정보 / 협업 콘텐츠 / 거래 정보 3탭으로 재구성한다 — 데이터·API 변경 없이 기존 섹션을 재배치하고, 탭 프레임이 새로 만드는 실패 모드(숨은 탭의 저장 실패·URL 파라미터 덮어쓰기·떠 있는 오버레이)를 막는다.

**Architecture:** 탭 상태는 URL `?tab=`(기본값은 삭제)이며 `InfluencersSplit`(리마운트 `key` 바깥)이 읽어 내려준다. 패널 3개는 전부 마운트하고 비활성은 `hidden`. 595줄 `InfluencerProfile.tsx`는 탭 단위 파일로 분해(이동만). 스펙: `docs/superpowers/specs/2026-08-25-influencer-profile-tabs-design.md` (판단이 갈리면 스펙 우선).

**Tech Stack:** Next.js App Router(`useSearchParams`/`router.replace`), React, Tailwind v4(`hidden` preflight 확인됨). 순수 로직 테스트는 `node --import tsx --test`.

## Global Constraints

- 사용자 문구 한국어, AGENTS.md UX 원칙(라벨-값 일치·색만으로 전하지 않기·거짓 어포던스 금지).
- API·스토어·`src/lib` 데이터 코드 변경 0. 컴포넌트는 **이동**이 원칙 — 로직 변경은 스펙이 명시한 `onErrorChange` 배선·`DraftRollup` 제목 숫자 제거·오버레이 닫기만.
- `Avatar` export는 `InfluencerProfile.tsx`에 남긴다(`page.tsx`가 import).
- 이 워크트리: `npx tsc --noEmit`(0 에러 기준), `npm run lint`(기준선 24 problems), 테스트 `node --import tsx --test <file>`. `npm test` 전체는 마지막 태스크에서만(실 DB ~7분).
- 커밋: 한국어 `feat(influencer): …`/`refactor(influencer): …` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add`는 자기 파일만(다른 에이전트가 병행 커밋).
- 탭 시각 언어: 밑줄 탭(구역 전환). 알약형(DraftFilterBar)은 필터용 — 섞지 않는다.

## 실행 웨이브

| 웨이브 | 태스크 (병렬) | 모델 |
|---|---|---|
| 1 | T1 순수 로직(`profileTabs.ts`) · T3 파일 분해(Timeline/ContentTab/profileShared) · T5 오버레이 닫기(InfoTip·히트맵) | T1 sonnet · T3 sonnet · T5 sonnet |
| 2 | T4 탭 프레임(ProfileTabs·AccountTab·DealTab·InfluencerProfile 재조립·오류 표식 배선) | opus |
| 3 | T2 page.tsx URL 병합·탭 리프트 | sonnet |
| 4 | T6 통합 검증 | sonnet |

의존: T4←T1,T3 / T2←T4 / T6←전부. T5는 독립(파일 겹침 없음: InfoTip.tsx·AnalysisSection.tsx).

---

### Task 1: 탭 순수 로직 (`src/lib/profileTabs.ts`)

**Files:**
- Create: `src/lib/profileTabs.ts`
- Test: `src/lib/profileTabs.test.ts`

**Interfaces — Produces:**
```ts
export type TabKey = 'account' | 'content' | 'deal';
export const TAB_KEYS: readonly TabKey[];                 // ['account','content','deal'] 표시 순서
export const TAB_LABEL: Record<TabKey, string>;           // account:'계정 정보', content:'협업 콘텐츠', deal:'거래 정보'
export const DEFAULT_TAB: TabKey;                         // 'account'
export function parseTab(v: string | null | undefined): TabKey;   // 모르는 값·null → 'account'
export function mergeQuery(current: string, patch: Record<string, string | null>): string;
  // current = 기존 쿼리(?, 없이). patch의 null은 delete, 문자열은 set. 반환 = 쿼리 문자열('?' 없음, 비면 '')
export function tabQuery(current: string, tab: TabKey): string;    // 기본 탭이면 tab 삭제, 아니면 set — mergeQuery 래퍼
```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/profileTabs.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTab, mergeQuery, tabQuery, TAB_KEYS, TAB_LABEL, DEFAULT_TAB } from './profileTabs.ts';

const params = (q: string) => Object.fromEntries(new URLSearchParams(q));

test('parseTab: 유효 키는 그대로, 그 외는 account', () => {
  assert.equal(parseTab('deal'), 'deal');
  assert.equal(parseTab('content'), 'content');
  assert.equal(parseTab('account'), 'account');
  assert.equal(parseTab('nope'), 'account');
  assert.equal(parseTab(null), 'account');
  assert.equal(parseTab(undefined), 'account');
});

test('상수', () => {
  assert.deepEqual([...TAB_KEYS], ['account', 'content', 'deal']);
  assert.equal(TAB_LABEL.content, '협업 콘텐츠');
  assert.equal(DEFAULT_TAB, 'account');
});

test('mergeQuery: 다른 파라미터를 보존하며 set/delete', () => {
  assert.deepEqual(params(mergeQuery('i=abc', { tab: 'deal' })), { i: 'abc', tab: 'deal' });
  assert.deepEqual(params(mergeQuery('i=abc&tab=deal', { tab: null })), { i: 'abc' });
  assert.deepEqual(params(mergeQuery('tab=deal', { i: 'xyz' })), { tab: 'deal', i: 'xyz' });
  assert.equal(mergeQuery('tab=deal', { tab: null }), '');           // 비면 빈 문자열(호출자가 pathname만 쓴다)
});

test('tabQuery: 기본 탭은 URL에서 지운다', () => {
  assert.deepEqual(params(tabQuery('i=abc&tab=deal', 'account')), { i: 'abc' });
  assert.deepEqual(params(tabQuery('i=abc', 'content')), { i: 'abc', tab: 'content' });
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/profileTabs.test.ts` → 모듈 없음 FAIL.

- [ ] **Step 3: 구현** — `src/lib/profileTabs.ts`

```ts
// 프로필 3구역 탭 — 상태는 URL(?tab=)이 단일 출처(스펙 §2). 여기엔 DOM 없는 순수 로직만.
// ?i=(명부 선택)와 같은 URL에 공존하므로, 쓰기는 반드시 mergeQuery로 — 한쪽이 상대를 지우면
// 탭이 사라지거나(i만 쓴 경우) 프로필이 통째로 사라진다(tab만 쓴 경우).
export type TabKey = 'account' | 'content' | 'deal';
export const TAB_KEYS: readonly TabKey[] = ['account', 'content', 'deal'];
export const TAB_LABEL: Record<TabKey, string> = {
  account: '계정 정보', content: '협업 콘텐츠', deal: '거래 정보',
};
export const DEFAULT_TAB: TabKey = 'account';

export function parseTab(v: string | null | undefined): TabKey {
  return (TAB_KEYS as readonly string[]).includes(v ?? '') ? (v as TabKey) : DEFAULT_TAB;
}

// 선례: src/app/w/[wsId]/library/page.tsx setTweetView — 복사 → set/delete → 비면 pathname만
export function mergeQuery(current: string, patch: Record<string, string | null>): string {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) p.delete(k); else p.set(k, v);
  }
  return p.toString();
}

// 기본 탭(account)은 파라미터 없음으로 표현한다 — "없음 = 계정 정보"가 곧 규칙
export function tabQuery(current: string, tab: TabKey): string {
  return mergeQuery(current, { tab: tab === DEFAULT_TAB ? null : tab });
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → 4/4 PASS.
- [ ] **Step 5: Commit** — `git add src/lib/profileTabs.ts src/lib/profileTabs.test.ts && git commit -m "feat(influencer): 프로필 탭 순수 로직 — parseTab·mergeQuery·tabQuery"`

---

### Task 3: 파일 분해 — Timeline · ContentTab · profileShared (이동만)

**Files:**
- Create: `src/app/influencers/profileShared.ts`
- Create: `src/app/influencers/Timeline.tsx`
- Create: `src/app/influencers/ContentTab.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx` (해당 코드 제거 + import로 교체)

**Interfaces — Produces:**
```ts
// profileShared.ts
export async function errOf(r: Response): Promise<string>;           // InfluencerProfile.tsx:34 이동
export function useErrorReport(hasError: boolean, onErrorChange?: (v: boolean) => void): void;
  // hasError가 바뀔 때만 onErrorChange(hasError) 호출, unmount 시 false. 콜백은 ref로 들어 정체성 변화에 재실행되지 않는다.
// Timeline.tsx
export const CHANNEL_LABEL: Record<InfluencerChannel, string>;
export function Timeline(props: { id: string; logs: InfluencerLogRow[]; onAdded: (row: InfluencerLogRow) => void; onRemoved: (logId: string) => void; onErrorChange?: (v: boolean) => void }): JSX.Element;
// ContentTab.tsx
export function ContentTab(props: { drafts: DraftRollupItem[]; draftCount: number }): JSX.Element;   // 기존 DraftRollup — 제목 숫자 제거(배지가 대신)
```

- [ ] **Step 1: `profileShared.ts` 작성**

```ts
import { useEffect, useRef } from 'react';

// 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(다섯 컴포넌트가 공유)
export async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

// 숨은 탭(hidden 패널) 안의 저장 실패는 보이지 않는다(스펙 §3) — 컴포넌트가 자기 오류 유무를
// 부모에 알려 탭 라벨에 표식을 띄운다. 콜백은 ref로 들어 인라인 화살표라도 effect가 매 렌더 돌지 않는다.
export function useErrorReport(hasError: boolean, onErrorChange?: (v: boolean) => void): void {
  const ref = useRef(onErrorChange);
  useEffect(() => { ref.current = onErrorChange; });
  useEffect(() => { ref.current?.(hasError); }, [hasError]);
  useEffect(() => () => { ref.current?.(false); }, []);   // 사라지면 표식도 걷는다
}
```

- [ ] **Step 2: `Timeline.tsx`로 이동** — InfluencerProfile.tsx의 `CHANNEL_LABEL`(:19), `autoText`(:327), `groupText`(:351), `groupAuto`(:364), `groupRange`(:376), `Timeline`(:382), `AutoLine`(:452), `AutoGroup`(:465), `LogItem`(:480)을 **본문 그대로** 옮긴다. 파일 헤더:

```tsx
'use client';
import { useState, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { relTime } from '@/lib/relTime';
import { kstMonthDay } from '@/lib/datetime';
import { PRICE_TYPE_LABEL, formatMoney, type PricingChange } from '@/lib/influencerPricing';
import type { InfluencerAutoEvent, InfluencerChannel, InfluencerLogRow } from '@/lib/influencerStore';
import { errOf, useErrorReport } from './profileShared';
```
필요한 import만 남긴다(사용 안 하는 것은 린트 경고 → 기준선 초과). `Timeline`에 `onErrorChange?: (v: boolean) => void` prop을 추가하고 본문 첫 줄에 `useErrorReport(err !== '', onErrorChange);` 한 줄만 추가(그 외 로직 불변). `export`는 `Timeline`·`CHANNEL_LABEL`만.

- [ ] **Step 3: `ContentTab.tsx`로 이동** — `STATUS_BADGE`(:26)와 `DraftRollup`(:526)을 옮기고 이름을 `ContentTab`으로. 제목은 숫자 없이:

```tsx
<h2 className="text-content font-bold">넘긴 원고</h2>
<InfoTip text="이 계정으로 배정한 원고를 모아 보여줘요. 원고를 누르면 콘텐츠 생성 화면에서 그 원고가 열려요." />
{draftCount > drafts.length && (
  <span className="text-caption text-x-muted">· 최근 {drafts.length}건 표시</span>
)}
```
(전체 건수는 탭 배지가 말한다 — 같은 수를 세 곳에 쓰지 않는다, 스펙 §1.) `section`의 `mt-7 border-t border-x-border pt-5`는 탭 패널 첫 섹션이 되므로 **`pt-1`로, border-t 제거**(탭 바가 경계 역할).

- [ ] **Step 4: InfluencerProfile.tsx 정리** — 옮긴 정의 삭제, `errOf`는 `./profileShared`에서 import, `Timeline`·`ContentTab` import로 교체(`<DraftRollup …/>` → `<ContentTab …/>`). 남는 것: Avatar·Msg·MSG_STYLE·InfluencerProfile·TagEditor·NoteEditor·DangerZone. 사용하지 않게 된 import(`Link`, `kstMonthDay`, `PRICE_TYPE_LABEL`, `formatMoney`, `PricingChange`, `InfluencerAutoEvent`, `InfluencerChannel` 등)를 정리.

- [ ] **Step 5: 검증** — `npx tsc --noEmit` 0, `npm run lint | grep problems` → `24 problems`, `npm run build` 성공. 동작 변경은 제목 숫자 제거뿐.
- [ ] **Step 6: Commit** — `git add src/app/influencers/profileShared.ts src/app/influencers/Timeline.tsx src/app/influencers/ContentTab.tsx src/app/influencers/InfluencerProfile.tsx && git commit -m "refactor(influencer): 프로필 파일 분해 — Timeline·ContentTab·profileShared(errOf·useErrorReport)"`

---

### Task 5: 오버레이 닫기 — InfoTip 0-rect 방어 · 히트맵 툴팁 키보드/popstate

**Files:**
- Modify: `src/components/InfoTip.tsx` (`place` 함수)
- Modify: `src/app/influencers/AnalysisSection.tsx` (`PostingHeatmap`의 `showTip`·close effect)

**Interfaces:** 외부 API 변경 없음.

- [ ] **Step 1: InfoTip — 앵커가 숨겨졌으면 닫기.** `place`에서 rect를 읽은 뒤:

```ts
const r = btnRef.current?.getBoundingClientRect();
// 앵커가 hidden 패널 안으로 들어가면 rect가 전부 0이다 — 그 좌표로 배치하면 좌상단으로 튄다.
// 숨은 앵커의 툴팁은 열려 있을 이유가 없으니 닫는다(프로필 탭 전환, 스펙 §3).
if (!r || (r.width === 0 && r.height === 0)) { setOpen(false); return; }
```
(`setOpen`이 `place`보다 뒤에 선언돼 있으면 순서를 맞추거나 `hide`를 쓴다 — 파일을 읽고 기존 이름을 따른다.)

- [ ] **Step 2: 히트맵 툴팁 — 0-rect 방어 + 키보드·popstate 닫기.** `showTip`에 `if (r.width === 0 && r.height === 0) { setTip(null); return; }` 추가. 열림 중 close 리스너 effect에 `keydown`·`popstate` 추가:

```ts
window.addEventListener('keydown', close);     // 키보드로 탭을 바꾸면 마우스 툴팁은 남을 이유가 없다
window.addEventListener('popstate', close);    // 뒤로가기/?tab 링크로 패널이 바뀌어도 같다
```
(cleanup에도 둘 다 제거.)

- [ ] **Step 3: 검증** — `npx tsc --noEmit` 0, lint 24, `node --import tsx --test src/lib/influencerAnalysis.test.ts` PASS(무관하지만 회귀 확인).
- [ ] **Step 4: Commit** — `git add src/components/InfoTip.tsx src/app/influencers/AnalysisSection.tsx && git commit -m "fix(influencer): 숨은 앵커의 툴팁 닫기 — InfoTip 0-rect 방어·히트맵 키보드/popstate"`

---

### Task 4: 탭 프레임 — ProfileTabs · AccountTab · DealTab · InfluencerProfile 재조립 · 오류 표식

**Files:**
- Create: `src/app/influencers/ProfileTabs.tsx`
- Create: `src/app/influencers/AccountTab.tsx`
- Create: `src/app/influencers/DealTab.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx`
- Modify: `src/app/influencers/PricingSection.tsx` (`onErrorChange` prop + `useErrorReport` 1줄)

**Interfaces:**
- Consumes: T1 `TabKey`·`TAB_KEYS`·`TAB_LABEL`; T3 `Timeline`·`ContentTab`·`useErrorReport`·`errOf`.
- Produces (T2가 쓴다):
```ts
// InfluencerProfile.tsx — props 확장
export function InfluencerProfile(props: {
  id: string; onChanged: () => Promise<void>; onDeleted: () => void;
  tab: TabKey; onTabChange: (t: TabKey) => void;     // 신규 — 탭 상태는 부모(page)가 URL에서 준다
}): JSX.Element;
// ProfileTabs.tsx
export function ProfileTabs(props: {
  active: TabKey; onChange: (t: TabKey) => void;
  badges: Partial<Record<TabKey, number>>;          // content에만 draftCount(0이면 생략)
  errorTabs: ReadonlySet<TabKey>;                   // 저장 실패가 있는 탭
  panels: Record<TabKey, ReactNode>;
}): JSX.Element;
```

- [ ] **Step 1: `ProfileTabs.tsx`**

```tsx
'use client';
import { useRef, type ReactNode } from 'react';
import { TAB_KEYS, TAB_LABEL, type TabKey } from '@/lib/profileTabs';

// 구역 전환용 밑줄 탭 — X 프로필(게시물/답글/미디어)과 같은 문법. 필터용 알약(DraftFilterBar)과 섞지 않는다.
// 패널은 전부 마운트하고 hidden으로만 숨긴다 — 입력 중 텍스트·저장 실패 문구·분석 진행이 보존된다(스펙 §3).
// 방향키는 포커스만 옮기고 Enter/Space로 활성화(수동) — 활성화가 곧 URL 내비게이션이라 키마다 일어나면 안 된다.
export function ProfileTabs({ active, onChange, badges, errorTabs, panels }: {
  active: TabKey; onChange: (t: TabKey) => void;
  badges: Partial<Record<TabKey, number>>;
  errorTabs: ReadonlySet<TabKey>;
  panels: Record<TabKey, ReactNode>;
}) {
  const refs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  function onKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TAB_KEYS[(i + (e.key === 'ArrowRight' ? 1 : TAB_KEYS.length - 1)) % TAB_KEYS.length];
    refs.current[next]?.focus();
  }
  return (
    <>
      <div role="tablist" aria-label="프로필 구역" className="mt-5 flex border-b border-x-border">
        {TAB_KEYS.map((k, i) => {
          const on = k === active;
          const badge = badges[k];
          return (
            <button key={k} role="tab" id={`ptab-${k}`} aria-selected={on} aria-controls={`ppanel-${k}`}
                    tabIndex={on ? 0 : -1} ref={(el) => { refs.current[k] = el; }}
                    onClick={() => onChange(k)} onKeyDown={(e) => onKeyDown(e, i)}
                    className={`relative -mb-px flex items-center gap-1.5 px-3 py-2 text-ui ${
                      on ? 'border-b-2 border-x-blue font-bold text-x-text' : 'border-b-2 border-transparent text-x-secondary hover:text-x-text'
                    }`}>
              {TAB_LABEL[k]}
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-x-surface px-1.5 text-caption tabular-nums text-x-secondary">{badge}</span>
              )}
              {/* 저장 실패가 숨은 탭 안에 있다 — 색(빨간 점)과 말(sr-only)로 함께 알린다 */}
              {errorTabs.has(k) && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
              )}
              {errorTabs.has(k) && <span className="sr-only">저장 실패 있음</span>}
            </button>
          );
        })}
      </div>
      {TAB_KEYS.map((k) => (
        <div key={k} role="tabpanel" id={`ppanel-${k}`} aria-labelledby={`ptab-${k}`} hidden={k !== active}>
          {panels[k]}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: `AccountTab.tsx`** — 계정 분석·태그·메모·기록·제거 조립. TagEditor·NoteEditor·DangerZone은 InfluencerProfile.tsx에서 **이 파일로 이동**(AccountTab만 쓴다)하고 각각 `onErrorChange?` prop + `useErrorReport(err !== '', onErrorChange)` 1줄 추가(TagEditor·NoteEditor; DangerZone은 제거 실패가 즉시 보이는 자리라 제외). 첫 섹션(AnalysisSection)의 상단 구분선은 탭 바가 대신하므로 AnalysisSection에 `className` 오버라이드가 없다면 AccountTab에서 `<div className="[&>section:first-child]:border-t-0 [&>section:first-child]:mt-2">`로 감싸 첫 섹션의 border-t/여백만 줄인다(AnalysisSection 파일은 T5가 병행 수정 중 — 건드리지 않는다).

```tsx
'use client';
import { AnalysisSection } from './AnalysisSection';
import { Timeline } from './Timeline';
import type { InfluencerDetail, InfluencerAnalysis, InfluencerLogRow } from '@/lib/influencerStore';

export function AccountTab({ id, data, onChanged, onDeleted, setData, reportError }: {
  id: string; data: InfluencerDetail;
  onChanged: () => Promise<void>; onDeleted: () => void;
  setData: (fn: (d: InfluencerDetail | null) => InfluencerDetail | null) => void;
  reportError: (source: string, hasError: boolean) => void;
}) {
  const inf = data.influencer;
  return (
    <div className="[&>section:first-child]:mt-2 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
      <AnalysisSection id={id} analysis={data.analysis} analyzedAt={data.analyzedAt} followers={inf.followersCount}
                       onAnalyzed={(analysis, analyzedAt) => setData((d) => (d ? { ...d, analysis, analyzedAt } : d))} />
      <TagEditor id={id} tags={inf.tags} onSaved={onChanged} onErrorChange={(v) => reportError('tags', v)} />
      <NoteEditor id={id} note={inf.note} onErrorChange={(v) => reportError('note', v)} />
      <Timeline id={id} logs={data.logs}
                onAdded={(row) => { setData((d) => (d ? { ...d, logs: [row, ...d.logs] } : d)); onChanged(); }}
                onRemoved={(logId) => { setData((d) => (d ? { ...d, logs: d.logs.filter((l) => l.id !== logId) } : d)); onChanged(); }}
                onErrorChange={(v) => reportError('timeline', v)} />
      <DangerZone id={id} logCount={data.logs.length} onDeleted={onDeleted} />
    </div>
  );
}
// ↓ TagEditor / NoteEditor / DangerZone 본문을 InfluencerProfile.tsx에서 그대로 옮긴다(export 없음)
```

- [ ] **Step 3: `DealTab.tsx`** — PricingSection 배치. `logs`·`onSaved`는 부모 상태(스펙 §5 — 거래 탭의 저장이 계정 탭 Timeline에 나타난다):

```tsx
'use client';
import { PricingSection } from './PricingSection';
import type { InfluencerDetail } from '@/lib/influencerStore';

export function DealTab({ id, data, onChanged, setData, reportError }: {
  id: string; data: InfluencerDetail; onChanged: () => Promise<void>;
  setData: (fn: (d: InfluencerDetail | null) => InfluencerDetail | null) => void;
  reportError: (source: string, hasError: boolean) => void;
}) {
  return (
    <div className="[&>section:first-child]:mt-2 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
      {/* 단가 변경은 서버가 자동 로그를 남긴다 — 새 로그를 타임라인(계정 정보 탭) 맨 앞에 붙인다.
          patch는 그 요청이 바꾼 키만 담으므로 병행 응답이 뒤섞여도 서로 다른 키끼리는 병합만 된다. */}
      <PricingSection id={id} pricing={data.pricing} logs={data.logs}
                      onSaved={(patch, newLogs) => {
                        setData((d) => (d ? { ...d, pricing: { ...d.pricing, ...patch }, logs: [...newLogs, ...d.logs] } : d));
                        if (newLogs.length > 0) onChanged();   // last_log_at이 바뀌니 명부도 움직여야 한다
                      }}
                      onErrorChange={(v) => reportError('pricing', v)} />
    </div>
  );
}
```

- [ ] **Step 4: `PricingSection.tsx`** — prop `onErrorChange?: (v: boolean) => void` 추가, 본문에 `useErrorReport(Object.keys(err).length > 0, onErrorChange);` 1줄(`import { useErrorReport } from './profileShared'`). 그 외 불변.

- [ ] **Step 5: `InfluencerProfile.tsx` 재조립** — props에 `tab: TabKey; onTabChange: (t: TabKey) => void` 추가. 탭별 오류 상태:

```tsx
// 숨은 탭의 저장 실패를 탭 라벨에 표식으로(스펙 §3). 키 = '탭:출처'. 멤버십이 안 바뀌면 같은 Set을 돌려
// 재렌더·effect 연쇄를 끊는다 — 없으면 useErrorReport → setState → 재렌더 → 새 콜백 … 무한 루프.
const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set());
const reportError = useCallback((tab: TabKey) => (source: string, hasError: boolean) => {
  const k = `${tab}:${source}`;
  setErrorKeys((prev) => {
    if (prev.has(k) === hasError) return prev;
    const n = new Set(prev); if (hasError) n.add(k); else n.delete(k); return n;
  });
}, []);
const errorTabs = useMemo(() => new Set([...errorKeys].map((k) => k.split(':')[0] as TabKey)), [errorKeys]);
```
렌더: 헤더·현황 스트립·알림띠(`loadErr` 띠와 `msg` 띠 — 둘 다 탭 바 **위**)까지 기존 그대로, 그 아래:

```tsx
<ProfileTabs active={tab} onChange={onTabChange}
             badges={{ content: inf.draftCount }}
             errorTabs={errorTabs}
             panels={{
               account: <AccountTab id={id} data={data} onChanged={onChanged} onDeleted={onDeleted} setData={setData} reportError={reportError('account')} />,
               content: <ContentTab drafts={data.drafts} draftCount={inf.draftCount} />,
               deal: <DealTab id={id} data={data} onChanged={onChanged} setData={setData} reportError={reportError('deal')} />,
             }} />
```
기존의 AnalysisSection/TagEditor/NoteEditor/PricingSection/Timeline/ContentTab/DangerZone 직접 렌더는 전부 제거(탭 안으로). `reportError(tab)`가 매 렌더 새 함수를 만들어도 `useErrorReport`가 ref로 받으므로 문제없다. `useMemo`·`useCallback` import 추가, 이제 안 쓰는 import 제거.

- [ ] **Step 6: 검증** — `npx tsc --noEmit` 0 (page.tsx가 아직 `tab`/`onTabChange`를 안 넘겨 에러가 난다면, 이 태스크에서는 두 prop을 **옵셔널 + 기본값**(`tab = 'account'`, `onTabChange = () => {}`)으로 두어 T2 전까지 컴파일되게 한다 — T2가 필수로 바꾼다), lint 24, build 성공. 파일 크기: InfluencerProfile.tsx가 ~250줄 이하로 줄었는지 `wc -l`.
- [ ] **Step 7: Commit** — `git add src/app/influencers/ProfileTabs.tsx src/app/influencers/AccountTab.tsx src/app/influencers/DealTab.tsx src/app/influencers/InfluencerProfile.tsx src/app/influencers/PricingSection.tsx && git commit -m "feat(influencer): 프로필 3구역 탭 — ProfileTabs·AccountTab·DealTab, 숨은 탭 저장 실패 표식"`

---

### Task 2: page.tsx — URL 병합 · 탭 리프트

**Files:**
- Modify: `src/app/influencers/page.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx` (T4가 옵셔널로 둔 `tab`/`onTabChange`를 필수로)

**Interfaces — Consumes:** T1 `parseTab`·`mergeQuery`·`tabQuery`·`TabKey`; T4 `InfluencerProfile` props.

- [ ] **Step 1: 읽기** — `const tab = parseTab(searchParams.get('tab'));` (`urlId` 옆). `key={selected.id}` 바깥(`InfluencersSplit`)이라 리마운트와 무관.

- [ ] **Step 2: 쓰기 — 병합으로 교체**

```ts
// 선택·탭은 한 URL에 공존한다 — 한쪽을 쓸 때 다른 쪽을 지우면 안 된다(스펙 §2).
// scroll:false — 탭·선택마다 상단으로 튀지 않게(선례 없이 기본값 true였음).
const replaceQuery = useCallback((q: string) => {
  router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
}, [router, pathname]);
const select = useCallback((id: string) => {
  replaceQuery(mergeQuery(searchParams.toString(), { i: id }));
}, [replaceQuery, searchParams]);
const setTab = useCallback((t: TabKey) => {
  replaceQuery(tabQuery(searchParams.toString(), t));
}, [replaceQuery, searchParams]);
```
`handleDeleted`의 `router.replace(pathname)`은 그대로(선택이 없으면 탭도 의미 없음 — 스펙 §2).

- [ ] **Step 3: 내려주기** — `<InfluencerProfile key={selected.id} id={selected.id} onChanged={load} onDeleted={handleDeleted} tab={tab} onTabChange={setTab} />`. InfluencerProfile의 두 prop을 필수로 되돌린다(기본값 제거).

- [ ] **Step 4: 검증** — tsc 0, lint 24, build. 수동 논리 점검: `?i=A&tab=deal`에서 다른 인플루언서 클릭 → `?i=B&tab=deal`; 탭을 계정 정보로 → `?i=B`.
- [ ] **Step 5: Commit** — `git add src/app/influencers/page.tsx src/app/influencers/InfluencerProfile.tsx && git commit -m "feat(influencer): 탭 상태를 URL로 — ?i·?tab 병합 쓰기·scroll 유지"`

---

### Task 6: 통합 검증

- [ ] **Step 1:** `node --import tsx --test src/lib/profileTabs.test.ts src/lib/influencerStore.test.ts src/lib/influencerAnalysis.test.ts src/lib/influencerPricing.test.ts` 전부 PASS (스토어는 `--env-file-if-exists=.env` 필요할 수 있음).
- [ ] **Step 2:** `npm run lint | grep problems` → `24 problems`.
- [ ] **Step 3:** `npm run build` 성공.
- [ ] **Step 4:** `wc -l src/app/influencers/*.tsx` — InfluencerProfile.tsx ≤ 260줄, 새 파일 각 ≤ 200줄 확인. 이전 파일에 있던 export(`Avatar`, `InfluencerProfile`)가 그대로인지 `grep -n "^export" src/app/influencers/InfluencerProfile.tsx`.
- [ ] **Step 5:** 결함이 있으면 최소 수정 후 커밋 `fix(influencer): 탭 통합 검증 반영`.

## QA 안내(koo) — 배포 전
탭 전환 지연·스크롤 튐 없음 / URL 유지(새로고침·인플루언서 교체) / 입력 중 텍스트 보존 / 배지 = 현황 요약 합계 / 거래 탭에서 단가 저장 실패 후 계정 탭으로 가면 거래 탭에 빨간 점 / 히트맵 툴팁이 탭 전환 후 남지 않음.
