# 덱 컬럼 순서 (새 컬럼 안내 + 드래그 재정렬) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새로 만든 컬럼이 화면에 보이게 하고, 그립 드래그로 컬럼 순서를 바꿀 수 있게 한다.

**Architecture:** 세 층으로 나눈다. (1) DB — 지금 항상 `0`인 `deck_column.position`을 실사용으로 전환하고 전체 순서 배열을 트랜잭션으로 저장. (2) 순수 계산 — 드롭 위치·이동량·스크롤 속도를 DOM 없이 계산하는 `deckReorder.ts`(테스트 대상). (3) DOM — `useDeckDrag` 훅이 포인터 이벤트를 rAF로 모아 `transform`을 직접 쓴다. 드래그 중 React 리렌더는 0회, 순서 확정 시에만 `setState` 1회.

**Tech Stack:** Next.js 16.2.10 (App Router), React 19.2.4, TypeScript, Tailwind v4, postgres.js, node:test

**설계 문서:** `docs/superpowers/specs/2026-07-27-deck-column-order-design.md`

## Global Constraints

- **DnD 라이브러리를 추가하지 않는다.** `package.json` 의존성 변경 없음.
- **프레임 예산 16ms, 포인터 핸들러 8ms.** 드래그 중 `setState` 금지, `getBoundingClientRect`를 프레임 안에서 호출 금지(시작 시 1회만), `left`/`top` 애니메이션 금지 — `transform`만.
- **읽기 → 쓰기 순서.** rAF 콜백에서 `scrollLeft` 등 읽기를 모두 끝낸 뒤 DOM 쓰기를 한다.
- **`transform`을 React가 관리하는 `style` prop에 넣지 않는다.** 훅이 `el.style.transform`으로 직접 쓴다.
- **마이그레이션은 재실행 안전해야 한다.** `scripts/apply-migrations.sh`가 `migrations/*.sql`을 매번 전부 다시 실행한다.
- **`prefers-reduced-motion: reduce`를 존중한다** — 새 컬럼 스크롤과 드래그 transition 양쪽.
- **드래그 활성화 임계값 5px.**
- **사용자 문구는 아래 그대로 사용한다** (내부어 금지):
  - 그립 툴팁: `끌어서 순서 변경`
  - 409 실패: `다른 팀원이 컬럼을 바꿔서 순서를 저장하지 못했어요. 최신 상태로 새로 불러왔습니다.`
  - 그 외 실패: `순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.`
- **DB 테스트는 `.env`가 있어야 돈다.** 없으면 `vercel env pull .env --environment=production`. `deckReorder.test.ts`는 순수 함수라 `.env` 없이도 돈다.
- **커밋 메시지 접두사**는 저장소 관례를 따른다: `feat(x-research):` / `fix(x-research):` / `docs(x-research):`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `migrations/013_column_position.sql` **(신규)** | 기존 컬럼에 순서 번호 backfill (재실행 안전) |
| `src/lib/deckReorder.ts` **(신규)** | 순수 계산 — 드롭 인덱스, 배열 이동, 컬럼별 이동량, 가장자리 스크롤 속도 |
| `src/lib/deckReorder.test.ts` **(신규)** | 위 4개 함수의 경계 케이스 |
| `src/lib/useDeckDrag.ts` **(신규)** | 포인터 이벤트, rAF 배칭, DOM 직접 쓰기, 자동 스크롤, Escape, 키보드 이동 |
| `src/components/ColumnGrip.tsx` **(신규)** | 그립 버튼 — 어포던스·ARIA·키보드 |
| `src/app/api/columns/reorder/route.ts` **(신규)** | 전체 순서 저장 엔드포인트 |
| `src/components/XIcons.tsx` | `GripIcon` 추가 |
| `src/components/Column.tsx` | `isNew`(스크롤+강조), 그립 자리, `data-column-id`, `content-visibility` |
| `src/app/w/[wsId]/page.tsx` | 훅 연결, 낙관적 순서 저장, Toast, `aria-live` |
| `src/lib/columnStore.ts` | `reorderColumns`, `ColumnSetMismatch`, 생성 시 position 자동 계산 |
| `src/lib/columnStore.test.ts` | 위 항목 테스트 추가 |
| `src/app/api/columns/route.ts` | `body.position` 통로 제거 |

**검증 수단.** 이 저장소에는 React 컴포넌트 테스트 하네스가 없다(테스트는 `src/**/*.test.ts`의 node:test뿐). 따라서 **순수 로직·DB 계층은 자동 테스트**로, **UI 계층은 `npx tsc --noEmit` + `npm run lint` + 명시된 수동 확인 절차**로 검증한다. 없는 테스트 프레임워크를 도입하지 않는다.

---

### Task 1: 새 컬럼을 화면으로 데려오기 (기능 A)

가장 작고 단독으로 가치가 있는 조각. 재정렬과 독립이다.

**Files:**
- Modify: `src/components/Column.tsx` (props 36-43, autoRefresh effect 139-146, section 209)
- Modify: `src/app/w/[wsId]/page.tsx` (17, 59, 86)

**Interfaces:**
- Consumes: 없음
- Produces: `Column`의 `isNew?: boolean` prop (기존 `autoRefresh`를 대체). 이후 태스크가 이 이름을 사용한다.

- [ ] **Step 1: `Column`의 `autoRefresh` prop을 `isNew`로 바꾸고 스크롤·강조를 추가**

`src/components/Column.tsx` 36-43행의 시그니처를 이렇게 바꾼다:

```tsx
export function Column({ column, isNew, onEdit, onDelete, onPickTag, tourAnchor }: {
  column: ColumnRow;
  isNew?: boolean;   // 방금 만든 컬럼 — 1회 자동 조회 + 화면으로 스크롤 + 잠깐 강조
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
  tourAnchor?: boolean;
}) {
```

- [ ] **Step 2: 강조 상태와 루트 ref를 추가**

`const [width, setWidth] = useState<number>(column.config.width ?? 400);` 바로 아래에 추가:

```tsx
  const rootRef = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState(false);
```

- [ ] **Step 3: 기존 자동 조회 effect를 `isNew`로 바꾸고, 스크롤·강조 effect를 그 아래에 추가**

`src/components/Column.tsx` 139-146행을 통째로 아래로 교체한다:

```tsx
  // 생성 직후 1회 자동 조회 — 미조회(lastRefreshedAt=null) 상태일 때만, 재실행 방지 가드
  const autoRan = useRef(false);
  useEffect(() => {
    if (isNew && !autoRan.current && !column.lastRefreshedAt) {
      autoRan.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // 새 컬럼은 스트립 오른쪽 끝에 붙어 화면 밖일 수 있다. 스크롤로 데려오고 잠깐 강조해
  // "만들어졌다"를 눈에 보이게 한다 — 없으면 컬럼 4개 이상에서 화면이 그대로라 실패로 읽힌다.
  const cameIntoView = useRef(false);
  useEffect(() => {
    if (!isNew || cameIntoView.current || !rootRef.current) return;
    cameIntoView.current = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rootRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'end', block: 'nearest' });
    setHighlight(true);
    const t = setTimeout(() => setHighlight(false), 1500);
    return () => clearTimeout(t);
  }, [isNew]);
```

- [ ] **Step 4: 루트 `<section>`에 ref와 강조 링을 단다**

`src/components/Column.tsx` 209행을 교체:

