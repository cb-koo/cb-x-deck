# 워크스페이스 관리 페이지 (`/workspaces`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크스페이스를 한눈에 보고 선택·관리(생성·이름 변경·삭제·순서 변경)하는 전용 페이지를 신설하고, 사이드바를 전환 전용으로 정리하며, `/` 진입을 마지막 방문 워크스페이스 복귀로 고친다.

**Architecture:** Next.js App Router. 새 페이지 `/workspaces`는 `/clients`와 같은 GlobalShell 셸을 쓴다. 스토어 함수(`workspaceStore.ts`) → API 라우트(`/api/workspaces/*`) → 클라이언트 페이지 순으로 쌓는다. 순서 변경은 기존 컬럼 reorder(`reorderColumns`)와 동일한 트랜잭션+집합검증 패턴.

**Tech Stack:** Next.js 15 App Router, postgres.js, Tailwind v4(@theme 토큰), node:test(실 DB).

**Spec:** `docs/superpowers/specs/2026-08-09-workspaces-page-design.md` — 작업 전 반드시 읽을 것.

## Global Constraints

- 모든 API 라우트는 `requireAllowedUser()` 게이트를 통과해야 한다 (기존 라우트와 동일).
- UI 텍스트는 전부 한국어, AGENTS.md UX 원칙 준수. "저장 후보"라는 용어와 수치는 카드 메타와 삭제 모달에서 동일해야 한다 (원칙 4).
- 타이포는 기존 role 토큰만: `text-content`(15px)/`text-ui`(13px)/`text-caption`(11px), 제목 20px bold. 색은 `x-*` 토큰만. 버튼은 `Button` 컴포넌트(ui.tsx) 사용.
- placeholder "클라이언트명" 금지 — 워크스페이스 ≠ 클라이언트. 새 문구는 "새 워크스페이스 이름".
- 마이그레이션은 재실행 안전(idempotent)해야 한다 (기존 001~017과 동일 관례).
- 테스트: 실 DB 사용. 단일 파일 실행 `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts` (수 초). 전체 `npm test`는 약 4분이므로 마지막 태스크에서만.
- 커밋 메시지는 한국어 관례(`feat(workspaces): …`, `fix(...): …`) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- UI(페이지·사이드바)는 테스트 하네스가 없다 — `npm run lint`와 `npx tsc --noEmit`으로 검증하고, 화면 확인은 배포 후 사용자 절차(기존 관례).

---

### Task 1: position backfill 마이그레이션 + 생성 시 position 부여

**Files:**
- Create: `migrations/018_workspace_position.sql`
- Modify: `src/lib/workspaceStore.ts:10-14` (`createWorkspace`)
- Test: `src/lib/workspaceStore.test.ts`

