# 콘텐츠 생성 신뢰 회복 + 상태 축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘텐츠 생성 기능의 작업물 유실 방지·표기 정정(1단)과 `draft.status` 5상태 축 + `/generate` 필터(2단)를 구현한다.

**Architecture:** 1단은 스키마 무관 UI 수정(먼저 배포 가능), 2단은 마이그레이션 016 + 스토어/API/UI 관통. 판정 로직(dirty·폴링 병합·필터)은 순수 함수로 `draftUi.ts`/`draftStatus.ts`에 추출해 컴포넌트 하네스 없이 테스트한다. 상태는 전이 제약 없는 자유 라벨 — 워크플로 엔진이 아니다.

**Tech Stack:** Next.js 16(주의: 학습 데이터와 다름 — `node_modules/next/dist/docs/` 참조) · React 19 · postgres.js · Tailwind 4 · node:test + tsx(실 DB)

**Spec:** `docs/superpowers/specs/2026-08-06-draft-trust-status-design.md`

## Global Constraints

- **UX 원칙 (AGENTS.md):** 라벨은 이득을 사용자 언어로 · 행동 전 기대 설정 · 결과엔 판단 서술 · 라벨-값 일치 · 기술 값 노출 최소화 · 비용 액션은 고지
- **X 미러링:** 상태 칩 등 도구 요소는 카드의 회색 도구층에만 — 흰색 X 콘텐츠층은 건드리지 않는다
- **상태 키는 영문 저장, 한국어 표시:** `draft/review/approved/delivered/unused` ↔ `초안/검수 대기/사용 확정/전달됨/미사용`
- **테스트:** `npm test`는 실 DB로 약 4분 — 개발 중엔 단일 파일 `node --import tsx --env-file-if-exists=.env --test <파일>` (수 초)
- **린트 기준선 24개:** `npm run lint`에서 새 에러/경고를 추가하지 않는다 (기존 24개는 통과 기준)
- **`.env` 없으면:** `vercel link` 후 `vercel env pull .env --environment=production` (메모리: cb-x-deck-env-from-vercel)
- **커밋 순서:** Task 1~6(1단)이 Task 7~12(2단)보다 먼저 — 1단만 선배포 가능해야 한다

---

## Phase 1 — 신뢰 회복 (스키마 변경 없음)

### Task 1: 표기 정리 — 비용 캡션·형식 라벨·모델명 제거

**Files:**
- Modify: `src/components/DraftComposer.tsx`
- Modify: `src/components/DraftCard.tsx:221`

**Interfaces:**
- Consumes: 없음
- Produces: `DraftComposer.tsx` 상단에 `const COST_CAPTION = '생성 1회 ≈ $0.02';` (Task 2가 같은 캡션 행에 안내문을 잇는다)

- [ ] **Step 1: DraftComposer — 비용 캡션 상수 + 버튼 라벨 + 형식 라벨**

`src/components/DraftComposer.tsx`의 `MODE_LABEL` 선언 아래에 상수 추가:

```tsx
// CONTENT_MODEL 변경 시 함께 갱신 (스펙 3-6 — sonnet 실측 ≈$0.015의 보수적 반올림)
const COST_CAPTION = '생성 1회 ≈ $0.02';
```

생성 버튼(기존 75행)의 라벨을 바꾸고:

```tsx
              원고 만들기
```

버튼 아래 안내 블록(기존 79~81행)을 다음으로 교체 — 생성 가능할 땐 비용 캡션, 불가능할 땐 기존 안내:

```tsx
        {!generating && (
          <p className="mt-1 text-caption text-x-muted">
            {canGenerate ? COST_CAPTION : '클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요'}
          </p>
        )}
```

형식 버튼(기존 116행)의 라벨 교체:

```tsx
                  {f === 'single' ? '단문 (트윗 1개, X 기준 280 이내)' : '스레드 (트윗 3~5개)'}
```

- [ ] **Step 2: DraftCard — 풋터 모델명 제거**

`src/components/DraftCard.tsx` 220~222행의 풋터 span에서 `draft.model` 부분을 삭제:

```tsx
          <span className="shrink-0 text-caption tabular-nums text-x-muted">
            {[draft.clientName, ...draft.procedureNames].filter(Boolean).join(' · ')}
          </span>
```

(DB의 `draft.model`은 원가 추적용으로 유지 — UI 노출만 제거, 스펙 1-5)

- [ ] **Step 3: 린트로 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 기존 기준선(24개) 외 새 에러/경고 없음

- [ ] **Step 4: Commit**

```bash
git add src/components/DraftComposer.tsx src/components/DraftCard.tsx
git commit -m "fix(x-deck): 표기 정정 — 비용 캡션 실측치로(상수+갱신 주석)·글자수 단위 통일(X 기준 280)·카드 모델명 노출 제거"
```

### Task 2: 클라이언트 미선택 안내 + 레퍼런스 모두 빼기

**Files:**
- Modify: `src/components/DraftComposer.tsx`
- Modify: `src/app/generate/page.tsx:196-199`

**Interfaces:**
- Consumes: Task 1의 `COST_CAPTION` 캡션 행
- Produces: `DraftComposer` props에 `onClearRefs: () => void` 추가 (page가 `() => setRefRows([])` 전달)

