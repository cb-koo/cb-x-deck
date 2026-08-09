# 표시 정확성 묶음 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용량 페이지를 전역 `/usage`로 옮기고, 삭제된/잘못된 wsId 딥링크에 정직한 안내를 보여주고, 태그 목록 API의 0건 태그를 제거한다.

**Architecture:** Next.js App Router. 세 항목은 파일이 완전히 분리돼 있어(T1~T4 상호 배타적 파일 집합) 병렬 구현 가능. UI 하네스가 없으므로 스토어/유틸만 TDD, 화면은 tsc·eslint 검증.

**Tech Stack:** Next.js 15 App Router, postgres.js, Tailwind v4, node:test(실 DB).

**Spec:** `docs/superpowers/specs/2026-08-09-display-accuracy-design.md` — 작업 전 반드시 읽을 것.

## Global Constraints

- 모든 API 라우트는 `requireAllowedUser()` 게이트 유지.
- UI 텍스트 전부 한국어. 색·타이포는 기존 `x-*` 토큰과 role 토큰(text-content/ui/caption)만.
- `react-hooks/set-state-in-effect`는 이 저장소에서 error다 — 이펙트(및 이펙트가 부르는 콜백)의 **동기** setState 금지. "실패 상태 해제"는 재시도 버튼 onClick에서 한다 (src/app/page.tsx 선례).
- 테스트: 실 DB. 단일 파일 `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>`. 전체 `npm test`(~5분)는 마지막 태스크만.
- lint 기준선 25개(2026-08-09 측정) — 신규 항목 0. 내 파일은 `npx eslint <경로>`로 0 확인.
- 커밋 메시지 한국어 + 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- import 확장자: `src/lib` 내부 상호 import는 `./uuid.ts`처럼 `.ts` 확장자 포함(기존 관례), 앱 코드는 `@/lib/...` 별칭.

---

### Task 1: UUID 공용 가드 + `/api/columns` 400

**Files:**
- Create: `src/lib/uuid.ts`
- Create: `src/lib/uuid.test.ts`
- Modify: `src/lib/tweetStore.ts:48-51` (로컬 정의 제거 → import)
- Modify: `src/app/api/columns/route.ts:11-13` (GET 가드)

**Interfaces:**
- Produces: `isUuidLike(id: string): boolean`, `UUID_RE` — `src/lib/uuid.ts` export. 다른 태스크는 소비하지 않는다(독립).

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/uuid.test.ts` 생성:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuidLike } from './uuid.ts';

test('isUuidLike: UUID 형식 판별', () => {
  assert.equal(isUuidLike('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(isUuidLike('123E4567-E89B-12D3-A456-426614174000'), true); // 대소문자 무관
  assert.equal(isUuidLike('abc'), false);
  assert.equal(isUuidLike(''), false);
  assert.equal(isUuidLike('123e4567-e89b-12d3-a456-42661417400g'), false); // g는 hex 아님
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/uuid.test.ts`
Expected: FAIL — `Cannot find module './uuid.ts'`

- [ ] **Step 3: 모듈 생성** — `src/lib/uuid.ts`:

```ts
// UUID 형식 가드 — 형식이 아니면 DB까지 가기 전에 끊는다 (postgres 22P02 → 500 방지).
// tweetStore의 파일-로컬 정의를 공용으로 승격한 것.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(id: string): boolean {
  return UUID_RE.test(id);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/uuid.test.ts`
Expected: PASS

- [ ] **Step 5: tweetStore 교체** — `src/lib/tweetStore.ts`의 48-51줄(아래 원문)을 삭제하고, 파일 상단 import 블록에 `import { isUuidLike } from './uuid.ts';` 추가:

삭제할 원문:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidLike(id: string): boolean {
  return UUID_RE.test(id);
}
```

- [ ] **Step 6: tweetStore 회귀 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: 전부 PASS (기존 테스트가 가드 동작을 커버)

- [ ] **Step 7: /api/columns GET 가드** — `src/app/api/columns/route.ts` GET에서 기존 null 검사 아래에 추가 (import에 `import { isUuidLike } from '@/lib/uuid';` 추가):

```ts
  if (!isUuidLike(workspaceId)) return NextResponse.json({ error: 'workspaceId 형식이 올바르지 않습니다' }, { status: 400 });
