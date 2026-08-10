# /generate 툴바 재설계 구현 계획 (워크벤치 7차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 툴바를 2행(1행=뷰·상태·클라이언트 / hairline / 2행=검색·시술·기간)으로 재구성, 전 컨트롤 32px 레일 통일, 기간을 프리셋+직접 지정(네이티브 date) 팝오버로 교체. 스펙: `docs/superpowers/specs/2026-08-10-generate-toolbar-redesign-design.md`

**Architecture:** 순수 프론트엔드. 기간 값 모델을 `PeriodValue`(preset | range)로 확장하고 순수 함수(applyPeriod·formatPeriodLabel)로 로직 분리, 팝오버는 신규 `PeriodPicker` 컴포넌트(자기완결 controlled), page는 배선·레이아웃만.

## Global Constraints

- 세션 렌즈 정책(저장 안 함) 유지. 서버 무변경. DraftTable·DraftKanban·DraftCard 무변경.
- **팝오버는 날짜 입력이 절대 잘리지 않게** `min-w-[300px]` + date input `w-full` 세로 배치 (시안 피드백 verbatim 요구).
- 전 컨트롤 `h-8` + `text-[13px]` 레일. 검증: tsc 0 / lint 24 / 단위 테스트. 작업자 커밋 금지. 주석 한국어.
- 병렬: W1={T1(haiku)·T2(sonnet)} — T2는 T1의 타입·함수 계약을 아래 Interfaces대로 사용(검증 시점에 T1 미완이면 30초 간격 2~3회 재시도 후 상태만 보고). W2={T3(sonnet)}.

---

### Task 1: PeriodValue 모델 + 순수 함수 — 권장 모델: haiku

**Files:** Modify: `src/lib/draftViews.ts`, `src/lib/draftViews.test.ts`

**Interfaces (T2·T3가 사용):**
```ts
export type PeriodValue = { kind: 'preset'; preset: Period } | { kind: 'range'; from: string; to: string };
export function applyPeriod<T extends { createdAt: string }>(list: T[], value: PeriodValue, now: number): T[];
export function formatPeriodLabel(value: PeriodValue): string;
export function isRangeInverted(value: PeriodValue): boolean;
```

- [ ] **Step 1: 실패하는 테스트** — draftViews.test.ts에 추가

```ts
test('applyPeriod: preset은 filterByPeriod 위임과 동일', () => {
  const now = Date.parse('2026-08-10T15:00:00+09:00');
  const rows = [{ createdAt: new Date(now - 8 * 86_400_000).toISOString() }, { createdAt: new Date(now - 1000).toISOString() }];
  assert.deepEqual(applyPeriod(rows, { kind: 'preset', preset: '7d' }, now), filterByPeriod(rows, '7d', now));
  assert.equal(applyPeriod(rows, { kind: 'preset', preset: 'all' }, now).length, 2);
});

test('applyPeriod: range는 양끝 날짜 포함(로컬 자정 경계)', () => {
  const day = (s: string, h: number) => ({ createdAt: new Date(new Date(`${s}T00:00:00`).getTime() + h * 3_600_000).toISOString() });
  const rows = [day('2026-08-01', 12), day('2026-08-05', 23), day('2026-08-06', 1)];
  const out = applyPeriod(rows, { kind: 'range', from: '2026-08-01', to: '2026-08-05' }, 0);
  assert.deepEqual(out, [rows[0], rows[1]]); // 8/6 01시는 제외, 8/5 23시는 포함
});

test('applyPeriod: 단측 range와 역전 range', () => {
  const rows = [{ createdAt: '2026-08-01T05:00:00.000Z' }, { createdAt: '2026-08-09T05:00:00.000Z' }];
  assert.equal(applyPeriod(rows, { kind: 'range', from: '', to: '' }, 0).length, 2);
  assert.equal(applyPeriod(rows, { kind: 'range', from: '2026-08-05', to: '' }, 0).length, 1);
  assert.equal(applyPeriod(rows, { kind: 'range', from: '2026-08-09', to: '2026-08-01' }, 0).length, 2); // 역전은 미적용(전체)
  assert.equal(isRangeInverted({ kind: 'range', from: '2026-08-09', to: '2026-08-01' }), true);
  assert.equal(isRangeInverted({ kind: 'range', from: '2026-08-01', to: '2026-08-09' }), false);
});

test('formatPeriodLabel: 프리셋·범위·단측 표기', () => {
  assert.equal(formatPeriodLabel({ kind: 'preset', preset: 'all' }), '전체 기간');
  assert.equal(formatPeriodLabel({ kind: 'preset', preset: '7d' }), '최근 7일');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '2026-08-01', to: '2026-08-10' }), '8.1 – 8.10');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '2026-08-01', to: '' }), '8.1 이후');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '', to: '' }), '전체 기간');
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/draftViews.test.ts` FAIL
- [ ] **Step 3: 구현** — draftViews.ts에 추가 (기존 filterByPeriod·Period는 유지, applyPeriod가 내부 위임)