- [ ] **Step 1: 클라이언트 미선택 안내**

Task 1에서 만든 캡션 행을 확장 — 클라이언트가 등록돼 있는데 미선택인 채 생성 가능한 상태면 안내를 덧붙인다 (막지 않는다, 스펙 3-7):

```tsx
        {!generating && (
          <p className="mt-1 text-caption text-x-muted">
            {canGenerate
              ? `${COST_CAPTION}${clients.length > 0 && !value.clientId ? " · 클라이언트 정보 없이 만들어요 — '바꾸기'에서 선택할 수 있어요" : ''}`
              : '클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요'}
          </p>
        )}
```

- [ ] **Step 2: 레퍼런스 모두 빼기**

`DraftComposer`의 props 타입과 구조 분해에 `onClearRefs: () => void`를 추가하고, 레퍼런스 밴드의 `+ 레퍼런스 추가` 버튼(기존 53~55행) 앞에 2건 이상일 때만 링크 추가:

```tsx
        {refRows.length >= 2 && (
          <button onClick={onClearRefs} className="shrink-0 text-x-muted hover:text-red-500 hover:underline">모두 빼기</button>
        )}
        <button onClick={onOpenPicker} className="ml-auto shrink-0 text-x-blue-text hover:underline">
          {refRows.length > 0 ? '+ 레퍼런스 추가' : '보관함에서 고르기'}
        </button>
```

(확인 대화 없음 — 시트에서 다시 고르면 되는 가역 동작, 스펙 3-8)

- [ ] **Step 3: page에서 연결**

`src/app/generate/page.tsx`의 `<DraftComposer …>` 호출에 prop 추가:

```tsx
      <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                     refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                     onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                     onClearRefs={() => setRefRows([])}
                     generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate} />
```

- [ ] **Step 4: 린트로 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

- [ ] **Step 5: Commit**

```bash
git add src/components/DraftComposer.tsx src/app/generate/page.tsx
git commit -m "feat(x-deck): 클라이언트 미선택 안내(막지 않고 알림) + 레퍼런스 모두 빼기 링크"
```

### Task 3: 판정 순수 헬퍼 — dirty 2종 + 폴링 병합

**Files:**
- Modify: `src/lib/draftUi.ts`
- Test: `src/lib/draftUi.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `textsChanged(base: string[], current: string[]): boolean` · `idSetChanged(a: string[], b: string[]): boolean` · `newDraftsSince<T extends { id: string; createdAt: string }>(cur: T[], fetched: T[], sinceMs: number): T[]` — Task 4·5·6이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/draftUi.test.ts` 끝에 추가:

```ts
test('textsChanged — 본문 배열이 하나라도 다르면 dirty', () => {
  assert.equal(textsChanged(['a', 'b'], ['a', 'b']), false);
  assert.equal(textsChanged(['a', 'b'], ['a', 'c']), true);
  assert.equal(textsChanged(['a'], ['a', '']), true);   // 길이 차이도 dirty
});

test('idSetChanged — 순서 무관 집합 비교', () => {
  assert.equal(idSetChanged(['1', '2'], ['2', '1']), false); // 순서만 다름 = 안 변함
  assert.equal(idSetChanged(['1'], ['1', '2']), true);
  assert.equal(idSetChanged(['1', '3'], ['1', '2']), true);
  assert.equal(idSetChanged([], []), false);
});

test('newDraftsSince — 모르는 id이면서 기준 시각 이후인 것만', () => {
  const cur = [{ id: 'a', createdAt: '2026-08-06T10:00:00Z' }];
  const fetched = [
    { id: 'b', createdAt: '2026-08-06T10:05:00Z' },  // 새 것 — 포함
    { id: 'a', createdAt: '2026-08-06T10:00:00Z' },  // 이미 있음 — 제외
    { id: 'c', createdAt: '2026-08-06T09:00:00Z' },  // 기준 이전(예: 삭제 대기 중인 옛 초안) — 제외
  ];
  const since = Date.parse('2026-08-06T10:01:00Z');
  assert.deepEqual(newDraftsSince(cur, fetched, since).map((d) => d.id), ['b']);
});
```

파일 상단 import에 `textsChanged, idSetChanged, newDraftsSince`를 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: FAIL — `textsChanged` 등이 export되지 않음

- [ ] **Step 3: 구현**

`src/lib/draftUi.ts` 끝에 추가:

```ts
// 편집 모달 dirty 판정 (스펙 3-3) — 열 때의 본문과 현재 입력이 하나라도 다르면 true
export function textsChanged(base: string[], current: string[]): boolean {
  return base.length !== current.length || base.some((t, i) => t !== current[i]);
}

// 레퍼런스 시트 dirty 판정 (스펙 3-4) — 선택 id 집합이 다르면 true (순서 무관)
export function idSetChanged(a: string[], b: string[]): boolean {
  return [...a].sort().join(' ') !== [...b].sort().join(' ');
}

// 취소 후 폴링 병합 (스펙 3-5) — 목록에 없는 id이면서 생성 시작 이후 만들어진 것만.
// sinceMs 기준이 없으면 '삭제 대기 중(5초 실행취소)'인 옛 초안이 폴링으로 되살아난다.
export function newDraftsSince<T extends { id: string; createdAt: string }>(
  cur: T[], fetched: T[], sinceMs: number,
): T[] {
  const known = new Set(cur.map((d) => d.id));
  return fetched.filter((d) => !known.has(d.id) && Date.parse(d.createdAt) >= sinceMs);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftUi.ts src/lib/draftUi.test.ts
git commit -m "feat(x-deck): 유실 방지·폴링 판정 순수 헬퍼 — textsChanged·idSetChanged·newDraftsSince (TDD)"
```