```

(현재는 non-UUID가 postgres 22P02로 내려가 500이 났다.)

- [ ] **Step 8: 검증 후 Commit**

Run: `npx tsc --noEmit && npx eslint src/lib/uuid.ts src/lib/uuid.test.ts src/lib/tweetStore.ts src/app/api/columns/route.ts`
Expected: 에러 0

```bash
git add src/lib/uuid.ts src/lib/uuid.test.ts src/lib/tweetStore.ts src/app/api/columns/route.ts
git commit -m "fix(api): UUID 가드 공용 승격 + /api/columns non-UUID 400 (22P02 500 방지)"
```

---

### Task 2: 태그 목록 0건 제거

**Files:**
- Modify: `src/lib/candidateStore.ts:119-128` (`listAllTags`)
- Test: `src/lib/candidateStore.test.ts`

**Interfaces:**
- Produces: `listAllTags` 시그니처·반환 형태 불변 — 0건 태그만 결과에서 빠진다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/candidateStore.test.ts` 파일 끝에 추가 (import에 `createWorkspace`, `deleteWorkspace`가 없으면 `./workspaceStore.ts`에서 추가):

```ts
test('listAllTags: 그 워크스페이스에서 쓰인 태그만 반환한다(0건 미노출)', async () => {
  // 이 파일 앞 테스트가 다른 워크스페이스에 태그를 만들어 둔 상태다(같은 파일 = 순차 실행).
  // 후보가 하나도 없는 새 워크스페이스의 태그 목록은 비어 있어야 한다.
  const wsEmpty = await createWorkspace(sql, P + 'ws-tag-empty');
  const tags = await listAllTags(sql, wsEmpty.id);
  assert.equal(tags.length, 0, `0건 태그가 노출됨: ${tags.map((t) => t.name).join(',')}`);
  await deleteWorkspace(sql, wsEmpty.id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/candidateStore.test.ts`
Expected: 새 테스트 FAIL — 전역 태그들이 count 0으로 반환됨

- [ ] **Step 3: 쿼리 수정** — `candidateStore.ts`의 `listAllTags`에서 `group by tg.id` 뒤에 having 추가:

```ts
    group by tg.id
    having count(distinct c.tweet_id) > 0
    order by tg.name
```