```ts
// 기간 렌즈 값 — 프리셋 또는 직접 지정 범위('YYYY-MM-DD', 빈 문자열=단측 개방)
export type PeriodValue = { kind: 'preset'; preset: Period } | { kind: 'range'; from: string; to: string };

// 'YYYY-MM-DD' → 로컬 자정 타임스탬프. 형식이 아니면 null(미적용)
function localDayStart(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

// 역전 범위(시작>끝)는 적용하지 않고 전체 반환 — 호출부(PeriodPicker)가 안내 캡션 담당
export function isRangeInverted(value: PeriodValue): boolean {
  return value.kind === 'range' && !!value.from && !!value.to && value.from > value.to;
}

export function applyPeriod<T extends { createdAt: string }>(list: T[], value: PeriodValue, now: number): T[] {
  if (value.kind === 'preset') return filterByPeriod(list, value.preset, now);
  if (isRangeInverted(value)) return list;
  const from = value.from ? localDayStart(value.from) : null;
  const toStart = value.to ? localDayStart(value.to) : null;
  const to = toStart !== null ? toStart + 86_400_000 : null; // 끝 날짜 포함 — 다음날 자정 미만
  return list.filter((x) => {
    const t = Date.parse(x.createdAt);
    return (from === null || t >= from) && (to === null || t < to);
  });
}

export function formatPeriodLabel(value: PeriodValue): string {
  if (value.kind === 'preset') {
    return value.preset === 'all' ? '전체 기간' : value.preset === 'today' ? '오늘'
      : value.preset === '7d' ? '최근 7일' : '최근 30일';
  }
  const md = (s: string) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s); return m ? `${Number(m[1])}.${Number(m[2])}` : s; };
  if (value.from && value.to) return `${md(value.from)} – ${md(value.to)}`;
  if (value.from) return `${md(value.from)} 이후`;
  if (value.to) return `${md(value.to)}까지`;
  return '전체 기간';
}
```

- [ ] **Step 4: 통과 확인** + **Step 5: 정적 검증** — 테스트 전부 PASS, `npx tsc --noEmit && npx eslint src/lib/draftViews.ts src/lib/draftViews.test.ts` 자기 파일 0건. (커밋 금지)

---

### Task 2: PeriodPicker 컴포넌트 — 권장 모델: sonnet

**Files:** Create: `src/components/PeriodPicker.tsx`

**Interfaces:** Consumes T1의 `PeriodValue`·`Period`·`formatPeriodLabel`·`isRangeInverted`. Produces: `PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void })`.

- [ ] **Step 1: 파일 작성**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { formatPeriodLabel, isRangeInverted, type Period, type PeriodValue } from '@/lib/draftViews';

const PRESETS: Array<{ preset: Period; label: string }> = [
  { preset: 'all', label: '전체 기간' }, { preset: 'today', label: '오늘' },
  { preset: '7d', label: '최근 7일' }, { preset: '30d', label: '최근 30일' },
];