```tsx
    <section ref={rootRef} style={{ width }}
             className={`relative flex h-full shrink-0 flex-col border-r border-x-border ${highlight ? 'ring-2 ring-inset ring-x-blue' : ''}`}>
```

- [ ] **Step 5: `page.tsx`에서 state 이름과 prop을 맞춘다**

`src/app/w/[wsId]/page.tsx` 17행:

```tsx
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
```

59행:

```tsx
    if (!isEdit) setNewColumnId(((await r.json()) as ColumnRow).id);
```

86행:

```tsx
                  isNew={c.id === newColumnId}
```

- [ ] **Step 6: 타입·린트 통과 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음. (`autoRefresh`가 남아 있으면 tsc가 잡는다.)

- [ ] **Step 7: 수동 확인**

Run: `npm run dev` 후 브라우저에서 워크스페이스 하나를 연다.

1. 컬럼을 5개 이상 만든다(창을 좁혀 3개만 보이게 해도 된다).
2. `+ 컬럼`으로 하나 더 만든다.
3. 확인: 덱이 오른쪽 끝으로 스크롤되어 **새 컬럼이 화면에 들어오고**, 파란 테두리가 약 1.5초 뒤 사라진다. 자동 새로고침이 도는 것도 보인다.
4. OS 설정에서 "동작 줄이기"를 켜고 다시 만들면 스크롤이 **부드럽지 않고 즉시** 이동한다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/Column.tsx "src/app/w/[wsId]/page.tsx"
git commit -m "feat(x-research): 새 컬럼 생성 시 화면으로 스크롤 + 1.5초 강조

컬럼이 4개 이상이면 새 컬럼이 화면 밖 오른쪽 끝에 생겨 화면 변화가 없었다.
autoRefresh prop을 isNew로 넓혀 자동조회·스크롤·강조 세 가지를 함께 트리거한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `position` 살리기 — 마이그레이션 + 스토어