(워크스페이스 조건이 left join ON절에만 있어 타 워크스페이스 전용 태그가 0건으로 전부 반환되던 결손 — inner 의미로 좁힌다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/candidateStore.test.ts`
Expected: 전부 PASS (기존 count=1 검증 테스트 포함)

- [ ] **Step 5: 검증 후 Commit**

Run: `npx eslint src/lib/candidateStore.ts src/lib/candidateStore.test.ts`
Expected: 0

```bash
git add src/lib/candidateStore.ts src/lib/candidateStore.test.ts
git commit -m "fix(tags): 타 워크스페이스 전용 태그가 0건으로 노출되던 것 제거"
```

---

### Task 3: 사용량 페이지 전역 `/usage` 이전

**Files:**
- Move: `src/app/w/[wsId]/usage/{UsageHeadline,ActualCostPanel,FeatureBreakdown,UsageBar,UsageDetailTables}.tsx` → `src/app/usage/`
- Create: `src/app/usage/page.tsx` (기존 page.tsx 기반), `src/app/usage/layout.tsx`
- Modify: `src/app/w/[wsId]/usage/page.tsx` (redirect 스텁으로 교체)
- Modify: `src/components/Sidebar.tsx:65-68` (링크)

**Interfaces:**
- Consumes: `GlobalShell` (기존), usage 컴포넌트 5개(상대 import 그대로).
- Produces: 라우트 `/usage` (+ `?period=7d|30d|month`). 옛 `/w/{wsId}/usage`는 `/usage`로 redirect.

- [ ] **Step 1: 컴포넌트 5개 이동**

```bash
mkdir -p src/app/usage
git mv "src/app/w/[wsId]/usage/UsageHeadline.tsx" "src/app/w/[wsId]/usage/ActualCostPanel.tsx" "src/app/w/[wsId]/usage/FeatureBreakdown.tsx" "src/app/w/[wsId]/usage/UsageBar.tsx" "src/app/w/[wsId]/usage/UsageDetailTables.tsx" src/app/usage/
```

- [ ] **Step 2: 새 page 생성** — 기존 `src/app/w/[wsId]/usage/page.tsx` 내용을 `src/app/usage/page.tsx`로 옮기되 다음 4가지만 변경:

1. props에서 `params` 제거 — 시그니처를 `{ searchParams }: { searchParams: Promise<{ period?: string }> }`로, 본문의 `const { wsId } = await params;` 삭제.
2. 기간 탭 링크: `` href={`/usage?period=${p}`} ``
3. 루트 div: `className="h-screen overflow-y-auto p-8"` → `className="p-8"` — GlobalShell 래퍼가 이미 `overflow-y-auto`라 이중 스크롤이 된다.
4. 헤더 캡션(기존 "추정치(기록 × 기준 단가)와…" 문장) 앞에 합산 안내를 붙인다:

```tsx
          <p className="mt-1 text-caption text-x-muted">모든 워크스페이스 합산 수치예요. 추정치(기록 × 기준 단가)와 제공사 실제 청구를 함께 보여줍니다. 실제와 다를 수 있어요.</p>
```

- [ ] **Step 3: 레이아웃 생성** — `src/app/usage/layout.tsx` (clients/layout.tsx와 동일 패턴):

```tsx
import { GlobalShell } from '@/components/GlobalShell';

export default function UsageLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
```

- [ ] **Step 4: 옛 URL redirect 스텁** — `src/app/w/[wsId]/usage/page.tsx` 전체를 다음으로 교체:

```tsx
import { redirect } from 'next/navigation';

// 사용량은 워크스페이스별 데이터가 아니다(전역 합산) — /usage로 이전됨 (표시 정확성 스펙 §A).
// 북마크·습관으로 남은 옛 주소를 새 위치로 보낸다.
export default function OldUsageRedirect() {
  redirect('/usage');
}
```

- [ ] **Step 5: 사이드바 링크** — `src/components/Sidebar.tsx`의 API 사용량 블록(65-68줄)을:

```tsx
        <a href="/usage"
           className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/usage' ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </a>
```

- [ ] **Step 6: 검증 후 Commit**

Run: `npx tsc --noEmit && npx eslint src/app/usage/ "src/app/w/[wsId]/usage/" src/components/Sidebar.tsx && npm run build 2>&1 | grep -E "usage|Error"`
Expected: tsc·eslint 0, 빌드 출력에 `/usage`(정적 또는 동적)와 `/w/[wsId]/usage` 둘 다 존재

```bash
git add -A src/app/usage "src/app/w/[wsId]/usage" src/components/Sidebar.tsx
git commit -m "fix(usage): 사용량 페이지를 전역 /usage로 — 워크스페이스별 수치로 오독되던 위치 정정"
```

(참고: 이 태스크만 이동이 있어 `git add -A`를 해당 경로 3곳에 한정해 쓴다.)

---

### Task 4: 삭제된/잘못된 wsId 게이트 + GlobalShell 복원 검증

**Files:**
- Modify: `src/app/w/[wsId]/layout.tsx` (전체 교체)
- Modify: `src/components/GlobalShell.tsx:14-19`

**Interfaces:**
- Consumes: `GET /api/workspaces` → `Workspace[]`, `LAST_WS_KEY`, 이벤트 `'cbx-workspaces-changed'`(워크스페이스 변이 시 /workspaces 페이지가 발화 — 기존).
- Produces: 없음 (동작 변경만).

- [ ] **Step 1: layout 전체 교체** — `src/app/w/[wsId]/layout.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { MemberProvider } from '@/lib/memberContext';
import { ToastProvider } from '@/lib/toastContext';
import { Sidebar } from '@/components/Sidebar';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { Workspace } from '@/lib/types';

// wsId를 워크스페이스 목록과 대조한다. 삭제된/잘못된 링크가 "컬럼이 없습니다" 같은
// 정상 빈 화면으로 위장되고 사이드바가 엉뚱한 이름을 보여주던 것을 막는다 (표시 정확성 스펙 §B-1).
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  const [known, setKnown] = useState<Set<string> | null>(null); // null = 첫 목록 로딩 전
  const [failed, setFailed] = useState(false);
  // wsId가 목록에 없을 때 낡은 목록일 수 있어(다른 탭에서 방금 생성) 한 번 재조회한다.
  // 재조회 후에도 없으면 그때 '없음'으로 확정 — wsId별로 1회만.
  const confirmedMissingRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/workspaces');
      if (!r.ok) throw new Error(String(r.status));
      const ws = (await r.json()) as Workspace[];
      setKnown(new Set(ws.map((w) => w.id)));
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // 관리 페이지의 생성·삭제와 같은 채널로 목록 갱신 (Sidebar와 동일 이벤트)
  useEffect(() => {
    const h = () => { load(); };
    window.addEventListener('cbx-workspaces-changed', h);
    return () => window.removeEventListener('cbx-workspaces-changed', h);
  }, [load]);

  const exists = known ? known.has(wsId) : null;

  useEffect(() => {
    if (exists === true) {
      localStorage.setItem(LAST_WS_KEY, wsId); // 검증 통과 후에만 저장 (죽은 id 저장 방지)
    } else if (exists === false) {
      if (confirmedMissingRef.current !== wsId) {
        confirmedMissingRef.current = wsId;
        load(); // 낡은 목록 재확인 — 결과가 같으면 아래 렌더가 '없음'으로 확정
      }
      if (localStorage.getItem(LAST_WS_KEY) === wsId) localStorage.removeItem(LAST_WS_KEY);
    }
  }, [exists, wsId, load]);

  if (failed && !known) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-ui text-x-secondary">워크스페이스 정보를 불러오지 못했습니다.</p>
        <button onClick={() => { setFailed(false); load(); }}
                className="rounded-full border border-x-border-strong px-4 py-1.5 text-ui hover:bg-x-hover">다시 시도</button>
      </div>
    );
  }
  if (!known) return <p className="p-8 text-sm text-x-muted">워크스페이스 확인 중…</p>;
  if (exists === false) {
    // 재확인 중이면 잠깐 '확인 중'을 유지 (방금 만든 워크스페이스 오탐 방지)
    if (confirmedMissingRef.current !== wsId) return <p className="p-8 text-sm text-x-muted">워크스페이스 확인 중…</p>;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-content font-bold">이 워크스페이스를 찾을 수 없습니다</p>
        <p className="text-ui text-x-secondary">삭제됐을 수 있어요. 워크스페이스 목록에서 다시 선택해 주세요.</p>
        <a href="/workspaces"
           className="rounded-full bg-x-blue px-4 py-1.5 text-ui font-medium text-white hover:bg-x-blue-hover">
          워크스페이스 목록으로
        </a>
      </div>
    );
  }

  return (
    <MemberProvider>
      <ToastProvider>
        <div className="flex h-screen">
          <Sidebar wsId={wsId} />
          <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </ToastProvider>
    </MemberProvider>
  );
}
```

재확인 로직: `confirmedMissingRef.current !== wsId`인 동안(이펙트가 아직 안 돌았거나 재조회 중) '확인 중'을 유지하고, 재조회 결과가 반영된 뒤에도 없으면 안내 화면.

- [ ] **Step 2: GlobalShell 복원 검증** — `src/components/GlobalShell.tsx`의 useEffect(14-19줄)를 교체:

```tsx
  useEffect(() => {
    // 저장값을 무검증으로 쓰면 삭제된 워크스페이스의 죽은 사이드바가 그려진다 —
    // 루트(/)와 동일하게 목록 대조 후 폴백 (표시 정확성 스펙 §B-2)
    (async () => {
      try {
        const r = await apiFetch('/api/workspaces');
        if (!r.ok) return; // 사이드바만 생략 — 페이지 콘텐츠는 그대로
        const ws = (await r.json()) as Workspace[];
        const saved = localStorage.getItem(LAST_WS_KEY);
        const target = ws.find((w) => w.id === saved) ?? ws[0];
        if (target) {
          setWsId(target.id);
          localStorage.setItem(LAST_WS_KEY, target.id);
        }
      } catch { /* 사이드바만 생략 */ }
    })();
  }, []);
```

- [ ] **Step 3: 검증 후 Commit**

Run: `npx tsc --noEmit && npx eslint "src/app/w/[wsId]/layout.tsx" src/components/GlobalShell.tsx`
Expected: 0 (setState는 전부 await/catch 뒤 — set-state-in-effect 비해당. 걸리면 기존 관례의 suppress+사유 주석)

```bash
git add "src/app/w/[wsId]/layout.tsx" src/components/GlobalShell.tsx
git commit -m "fix(ws): 삭제된 wsId 딥링크에 정직한 안내 + GlobalShell 복원 목록 대조"
```

---

### Task 5: 전체 검증 + 최종 리뷰 (컨트롤러 수행)

- [ ] `npm test` 전부 PASS (~5분, 실 DB)
- [ ] `npm run build` 성공 — `/usage` 라우트 존재 확인
- [ ] `npm run lint` 25개(기준선) 유지
- [ ] 전체 브랜치 최종 리뷰(최상위 모델) — 태스크 리뷰 이월 Minor triage 포함