// 기간 렌즈 — 프리셋은 즉시 적용+닫힘, 직접 지정은 네이티브 date 입력(브라우저 캘린더 활용, 내부 도구 관례).
// 팝오버는 date 입력이 잘리지 않는 폭을 보장한다(min-w + w-full — 시안 피드백).
export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const range = value.kind === 'range' ? value : { kind: 'range' as const, from: '', to: '' };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}
              className="flex h-8 items-center gap-1 rounded-md border border-x-border-strong bg-white px-2.5 text-[13px] text-x-secondary hover:bg-x-hover">
        <span aria-hidden>🗓</span> {formatPeriodLabel(value)} <span aria-hidden>⌄</span>
      </button>
      {open && (
        <div role="dialog" aria-label="기간 선택"
             className="absolute left-0 z-30 mt-1 min-w-[300px] rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-1" role="group" aria-label="기간 프리셋">
            {PRESETS.map((p) => (
              <button key={p.preset} onClick={() => { onChange({ kind: 'preset', preset: p.preset }); setOpen(false); }}
                      className={`rounded-md px-2.5 py-1.5 text-left text-[13px] ${value.kind === 'preset' && value.preset === p.preset ? 'bg-x-blue/10 font-bold text-x-blue-text' : 'text-x-secondary hover:bg-x-hover'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-x-border pt-2">
            <p className="mb-1.5 text-caption text-x-muted">직접 지정 — 날짜를 고르면 바로 적용됩니다</p>
            <div className="flex flex-col gap-1.5">
              <input type="date" value={range.from} aria-label="시작 날짜"
                     onChange={(e) => onChange({ kind: 'range', from: e.target.value, to: range.to })}
                     className="h-8 w-full rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue" />
              <input type="date" value={range.to} aria-label="끝 날짜"
                     onChange={(e) => onChange({ kind: 'range', from: range.from, to: e.target.value })}
                     className="h-8 w-full rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue" />
            </div>
            {isRangeInverted(value) && (
              <p className="mt-1.5 text-caption text-red-600">시작이 끝보다 늦어요 — 기간이 적용되지 않았어요</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 정적 검증** — `npx tsc --noEmit && npx eslint src/components/PeriodPicker.tsx` 자기 파일 0건(T1 미완이면 재시도 프로토콜). (커밋 금지)

---

### Task 3: page.tsx 툴바 재구성 + DraftFilterBar 32px 레일 — 권장 모델: sonnet

**Files:** Modify: `src/app/generate/page.tsx`, `src/components/DraftFilterBar.tsx`

**Interfaces:** Consumes T1(`applyPeriod`·`PeriodValue`)·T2(`PeriodPicker`).

- [ ] **Step 1: DraftFilterBar 32px 레일** — 로직 불변, 클래스만:
  - 탭: `rounded-full border px-2.5 py-0.5 …` → `inline-flex h-8 items-center rounded-full border px-3 …` (양쪽 변형 모두).
  - 셀렉트: `px-2 py-1 text-caption` → `h-8 px-2 text-[13px]`.

- [ ] **Step 2: page.tsx — period 상태를 PeriodValue로**
  - import 교체: `filterByPeriod, type Period` → `applyPeriod, type PeriodValue` + `import { PeriodPicker } from '@/components/PeriodPicker';`
  - `const [period, setPeriod] = useState<PeriodValue>({ kind: 'preset', preset: 'all' });`
  - scoped: `applyPeriod(filterByProcedure(searchDrafts(clientScoped, query), procFilter), period, Date.now())` (deps 동일).
  - revealIfHidden: `filterByPeriod(..., L.period, ...)` → `applyPeriod(..., L.period, Date.now())`, 리셋은 `setPeriod({ kind: 'preset', preset: 'all' })`.

- [ ] **Step 3: page.tsx — 헤더 2행 재구성**

기존 헤더(세그먼트+래퍼)와 6차 둘째 행을 다음 구조로 재배치(세그먼트·DraftFilterBar props·검색·시술 셀렉트의 기존 마크업 재사용, 클래스만 h-8 레일로):

```tsx
        {loaded && drafts.length > 0 && (
          <div className="border-b border-x-border bg-x-surface px-4 py-2">
            {/* 1행 — 무엇을 보나: 뷰 | 상태 | 클라이언트 (GitLab·Notion 관례: 모드와 필터의 레이어 분리) */}
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="보기 방식" className="flex h-8 shrink-0 overflow-hidden rounded-lg border border-x-border-strong">
                {/* 기존 세그먼트 버튼 3개 — className만 `h-full px-3 text-[13px] …`로(py 제거) */}
              </div>
              <span aria-hidden className="h-5 w-px shrink-0 bg-x-border-strong" />
              <div className="min-w-0 flex-1">
                <DraftFilterBar /* 기존 props 그대로 */ />
              </div>
            </div>
            {/* 2행 — 어떻게 좁히나: 검색(최광폭)·시술·기간 (필터 초과분은 둘째 줄+구분선 — GitLab) */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-x-border pt-2">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder="제목·내용·방향성 검색" aria-label="초안 검색"
                     className="h-8 min-w-[200px] max-w-[360px] flex-1 rounded-md border border-x-border-strong bg-white px-2.5 text-[13px] outline-none focus:border-x-blue" />
              <select value={procFilter} onChange={(e) => setProcFilter(e.target.value)} aria-label="시술로 거르기"
                      className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue">
                <option value="">모든 시술</option>
                {procOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
          </div>
        )}
```

(6차의 기존 기간 `<select>`는 제거 — PeriodPicker가 대체.)

- [ ] **Step 4: 정적 검증** — `npx tsc --noEmit && npm run lint` 0건/24 기준선. 잔재 grep: `filterByPeriod`가 page.tsx에 남아 있지 않아야(applyPeriod로 대체).
- [ ] **Step 5: 스모크** — 포트 3000 curl 307/200.

---

## 실행 순서

| Wave | Task | 모델 |
|---|---|---|
| 1 | T1 PeriodValue 함수(haiku) · T2 PeriodPicker(sonnet) 병렬 | haiku·sonnet |
| 2 | T3 page+FilterBar 재구성 | sonnet |

마감: 통합 리뷰 1회(sonnet, 전체 npm test는 조율자가 별도 실행 — 리뷰어는 돌리지 말 것) + 회귀 + 조율자 diff 검수 + 프로덕션 재빌드.