### Task 4: 편집 모달 유실 방지

**Files:**
- Modify: `src/components/DraftEditModal.tsx`

**Interfaces:**
- Consumes: `textsChanged` (Task 3)
- Produces: 없음 (컴포넌트 내부 동작)

- [ ] **Step 1: dirty 가드 구현**

`src/components/DraftEditModal.tsx`에서:

import 추가:

```tsx
import { textsChanged } from '@/lib/draftUi';
```

`empty` 선언(기존 17행) 아래에 dirty 판정과 닫기 요청 함수 추가:

```tsx
  const dirty = textsChanged(base.posts.map((p) => p.text), texts);
  // 이 모달엔 별도 '취소' 버튼이 없어 ✕·Esc·배경 클릭 모두 확인 대상 (스펙 3-3)
  function requestClose() {
    if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
  }
```

Esc 핸들러(기존 20~24행)를 dirty를 보는 형태로 교체 — 의존성에 `dirty`가 들어가야 최신 판정을 쓴다:

```tsx
  // Esc로 모달 닫기 — ColumnSettings 선례와 동일한 방식. IME 조합 중 Esc는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);
```

배경 클릭(기존 40행)과 ✕ 버튼(기존 44행)을 `requestClose`로 교체:

```tsx
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
```

```tsx
          <button onClick={requestClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
```

- [ ] **Step 2: 린트 + 수동 시나리오 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

수동 확인(로컬 `npm run dev`): ① 수정 없이 Esc → 즉시 닫힘 ② 한 글자 수정 후 배경 클릭 → confirm 표시, 취소하면 유지 ③ 저장 후엔 dirty 해제.

- [ ] **Step 3: Commit**

```bash
git add src/components/DraftEditModal.tsx
git commit -m "fix(x-deck): 편집 모달 유실 방지 — 수정 상태에서 Esc·배경 클릭·✕ 시 확인 후 닫기"
```

### Task 5: 레퍼런스 시트 유실 방지

**Files:**
- Modify: `src/components/RefPickerSheet.tsx`

**Interfaces:**
- Consumes: `idSetChanged` (Task 3)
- Produces: 없음

- [ ] **Step 1: dirty 가드 구현**

`src/components/RefPickerSheet.tsx`에서:

import 추가:

```tsx
import { idSetChanged } from '@/lib/draftUi';
```

`toggle` 함수(기존 59~62행) 위에 추가 — 기준은 "우발(배경·Esc)만 확인, 명시(✕·취소 버튼)는 즉시" (스펙 3-4):

```tsx
  const dirty = idSetChanged(sel, selectedIds);
  function requestClose() {
    if (!dirty || window.confirm('선택을 적용하지 않았어요. 닫을까요?')) onClose();
  }
```

주의: `requestClose`는 `if (!open) return null;` 이전에 정의하면 훅 규칙과 무관한 일반 함수라 위치 제약이 없지만, `dirty` 계산은 `sel` 선언 이후여야 한다.

Esc 핸들러(기존 48~53행)를 dirty를 보는 형태로 교체:

```tsx
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!idSetChanged(sel, selectedIds) || window.confirm('선택을 적용하지 않았어요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, sel, selectedIds]);
```

배경 클릭(기존 65행)만 `requestClose`로 교체 — 헤더 ✕(71행)와 푸터 취소(170행)는 명시적 버리기이므로 `onClose` 유지:

```tsx
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
```

- [ ] **Step 2: 린트 + 수동 시나리오 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

수동 확인: ① 선택 변경 없이 배경 클릭 → 즉시 닫힘 ② 1건 체크 후 배경 클릭 → confirm ③ 1건 체크 후 '취소' 버튼 → 확인 없이 닫힘 ④ 적용 후 다시 열어 배경 클릭 → 즉시 닫힘(적용값과 같으므로 dirty 아님).

- [ ] **Step 3: Commit**

```bash
git add src/components/RefPickerSheet.tsx
git commit -m "fix(x-deck): 레퍼런스 시트 유실 방지 — 선택 변경 상태에서 배경 클릭·Esc 시 확인 (✕·취소는 명시적 의사라 즉시)"
```

### Task 6: 생성 취소 후 자동 반영

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `newDraftsSince` (Task 3)
- Produces: 없음

- [ ] **Step 1: 폴링 구현**

`src/app/generate/page.tsx`에서:

import 추가:

```tsx
import { newDraftsSince } from '@/lib/draftUi';
```

ref 선언부(기존 39~42행)에 추가:

```tsx
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genStartedAt = useRef(0); // 이번 생성 요청 시각 — 폴링 병합의 하한선
```

`generate()` 시작부(기존 82~85행)를 다음으로 교체 — 새 생성이 시작되면 이전 폴링은 중단:

