# /generate 뷰 다양화 + 패널 접기 구현 계획 (워크벤치 2차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 우측 결과 영역에 카드/테이블/칸반 뷰 전환을 추가하고, 좌 생성 패널을 레일형으로 접을 수 있게 한다(뷰 연동 자동 + 수동 우선). 스펙: `docs/superpowers/specs/2026-08-10-generate-views-collapse-design.md`

**Architecture:** 순수 프론트엔드. 신규 컴포넌트 2개(DraftTable·DraftKanban)와 공용 파생 유틸(draftViews)을 만들고, page.tsx가 뷰 상태·접힘 상태·카드 점프를 배선한다. 상태 변경은 기존 `changeStatus`(낙관적 갱신·실패 롤백)를 그대로 재사용 — 칸반 드롭·테이블 칩 모두.

**Tech Stack:** React 19 + Tailwind 4, HTML5 네이티브 DnD(라이브러리 추가 금지), node:test + tsx.

## Global Constraints

- 서버·API·DB 변경 금지. 기존 데이터 로직(generate/rewrite/폴링/삭제·무시·상태 변경 핸들러 본문) 변경 금지.
- DraftCard·DraftStatusChip·ComposerFooter·DraftComposer 파일 변경 금지 (DraftFilterBar만 prop 1개 추가).
- AGENTS.md UX 원칙: 내부 개념어 노출 금지, 라벨-값 일치, 아이콘 버튼은 aria-label+title 필수.
- 시각 층 원칙: 테이블·칸반·레일 = 도구층(text-ui/caption, bg-x-surface 계열). 카드 뷰는 현행 그대로.
- 검증: `npx tsc --noEmit` 새 오류 0건, `npm run lint` 기준선(24) 초과 금지, 신규 테스트는 T1 순수 함수만.
- **병렬 실행 규약**: W1={T1,T2,T3 병렬} W2={T4}. **작업자는 git 커밋 금지** — 조율자가 파일 단위 분리 커밋. tsc·lint에서 자기 파일 밖 오류는 무시하고 보고에만 구분 기재.

---

### Task 1: draftViews 공용 파생 유틸 + 테스트 — 권장 모델: haiku

**Files:**
- Create: `src/lib/draftViews.ts`
- Create: `src/lib/draftViews.test.ts`

**Interfaces:**
- Produces (T2·T3·T4가 import): `draftPreviewLine(d)`, `sortDrafts(list, sort, clientNameOf)`, `groupByStatus(list)`, `type TableSort`, `type TableSortKey`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/draftViews.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPreviewLine, sortDrafts, groupByStatus } from './draftViews.ts';
import type { DraftStatus } from './draftStatus.ts';

const post = (text: string) => ({ posts: [{ text }] });
const row = (over: Partial<{ id: string; createdAt: string; clientId: string | null; status: DraftStatus }>) => ({
  id: 'x', createdAt: '2026-08-10T00:00:00Z', clientId: null, status: 'draft' as DraftStatus, ...over,
});

test('draftPreviewLine: 편집본 우선, 첫 줄만, 공백 정리', () => {
  assert.equal(draftPreviewLine({ content: post('원문 첫 줄\n둘째 줄'), edited: null }), '원문 첫 줄');
  assert.equal(draftPreviewLine({ content: post('원문'), edited: post('  편집본 첫 줄  \n둘째') }), '편집본 첫 줄');
  assert.equal(draftPreviewLine({ content: { posts: [] }, edited: null }), '');
});

test('sortDrafts: 생성일 내림차순 기본·원본 불변', () => {
  const a = row({ id: 'a', createdAt: '2026-08-01T00:00:00Z' });
  const b = row({ id: 'b', createdAt: '2026-08-09T00:00:00Z' });
  const list = [a, b];
  const sorted = sortDrafts(list, { key: 'createdAt', dir: 'desc' }, () => '');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']); // 원본 그대로
});