**Files:**
- Create: `migrations/013_column_position.sql`
- Modify: `src/lib/columnStore.ts:22-31` (createColumn), 파일 끝에 추가
- Modify: `src/lib/columnStore.test.ts`
- Modify: `src/app/api/columns/route.ts:38`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `createColumn(sql, { workspaceId, kind, title, config })` — `position` 인자 **제거**. 서버가 `max(position)+1`로 정한다.
  - `reorderColumns(sql: postgres.Sql, workspaceId: string, ids: string[]): Promise<ColumnRow[]>`
  - `class ColumnSetMismatch extends Error`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/columnStore.test.ts` 4행의 import에 `reorderColumns, ColumnSetMismatch`를 추가하고, 파일 끝에 아래 테스트를 붙인다:

```ts
test('position 자동 증가 + reorderColumns + 집합 불일치 거부', async () => {
  const ws = await createWorkspace(sql, T + '-w3');
  try {
    const mk = (n: string) => createColumn(sql, { workspaceId: ws.id, kind: 'search', title: T + n, config: { keywords: [n] } });
    const a = await mk('-a');
    const b = await mk('-b');
    const c = await mk('-c');
    assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]); // 새 컬럼은 항상 맨 뒤

    const out = await reorderColumns(sql, ws.id, [c.id, a.id, b.id]);
    assert.deepEqual(out.map((x) => x.id), [c.id, a.id, b.id]);
    assert.deepEqual(out.map((x) => x.position), [0, 1, 2]);
    assert.deepEqual((await listColumns(sql, ws.id)).map((x) => x.id), [c.id, a.id, b.id]);

    const d = await mk('-d');
    assert.equal(d.position, 3); // 재정렬 뒤에도 맨 뒤로 붙는다

    // 일부만 보내면 거부 — 그 사이 다른 멤버가 컬럼을 추가/삭제했다는 뜻
    await assert.rejects(() => reorderColumns(sql, ws.id, [c.id, a.id]), ColumnSetMismatch);
    // 중복 id도 거부
    await assert.rejects(() => reorderColumns(sql, ws.id, [c.id, c.id, a.id, b.id]), ColumnSetMismatch);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npm test 2>&1 | grep -A 3 "position 자동"`
Expected: FAIL — `reorderColumns is not a function` 또는 import 오류.

(`.env`가 없어 DB 연결이 안 되면 먼저 `vercel env pull .env --environment=production`)

- [ ] **Step 3: 마이그레이션을 쓴다**

Create `migrations/013_column_position.sql`:

```sql
-- 013: deck_column.position 실사용 시작.
-- 그동안 position은 항상 0이었고 실질 정렬은 created_at이었다. 기존 컬럼에
-- '지금 보이던 그 순서'를 번호로 굳혀서 사용자 눈에는 변화가 없게 한다.
--
-- 재실행 안전: apply-migrations.sh가 매번 모든 파일을 다시 실행한다.
-- 이미 번호가 매겨진 워크스페이스(max(position) > 0)는 건드리지 않는다 —
-- 안 그러면 마이그레이션을 돌릴 때마다 사용자가 정한 순서가 생성순으로 되돌아간다.
with untouched as (
  select workspace_id
    from deck_column
   group by workspace_id
  having max(position) = 0
), ranked as (
  select id,
         row_number() over (partition by workspace_id order by created_at) - 1 as rn
    from deck_column
   where workspace_id in (select workspace_id from untouched)
)
update deck_column c
   set position = r.rn
  from ranked r
 where c.id = r.id
   and c.position <> r.rn;
```

- [ ] **Step 4: 마이그레이션을 적용하고 재실행 안전성을 확인**

```bash
npm run migrate
npm run migrate   # 두 번째 실행에서도 오류 없이 통과해야 한다
```

Expected: 두 번 다 `== done`.

- [ ] **Step 5: `createColumn`을 서버 계산으로 바꾸고 `reorderColumns`를 추가**

`src/lib/columnStore.ts` 22-31행을 교체:

```ts
export async function createColumn(
  sql: postgres.Sql,
  input: { workspaceId: string; kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig },
): Promise<ColumnRow> {
  // position은 서버가 정한다. 클라이언트가 보내면 두 명이 동시에 만들 때 번호가 겹친다.
  // 새 컬럼은 항상 맨 뒤 — "새 건 오른쪽 끝"이라는 화면 규칙과 같은 규칙이다.
  const [row] = await sql<Row[]>`
    insert into deck_column (workspace_id, kind, title, position, config)
    values (
      ${input.workspaceId}, ${input.kind}, ${input.title},
      (select coalesce(max(position) + 1, 0) from deck_column where workspace_id = ${input.workspaceId}),
      ${sql.json(input.config as never)}
    )
    returning id, workspace_id, kind, title, position, config, last_refreshed_at`;
  return toColumn(row);
}
```

같은 파일 끝에 추가:

```ts
/** 재정렬 요청의 id 집합이 서버의 현재 컬럼 집합과 다를 때. 호출자는 재조회해야 한다. */
export class ColumnSetMismatch extends Error {
  constructor() {
    super('컬럼 목록이 변경되었습니다');
    this.name = 'ColumnSetMismatch';
  }
}

/**
 * 전체 순서를 한 번에 확정한다. ids는 그 워크스페이스의 현재 컬럼 **전부**여야 하며
 * 중복이 없어야 한다. 하나만 보내고 서버가 나머지를 미루는 방식은 결국 서버가
 * 재계산해야 해서 이득이 없고 어긋날 여지만 는다.
 * 동시 재정렬은 `for update`로 직렬화된다(마지막 저장이 이긴다).
 */
export async function reorderColumns(
  sql: postgres.Sql,
  workspaceId: string,
  ids: string[],
): Promise<ColumnRow[]> {
  return (await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from deck_column where workspace_id = ${workspaceId} for update`;
    const current = new Set(rows.map((r) => r.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== current.size || ids.some((id) => !current.has(id))) {
      throw new ColumnSetMismatch();
    }
    for (const [i, id] of ids.entries()) {
      await tx`update deck_column set position = ${i} where id = ${id}`;
    }
    const out = await tx.unsafe<Row[]>(
      `select ${COLS} from deck_column where workspace_id = $1 order by position, created_at`,
      [workspaceId],
    );
    return out.map(toColumn);
  })) as ColumnRow[];
}
```

- [ ] **Step 6: API 라우트에서 `body.position` 통로를 제거**

`src/app/api/columns/route.ts` 38행을 교체:

```ts
  const col = await createColumn(getSql(), { workspaceId, kind: body.kind, title: body.title, config });
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npm test 2>&1 | tail -20`
Expected: 전체 PASS. `position 자동 증가 + reorderColumns + 집합 불일치 거부` 포함.

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음.

- [ ] **Step 8: 커밋**

```bash
git add migrations/013_column_position.sql src/lib/columnStore.ts src/lib/columnStore.test.ts src/app/api/columns/route.ts
git commit -m "feat(x-research): deck_column.position 실사용 — 생성 시 서버 채번 + reorderColumns

position이 항상 0이라 정렬이 사실상 생성순 고정이었다. 기존 컬럼에 보이던 순서를
그대로 backfill(재실행 안전)하고, 새 컬럼은 서버가 max+1로 채번한다.
재정렬은 전체 순서 배열을 트랜잭션으로 확정하며, 집합이 다르면 ColumnSetMismatch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 재정렬 API 라우트

**Files:**
- Create: `src/app/api/columns/reorder/route.ts`

**Interfaces:**
- Consumes: `reorderColumns`, `ColumnSetMismatch` (Task 2)
- Produces: `PATCH /api/columns/reorder`, body `{ workspaceId: string, ids: string[] }` → `200` + `ColumnRow[]`, 또는 `400` / `409`

- [ ] **Step 1: 번들 문서에서 라우트 핸들러 규약을 확인**

Run: `sed -n '1,80p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`

이 Next 버전에서 `PATCH` 익스포트 시그니처와 `NextResponse.json` 사용법이 아래 코드와 맞는지 확인한다. 다르면 문서를 따른다. (AGENTS.md: 코드를 쓰기 전에 해당 가이드를 읽을 것.)

- [ ] **Step 2: 라우트를 작성**

Create `src/app/api/columns/reorder/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { reorderColumns, ColumnSetMismatch } from '@/lib/columnStore';
import { requireAllowedUser } from '@/lib/authGuard';

export async function PATCH(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => null);
  const workspaceId = body?.workspaceId;
  const ids = body?.ids;
  if (typeof workspaceId !== 'string' || !workspaceId) {
    return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'ids 필수' }, { status: 400 });
  }
  try {
    return NextResponse.json(await reorderColumns(getSql(), workspaceId, ids));
  } catch (e) {
    // 집합 불일치 = 그 사이 다른 멤버가 컬럼을 추가/삭제함. 클라이언트는 재조회한다.
    if (e instanceof ColumnSetMismatch) {
      return NextResponse.json({ error: '컬럼 목록이 변경되었습니다' }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 3: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음. 빌드 로그에 `/api/columns/reorder` 라우트가 나타난다.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/columns/reorder/route.ts
git commit -m "feat(x-research): PATCH /api/columns/reorder — 전체 순서 저장

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 순수 계산 모듈 `deckReorder`

DOM에서 떼어내는 이유는 성능이 아니라 **검증**이다. 컬럼 폭이 280~720으로 제각각이라 경계 계산이 틀리기 쉽고, 화면에 붙어 있으면 사람이 마우스로 끌어봐야만 확인된다.

**Files:**
- Create: `src/lib/deckReorder.ts`
- Create: `src/lib/deckReorder.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type ColumnBox = { id: string; left: number; width: number }`
  - `dropIndex(boxes: ColumnBox[], fromIndex: number, draggedLeft: number): number`
  - `arrayMove<T>(items: T[], from: number, to: number): T[]`
  - `shiftFor(boxes: ColumnBox[], fromIndex: number, toIndex: number): number[]`
  - `edgeScrollVelocity(pointerX: number, viewLeft: number, viewWidth: number, max?: number): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `src/lib/deckReorder.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropIndex, arrayMove, shiftFor, edgeScrollVelocity, type ColumnBox } from './deckReorder.ts';

// 폭이 제각각인 3개 컬럼: A[0,300) B[300,400) C[400,900)
const BOXES: ColumnBox[] = [
  { id: 'a', left: 0, width: 300 },
  { id: 'b', left: 300, width: 100 },
  { id: 'c', left: 400, width: 500 },
];

test('dropIndex — 제자리에 있으면 원래 인덱스', () => {
  assert.equal(dropIndex(BOXES, 0, 0), 0);
  assert.equal(dropIndex(BOXES, 1, 300), 1);
  assert.equal(dropIndex(BOXES, 2, 400), 2);
});

test('dropIndex — 맨 앞/맨 뒤 경계는 넘어가지 않는다', () => {
  assert.equal(dropIndex(BOXES, 2, -9999), 0);
  assert.equal(dropIndex(BOXES, 0, 9999), 2);
  assert.equal(dropIndex(BOXES, 0, -9999), 0);
  assert.equal(dropIndex(BOXES, 2, 9999), 2);
});

test('dropIndex — 다른 컬럼의 중심을 지나야 자리를 내준다 (폭 제각각)', () => {
  // 판정 기준은 '잡은 컬럼의 중심'. 중심 = draggedLeft + 잡은 컬럼 폭/2.
  // 상대 중심: A=150, B=350, C=650.
  // C는 폭 500이므로 중심 = draggedLeft + 250.
  assert.equal(dropIndex(BOXES, 2, 200), 2);   // 중심 450 → A·B 둘 다 지남
  assert.equal(dropIndex(BOXES, 2, 0), 1);     // 중심 250 → A만 지남
  assert.equal(dropIndex(BOXES, 2, -200), 0);  // 중심 50 → 아무것도 안 지남
  // A는 폭 300이므로 중심 = draggedLeft + 150.
  assert.equal(dropIndex(BOXES, 0, 100), 0);   // 중심 250 → B(350) 안 지남
  assert.equal(dropIndex(BOXES, 0, 250), 1);   // 중심 400 → B만 지남
  assert.equal(dropIndex(BOXES, 0, 600), 2);   // 중심 750 → B·C 둘 다 지남
});

test('arrayMove', () => {
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
});

test('shiftFor — 오른쪽으로 옮기면 사이 컬럼들이 잡은 컬럼의 폭만큼 왼쪽으로 당겨진다', () => {
  assert.deepEqual(shiftFor(BOXES, 0, 2), [0, -300, -300]);
  assert.deepEqual(shiftFor(BOXES, 0, 1), [0, -300, 0]);
});

test('shiftFor — 왼쪽으로 옮기면 사이 컬럼들이 오른쪽으로 밀린다', () => {
  assert.deepEqual(shiftFor(BOXES, 2, 0), [500, 500, 0]);
  assert.deepEqual(shiftFor(BOXES, 1, 0), [100, 0, 0]);
});

test('shiftFor — 제자리면 전부 0', () => {
  assert.deepEqual(shiftFor(BOXES, 1, 1), [0, 0, 0]);
});

test('edgeScrollVelocity — 가운데선 0, 가장자리로 갈수록 제곱으로 빨라진다', () => {
  // 뷰포트: left=0, width=1000 → 시작 250px 지점, 최고속 50px 지점
  assert.equal(edgeScrollVelocity(500, 0, 1000), 0);
  assert.equal(edgeScrollVelocity(250, 0, 1000), 0);   // 경계 = 아직 0
  assert.equal(edgeScrollVelocity(750, 0, 1000), 0);
  assert.ok(edgeScrollVelocity(100, 0, 1000) < 0);     // 왼쪽 = 음수
  assert.ok(edgeScrollVelocity(900, 0, 1000) > 0);     // 오른쪽 = 양수
  assert.equal(edgeScrollVelocity(0, 0, 1000, 1700), -1700);
  assert.equal(edgeScrollVelocity(1000, 0, 1000, 1700), 1700);
  // 제곱 가속: 절반 지점의 속도는 최고속의 1/4보다 작다
  const half = edgeScrollVelocity(150, 0, 1000, 1700);  // 250→50 구간의 중간
  assert.ok(Math.abs(half) < 1700 * 0.3);
});

test('edgeScrollVelocity — 뷰포트가 화면 왼쪽 끝이 아닐 때도 동작', () => {
  assert.equal(edgeScrollVelocity(700, 200, 1000), 0); // 200~1200 안의 가운데
  assert.ok(edgeScrollVelocity(250, 200, 1000) < 0);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `node --import tsx --test src/lib/deckReorder.test.ts`
Expected: FAIL — `Cannot find module './deckReorder.ts'`

- [ ] **Step 3: 구현**

Create `src/lib/deckReorder.ts`:

```ts
// 덱 컬럼 재정렬의 순수 계산. DOM·React 의존 없음 — 그래야 자동 테스트로 검증할 수 있다.
// 좌표는 모두 '콘텐츠 좌표계'(가로 스크롤 컨테이너의 스크롤 시작점 = 0) 기준.

export type ColumnBox = { id: string; left: number; width: number };

/**
 * 잡은 컬럼의 왼쪽 끝이 draggedLeft일 때 놓일 인덱스.
 * 판정 기준은 '잡은 컬럼의 중심이 상대 컬럼의 중심을 지났는가' — 폭이 제각각이어도
 * 일관되게 동작한다. 반환값은 잡은 컬럼을 뺀 뒤 다시 끼워 넣을 위치이므로
 * arrayMove(items, fromIndex, 반환값)에 그대로 쓸 수 있다.
 */
export function dropIndex(boxes: ColumnBox[], fromIndex: number, draggedLeft: number): number {
  const center = draggedLeft + boxes[fromIndex].width / 2;
  let idx = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (i === fromIndex) continue;
    if (center > boxes[i].left + boxes[i].width / 2) idx++;
  }
  return idx;
}

/** from 위치의 항목을 to 위치로 옮긴 새 배열. */
export function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const out = items.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * 드래그 중 각 컬럼에 적용할 가로 이동량(px). 잡은 컬럼 자신은 0
 * (포인터를 따라 별도로 움직인다). 잡은 컬럼이 비운 자리를 나머지가 그 폭만큼 메운다.
 */
export function shiftFor(boxes: ColumnBox[], fromIndex: number, toIndex: number): number[] {
  const w = boxes[fromIndex].width;
  return boxes.map((_, i) => {
    if (i === fromIndex) return 0;
    if (fromIndex < toIndex && i > fromIndex && i <= toIndex) return -w;
    if (fromIndex > toIndex && i >= toIndex && i < fromIndex) return w;
    return 0;
  });
}

/**
 * 가장자리 자동 스크롤 속도(px/초). 음수 = 왼쪽.
 * 뷰포트 폭의 25% 지점부터 시작해 5% 지점에서 최고 속도에 닿고, 그 사이는 제곱 가속이다.
 * 픽셀 고정이 아니라 비율인 이유는 화면 크기가 달라도 같은 체감을 주기 위해서다.
 * (근거: react-beautiful-dnd 자동 스크롤 설계)
 */
export function edgeScrollVelocity(
  pointerX: number,
  viewLeft: number,
  viewWidth: number,
  max = 1700,
): number {
  const start = viewWidth * 0.25;
  const full = viewWidth * 0.05;
  const ramp = (dist: number) => {
    if (dist >= start) return 0;
    const p = Math.min(1, (start - dist) / Math.max(1, start - full));
    return p * p * max;
  };
  const left = ramp(pointerX - viewLeft);
  if (left > 0) return -left;
  return ramp(viewLeft + viewWidth - pointerX);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --test src/lib/deckReorder.test.ts`
Expected: 9개 테스트 전부 PASS.

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/deckReorder.ts src/lib/deckReorder.test.ts
git commit -m "feat(x-research): 덱 재정렬 순수 계산 모듈 + 테스트

컬럼 폭이 280~720으로 제각각이라 드롭 위치 계산이 틀리기 쉽다.
DOM에서 떼어내 경계 케이스를 자동 검증한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 그립 아이콘과 버튼

**Files:**
- Modify: `src/components/XIcons.tsx` (파일 끝에 추가)
- Create: `src/components/ColumnGrip.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `<ColumnGrip title index total onPointerDown onMove />` — `index`는 0-based, `onMove(delta: -1 | 1)`

- [ ] **Step 1: `GripIcon`을 추가**

`src/components/XIcons.tsx` 파일 끝에 추가:

```tsx
// 세로 2열 × 3행 점 — 끌 수 있음을 알리는 표준 기호
export const GripIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M9 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 16a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
);
```

- [ ] **Step 2: `ColumnGrip`을 만든다**

Create `src/components/ColumnGrip.tsx`:

```tsx
'use client';
import { GripIcon } from './XIcons';

/**
 * 컬럼 순서 변경 손잡이. hover에 숨기지 않고 상시 노출한다 — 숨기면 "끌 수 있다"를
 * 아무도 발견하지 못한다. 반대로 컬럼이 1개뿐이면 호출부에서 렌더하지 않는다(거짓 어포던스 금지).
 * 크기는 헤더의 기존 아이콘 버튼과 동일 규격(p-1.5 + 16px)을 따른다.
 */
export function ColumnGrip({ title, index, total, onPointerDown, onMove }: {
  title: string;
  index: number;                       // 0-based
  total: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onMove: (delta: -1 | 1) => void;     // 키보드 한 칸 이동
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title="끌어서 순서 변경"
      aria-label={`${title} 순서 변경 — 끌어서 옮기거나 화살표 키를 누르세요. ${total}개 중 ${index + 1}번째`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        // 경계에서는 아무 일도 일어나지 않는다 — 헛도는 저장 요청을 막는다
        if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onMove(-1); }
        if (e.key === 'ArrowRight' && index < total - 1) { e.preventDefault(); onMove(1); }
      }}
      className="shrink-0 cursor-grab touch-none rounded p-1.5 text-x-secondary hover:bg-x-text/5 hover:text-x-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:cursor-grabbing"
    >
      <GripIcon className="h-4 w-4" />
    </span>
  );
}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/XIcons.tsx src/components/ColumnGrip.tsx
git commit -m "feat(x-research): 컬럼 순서 변경 그립 (상시 노출 + 키보드 이동)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 드래그 훅 `useDeckDrag`

성능 규칙이 전부 여기 모인다. 컬럼 하나에 트윗 200개, 5개면 카드 1,000개가 떠 있으므로 **드래그 중 React 리렌더는 0회**여야 한다.

**Files:**
- Create: `src/lib/useDeckDrag.ts`

**Interfaces:**
- Consumes: `arrayMove`, `dropIndex`, `shiftFor`, `edgeScrollVelocity`, `ColumnBox` (Task 4)
- Produces:
  ```ts
  useDeckDrag(opts: {
    columns: ColumnRow[];
    containerRef: React.RefObject<HTMLElement | null>;
    getColumnEl: (id: string) => HTMLElement | null;
    onCommit: (ids: string[]) => void;
    onAnnounce?: (message: string) => void;
  }): {
    startDrag: (index: number, e: React.PointerEvent) => void;
    moveByKeyboard: (index: number, delta: -1 | 1) => void;
  }
  ```

- [ ] **Step 1: 훅을 작성**

Create `src/lib/useDeckDrag.ts`:

```ts
'use client';
import { useCallback, useRef } from 'react';
import type { ColumnRow } from './types';
import { arrayMove, dropIndex, shiftFor, edgeScrollVelocity, type ColumnBox } from './deckReorder';

const ACTIVATION_PX = 5;   // 이만큼 움직여야 드래그로 인정 — 그냥 클릭했을 때 순서가 바뀌는 것을 막는다

type Drag = {
  fromIndex: number;
  pointerId: number;
  startClientX: number;
  clientX: number;
  grabOffset: number;        // 잡은 지점 − 컬럼 왼쪽 끝 (콘텐츠 좌표)
  containerLeft: number;     // 컨테이너의 뷰포트 기준 왼쪽
  containerWidth: number;
  prevScrollBehavior: string;
  boxes: ColumnBox[];
  els: HTMLElement[];
  active: boolean;           // 임계값을 넘었는가
  reduce: boolean;           // prefers-reduced-motion
  toIndex: number;
  lastTo: number;
  lastDraggedLeft: number;
  raf: number | null;
  lastT: number;
};

export function useDeckDrag({ columns, containerRef, getColumnEl, onCommit, onAnnounce }: {
  columns: ColumnRow[];
  containerRef: React.RefObject<HTMLElement | null>;
  getColumnEl: (id: string) => HTMLElement | null;
  onCommit: (ids: string[]) => void;
  onAnnounce?: (message: string) => void;
}) {
  const drag = useRef<Drag | null>(null);
  // 리스너 해제를 위해 같은 함수 참조를 유지한다
  const handlers = useRef<{ move: (e: PointerEvent) => void; up: () => void; cancel: () => void; key: (e: KeyboardEvent) => void } | null>(null);

  const finish = useCallback((commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf !== null) cancelAnimationFrame(d.raf);
    if (handlers.current) {
      window.removeEventListener('pointermove', handlers.current.move);
      window.removeEventListener('pointerup', handlers.current.up);
      window.removeEventListener('pointercancel', handlers.current.cancel);
      window.removeEventListener('keydown', handlers.current.key);
      handlers.current = null;
    }
    document.body.style.userSelect = '';
    const container = containerRef.current;
    if (container) container.style.scrollBehavior = d.prevScrollBehavior;
    // will-change를 남겨두면 GPU 메모리를 계속 잡아먹는다 — 반드시 해제한다
    for (const el of d.els) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      el.style.opacity = '';
      el.style.zIndex = '';
      el.style.boxShadow = '';
    }
    if (commit && d.active && d.toIndex !== d.fromIndex) {
      // 스타일을 먼저 지우고 같은 태스크 안에서 상태를 바꾼다 — 사이에 페인트가 끼지 않아 튀지 않는다
      onCommit(arrayMove(columns.map((c) => c.id), d.fromIndex, d.toIndex));
    }
  }, [columns, containerRef, onCommit]);

  const frame = useCallback(() => {
    const d = drag.current;
    const container = containerRef.current;
    if (!d || !container) return;
    d.raf = requestAnimationFrame(frame);

    // ── 읽기 먼저. 쓰기 뒤에 읽으면 강제 동기 레이아웃이 걸린다.
    const now = performance.now();
    const dt = Math.min(0.05, (now - d.lastT) / 1000);   // 탭 전환 등으로 프레임이 튀어도 폭주하지 않게 상한
    d.lastT = now;
    const scrollLeft = container.scrollLeft;
    const maxScroll = container.scrollWidth - container.clientWidth;

    // ── 가장자리 자동 스크롤
    let nextScroll = scrollLeft;
    const v = edgeScrollVelocity(d.clientX, d.containerLeft, d.containerWidth);
    if (v !== 0) {
      // 그 방향으로 실제 움직인 뒤에만 스크롤한다. 없으면 오른쪽 끝 컬럼을 집는 순간
      // 스트립이 날아간다 — 새 컬럼이 항상 오른쪽 끝에 생기는 구조라 자주 걸린다.
      const moved = d.clientX - d.startClientX;
      if ((v < 0 && moved < 0) || (v > 0 && moved > 0)) {
        nextScroll = Math.max(0, Math.min(maxScroll, scrollLeft + v * dt));
      }
    }

    // ── 계산 (캐시된 boxes만 사용 — 여기서 다시 재면 매 프레임 리플로)
    const draggedLeft = d.clientX - d.containerLeft + nextScroll - d.grabOffset;
    const to = dropIndex(d.boxes, d.fromIndex, draggedLeft);

    // ── 쓰기
    if (nextScroll !== scrollLeft) container.scrollLeft = nextScroll;
    if (draggedLeft !== d.lastDraggedLeft) {
      d.lastDraggedLeft = draggedLeft;
      const el = d.els[d.fromIndex];
      el.style.transform = `translateX(${draggedLeft - d.boxes[d.fromIndex].left}px) rotate(1.5deg)`;
    }
    if (to !== d.lastTo) {
      d.lastTo = to;
      d.toIndex = to;
      const shifts = shiftFor(d.boxes, d.fromIndex, to);
      d.els.forEach((el, i) => {
        if (i === d.fromIndex) return;
        el.style.transform = shifts[i] ? `translateX(${shifts[i]}px)` : '';
      });
    }
  }, [containerRef]);

  const beginVisual = useCallback((d: Drag) => {
    document.body.style.userSelect = 'none';
    d.els.forEach((el, i) => {
      el.style.willChange = 'transform';
      if (i === d.fromIndex) {
        el.style.transition = 'none';
        el.style.opacity = '.85';
        el.style.zIndex = '30';
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,.18)';
      } else {
        el.style.transition = d.reduce ? 'none' : 'transform 150ms ease';
      }
    });
  }, []);

  const startDrag = useCallback((index: number, e: React.PointerEvent) => {
    if (drag.current || columns.length < 2) return;
    const container = containerRef.current;
    if (!container) return;
    const els = columns.map((c) => getColumnEl(c.id));
    if (els.some((el) => !el)) return;

    // 측정은 여기서 딱 한 번. 매 프레임 재측정하면 강제 동기 레이아웃이 쌓여 확실히 끊긴다.
    const cRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const boxes: ColumnBox[] = (els as HTMLElement[]).map((el, i) => {
      const r = el.getBoundingClientRect();
      return { id: columns[i].id, left: r.left - cRect.left + scrollLeft, width: r.width };
    });

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const prevScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';   // 자동 스크롤이 부드러운 스크롤 설정과 싸우지 않게

    const d: Drag = {
      fromIndex: index,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      clientX: e.clientX,
      grabOffset: e.clientX - cRect.left + scrollLeft - boxes[index].left,
      containerLeft: cRect.left,
      containerWidth: cRect.width,
      prevScrollBehavior,
      boxes,
      els: els as HTMLElement[],
      active: false,
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      toIndex: index,
      lastTo: index,
      lastDraggedLeft: NaN,
      raf: null,
      lastT: 0,
    };
    drag.current = d;

    const move = (ev: PointerEvent) => {
      const cur = drag.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      cur.clientX = ev.clientX;   // 좌표만 저장. 계산과 DOM 쓰기는 rAF에서 프레임당 1회.
      if (!cur.active && Math.abs(ev.clientX - cur.startClientX) >= ACTIVATION_PX) {
        cur.active = true;
        beginVisual(cur);
        cur.lastT = performance.now();
        cur.raf = requestAnimationFrame(frame);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      // 끌다가 마음이 바뀌는 것은 흔한 일이다. 되돌릴 길이 없으면 애초에 시도하지 않는다.
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    };
    handlers.current = { move, up, cancel, key };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  }, [columns, containerRef, getColumnEl, beginVisual, frame, finish]);

  const moveByKeyboard = useCallback((index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= columns.length) return;
    const id = columns[index].id;
    onCommit(arrayMove(columns.map((c) => c.id), index, to));
    onAnnounce?.(`${columns[index].title}, ${columns.length}개 중 ${to + 1}번째`);
    // 재렌더 뒤에 옮겨간 컬럼을 화면에 보이게 한다
    requestAnimationFrame(() => getColumnEl(id)?.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' }));
  }, [columns, getColumnEl, onCommit, onAnnounce]);

  return { startDrag, moveByKeyboard };
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음. (아직 어디서도 쓰이지 않으므로 런타임 확인은 Task 7에서 한다.)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/useDeckDrag.ts
git commit -m "feat(x-research): 덱 드래그 훅 — rAF 배칭·transform 직접 쓰기·가장자리 자동 스크롤

드래그 중 React 리렌더 0회. 측정은 시작 시 1회만, 프레임당 읽기→쓰기 순서 고정,
will-change는 드래그 중에만. 5px 임계값·Escape 취소·방향 확인 후 자동 스크롤 포함.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 화면 연결 — 그립 배치와 낙관적 저장

**Files:**
- Modify: `src/components/Column.tsx` (import, props, 헤더 첫 줄, 루트 section)
- Modify: `src/app/w/[wsId]/page.tsx`

**Interfaces:**
- Consumes: `ColumnGrip` (Task 5), `useDeckDrag` (Task 6), `PATCH /api/columns/reorder` (Task 3)
- Produces: 없음 (최종 통합)

- [ ] **Step 1: `Column`에 그립 관련 prop과 `data-column-id`를 추가**

`src/components/Column.tsx` 12행의 import 아래에 추가:

```tsx
import { ColumnGrip } from './ColumnGrip';
```

Task 1에서 고친 시그니처를 다시 확장한다:

```tsx
export function Column({ column, isNew, index, total, onEdit, onDelete, onPickTag, onGripPointerDown, onKeyboardMove, tourAnchor }: {
  column: ColumnRow;
  isNew?: boolean;   // 방금 만든 컬럼 — 1회 자동 조회 + 화면으로 스크롤 + 잠깐 강조
  index: number;     // 0-based, 순서 변경 안내용
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
  onGripPointerDown: (e: React.PointerEvent) => void;
  onKeyboardMove: (delta: -1 | 1) => void;
  tourAnchor?: boolean;
}) {
```

- [ ] **Step 2: 루트 `<section>`에 `data-column-id`를 단다**

Task 1에서 고친 209행을 다시 교체한다. 훅이 `querySelector`로 이 속성을 찾는다:

```tsx
    <section ref={rootRef} data-column-id={column.id} style={{ width }}
             className={`relative flex h-full shrink-0 flex-col border-r border-x-border ${highlight ? 'ring-2 ring-inset ring-x-blue' : ''}`}>
```

- [ ] **Step 3: 헤더 첫 줄 맨 앞에 그립을 넣는다**

`src/components/Column.tsx`의 `<div className="flex items-center gap-1.5">` 바로 다음 줄(검색/사용자 아이콘 앞)에 삽입:

```tsx
          {total > 1 && (
            <ColumnGrip title={column.title} index={index} total={total}
                        onPointerDown={onGripPointerDown} onMove={onKeyboardMove} />
          )}
```

컬럼이 1개면 렌더하지 않는다 — 옮길 곳이 없는데 손잡이가 보이면 거짓 어포던스다.

- [ ] **Step 4: `page.tsx`에 훅과 낙관적 저장을 연결**

`src/app/w/[wsId]/page.tsx`를 아래로 교체한다:

```tsx
'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from '@/lib/types';
import { Column } from '@/components/Column';
import { ColumnSettings } from '@/components/ColumnSettings';
import { Toast } from '@/components/Toast';
import { useDeckDrag } from '@/lib/useDeckDrag';
import { useTour } from '@/lib/tour/useTour';
import { deckSteps } from '@/lib/tour/tourSteps';
import { hasSeenTour } from '@/lib/tour/tourState';
import { HelpButton } from '@/components/HelpButton';

export default function DeckPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; column?: ColumnRow; presetKeyword?: string } | null>(null);
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const deckRef = useRef<HTMLElement>(null);
  const { start, advance, activeTour } = useTour();
  const prevColCount = useRef(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const didAutoStart = useRef(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/columns?workspaceId=${wsId}`);
    if (r.ok) setColumns(await r.json());
    setLoadedOnce(true);
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  // 덱 첫 방문 시 1회 자동 투어. 최초 로드가 끝난 뒤 실행해야 실제 컬럼 수로 갈래(생성 유도 vs 사용법)를 고른다.
  // (로드 전엔 columns가 항상 []이라 '컬럼 없음' 갈래로 오판됨 — 기존 컬럼이 있는 사용자 배포 시 문제)
  useEffect(() => {
    if (!loadedOnce || didAutoStart.current || hasSeenTour('deck')) return;
    didAutoStart.current = true;
    const t = setTimeout(() => start('deck', deckSteps()), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedOnce]);

  // 행동 유도형 자동 전진: 모달이 열리면 add-column→create-modal
  useEffect(() => {
    if (activeTour === 'deck' && modal) advance('add-column');
  }, [modal, activeTour, advance]);

  // 컬럼이 새로 생기면 create-modal→col-refresh
  useEffect(() => {
    if (activeTour === 'deck' && columns.length > prevColCount.current) advance('create-modal');
    prevColCount.current = columns.length;
  }, [columns.length, activeTour, advance]);

  // Toast 자동 소멸
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const getColumnEl = useCallback(
    (id: string) => deckRef.current?.querySelector<HTMLElement>(`[data-column-id="${id}"]`) ?? null,
    [],
  );

  // 화면은 즉시 확정하고 저장은 뒤에서. 실패해도 드래그 직전 순서로 되돌리지 않는다 —
  // 거부되는 이유는 대개 다른 멤버가 그 사이 바꾼 것이라 그 순서도 이미 낡았다. 서버 것을 다시 받는다.
  const commitOrder = useCallback(async (ids: string[]) => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const next = ids.map((id) => byId.get(id)).filter((c): c is ColumnRow => !!c);
    if (next.length !== ids.length) return;
    setColumns(next);
    try {
      const r = await apiFetch('/api/columns/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, ids }),
      });
      if (!r.ok) {
        setToast(r.status === 409
          ? '다른 팀원이 컬럼을 바꿔서 순서를 저장하지 못했어요. 최신 상태로 새로 불러왔습니다.'
          : '순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
        await load();
      }
    } catch {
      setToast('순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
      await load();
    }
  }, [columns, wsId, load]);

  const { startDrag, moveByKeyboard } = useDeckDrag({
    columns, containerRef: deckRef, getColumnEl, onCommit: commitOrder, onAnnounce: setAnnounce,
  });

  async function submit(v: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig }) {
    const isEdit = modal?.mode === 'edit' && modal.column;
    const r = await apiFetch(isEdit ? `/api/columns/${modal.column!.id}` : '/api/columns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { title: v.title, config: v.config } : { ...v, workspaceId: wsId }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `오류 ${r.status}`);
    if (!isEdit) setNewColumnId(((await r.json()) as ColumnRow).id);
    await load();
  }

  // 삭제 확인은 Column 헤더의 인라인 확인 바가 담당(Sidebar 워크스페이스 삭제와 동일 패턴). 여기선 확정된 삭제만 수행.
  async function remove(col: ColumnRow) {
    await apiFetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-x-border bg-x-surface px-4 py-2">
        <button onClick={() => setModal({ mode: 'create' })}
                data-tour="add-column"
                className="rounded-full bg-x-text px-4 py-1.5 text-ui font-bold text-white hover:opacity-90">
          + 컬럼
        </button>
        <HelpButton onClick={() => start('deck', deckSteps())} />
      </div>
      <main ref={deckRef} className="flex flex-1 overflow-x-auto">
        {columns.length === 0 && (
          <p className="m-auto text-ui text-x-muted">컬럼이 없습니다 — “+ 컬럼”으로 키워드/인플루언서 컬럼을 만드세요</p>
        )}
        {columns.map((c, i) => (
          <Column key={c.id} column={c}
                  index={i} total={columns.length}
                  tourAnchor={i === 0}
                  isNew={c.id === newColumnId}
                  onEdit={() => setModal({ mode: 'edit', column: c })}
                  onDelete={() => remove(c)}
                  onPickTag={(tag) => setModal({ mode: 'create', presetKeyword: tag })}
                  onGripPointerDown={(e) => startDrag(i, e)}
                  onKeyboardMove={(delta) => moveByKeyboard(i, delta)} />
        ))}
      </main>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      {modal && (
        <ColumnSettings initial={modal.mode === 'edit' ? modal.column : undefined}
                        presetKeyword={modal.presetKeyword}
                        onSubmit={submit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음.

- [ ] **Step 6: 수동 확인 — 기능**

Run: `npm run dev`

컬럼을 6개 이상 만든 뒤(폭도 서로 다르게 조절해둔다) 확인한다:

1. **그립이 보인다** — 각 컬럼 제목 왼쪽. 마우스를 올리면 배경이 강조되고 커서가 손 모양.
2. **끌면 자리가 밀린다** — 잡은 컬럼은 반투명·기울어져 따라오고, 나머지가 실시간으로 비켜선다. 놓으면 보이던 그대로 확정된다.
3. **새로고침해도 순서가 유지된다.**
4. **그냥 클릭만 하면 아무 일도 없다** — 순서 변화 없음. DevTools Network에 `/api/columns/reorder` 요청이 **뜨지 않아야** 한다.
5. **드래그 중 Escape** → 원래 자리로 돌아가고 요청도 없다.
6. **오른쪽 끝 컬럼을 집어도 스트립이 즉시 날아가지 않는다.** 오른쪽으로 밀어야 스크롤이 시작된다.
7. **가장자리 자동 스크롤** — 왼쪽/오른쪽 끝으로 끌고 가면 가까울수록 빨라진다.
8. **폭 조절과 충돌 없음** — 컬럼 우측 가장자리를 끌면 폭만 바뀌고 순서는 그대로.
9. **컬럼이 1개면 그립이 안 보인다.**
10. **키보드** — Tab으로 그립에 포커스(2px 파란 아웃라인이 보여야 함) → `←` `→`로 이동, 이동한 컬럼이 화면에 들어온다. 첫 컬럼에서 `←`, 마지막에서 `→`는 무반응이고 Network 요청도 없다.
11. **동작 줄이기 켠 상태** — 비켜서는 애니메이션이 사라지고 즉시 이동한다.

- [ ] **Step 7: 수동 확인 — 성능**

DevTools → Performance 탭에서 녹화하며 트윗이 가득 찬 컬럼 6개를 드래그한다.

Expected:
- 프레임 대부분이 16ms 이내. 긴 빨간 막대(Long Task)가 연속으로 뜨지 않는다.
- Main 트랙에 **드래그 중 React 커밋이 보이지 않는다**(놓는 순간에만 1회).
- `Recalculate Style` / `Layout`이 매 프레임 반복되지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/Column.tsx "src/app/w/[wsId]/page.tsx"
git commit -m "feat(x-research): 컬럼 그립 드래그로 순서 변경 (낙관적 저장 + 실패 시 재조회)

순서를 바꾸려면 삭제 후 재생성뿐이었고 그러면 쌓인 트윗이 사라졌다.
그립 상시 노출, 끄는 동안 실제 자리 밀림, 실패 시 되돌리지 않고 서버 순서를 재조회.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `content-visibility` — 덱 전체 렌더 비용 절감

앞 태스크들과 독립이다. 문제가 재현되면 **이 커밋만 되돌리면 된다.**

**Files:**
- Modify: `src/components/Column.tsx` (루트 section의 style)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 적용 전 기준값을 잰다**

`npm run dev`로 컬럼 6개(각 트윗 100개 이상)를 띄우고 DevTools → Performance에서 **가로 스크롤을 5초간 왕복**하며 녹화한다.

기록할 것: Rendering(Layout + Paint) 합계 ms. 이 숫자를 Step 4에서 비교한다.

- [ ] **Step 2: 루트 section에 적용**

`src/components/Column.tsx`의 루트 `<section>` style을 교체한다:

```tsx
    <section ref={rootRef} data-column-id={column.id}
             style={{
               width,
               // 화면 밖 컬럼의 트윗 수백 개는 레이아웃·페인트를 건너뛴다. 화면 안 컬럼도
               // 강제되는 containment 덕에 한 컬럼의 변화가 다른 컬럼 레이아웃을 건드리지 않는다.
               // (Chrome 팀 가이드가 칸반 컬럼을 대표 사례로 든다)
               contentVisibility: 'auto',
               // 폭·높이가 이미 확정(width는 px, 높이는 h-full)이라 크기 추측이 필요 없다.
               // 그래서 "c-v:auto 하위로 scrollIntoView가 어긋나는" 알려진 버그에 걸리지 않는다.
               containIntrinsicWidth: `auto ${width}px`,
             }}
             className={`relative flex h-full shrink-0 flex-col border-r border-x-border ${highlight ? 'ring-2 ring-inset ring-x-blue' : ''}`}>
```

- [ ] **Step 3: 타입 확인 — 실패 시 대체 경로**

Run: `npx tsc --noEmit`

`containIntrinsicWidth`가 React의 `CSSProperties`에 없다고 나오면, 인라인 style에서 그 줄을 빼고 대신 클래스로 준다. `src/app/globals.css`(또는 Tailwind 엔트리 CSS)에 추가:

```css
.deck-column {
  content-visibility: auto;
  contain-intrinsic-width: auto 400px;
}
```

그리고 section의 style에서 `contentVisibility`/`containIntrinsicWidth`를 지우고 className 앞에 `deck-column `을 붙인다. (기본 폭 400px 기준 추정값 — 폭이 확정돼 있어 실제로는 사용되지 않는다.)

- [ ] **Step 4: 수동 확인 — 성능 이득**

Step 1과 **똑같은 조건**으로 다시 녹화한다.

Expected: Rendering 합계가 줄어든다. 늘었다면 Step 6으로 간다.

- [ ] **Step 5: 수동 확인 — 부작용 (이 단계가 이 태스크의 핵심)**

1. **새 컬럼 자동 스크롤이 정확히 멈추는가** — 컬럼 8개 상태에서 `+ 컬럼`으로 하나 더 만든다. 새 컬럼이 **화면 안에 정확히** 들어와야 한다. 덜 스크롤되어 반쯤 잘리면 실패다.
2. **가로 스크롤이 매끄러운가** — 트랙패드로 좌우로 빠르게 스와이프. 뻑뻑하거나 튀면 실패.
3. **컬럼 안 세로 스크롤 위치가 유지되는가** — 3번 컬럼을 아래로 스크롤 → 오른쪽 끝까지 갔다가 → 돌아온다. 스크롤 위치가 유지돼야 한다.
4. **드래그가 여전히 매끄러운가** — Task 7 Step 7을 다시 한다.
5. **Ctrl/Cmd+F 페이지 내 검색**으로 화면 밖 컬럼의 트윗 단어가 찾아지는가.

- [ ] **Step 6: 판정**

- 전부 통과 → Step 7로 커밋한다.
- 하나라도 실패 → **되돌린다.** `git checkout -- src/components/Column.tsx` 후 설계 문서의 리스크 표에 관측한 증상(브라우저·재현 절차 포함)을 적고 커밋한다. 이 최적화는 A·B와 독립이므로 빼도 나머지 기능은 온전하다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/Column.tsx
git commit -m "perf(x-research): 컬럼에 content-visibility 적용 — 화면 밖 트윗 렌더 생략

컬럼 6개면 화면에 트윗 카드 1,000개가 뜬다. 화면 밖 컬럼은 레이아웃·페인트를 건너뛰고,
화면 안 컬럼도 containment 경계 덕에 서로의 레이아웃 재계산을 유발하지 않는다.
폭·높이가 확정돼 있어 크기 추측이 없으므로 scrollIntoView 어긋남 이슈에 걸리지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test 2>&1 | tail -20`
Expected: 전부 PASS.

- [ ] **Step 2: 타입·린트·빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음.

- [ ] **Step 3: 마이그레이션 재실행 안전성 재확인**

Run: `npm run migrate && npm run migrate`
Expected: 두 번 다 통과. 두 번째 실행 후에도 브라우저에서 컬럼 순서가 **바뀌지 않았는지** 확인한다(직접 옮겨둔 순서가 생성순으로 돌아가면 마이그레이션 가드가 잘못된 것).

- [ ] **Step 4: 설계 문서의 수동 확인 목록을 전부 실행**

`docs/superpowers/specs/2026-07-27-deck-column-order-design.md`의 "수동 확인(브라우저)" 항목 9개를 하나씩 확인한다.

- [ ] **Step 5: 남은 이슈 기록**

관측했지만 이번 범위에서 고치지 않은 것이 있으면 설계 문서 리스크 표에 추가하고 커밋한다. 없으면 이 단계는 건너뛴다.

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| A: 오른쪽 끝 유지 + 스크롤 + 1.5초 강조 + reduced-motion | Task 1 |
| A: `autoRefreshId` → `newColumnId` 통합 | Task 1 |
| B: 그립 상시 노출, 컬럼 1개면 숨김, 포커스 링 | Task 5, Task 7 Step 3 |
| B: 5px 활성화 임계값 | Task 6 |
| B: 실시간 자리 밀림, 잡은 컬럼 시각 처리 | Task 6 |
| B: Escape / pointercancel 취소 | Task 6 |
| B: 낙관적 확정 + 실패 시 재조회 + 문구 2종 | Task 7 |
| B: 키보드 이동 + 경계 무반응 + aria-live | Task 5, Task 6, Task 7 |
| 데이터: 마이그레이션(재실행 안전) | Task 2 |
| 데이터: 생성 시 서버 채번, `body.position` 제거 | Task 2 |
| 데이터: 전체 배열 저장 + 집합 불일치 409 | Task 2, Task 3 |
| 성능: rAF 배칭 / transform 전용 / 측정 캐시 / pointer capture / touch-action / will-change 해제 | Task 5(touch-none), Task 6(나머지) |
| 성능: 자동 스크롤 (비율·제곱·방향 확인·scroll-behavior) | Task 4, Task 6 |
| 성능: 리렌더 0회 | Task 6, Task 7 Step 7 검증 |
| 성능: `content-visibility` + 부작용 검증 + 독립 롤백 | Task 8 |
| 테스트: `deckReorder` 경계 케이스 | Task 4 |
| 테스트: `columnStore` position/reorder | Task 2 |

누락 없음.

**타입 일관성 확인**

- `Column`의 prop 이름은 Task 1에서 `isNew`로 정해지고 Task 7에서 확장만 된다 — 두 태스크가 같은 이름을 쓴다.
- `ColumnGrip`의 `onMove(delta: -1 | 1)`는 `Column`의 `onKeyboardMove(delta: -1 | 1)`를 거쳐 `useDeckDrag`의 `moveByKeyboard(index, delta: -1 | 1)`로 이어진다 — 시그니처 일치.
- `getColumnEl`은 Task 6이 요구하고 Task 7이 `data-column-id`(Task 7 Step 2에서 부여)로 구현한다.
- `ColumnSetMismatch`는 Task 2에서 정의되고 Task 3에서 `instanceof`로 쓰인다.
- `ColumnBox`는 Task 4에서 정의되고 Task 6에서 import된다.

**알려진 순서 의존성**

Task 7 Step 2가 Task 1 Step 4에서 쓴 같은 줄을 다시 교체한다. Task 8 Step 2가 다시 한 번 교체한다. 순서대로 실행하면 문제없지만, 건너뛰면 `data-column-id`가 빠져 드래그가 조용히 동작하지 않는다(`startDrag`가 `els.some(el => !el)`에서 즉시 반환). 순서를 지킬 것.

---

## 실행 방식 선택

계획을 `docs/superpowers/plans/2026-07-27-deck-column-order.md`에 저장했습니다. 두 가지 실행 방식이 있습니다.

1. **서브에이전트 방식 (권장)** — 태스크마다 새 서브에이전트를 붙이고 사이사이 검토
2. **인라인 실행** — 이 세션에서 체크포인트를 두고 순차 실행