```tsx
  async function generate() {
    if (generating) return;
    stopPolling();
    genStartedAt.current = Date.now();
    setGenerating(true);
    const ac = new AbortController();
    abortRef.current = ac;
```

`cancelGenerate()`(기존 127~130행)를 교체:

```tsx
  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  // 취소 = 기다리기만 중단(서버 생성은 계속) → 완성본을 폴링으로 자동 반영 (스펙 3-5)
  function cancelGenerate() {
    abortRef.current?.abort();
    setToast('기다리기를 취소했어요 — 완성되면 목록에 자동으로 나타나요');
    const deadline = Date.now() + 120_000; // 최대 2분
    stopPolling();
    pollTimer.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); return; }
      try {
        const r = await apiFetch('/api/drafts');
        if (!r.ok) return; // 조용히 다음 주기 재시도 (스펙 §4)
        const fetched = (await r.json()) as DraftRow[];
        let found = false;
        setDrafts((cur) => {
          const fresh = newDraftsSince(cur, fetched, genStartedAt.current);
          found = fresh.length > 0;
          return found ? [...fresh, ...cur] : cur;
        });
        if (found) { stopPolling(); setToast('아까 취소한 원고가 완성됐어요'); }
      } catch { /* 다음 주기 재시도 */ }
    }, 5000);
  }
```

언마운트 시 폴링 정리 — 마운트 effect(기존 44~56행) 아래에 추가:

```tsx
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);
```

- [ ] **Step 2: 린트 + 수동 시나리오 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

수동 확인: 생성 시작 → 취소 → 토스트 문구 확인 → 15~30초 내 완성본이 자동으로 목록 맨 위에 나타나고 "아까 취소한 원고가 완성됐어요" 토스트.

- [ ] **Step 3: Commit**

```bash
git add src/app/generate/page.tsx
git commit -m "feat(x-deck): 생성 취소 후 자동 반영 — 5초 폴링(최대 2분)으로 완성본 자동 표시, '새로고침' 안내 제거"
```

## Phase 2 — 상태 축 (마이그레이션 016)

### Task 7: 마이그레이션 016 + 상태 상수 모듈

**Files:**
- Create: `migrations/016_draft_status.sql`
- Create: `src/lib/draftStatus.ts`
- Test: `src/lib/draftStatus.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `DRAFT_STATUSES: readonly ['draft','review','approved','delivered','unused']` · `type DraftStatus` · `STATUS_LABEL: Record<DraftStatus, string>` · `isDraftStatus(v: unknown): v is DraftStatus` — Task 8~11이 사용

- [ ] **Step 1: 마이그레이션 파일 작성**

`migrations/016_draft_status.sql`:

```sql
-- 016: 초안 상태 축 — "결정 진행도" 라벨 (스펙 2026-08-06-draft-trust-status-design.md §2)
-- 전이 제약 없음(워크플로 엔진이 아니라 자유 라벨): 검수 생략·담당자 직접 사용 등 모든 경로 수용.
-- draft=결정 없음(기본) · review=검수 대기 · approved=사용 확정 · delivered=인플루언서 전달됨 · unused=안 쓰기로 결정
alter table draft add column if not exists status text not null default 'draft'
  check (status in ('draft', 'review', 'approved', 'delivered', 'unused'));
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `npm run migrate`
Expected: 016 적용 로그, 에러 없음

Run: `node --import tsx --env-file-if-exists=.env -e "import('./src/lib/db.ts').then(async ({getSql}) => { const sql = getSql(); const r = await sql\`select column_default from information_schema.columns where table_name='draft' and column_name='status'\`; console.log(r); await sql.end(); })"`
Expected: `column_default: "'draft'::text"` 확인

- [ ] **Step 3: 실패하는 테스트 작성**

`src/lib/draftStatus.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_STATUSES, STATUS_LABEL, isDraftStatus } from './draftStatus.ts';

test('isDraftStatus — 유효 5종 통과, 그 외 전부 거부', () => {
  for (const s of DRAFT_STATUSES) assert.ok(isDraftStatus(s), s);
  assert.equal(isDraftStatus('bogus'), false);
  assert.equal(isDraftStatus(''), false);
  assert.equal(isDraftStatus(undefined), false);
  assert.equal(isDraftStatus(3), false);
});

test('모든 상태에 한국어 라벨이 있다', () => {
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...DRAFT_STATUSES].sort());
  for (const s of DRAFT_STATUSES) assert.ok(STATUS_LABEL[s].length > 0);
});
```

- [ ] **Step 4: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStatus.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 5: 구현**

`src/lib/draftStatus.ts`:

```ts
// 초안 상태 축 — "결정 진행도" 라벨 (스펙 §2). 저장은 영문 키, 표시는 한국어.
// 전이 제약 없음: 어느 상태에서 어느 상태로든 바로 변경한다 (검수 생략·직접 사용 등 모든 경로 수용).
export const DRAFT_STATUSES = ['draft', 'review', 'approved', 'delivered', 'unused'] as const;
export type DraftStatus = typeof DRAFT_STATUSES[number];

export const STATUS_LABEL: Record<DraftStatus, string> = {
  draft: '초안', review: '검수 대기', approved: '사용 확정', delivered: '전달됨', unused: '미사용',
};

export function isDraftStatus(v: unknown): v is DraftStatus {
  return typeof v === 'string' && (DRAFT_STATUSES as readonly string[]).includes(v);
}
```