test('sortDrafts: 클라이언트명은 한국어 locale 비교', () => {
  const names: Record<string, string> = { c1: '바른의원', c2: '가온의원' };
  const list = [row({ id: 'a', clientId: 'c1' }), row({ id: 'b', clientId: 'c2' })];
  const sorted = sortDrafts(list, { key: 'client', dir: 'asc' }, (id) => (id ? names[id] : '—'));
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']); // 가온 < 바른
});

test('sortDrafts: 상태는 워크플로 순서(초안→…→미사용)', () => {
  const list = [row({ id: 'a', status: 'delivered' }), row({ id: 'b', status: 'draft' }), row({ id: 'c', status: 'review' })];
  const sorted = sortDrafts(list, { key: 'status', dir: 'asc' }, () => '');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'c', 'a']);
});

test('groupByStatus: 5개 열이 항상 존재하고 열 안은 최신순', () => {
  const g = groupByStatus([
    row({ id: 'old', status: 'draft', createdAt: '2026-08-01T00:00:00Z' }),
    row({ id: 'new', status: 'draft', createdAt: '2026-08-09T00:00:00Z' }),
    row({ id: 'd1', status: 'delivered' }),
  ]);
  assert.deepEqual(g.draft.map((x) => x.id), ['new', 'old']);
  assert.equal(g.delivered.length, 1);
  assert.deepEqual(g.review, []); assert.deepEqual(g.approved, []); assert.deepEqual(g.unused, []);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/draftViews.test.ts` / Expected: FAIL (module not found)

- [ ] **Step 3: 구현** — `src/lib/draftViews.ts`

```ts
import { DRAFT_STATUSES, type DraftStatus } from '@/lib/draftStatus';

// 뷰 공용 파생 — 테이블·칸반이 같은 계산을 쓰도록 순수 함수로 (스펙 2차 §draftViews)
interface PreviewSource { posts: Array<{ text: string }> }

export function draftPreviewLine(d: { content: PreviewSource; edited: PreviewSource | null }): string {
  const text = (d.edited ?? d.content).posts[0]?.text ?? '';
  return (text.split('\n')[0] ?? '').trim();
}

export type TableSortKey = 'createdAt' | 'client' | 'status';
export interface TableSort { key: TableSortKey; dir: 'asc' | 'desc' }

// 원본 불변. client 정렬은 표시명 기준이라 이름 해석 함수를 받는다(한국어 locale 비교).
export function sortDrafts<T extends { createdAt: string; clientId: string | null; status: DraftStatus }>(
  list: T[], sort: TableSort, clientNameOf: (id: string | null) => string,
): T[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (sort.key === 'client') return clientNameOf(a.clientId).localeCompare(clientNameOf(b.clientId), 'ko') * flip;
    const x = sort.key === 'createdAt' ? Date.parse(a.createdAt) : DRAFT_STATUSES.indexOf(a.status);
    const y = sort.key === 'createdAt' ? Date.parse(b.createdAt) : DRAFT_STATUSES.indexOf(b.status);
    return (x - y) * flip;
  });
}

// 칸반 열 데이터 — 5개 상태 열이 항상 존재, 열 내부는 최신순
export function groupByStatus<T extends { status: DraftStatus; createdAt: string }>(list: T[]): Record<DraftStatus, T[]> {
  const out = Object.fromEntries(DRAFT_STATUSES.map((s) => [s, [] as T[]])) as Record<DraftStatus, T[]>;
  for (const d of list) out[d.status].push(d);
  for (const s of DRAFT_STATUSES) out[s].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out;
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/draftViews.test.ts` / Expected: PASS (5 tests)
- [ ] **Step 5: 정적 검증** — Run: `npx tsc --noEmit && npx eslint src/lib/draftViews.ts src/lib/draftViews.test.ts` / Expected: 자기 파일 오류 0건. (커밋 금지)

---

### Task 2: DraftTable (트리아지 테이블) — 권장 모델: haiku

**Files:**
- Create: `src/components/DraftTable.tsx`

**Interfaces:**
- Consumes: T1의 `draftPreviewLine`·`sortDrafts`·`TableSort`·`TableSortKey`, 기존 `DraftStatusChip({status,onChange})`·`draftTimeLabel(iso)`.
- Produces (T4가 import): `DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard })`.

- [ ] **Step 1: 파일 작성**

```tsx
'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftStatus } from '@/lib/draftStatus';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftPreviewLine, sortDrafts, type TableSort, type TableSortKey } from '@/lib/draftViews';