**Interfaces:**
- Produces: `createWorkspace(sql, name)` — 반환 타입 변화 없음(`Workspace`), 이제 position이 `max+1`로 저장됨. `listWorkspaces` 정렬(`order by position, created_at`)은 기존 그대로.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/workspaceStore.test.ts`의 `workspace CRUD` 테스트 아래에 추가:

```ts
test('createWorkspace: 새 워크스페이스는 목록 맨 뒤 position을 받는다', async () => {
  const a = await createWorkspace(sql, T + '-pos-a');
  const b = await createWorkspace(sql, T + '-pos-b');
  assert.ok(b.position > a.position, `b(${b.position})는 a(${a.position})보다 뒤여야 한다`);
  const all = await listWorkspaces(sql);
  const ia = all.findIndex((w) => w.id === a.id);
  const ib = all.findIndex((w) => w.id === b.id);
  assert.ok(ib > ia);
  await deleteWorkspace(sql, a.id);
  await deleteWorkspace(sql, b.id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: 새 테스트 FAIL (`b.position`이 0으로 같음 — 현재 insert가 position을 안 넣는다)

- [ ] **Step 3: 마이그레이션 + createWorkspace 수정**

`migrations/018_workspace_position.sql` 생성:

```sql
-- 워크스페이스 순서: 지금까지 position이 전부 0(미사용)이었다 → 생성순으로 1회 backfill.
-- 재실행 안전: 이미 부여된 상태(max>0)면 건너뛴다. 워크스페이스가 1개뿐이면 재실행해도 결과 동일.
update workspace w
set position = t.rn - 1
from (select id, row_number() over (order by created_at) as rn from workspace) t
where w.id = t.id
  and (select coalesce(max(position), 0) from workspace) = 0;
```

`src/lib/workspaceStore.ts`의 `createWorkspace`를 수정:

```ts
export async function createWorkspace(sql: postgres.Sql, name: string): Promise<Workspace> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    insert into workspace (name, position)
    values (${name.trim()}, (select coalesce(max(position) + 1, 0) from workspace))
    returning id, name, position`;
  return row;
}
```

- [ ] **Step 4: 마이그레이션 적용 후 테스트 통과 확인**

Run: `npm run migrate && node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/018_workspace_position.sql src/lib/workspaceStore.ts src/lib/workspaceStore.test.ts
git commit -m "feat(workspaces): position backfill + 생성 시 맨 뒤 순번 부여"
```

---

### Task 2: 이름 변경 — `renameWorkspace` + `PATCH /api/workspaces/[id]`

**Files:**
- Modify: `src/lib/workspaceStore.ts` (함수 추가)
- Modify: `src/app/api/workspaces/[id]/route.ts` (PATCH 추가)
- Test: `src/lib/workspaceStore.test.ts`

**Interfaces:**
- Produces: `renameWorkspace(sql, id: string, name: string): Promise<Workspace | null>` — 미존재 시 null. API: `PATCH /api/workspaces/{id}` body `{ name: string }` → 200 `Workspace` / 400(빈 이름) / 404(미존재). Task 6(인라인 이름 변경 UI)이 이 API를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `workspaceStore.test.ts`에 추가 (import에 `renameWorkspace` 추가):

```ts
test('renameWorkspace: 이름 변경 + 미존재 null', async () => {
  const w = await createWorkspace(sql, T + '-rn');
  const renamed = await renameWorkspace(sql, w.id, T + '-rn-신규');
  assert.equal(renamed?.name, T + '-rn-신규');
  assert.equal(renamed?.id, w.id);
  const missing = await renameWorkspace(sql, '00000000-0000-0000-0000-000000000000', 'x');
  assert.equal(missing, null);
  await deleteWorkspace(sql, w.id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: FAIL — `renameWorkspace is not a function` (또는 import 에러)

- [ ] **Step 3: 스토어 함수 구현** — `workspaceStore.ts`의 `deleteWorkspace` 아래에:

```ts
export async function renameWorkspace(sql: postgres.Sql, id: string, name: string): Promise<Workspace | null> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    update workspace set name = ${name.trim()} where id = ${id} returning id, name, position`;
  return row ?? null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: PASS

- [ ] **Step 5: API 라우트 추가** — `src/app/api/workspaces/[id]/route.ts`에 PATCH 추가 (import에 `renameWorkspace` 추가):

```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await params;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  const renamed = await renameWorkspace(getSql(), id, name);
  if (!renamed) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다' }, { status: 404 });
  return NextResponse.json(renamed);
}
```

- [ ] **Step 6: 린트 확인 후 Commit**

Run: `npm run lint` — 기존 기준선(24개) 외 신규 에러 없어야 함.

```bash
git add src/lib/workspaceStore.ts src/lib/workspaceStore.test.ts src/app/api/workspaces/\[id\]/route.ts
git commit -m "feat(workspaces): 이름 변경 API (PATCH /api/workspaces/[id])"
```

---

### Task 3: 순서 변경 — `reorderWorkspaces` + `PATCH /api/workspaces/reorder`

**Files:**
- Modify: `src/lib/workspaceStore.ts`
- Create: `src/app/api/workspaces/reorder/route.ts`
- Test: `src/lib/workspaceStore.test.ts`

**Interfaces:**
- Consumes: 없음 (Task 1의 position 체계 위에서 동작)
- Produces: `reorderWorkspaces(sql, ids: string[]): Promise<Workspace[]>` — 집합 불일치 시 `WorkspaceSetMismatch` throw. API: `PATCH /api/workspaces/reorder` body `{ ids: string[] }` → 200 `Workspace[]`(새 순서) / 400 / 409(집합 불일치 — 클라이언트는 재조회). Task 8(드래그 UI)이 호출한다.

참고 패턴: `src/lib/columnStore.ts`의 `reorderColumns` + `ColumnSetMismatch`, `src/app/api/columns/reorder/route.ts` — 동일 구조를 워크스페이스(전역, workspaceId 필터 없음)로 옮긴 것.

- [ ] **Step 1: 실패하는 테스트 작성** — `workspaceStore.test.ts`에 추가 (import에 `reorderWorkspaces`, `WorkspaceSetMismatch` 추가):

```ts
test('reorderWorkspaces: 전체 순서 재부여 + 집합 불일치 throw', async () => {
  const a = await createWorkspace(sql, T + '-ro-a');
  const b = await createWorkspace(sql, T + '-ro-b');
  const before = await listWorkspaces(sql);
  // b를 a 앞으로: 전체 id 배열에서 둘의 위치를 맞바꾼다
  const ids = before.map((w) => w.id);
  const ia = ids.indexOf(a.id); const ib = ids.indexOf(b.id);
  [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
  const after = await reorderWorkspaces(sql, ids);
  assert.deepEqual(after.map((w) => w.id), ids);
  // 집합 불일치: 하나 빠진 배열
  await assert.rejects(() => reorderWorkspaces(sql, ids.slice(1)), WorkspaceSetMismatch);
  await deleteWorkspace(sql, a.id);
  await deleteWorkspace(sql, b.id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: FAIL — `reorderWorkspaces is not a function`

- [ ] **Step 3: 스토어 구현** — `workspaceStore.ts`에 추가:

```ts
export class WorkspaceSetMismatch extends Error {
  constructor() {
    super('워크스페이스 목록이 변경되었습니다');
    this.name = 'WorkspaceSetMismatch';
  }
}

// 전체 순서를 한 번에 재부여한다. 전달된 id 집합이 현재 집합과 다르면(그 사이 다른
// 팀원이 추가/삭제) 엉뚱한 덮어쓰기가 되므로 throw — 클라이언트는 재조회한다.
// columnStore.reorderColumns와 동일 패턴(전역이라 workspaceId 필터만 없음).
export async function reorderWorkspaces(sql: postgres.Sql, ids: string[]): Promise<Workspace[]> {
  return (await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from workspace for update`;
    const current = new Set(rows.map((r) => r.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== current.size || ids.some((id) => !current.has(id))) {
      throw new WorkspaceSetMismatch();
    }
    for (const [i, id] of ids.entries()) {
      await tx`update workspace set position = ${i} where id = ${id}`;
    }
    return await tx<Array<{ id: string; name: string; position: number }>>`
      select id, name, position from workspace order by position, created_at`;
  })) as Workspace[];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: PASS

- [ ] **Step 5: API 라우트 생성** — `src/app/api/workspaces/reorder/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { reorderWorkspaces, WorkspaceSetMismatch } from '@/lib/workspaceStore';
import { requireAllowedUser } from '@/lib/authGuard';

export async function PATCH(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'ids 필수' }, { status: 400 });
  }
  try {
    return NextResponse.json(await reorderWorkspaces(getSql(), ids));
  } catch (e) {
    if (e instanceof WorkspaceSetMismatch) {
      return NextResponse.json({ error: '워크스페이스 목록이 변경되었습니다' }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 6: 린트 확인 후 Commit**

Run: `npm run lint`

```bash
git add src/lib/workspaceStore.ts src/lib/workspaceStore.test.ts src/app/api/workspaces/reorder/
git commit -m "feat(workspaces): 순서 변경 API (PATCH /api/workspaces/reorder)"
```

---

### Task 4: 목록 메타 확장 — `listWorkspacesWithMeta` + `GET /api/workspaces?meta=1`

**Files:**
- Modify: `src/lib/types.ts` (타입 추가)
- Modify: `src/lib/workspaceStore.ts`
- Modify: `src/app/api/workspaces/route.ts:6-10` (GET)
- Test: `src/lib/workspaceStore.test.ts`

**Interfaces:**
- Produces: 타입 `WorkspaceMeta`(아래), `listWorkspacesWithMeta(sql): Promise<WorkspaceMeta[]>`. API: `GET /api/workspaces?meta=1` → `WorkspaceMeta[]`. **쿼리 없는 `GET /api/workspaces`는 기존 `Workspace[]` 그대로** (사이드바·RootRedirect 하위 호환). Task 5(페이지)가 meta=1을 호출한다.

- [ ] **Step 1: 타입 추가** — `src/lib/types.ts`의 `Workspace` 아래에:

```ts
// /workspaces 관리 페이지 카드 메타. candidateCount의 UI 라벨은 "저장 후보"로 통일한다
// (삭제 모달의 수치와 같은 값·같은 용어여야 한다 — AGENTS.md 원칙 4).
export interface WorkspaceMeta extends Workspace {
  columnCount: number;
  candidateCount: number;
  lastActivityAt: string; // ISO — max(컬럼 created_at, 후보 saved_at, 워크스페이스 created_at)
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `workspaceStore.test.ts`에 추가 (import에 `listWorkspacesWithMeta` 추가):

```ts
test('listWorkspacesWithMeta: 컬럼·후보 수와 최근 활동', async () => {
  const w = await createWorkspace(sql, T + '-meta');
  // 컬럼 1개 직접 삽입 (columnStore를 끌어오지 않고 최소 픽스처)
  const [col] = await sql<{ id: string }[]>`
    insert into deck_column (kind, title, workspace_id) values ('search', ${T + '-col'}, ${w.id}) returning id`;
  const metas = await listWorkspacesWithMeta(sql);
  const m = metas.find((x) => x.id === w.id);
  assert.ok(m);
  assert.equal(m.columnCount, 1);
  assert.equal(m.candidateCount, 0);
  assert.ok(m.lastActivityAt); // 컬럼 삽입 시각 이상
  await sql`delete from deck_column where id = ${col.id}`;
  await deleteWorkspace(sql, w.id);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: FAIL — `listWorkspacesWithMeta is not a function`

- [ ] **Step 4: 스토어 구현** — `workspaceStore.ts`에 추가 (import에 `WorkspaceMeta` 추가: `import type { Member, Workspace, WorkspaceMeta } from './types.ts';`):

```ts
// 관리 페이지용: 워크스페이스별 컬럼 수·저장 후보 수·최근 활동을 한 번에 (N+1 금지).
export async function listWorkspacesWithMeta(sql: postgres.Sql): Promise<WorkspaceMeta[]> {
  const rows = await sql<Array<{
    id: string; name: string; position: number;
    column_count: number; candidate_count: number; last_activity_at: string;
  }>>`
    select w.id, w.name, w.position,
      (select count(*)::int from deck_column c where c.workspace_id = w.id) as column_count,
      (select count(*)::int from candidate ca where ca.workspace_id = w.id) as candidate_count,
      greatest(
        w.created_at,
        coalesce((select max(c.created_at) from deck_column c where c.workspace_id = w.id), w.created_at),
        coalesce((select max(ca.saved_at) from candidate ca where ca.workspace_id = w.id), w.created_at)
      ) as last_activity_at
    from workspace w
    order by w.position, w.created_at`;
  return rows.map((r) => ({
    id: r.id, name: r.name, position: r.position,
    columnCount: r.column_count, candidateCount: r.candidate_count,
    lastActivityAt: new Date(r.last_activity_at).toISOString(),
  }));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/workspaceStore.test.ts`
Expected: PASS

- [ ] **Step 6: GET 라우트 확장** — `src/app/api/workspaces/route.ts`의 GET을 교체 (import에 `listWorkspacesWithMeta` 추가):

```ts
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const meta = new URL(req.url).searchParams.get('meta');
  const sql = getSql();
  return NextResponse.json(meta === '1' ? await listWorkspacesWithMeta(sql) : await listWorkspaces(sql));
}
```

- [ ] **Step 7: 린트 확인 후 Commit**

Run: `npm run lint`

```bash
git add src/lib/types.ts src/lib/workspaceStore.ts src/lib/workspaceStore.test.ts src/app/api/workspaces/route.ts
git commit -m "feat(workspaces): 목록 메타 확장 (GET /api/workspaces?meta=1)"
```

---

### Task 5: `/workspaces` 페이지 골격 — 목록·상태·이동·생성

**Files:**
- Create: `src/app/workspaces/layout.tsx`
- Create: `src/app/workspaces/page.tsx`

**Interfaces:**
- Consumes: `GET /api/workspaces?meta=1` → `WorkspaceMeta[]` (Task 4), `POST /api/workspaces` (기존).
- Produces: 페이지 컴포넌트 내부 상태 구조 — Task 6~8이 이 파일을 이어서 수정한다. `rows: WorkspaceMeta[]`, `load(): Promise<void>`, 카드 렌더 함수 구조를 아래 코드대로 만들 것.

UI 시안: `.superpowers/brainstorm/40310-1786248272/content/detail-v4-reorder.html` (박스 카드, 640px 중앙). 하네스가 없으므로 TDD 불가 — lint+tsc로 검증.

- [ ] **Step 1: 레이아웃 생성** — `src/app/workspaces/layout.tsx` (`src/app/clients/layout.tsx`와 동일 패턴):

```tsx
import { GlobalShell } from '@/components/GlobalShell';

export default function WorkspacesLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
```

- [ ] **Step 2: 페이지 생성** — `src/app/workspaces/page.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { WorkspaceMeta } from '@/lib/types';

// 상대 시각 — 카드 메타의 "최근 활동" 표기
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return '오늘 활동';
  if (d < 7) return `${d}일 전 활동`;
  if (d < 30) return `${Math.floor(d / 7)}주 전 활동`;
  return `${Math.floor(d / 30)}달 전 활동`;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkspaceMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // 생성
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const creating = useRef(false); // 한글 IME Enter 이중 발화·더블클릭 중복 생성 방지 (Sidebar와 동일 패턴)
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await apiFetch('/api/workspaces?meta=1');
      if (!r.ok) throw new Error(String(r.status));
      setRows(await r.json());
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCurrentId(localStorage.getItem(LAST_WS_KEY)); }, []);

  async function createWs() {
    const name = newName.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      const r = await apiFetch('/api/workspaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setNewName(''); setAdding(false); setErr('');
      await load();
    } finally { creating.current = false; }
  }

  return (
    <main className="mx-auto max-w-[640px] px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[20px] font-bold">워크스페이스</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>+ 새 워크스페이스</Button>
      </div>
      <p className="mb-4 text-caption text-x-muted">
        팀 전체가 함께 쓰는 작업 공간입니다. 카드를 클릭하면 해당 덱으로 이동하고, ⠿ 핸들을 끌어 순서를 바꿀 수 있어요.
      </p>

      {adding && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-x-border p-3">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createWs(); }}
                 placeholder="새 워크스페이스 이름"
                 className="w-full rounded-lg border border-x-border-strong bg-transparent px-3 py-1.5 text-content outline-none focus:border-x-blue" />
          <Button variant="primary" onClick={createWs}>만들기</Button>
          <Button variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>취소</Button>
        </div>
      )}
      {err && <p className="mb-2 text-caption text-red-500">{err}</p>}

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">목록을 불러오지 못했습니다</p>
          <Button onClick={load}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && rows.length === 0 && !adding && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">아직 워크스페이스가 없습니다. 첫 워크스페이스를 만들어보세요.</p>
          <Button variant="primary" onClick={() => setAdding(true)}>+ 새 워크스페이스</Button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rows.map((w) => (
          <div key={w.id} role="link" tabIndex={0}
               onClick={() => router.push(`/w/${w.id}`)}
               onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/w/${w.id}`); }}
               className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-x-hover ${
                 w.id === currentId ? 'border-[1.5px] border-x-blue' : 'border-x-border hover:border-x-border-strong'
               }`}>
            <span className="select-none text-ui text-x-muted" aria-hidden>⠿</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-content font-bold">
                {w.name}
                {w.id === currentId && (
                  <span className="rounded-full bg-[#e3f1fb] px-2 py-0.5 text-caption font-normal text-x-blue-text">현재</span>
                )}
              </p>
              <p className="text-ui text-x-secondary">
                컬럼 {w.columnCount}개 · 저장 후보 {w.candidateCount}건 · {relTime(w.lastActivityAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
              <button className="text-ui text-x-secondary hover:text-red-500">삭제</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

(이 단계의 "이름 변경"·"삭제" 버튼은 자리만 잡는다 — 동작은 Task 6·7에서.)

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 에러 0, 신규 린트 에러 0 (기준선 24개 외)

- [ ] **Step 4: Commit**

```bash
git add src/app/workspaces/
git commit -m "feat(workspaces): 관리 페이지 골격 — 카드 목록·상태·생성·이동"
```

---

### Task 6: 인라인 이름 변경 UI

**Files:**
- Modify: `src/app/workspaces/page.tsx` (Task 5의 결과)

**Interfaces:**
- Consumes: `PATCH /api/workspaces/{id}` body `{ name }` (Task 2).

- [ ] **Step 1: 상태·핸들러 추가** — 컴포넌트 상단 상태 블록에 추가:

```tsx
  // 이름 변경: 편집 중인 카드 id와 입력값
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const renaming = useRef(false); // IME Enter 이중 발화 방지

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name || renaming.current) return;
    renaming.current = true;
    try {
      const r = await apiFetch(`/api/workspaces/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setEditingId(null); setErr('');
      await load();
    } finally { renaming.current = false; }
  }
```

- [ ] **Step 2: 카드 렌더 분기** — 카드 `<div key={w.id} …>` 내부에서, `editingId === w.id`이면 이름+버튼 영역 대신 편집 UI를 렌더:

이름 영역(`<div className="min-w-0 flex-1">…</div>`)과 우측 버튼 영역을 다음 분기로 감싼다:

```tsx
            {editingId === w.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveRename(w.id);
                         if (e.key === 'Escape') setEditingId(null);
                       }}
                       className="w-full rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-content outline-none focus:border-x-blue" />
                <Button variant="primary" onClick={() => saveRename(w.id)}>저장</Button>
                <Button variant="ghost" onClick={() => setEditingId(null)}>취소</Button>
              </div>
            ) : (
              <>
                {/* Task 5 Step 2에서 만든 이름+메타 <div className="min-w-0 flex-1"> 블록을 여기 그대로 둔다 */}
                <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setEditingId(w.id); setEditName(w.name); }}
                          className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
                  <button className="text-ui text-x-secondary hover:text-red-500">삭제</button>
                </div>
              </>
            )}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/workspaces/page.tsx
git commit -m "feat(workspaces): 카드 인라인 이름 변경"
```

---

### Task 7: 삭제 — 이름 입력 확인 모달

**Files:**
- Modify: `src/app/workspaces/page.tsx`

**Interfaces:**
- Consumes: `DELETE /api/workspaces/{id}` (기존 — 404/409 처리 포함), `WorkspaceMeta`의 `columnCount`/`candidateCount` (카드 메타와 같은 수치·용어 — 원칙 4).

- [ ] **Step 1: 모달 상태·핸들러 추가**:

```tsx
  // 삭제 모달: 대상 워크스페이스 + 확인 입력값
  const [deleting, setDeleting] = useState<WorkspaceMeta | null>(null);
  const [confirmText, setConfirmText] = useState('');

  async function confirmDelete() {
    if (!deleting || confirmText !== deleting.name) return;
    const r = await apiFetch(`/api/workspaces/${deleting.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
      setDeleting(null); setConfirmText('');
      return;
    }
    // 현재 보던 워크스페이스를 지웠으면 복귀 지점도 정리 (/ 진입이 첫 번째로 폴백하도록)
    if (localStorage.getItem(LAST_WS_KEY) === deleting.id) {
      localStorage.removeItem(LAST_WS_KEY);
      setCurrentId(null);
    }
    setDeleting(null); setConfirmText(''); setErr('');
    await load();
  }
```

- [ ] **Step 2: 삭제 버튼 연결** — Task 6에서 만든 삭제 버튼에 (마지막 1개는 비활성 + 이유 title):

```tsx
                  <button onClick={() => { setDeleting(w); setConfirmText(''); }}
                          disabled={rows.length <= 1}
                          title={rows.length <= 1 ? '마지막 워크스페이스는 삭제할 수 없습니다' : undefined}
                          className="text-ui text-x-secondary hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
```

- [ ] **Step 3: 모달 렌더** — `</main>` 닫기 직전에 추가:

```tsx
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleting(null)}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">워크스페이스 삭제</h2>
            <p className="mb-1 text-content">
              &lsquo;{deleting.name}&rsquo;과(와) 컬럼 {deleting.columnCount}개 · 저장 후보 {deleting.candidateCount}건이
              함께 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <p className="mb-3 text-caption text-x-muted">브리핑·발굴 계정·숨김 처리 등 이 워크스페이스에 속한 데이터가 모두 삭제됩니다.</p>
            <p className="mb-1 text-ui text-x-secondary">계속하려면 워크스페이스 이름을 입력하세요</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmDelete(); }}
                   placeholder={deleting.name}
                   className="mb-3 w-full rounded-lg border border-x-border-strong px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeleting(null)}>취소</Button>
              <button onClick={confirmDelete} disabled={confirmText !== deleting.name}
                      className="rounded-full bg-x-pink px-3 py-1 text-ui font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/app/workspaces/page.tsx
git commit -m "feat(workspaces): 이름 입력 확인 삭제 모달"
```

---

### Task 8: 드래그 순서 변경

**Files:**
- Modify: `src/app/workspaces/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/workspaces/reorder` body `{ ids }` (Task 3 — 409면 재조회), `arrayMove` (`src/lib/deckReorder.ts:23`).

방식: 핸들(⠿)에서 pointerdown → 5px 임계값(클릭 오인 방지, `useDeckDrag`의 `ACTIVATION_PX`와 동일 값) → pointermove마다 카드 중심점 비교로 로컬 배열을 즉시 재배열(React 재렌더로 시각 표현) → pointerup에 커밋, Escape 취소. 덱의 `useDeckDrag`는 가로 전용 + rAF 최적화라 재사용하지 않고, 세로 목록용 단순 버전을 페이지 안에 둔다 (목록이 십수 개 수준이라 재렌더 방식으로 충분).

- [ ] **Step 1: 드래그 상태·핸들러 추가** — import에 `arrayMove` 추가 (`import { arrayMove } from '@/lib/deckReorder';`):

```tsx
  // 드래그 순서 변경 — 핸들에서만 시작. 5px 임계값 전엔 클릭으로 취급.
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startY: number; active: boolean; snapshot: WorkspaceMeta[] } | null>(null);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  async function commitOrder(ids: string[]) {
    const r = await apiFetch('/api/workspaces/reorder', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    if (!r.ok) { await load(); return; } // 409(다른 팀원이 추가/삭제) 포함 — 서버 기준으로 재동기화
  }

  function startDrag(id: string, e: React.PointerEvent) {
    if (rowsRef.current.length < 2) return;
    e.preventDefault();
    dragRef.current = { id, startY: e.clientY, active: false, snapshot: rowsRef.current };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active && Math.abs(ev.clientY - d.startY) < 5) return;
      if (!d.active) { d.active = true; setDragId(d.id); }
      // 목표 인덱스 = 포인터보다 중심점이 위에 있는 "다른" 카드의 수.
      // 자기 카드를 세면 자기 중심점을 스칠 때마다 인덱스가 흔들리고,
      // 포인터가 맨 위 카드 중심보다 위일 때 0이 나오지 않는다.
      const cur = rowsRef.current;
      const from = cur.findIndex((w) => w.id === d.id);
      let to = 0;
      for (const el of document.querySelectorAll<HTMLElement>('[data-ws-card]')) {
        if (el.dataset.wsCard === d.id) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) to++;
      }
      if (to !== from) setRows(arrayMove(cur, from, to));
    };
    const finish = (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      setDragId(null);
      if (!d) return;
      if (commit && d.active) commitOrder(rowsRef.current.map((w) => w.id));
      if (!commit && d.active) setRows(d.snapshot); // Escape → 원위치
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
  }
```

- [ ] **Step 2: 핸들·카드에 연결** — 카드 `<div key={w.id} …>`에 `data-ws-card={w.id}` 속성(값이 id여야 위 로직의 자기 제외가 동작)과 드래그 중 스타일 추가, 핸들 `<span>`에 pointerdown 연결:

카드 div에 추가: `data-ws-card={w.id}` 속성 + className에 `${dragId === w.id ? 'shadow-[0_4px_16px_rgba(0,0,0,0.12)]' : ''}` 조각.

핸들 교체:

```tsx
            <span onPointerDown={(e) => startDrag(w.id, e)} onClick={(e) => e.stopPropagation()}
                  className="cursor-grab touch-none select-none text-ui text-x-muted active:cursor-grabbing"
                  title="끌어서 순서 변경" aria-hidden>⠿</span>
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/workspaces/page.tsx
git commit -m "feat(workspaces): 핸들 드래그 순서 변경"
```

---

### Task 9: 사이드바 정리 — 전환 전용 + 관리 링크

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/lib/tour/tourSteps.ts:100` (워크스페이스 개념 문구 정정)

**Interfaces:**
- Consumes: `/workspaces` 페이지 (Task 5).
- Produces: 사이드바에서 제거되는 것 — 생성 UI(`addingWs`/`newWs`/`createWs`), 삭제 UI(`confirmDelete`/`askDeleteWs`/`confirmDeleteWs`), `wsErr`. select는 유지.

- [ ] **Step 1: 사이드바 수정** — `Sidebar.tsx`에서:

1. 상태·함수 제거: `newWs`, `addingWs`, `creating`, `confirmDelete`, `wsErr`, `createWs()`, `askDeleteWs()`, `confirmDeleteWs()` (9-61줄 중 해당 부분).
2. JSX에서 83-106줄(추가 입력/버튼 줄, 확인 바, 에러 캡션)을 다음 한 줄로 교체:

```tsx
      <a href="/workspaces"
         className={`mb-2 block px-1 text-ui hover:text-x-secondary ${pathname === '/workspaces' ? 'font-bold text-x-text' : 'text-x-muted'}`}>
        워크스페이스 관리
      </a>
```

3. 이제 안 쓰는 import 정리 (`useRef`, `useState` 중 남는 것 확인 — `workspaces` state는 유지).

- [ ] **Step 2: 투어 문구 정정** — `src/lib/tour/tourSteps.ts:100`의 `<b>워크스페이스</b>(클라이언트별 작업 공간)` → `<b>워크스페이스</b>(팀 공용 작업 공간)`. (워크스페이스 ≠ 클라이언트 — 커밋 1ae9b6e의 후속 누락 정정. `tourSteps.test.ts`가 있으니 실행해 깨짐 확인.)

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint && node --import tsx --env-file-if-exists=.env --test src/lib/tour/tourSteps.test.ts`
Expected: 전부 통과

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/lib/tour/tourSteps.ts
git commit -m "feat(workspaces): 사이드바를 전환 전용으로 — 추가·삭제를 관리 페이지로 이동"
```

---

### Task 10: `/` 진입 — 마지막 방문 워크스페이스 복귀

**Files:**
- Modify: `src/app/page.tsx` (전체 교체)

**Interfaces:**
- Consumes: `GET /api/workspaces`(기존 형태), `LAST_WS_KEY` (`@/components/GlobalShell`).

- [ ] **Step 1: RootRedirect 교체** — `src/app/page.tsx` 전체를:

```tsx
'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { LAST_WS_KEY } from '@/components/GlobalShell';

// 마지막에 보던 워크스페이스로 복귀한다. 없거나 삭제됐으면 첫 번째, 0개면 관리 페이지로.
// (기존: 무조건 첫 번째 → GlobalShell(/generate·/clients)의 복원 동작과 어긋났다)
export default function RootRedirect() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const go = useCallback(async () => {
    setFailed(false);
    try {
      const r = await apiFetch('/api/workspaces');
      if (!r.ok) throw new Error(String(r.status));
      const ws = (await r.json()) as Workspace[];
      if (ws.length === 0) { router.replace('/workspaces'); return; }
      const saved = localStorage.getItem(LAST_WS_KEY);
      const target = ws.find((w) => w.id === saved) ?? ws[0];
      router.replace(`/w/${target.id}`);
    } catch {
      setFailed(true); // 무한 스피너 금지 — 실패는 실패로 보여준다
    }
  }, [router]);
  useEffect(() => { go(); }, [go]);

  if (failed) {
    return (
      <div className="p-8 text-sm">
        <p className="mb-2 text-x-secondary">워크스페이스 목록을 불러오지 못했습니다.</p>
        <button onClick={go} className="rounded-full border border-x-border-strong px-3 py-1 hover:bg-x-hover">다시 시도</button>
      </div>
    );
  }
  return <p className="p-8 text-sm text-x-muted">워크스페이스로 이동 중…</p>;
}
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix(root): / 진입을 마지막 방문 워크스페이스 복귀로 — 0개면 관리 페이지, 실패는 재시도 UI"
```

---

### Task 11: 전체 검증 + 빌드

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`  (~4분, 실 DB)
Expected: 전부 PASS

- [ ] **Step 2: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공, `/workspaces` 라우트 출력에 포함

- [ ] **Step 3: 최종 lint 기준선 확인**

Run: `npm run lint`
Expected: 기준선(24개, 표 컨테이너 예외 2건 포함) 외 신규 항목 없음

- [ ] **Step 4: 잔여 커밋 확인 후 종료**

`git status`가 깨끗한지 확인. 배포는 사용자 확인 후 별도 진행(Vercel CLI — 이 계획 범위 밖).