- [ ] **Step 6: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStatus.test.ts`
Expected: PASS 2건

- [ ] **Step 7: Commit**

```bash
git add migrations/016_draft_status.sql src/lib/draftStatus.ts src/lib/draftStatus.test.ts
git commit -m "feat(x-deck): draft.status 5상태 — 마이그레이션 016 + 상태 상수 모듈 (전이 제약 없는 자유 라벨, TDD)"
```

### Task 8: draftStore — status 관통

**Files:**
- Modify: `src/lib/draftStore.ts`
- Test: `src/lib/draftStore.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `DraftStatus` (Task 7)
- Produces: `DraftRow.status: DraftStatus` · `listDrafts(sql, { clientId?, status?, limit? })` · `updateDraft(sql, id, { …, status? })` — Task 9~11이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/draftStore.test.ts` 끝에 추가:

```ts
test('status — 기본값·패치·필터·부분 패치 독립', async () => {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '상태 왕복', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  assert.equal((await getDraft(sql, id))!.status, 'draft');       // DB 기본값

  await updateDraft(sql, id, { status: 'review' });
  assert.equal((await getDraft(sql, id))!.status, 'review');

  const listed = await listDrafts(sql, { status: 'review' });
  assert.ok(listed.some((d) => d.id === id));
  const excluded = await listDrafts(sql, { status: 'delivered' });
  assert.ok(!excluded.some((d) => d.id === id));

  // 다른 필드 패치가 status를 덮지 않는다 (coalesce 부분 패치)
  await updateDraft(sql, id, { dismissedFlags: ['yakkiho:効果がある'] });
  assert.equal((await getDraft(sql, id))!.status, 'review');

  // DB CHECK — 유효하지 않은 상태는 거부
  await assert.rejects(sql`update draft set status = 'bogus' where id = ${id}`);

  await removeDraft(sql, id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: FAIL — `listDrafts`가 `status` 옵션을 모르고, `DraftRow.status`가 없음 (타입 에러 또는 undefined)

- [ ] **Step 3: 구현**

`src/lib/draftStore.ts`에서:

import 추가:

```ts
import type { DraftStatus } from './draftStatus.ts';
```

`DraftRow`에 필드 추가 (`dismissedFlags` 행 아래):

```ts
  dismissedFlags: string[];
  status: DraftStatus; // 결정 진행도 라벨 — 전이 제약 없음 (스펙 §2)
```

`Row` 타입에 추가 (`dismissed_flags` 행 아래):

```ts
  dismissed_flags: string[];
  status: DraftStatus;
```

`toRow`에 추가 (`dismissedFlags` 매핑 아래):

```ts
  dismissedFlags: r.dismissed_flags,
  status: r.status,
```

`SELECT`의 컬럼 목록에 `d.status` 추가:

```ts
const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.dismissed_flags, d.status, d.model, d.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by`;
```

`listDrafts`를 두 필터 조합형으로 교체 (`where true` + and 절 — 3단 관리 표면도 같은 시그니처를 쓴다):

```ts
export async function listDrafts(
  sql: postgres.Sql, opts: { clientId?: string; status?: DraftStatus; limit?: number } = {},
): Promise<DraftRow[]> {
  const byClient = opts.clientId ? sql`and d.client_id = ${opts.clientId}` : sql``;
  const byStatus = opts.status ? sql`and d.status = ${opts.status}` : sql``;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where true ${byClient} ${byStatus}
    order by d.created_at desc
    limit ${opts.limit ?? 50}`;
  return rows.map(toRow);
}
```

`updateDraft`의 patch 타입과 set 절에 status 추가 (status는 null로 되돌릴 일이 없어 coalesce 패턴이 안전):

```ts
export async function updateDraft(
  sql: postgres.Sql, id: string,
  patch: { edited?: DraftContent; dismissedFlags?: string[]; history?: DraftContent[];
           translation?: DraftTranslation; status?: DraftStatus },
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags),
      history = coalesce(${patch.history ? sql.json(patch.history as never) : null}, history),
      translation = coalesce(${patch.translation ? sql.json(patch.translation as never) : null}, translation),
      status = coalesce(${patch.status ?? null}, status)
    where id = ${id}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts`
Expected: PASS (기존 왕복 테스트 포함 전부)

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftStore.ts src/lib/draftStore.test.ts
git commit -m "feat(x-deck): draftStore status 관통 — DraftRow.status·listDrafts 상태 필터·updateDraft 부분 패치 (TDD)"
```

### Task 9: API — PATCH 상태 검증 + GET ?status=

**Files:**
- Modify: `src/app/api/drafts/[id]/route.ts`
- Modify: `src/app/api/drafts/route.ts:8-13`

**Interfaces:**
- Consumes: `isDraftStatus`, `DraftStatus` (Task 7) · `listDrafts { status }` (Task 8)
- Produces: `PATCH /api/drafts/[id]` body `{ status?: DraftStatus }` 수용(enum 불일치 400) · `GET /api/drafts?status=` — Task 10~11의 UI가 호출

- [ ] **Step 1: PATCH 검증 추가**

`src/app/api/drafts/[id]/route.ts`에서:

import 추가:

```ts
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';
```

`PATCH`의 body 타입과 검증 교체 (기존 20~33행):

```ts
  const body = (await req.json().catch(() => ({}))) as
    { edited?: DraftContent; dismissedFlags?: string[]; status?: string };
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  if (body.edited !== undefined) {
    const posts = (body.edited as { posts?: unknown })?.posts;
    if (!Array.isArray(posts) || posts.length === 0 ||
        posts.some((p) => typeof (p as { text?: unknown })?.text !== 'string')) {
      return NextResponse.json({ error: '편집 내용 형식이 올바르지 않아요' }, { status: 400 });
    }
    body.edited = {
      posts: (posts as Array<{ text: string; media?: unknown }>).map((p) => ({
        text: p.text, media: Array.isArray(p.media) ? p.media : [],
      })),
    } as DraftContent;
  }
  await updateDraft(getSql(), id,
    body as { edited?: DraftContent; dismissedFlags?: string[]; status?: DraftStatus });
```

- [ ] **Step 2: GET 필터 추가**

`src/app/api/drafts/route.ts`의 `GET`을 교체:

```ts
import { isDraftStatus } from '@/lib/draftStatus';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId') ?? undefined;
  const status = params.get('status');
  if (status !== null && !isDraftStatus(status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  return NextResponse.json(await listDrafts(getSql(), { clientId, status: status ?? undefined }));
}
```

(이번 UI는 클라이언트 사이드 필터를 쓰므로 `?status=`는 3단 대비 정합성용 — 스펙 §2)

- [ ] **Step 3: 린트 + 타입 확인**

Run: `npm run lint 2>&1 | tail -5` 그리고 `npx tsc --noEmit 2>&1 | tail -5`
Expected: 새 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/api/drafts/[id]/route.ts src/app/api/drafts/route.ts
git commit -m "feat(x-deck): 초안 API status — PATCH enum 검증(불일치 400) + GET ?status= 필터"
```

### Task 10: 상태 칩 — DraftCard 도구층

**Files:**
- Create: `src/components/DraftStatusChip.tsx`
- Modify: `src/components/DraftCard.tsx`
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `DRAFT_STATUSES`, `STATUS_LABEL`, `DraftStatus` (Task 7) · `PATCH { status }` (Task 9) · `DraftRow.status` (Task 8)
- Produces: `DraftStatusChip({ status, onChange })` · `DraftCard` props에 `onChangeStatus: (s: DraftStatus) => void` 추가

- [ ] **Step 1: DraftStatusChip 컴포넌트**

`src/components/DraftStatusChip.tsx`:

```tsx
'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';

// 도구층 톤의 은은한 칩 (스펙 3-2) — 색은 여기(UI)에만, 키·라벨은 lib에
const STATUS_STYLE: Record<DraftStatus, string> = {
  draft: 'bg-x-border/60 text-x-secondary',
  review: 'bg-amber-100 text-amber-800',
  approved: 'bg-x-blue/10 text-x-blue-text',
  delivered: 'bg-green-100 text-green-800',
  unused: 'bg-x-surface text-x-muted',
};

// 칩처럼 보이는 select — 클릭 시 5개 상태 중 선택, 즉시 저장은 부모 몫
export function DraftStatusChip({ status, onChange }: {
  status: DraftStatus; onChange: (s: DraftStatus) => void;
}) {
  return (
    <label className={`relative inline-flex cursor-pointer items-center rounded-full px-2.5 py-0.5 text-caption font-bold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]} <span aria-hidden className="ml-0.5">⌄</span>
      <select value={status} onChange={(e) => onChange(e.target.value as DraftStatus)}
              aria-label="초안 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
        {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: DraftCard 통합**

`src/components/DraftCard.tsx`에서:

import 추가:

```tsx
import { DraftStatusChip } from '@/components/DraftStatusChip';
import type { DraftStatus } from '@/lib/draftStatus';
```

props에 `onChangeStatus` 추가 (구조 분해와 타입 둘 다):

```tsx
export function DraftCard({ draft, banned, onEdit, onRewrite, rewriteBusy, onDelete, onRegenPost, regenBusyIndex, onDismissFlag, onRestoreAllFlags, onChangeStatus }: {
  draft: DraftRow; banned: string[];
  onEdit: () => void; onRewrite: (feedback: string, baseIndex: number) => void; rewriteBusy: boolean;
  onDelete: () => void; onRegenPost: (index: number) => void; regenBusyIndex: number | null;
  onDismissFlag: (key: string, dismiss: boolean) => void;
  onRestoreAllFlags: () => void;
  onChangeStatus: (s: DraftStatus) => void;
}) {
```

도구층(회색 밴드) 최상단 — `{active.map(…)}` 바로 위에 칩 행 추가 (X 콘텐츠층은 건드리지 않음, 스펙 3-2):

```tsx
      <div className="border-t border-x-border bg-x-surface px-4 py-2.5">
        <div className="flex items-center pb-1">
          <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
        </div>
        {active.map((f) => (
```

- [ ] **Step 3: page에서 낙관적 갱신으로 연결**

`src/app/generate/page.tsx`에서:

import 추가:

```tsx
import type { DraftStatus } from '@/lib/draftStatus';
```

`restoreAllFlags` 아래에 핸들러 추가 (실패 시 롤백은 `patchDraft`의 null 반환 활용, 스펙 §4):

```tsx
  function changeStatus(d: DraftRow, status: DraftStatus) {
    const prev = d.status;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, status } : x)));
    void patchDraft(d.id, { status }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, status: prev } : x)));
    });
  }
```

`<DraftCard …>` 호출에 prop 추가:

```tsx
                   onRestoreAllFlags={() => restoreAllFlags(d)}
                   onChangeStatus={(s) => changeStatus(d, s)} />
```

- [ ] **Step 4: 린트 + 수동 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

수동 확인: 새 초안 카드 도구층에 `초안` 칩 → 클릭해 `검수 대기` 선택 → 즉시 반영, 새로고침 후에도 유지.

- [ ] **Step 5: Commit**

```bash
git add src/components/DraftStatusChip.tsx src/components/DraftCard.tsx src/app/generate/page.tsx
git commit -m "feat(x-deck): 초안 상태 칩 — 카드 도구층에서 5상태 즉시 변경(낙관적 갱신·실패 롤백)"
```

### Task 11: 상태 탭 + 클라이언트 필터 — /generate

**Files:**
- Create: `src/components/DraftFilterBar.tsx`
- Modify: `src/lib/draftUi.ts`
- Modify: `src/app/generate/page.tsx`
- Test: `src/lib/draftUi.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `DRAFT_STATUSES`, `STATUS_LABEL`, `DraftStatus` (Task 7) · `DraftRow.status` (Task 8)
- Produces: `DraftListFilter { status: DraftStatus | 'all'; clientId: string }` · `filterDrafts(drafts, f)` · `statusCounts(drafts)` · `DraftFilterBar` 컴포넌트

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/draftUi.test.ts` 끝에 추가 (import에 `filterDrafts, statusCounts` 추가):

```ts
test('filterDrafts — 상태·클라이언트 AND 조합', () => {
  const drafts = [
    { status: 'draft' as const, clientId: 'c1' },
    { status: 'review' as const, clientId: 'c1' },
    { status: 'review' as const, clientId: null },
  ];
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '' }).length, 3);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: '' }).length, 2);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: 'c1' }).length, 1);
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: 'none' }).length, 1); // 클라이언트 없음
});

test('statusCounts — 상태별 건수', () => {
  const counts = statusCounts([
    { status: 'draft' }, { status: 'draft' }, { status: 'delivered' },
  ]);
  assert.equal(counts.draft, 2);
  assert.equal(counts.delivered, 1);
  assert.equal(counts.review, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: FAIL — export 없음

- [ ] **Step 3: 헬퍼 구현**

`src/lib/draftUi.ts`에 추가 (import에 `import type { DraftStatus } from './draftStatus.ts';` 추가):

```ts
// /generate 목록 필터 (스펙 3-1) — clientId: '' 전체 · 'none' 클라이언트 없음 · 그 외 해당 id
export interface DraftListFilter { status: DraftStatus | 'all'; clientId: string }

export function filterDrafts<T extends { status: DraftStatus; clientId: string | null }>(
  drafts: T[], f: DraftListFilter,
): T[] {
  return drafts.filter((d) =>
    (f.status === 'all' || d.status === f.status) &&
    (f.clientId === '' || (f.clientId === 'none' ? d.clientId === null : d.clientId === f.clientId)));
}

export function statusCounts(drafts: Array<{ status: DraftStatus }>): Record<DraftStatus, number> {
  const out: Record<DraftStatus, number> = { draft: 0, review: 0, approved: 0, delivered: 0, unused: 0 };
  for (const d of drafts) out[d.status] += 1;
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: PASS 전부

- [ ] **Step 5: DraftFilterBar 컴포넌트**

`src/components/DraftFilterBar.tsx`:

```tsx
'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftListFilter } from '@/lib/draftUi';

// 상태 탭 + 클라이언트 필터 (스펙 3-1) — 작업 세션용 렌즈라 저장하지 않는다
export function DraftFilterBar({ counts, total, filter, clients, onChange }: {
  counts: Record<DraftStatus, number>; total: number;
  filter: DraftListFilter; clients: Array<{ id: string; name: string }>;
  onChange: (f: DraftListFilter) => void;
}) {
  const tab = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;
  return (
    <div className="flex w-full max-w-[600px] flex-wrap items-center gap-1.5 text-[13px]">
      <button onClick={() => onChange({ ...filter, status: 'all' })} className={tab(filter.status === 'all')}>
        전체 {total}
      </button>
      {DRAFT_STATUSES.map((s) => (
        <button key={s} onClick={() => onChange({ ...filter, status: filter.status === s ? 'all' : s })}
                className={tab(filter.status === s)}>
          {STATUS_LABEL[s]} {counts[s]}
        </button>
      ))}
      <select value={filter.clientId} onChange={(e) => onChange({ ...filter, clientId: e.target.value })}
              aria-label="클라이언트로 거르기"
              className="ml-auto rounded-md border border-x-border-strong bg-white px-2 py-1 text-caption outline-none focus:border-x-blue">
        <option value="">모든 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">클라이언트 없음</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 6: page 통합**

`src/app/generate/page.tsx`에서:

import 추가:

```tsx
import { DraftFilterBar } from '@/components/DraftFilterBar';
import { newDraftsSince, filterDrafts, statusCounts, type DraftListFilter } from '@/lib/draftUi';
```

(Task 6에서 추가한 `newDraftsSince` import와 합친다)

상태 추가 (`pickerOpen` 선언 근처):

```tsx
  const [filter, setFilter] = useState<DraftListFilter>({ status: 'all', clientId: '' });
```

파생값 — `selectedRefIds` 선언 근처에 추가. 탭 건수는 클라이언트 필터를 반영한 모수로 계산해 라벨-값이 항상 일치하게 한다:

```tsx
  const clientScoped = useMemo(
    () => filterDrafts(drafts, { status: 'all', clientId: filter.clientId }), [drafts, filter.clientId]);
  const visibleDrafts = useMemo(
    () => filterDrafts(clientScoped, { status: filter.status, clientId: '' }), [clientScoped, filter.status]);
  const counts = useMemo(() => statusCounts(clientScoped), [clientScoped]);
```

렌더 — 컴포저와 스켈레톤 사이에 필터 바 삽입 (초안 1건 이상일 때만, 스펙 3-1):

```tsx
      {loaded && drafts.length > 0 && (
        <DraftFilterBar counts={counts} total={clientScoped.length} filter={filter}
                        clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                        onChange={setFilter} />
      )}
```

목록 렌더를 `drafts.map` → `visibleDrafts.map`으로 교체하고, 필터로 비어 보일 때의 안내를 기존 빈 상태 아래에 추가:

```tsx
      {loaded && drafts.length > 0 && visibleDrafts.length === 0 && !generating && (
        <p className="w-full max-w-[600px] rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
          이 조건에 맞는 초안이 없어요 — 탭이나 클라이언트 필터를 바꿔보세요.
        </p>
      )}

      {visibleDrafts.map((d) => (
```

- [ ] **Step 7: 린트 + 수동 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 새 에러/경고 없음

수동 확인: ① 탭 건수 합 = 전체 ② `검수 대기` 탭 클릭 → 해당 상태만 표시, 재클릭 → 전체 ③ 클라이언트 선택 시 탭 건수도 함께 줄어듦(라벨-값 일치) ④ 초안 0건이면 필터 바 자체가 안 보임.

- [ ] **Step 8: Commit**

```bash
git add src/components/DraftFilterBar.tsx src/lib/draftUi.ts src/lib/draftUi.test.ts src/app/generate/page.tsx
git commit -m "feat(x-deck): /generate 상태 탭·클라이언트 필터 — 검수 대기 탭이 담당자 일감함 (filterDrafts·statusCounts TDD)"
```

### Task 12: README 현행화 + 전체 검증

**Files:**
- Modify: `README.md` (§콘텐츠 생성, §스키마)

**Interfaces:**
- Consumes: Task 1~11 전부
- Produces: 없음 (문서·검증)

- [ ] **Step 1: README 갱신**

`README.md`의 "콘텐츠 생성 (원고)" 섹션(31~41행 부근)에 다음 내용을 기존 문체에 맞춰 반영:

- 상태 축: "초안마다 상태(초안 → 검수 대기 → 사용 확정 → 전달됨 / 미사용)를 카드에서 바로 바꾸고, 상태 탭·클라이언트 필터로 걸러 볼 수 있다 — 전이 제약 없음(자유 라벨)"
- 유실 방지: "편집 모달·레퍼런스 시트는 저장/적용 안 한 변경이 있으면 닫기 전에 확인한다"
- 취소 후 자동 반영: "생성 취소는 기다리기만 중단 — 완성되면 목록에 자동으로 나타난다"
- 스키마 한 줄(82행 부근)의 draft 컬럼 나열에 `status` 추가
- 비용 섹션(69~75행 부근)의 버튼 문구 언급이 있으면 캡션 방식으로 갱신

- [ ] **Step 2: 전체 테스트 (실 DB, 약 4분)**

Run: `npm test 2>&1 | tail -15`
Expected: 전부 PASS (fail 0)

- [ ] **Step 3: 린트 기준선 확인**

Run: `npm run lint 2>&1 | tail -5`
Expected: 기준선 24개 그대로 — 새 항목 없음

- [ ] **Step 4: 빌드 확인**

Run: `npm run build 2>&1 | tail -10`
Expected: 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(x-deck): README 현행화 — 초안 상태 축·필터·유실 방지·취소 후 자동 반영"
```

---

## 배포 메모 (플랜 범위 밖 — 사용자와 함께)

- 1단(Task 1~6)은 스키마 무관이라 먼저 배포 가능. 2단(Task 7~11)은 **프로덕션 DB에 마이그레이션 016을 먼저 적용**한 뒤 배포한다(015 때와 같은 절차 — 메모리: cb-x-deck-deploy, cb-x-deck-db-pool-exhaustion-fix의 PGPORT 6543 주의).
- 화면 확인은 OAuth 게이팅으로 사용자만 가능(메모리: cb-x-deck-verification-loop) — 수동 확인 단계는 사용자 QA로 대체될 수 있다.