// 트리아지용 테이블 — 정독 액션은 없다. 행 클릭 = 카드 뷰 점프 (스펙 2차 §DraftTable)
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: 'createdAt', dir: 'desc' });
  const rows = sortDrafts(drafts, sort, clientNameOf);
  const sortBtn = (key: TableSortKey, label: string) => (
    <button onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            <th className="px-3 py-2 font-normal">원고</th>
            <th className="px-3 py-2 font-normal">{sortBtn('client', '클라이언트')}</th>
            <th className="px-3 py-2 font-normal">시술</th>
            <th className="px-3 py-2 font-normal">형식</th>
            <th className="px-3 py-2 font-normal">{sortBtn('status', '상태')}</th>
            <th className="px-3 py-2 font-normal">{sortBtn('createdAt', '생성')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} onClick={() => onOpenCard(d.id)}
                className="cursor-pointer border-b border-x-border hover:bg-x-hover">
              <td className="max-w-[360px] truncate px-3 py-2">{draftPreviewLine(d) || '(내용 없음)'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{clientNameOf(d.clientId)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.procedureNames.join(' · ') || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.format === 'thread' ? '스레드' : '단문'}</td>
              {/* 칩 클릭이 행 클릭(카드 점프)으로 번지지 않게 — 셀에서 차단 */}
              <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 정적 검증** — Run: `npx tsc --noEmit && npx eslint src/components/DraftTable.tsx` / Expected: 자기 파일 오류 0건 (T1이 병렬 진행 중이라 draftViews 미존재 오류가 나면 보고에 명시하고 대기 후 재검증 — T1 완료가 늦으면 그 사실만 보고). (커밋 금지)

---

### Task 3: DraftKanban (파이프라인 칸반) — 권장 모델: sonnet

**Files:**
- Create: `src/components/DraftKanban.tsx`

**Interfaces:**
- Consumes: T1의 `draftPreviewLine`·`groupByStatus`, 기존 `DRAFT_STATUSES`·`STATUS_LABEL`·`draftTimeLabel`.
- Produces (T4가 import): `DraftKanban({ drafts, clientNameOf, onChangeStatus, onOpenCard })` — DraftTable과 동일 props.

- [ ] **Step 1: 파일 작성**

```tsx
'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftPreviewLine, groupByStatus } from '@/lib/draftViews';

// 열 헤더 점 색 — DraftStatusChip의 STATUS_STYLE과 같은 계열 유지 (색은 UI 파일에만)
const STATUS_DOT: Record<DraftStatus, string> = {
  draft: 'bg-x-muted', review: 'bg-amber-500', approved: 'bg-x-blue', delivered: 'bg-green-500', unused: 'bg-x-border-strong',
};

// 파이프라인용 칸반 — 열 위치가 곧 상태. 드롭 = 상태 변경(낙관적 갱신·롤백은 부모 changeStatus 재사용)
// DnD는 마우스 전용 — 키보드 사용자는 카드 클릭→카드 뷰의 상태 칩이 등가 경로 (스펙 §접근성)
export function DraftKanban({ drafts, clientNameOf, onChangeStatus, onOpenCard }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
}) {
  const [overCol, setOverCol] = useState<DraftStatus | null>(null);
  const byStatus = groupByStatus(drafts);
  return (
    <div className="flex w-full gap-3 overflow-x-auto pb-2">
      {DRAFT_STATUSES.map((s) => (
        <div key={s}
             onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverCol(s); }}
             onDragLeave={() => setOverCol((cur) => (cur === s ? null : cur))}
             onDrop={(e) => {
               e.preventDefault(); setOverCol(null);
               const d = drafts.find((x) => x.id === e.dataTransfer.getData('text/plain'));
               if (d && d.status !== s) onChangeStatus(d, s);
             }}
             className={`flex min-h-[220px] w-[210px] shrink-0 flex-col rounded-xl border p-2 ${overCol === s ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface'}`}>
          <p className="flex items-center gap-1.5 px-1 pb-2 text-caption font-bold text-x-secondary">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {STATUS_LABEL[s]} <span className="tabular-nums font-normal text-x-muted">{byStatus[s].length}</span>
          </p>
          <div className="flex flex-col gap-2">
            {byStatus[s].map((d) => (
              <div key={d.id} draggable
                   onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; }}
                   onClick={() => onOpenCard(d.id)}
                   className="cursor-pointer rounded-lg border border-x-border bg-white p-2 hover:border-x-border-strong">
                <p className="line-clamp-2 text-ui">{draftPreviewLine(d) || '(내용 없음)'}</p>
                <p className="mt-1 truncate text-caption text-x-muted">
                  {[clientNameOf(d.clientId), ...d.procedureNames, d.format === 'thread' ? '스레드' : '단문'].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-0.5 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</p>
              </div>
            ))}
            {byStatus[s].length === 0 && (
              <p className="rounded-lg border border-dashed border-x-border-strong p-3 text-center text-caption leading-relaxed text-x-muted">
                여기로 끌어다 놓으면<br />상태가 바뀝니다
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

주의: `onDragLeave`는 자식 요소 진입 시에도 발생한다 — 위 구현은 `dragover`가 곧바로 다시 setOverCol(s)를 호출하므로 깜빡임은 실사용상 무해. 더 정교한 처리(relatedTarget 검사)는 넣지 않는다(YAGNI).

- [ ] **Step 2: 정적 검증** — Task 2의 Step 2와 동일 기준(자기 파일 0건, T1 대기 케이스 동일). (커밋 금지)

---

### Task 4: page.tsx 통합 — 뷰 토글·패널 레일·카드 점프 + DraftFilterBar prop — 권장 모델: sonnet

**Files:**
- Modify: `src/app/generate/page.tsx`
- Modify: `src/components/DraftFilterBar.tsx`

**Interfaces:**
- Consumes: T1 `draftViews`(직접 import 없음 — T2·T3 경유), T2 `DraftTable`, T3 `DraftKanban` (둘 다 `{ drafts, clientNameOf, onChangeStatus, onOpenCard }`).
- Produces: 없음 (말단).

- [ ] **Step 1: DraftFilterBar에 showStatusTabs prop**

시그니처에 `showStatusTabs = true` 추가(`showStatusTabs?: boolean`), "전체" 버튼과 상태 탭 map을 `{showStatusTabs && (<>...</>)}`로 감싼다. 클라이언트 셀렉트(`ml-auto`)는 그대로 — 탭이 숨어도 우측 정렬 유지.

- [ ] **Step 2: page.tsx — 상태·헬퍼 추가**

import 추가:

```tsx
import { DraftTable } from '@/components/DraftTable';
import { DraftKanban } from '@/components/DraftKanban';
```

`Workbench` 상단(리사이즈 상태 옆)에:

```tsx
  // 보기 방식 — 렌즈(필터)와 달리 작업 방식 선호라 저장한다 (스펙 2차 §확정 결정)
  type ResultView = 'cards' | 'table' | 'kanban';
  const VIEW_KEY = 'cbx-generate-view';
```

(주의: 타입·상수는 컴포넌트 밖 최상위에 선언 — `COMPOSER_KEY` 옆.)

```tsx
  const [view, setViewState] = useState<ResultView>('cards');
  // 패널 접힘: null=자동(카드 뷰=펼침, 테이블·칸반=접힘), 'open'|'closed'=수동 고정(세션 한정)
  const [panelPref, setPanelPref] = useState<'open' | 'closed' | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const v = localStorage.getItem(VIEW_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원 (COMPOSER_KEY와 같은 관례)
    if (v === 'table' || v === 'kanban') setViewState(v);
  }, []);
  const setView = useCallback((v: ResultView) => { setViewState(v); localStorage.setItem(VIEW_KEY, v); }, []);
  const panelOpen = panelPref !== null ? panelPref === 'open' : view === 'cards';
  const clientNameOf = useCallback(
    (id: string | null) => (id ? (clients.find((c) => c.client.id === id)?.client.name ?? '?') : '—'),
    [clients]);

  // 테이블·칸반에서 원고를 눌렀을 때 — 카드 뷰로 점프해 정독. 필터에 가려 있으면 전체로(T11 계열: 점프가 소리 없이 실패하지 않게)
  function openCard(id: string) {
    setView('cards');
    const target = draftsRef.current.find((d) => d.id === id);
    if (target) setFilter((f) => (filterDrafts([target], f).length > 0 ? f : { status: 'all', clientId: '' }));
    setHighlightId(id);
    setTimeout(() => { // 카드 뷰 DOM이 그려진 다음 프레임에 스크롤
      document.querySelector(`[data-draft-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    setTimeout(() => setHighlightId(null), 1600);
  }
```

`?ref=` 진입 effect의 `if (found) ...` 분기에 `setPanelPref('open');` 추가 — 접힌 상태로 진입해도 연결 결과가 보이게 (스펙 §경계 조건).

- [ ] **Step 3: page.tsx — 좌 컬럼을 접힘 대응으로**

기존 좌 컬럼 div를 다음 구조로 교체(내부 콘텐츠는 그대로):

```tsx
      {/* 좌: 생성 패널 — 접히면 lg에서 레일로. <lg 스택에서는 접기 개념 없음(항상 펼침) */}
      <div className={`flex shrink-0 flex-col bg-x-surface lg:min-h-0 ${panelOpen ? 'lg:w-[var(--panel-w)]' : 'lg:hidden'}`}>
        <div className="space-y-3 p-4 lg:flex-1 lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
              <p className="mt-0.5 text-caption text-x-secondary">레퍼런스와 클라이언트 정보를 조합해 인플루언서에게 보낼 X 원고 초안을 만들어요.</p>
            </div>
            <button onClick={() => setPanelPref('closed')} aria-label="생성 패널 접기" title="생성 패널 접기"
                    className="hidden shrink-0 rounded p-1 text-x-muted hover:bg-x-hover lg:block">«</button>
          </div>
          {/* (기존: 클라이언트 0건 배너 · DraftComposer — 그대로) */}
        </div>
        {/* (기존: ComposerFooter — 그대로) */}
      </div>
      {!panelOpen && (
        <div className="hidden w-12 shrink-0 flex-col items-center gap-1.5 border-r border-x-border bg-x-surface py-3 lg:flex">
          <button onClick={() => setPanelPref('open')} aria-label="생성 패널 펼치기" title="생성 패널 펼치기"
                  className="rounded p-1.5 text-x-secondary hover:bg-x-hover">»</button>
          <button onClick={() => setPanelPref('open')} aria-label="새 원고 만들기 — 생성 패널이 펼쳐집니다" title="새 원고"
                  className="rounded p-1.5 text-[15px] font-bold text-x-blue-text hover:bg-x-blue/10">✚</button>
          {generating && <span role="status" aria-label="원고 생성 중" className="mt-1 h-2 w-2 animate-pulse rounded-full bg-x-blue" />}
        </div>
      )}
```

구분선(리사이즈 핸들) div는 `{panelOpen && (` 조건으로 감싼다(접힘 상태에선 리사이즈 대상이 없음).

- [ ] **Step 4: page.tsx — 우 컬럼 헤더에 뷰 토글, 본문 뷰 분기**

필터 헤더 행을 다음으로 교체:

```tsx
        {loaded && drafts.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-x-border bg-x-surface px-4 py-2">
            <div className="flex gap-1" role="group" aria-label="보기 방식">
              {(['cards', 'table', 'kanban'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                        className={`rounded-full border px-2.5 py-0.5 text-[13px] ${view === v ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                  {v === 'cards' ? '카드' : v === 'table' ? '테이블' : '칸반'}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <DraftFilterBar counts={counts} total={clientScoped.length} filter={filter}
                              clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                              onChange={setFilter} showStatusTabs={view !== 'kanban'} />
            </div>
          </div>
        )}
```

본문(스크롤 컨테이너 내부)을 뷰 분기로 교체 — 스켈레톤·빈 상태 문구는 기존 그대로 재사용:

```tsx
        <div ref={resultsRef} className="lg:flex-1 lg:overflow-y-auto">
          <div className={view === 'cards' ? 'flex flex-col items-center gap-4 p-6' : 'p-4'}>
            {generating && view === 'cards' && (
              /* 기존 스켈레톤 JSX 그대로 */
            )}
            {generating && view !== 'cards' && (
              <p className="mb-3 rounded-lg bg-white px-3 py-2 text-ui text-x-secondary">원고 작성 중… 완성되면 초안으로 나타나요 — 취소해도 생성은 계속됩니다</p>
            )}
            {/* 기존 빈 상태 2종 그대로 — 단 필터 빈 상태는 칸반 제외: && view !== 'kanban' 조건 추가
               (칸반은 상태 필터를 쓰지 않아 "이 조건에 맞는 초안이 없어요"가 성립하지 않음) */}
            {view === 'cards' && visibleDrafts.map((d) => (
              <div key={d.id} data-draft-id={d.id}
                   className={`w-full max-w-[600px] ${highlightId === d.id ? 'rounded-2xl ring-2 ring-x-blue' : ''}`}>
                <DraftCard draft={d} /* 기존 props 전부 그대로 */ />
              </div>
            ))}
            {view === 'table' && loaded && visibleDrafts.length > 0 && (
              <DraftTable drafts={visibleDrafts} clientNameOf={clientNameOf}
                          onChangeStatus={changeStatus} onOpenCard={openCard} />
            )}
            {view === 'kanban' && loaded && clientScoped.length > 0 && (
              <DraftKanban drafts={clientScoped} clientNameOf={clientNameOf}
                           onChangeStatus={changeStatus} onOpenCard={openCard} />
            )}
          </div>
        </div>
```

주의:
- 카드 map의 key·기존 props를 래퍼 div로 옮길 때 DraftCard props는 한 글자도 바꾸지 않는다.
- 칸반 데이터는 `clientScoped`(상태 필터 무시, 클라이언트 필터만 — 스펙 §데이터 모델), 테이블은 `visibleDrafts`(상태 탭 적용).
- `changeStatus`는 기존 함수 그대로 — 시그니처 `(d: DraftRow, status: DraftStatus)`가 두 컴포넌트 props와 일치.

- [ ] **Step 5: 정적 검증** — Run: `npx tsc --noEmit && npm run lint` / Expected: tsc 0건, lint 총 24개(기준선).
- [ ] **Step 6: 스모크** — dev 서버가 이미 떠 있으면(포트 3000) `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/generate` → 307/200, 서버 로그에 컴파일 에러 없음. 안 떠 있으면 `npm run dev` 기동 후 확인·종료.

---

## 실행 순서 요약

| Wave | Task | 파일 | 모델 |
|---|---|---|---|
| 1 | T1 draftViews | `src/lib/draftViews*` | haiku |
| 1 | T2 DraftTable | `src/components/DraftTable.tsx` | haiku |
| 1 | T3 DraftKanban | `src/components/DraftKanban.tsx` | sonnet |
| 2 | T4 page 통합 | `page.tsx`, `DraftFilterBar.tsx` | sonnet |

커밋: 조율자가 태스크별 파일만 add해 분리 커밋. T2·T3는 T1과 병렬이므로 T1 미완 시점의 draftViews 미존재 tsc 오류는 예상 상태(보고에만 기재). 마감: 전체 tsc·lint·`npm test` 회귀 확인 후 최종 전체 리뷰(opus).
