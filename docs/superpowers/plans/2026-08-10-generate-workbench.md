# /generate 워크벤치 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/generate`를 단일 컬럼 피드에서 "좌 생성 패널(리사이즈 가능) / 우 결과(고정 필터 헤더)" 2단 워크벤치로 재구성한다. 스펙: `docs/superpowers/specs/2026-08-10-generate-workbench-design.md`

**Architecture:** 순수 프론트엔드 변경. 상태·핸들러 로직은 전부 `page.tsx`에 그대로 두고 렌더 구조만 재배치한다. `DraftComposer`는 "섹션부(스크롤 영역용)"와 "풋터(하단 고정 요약+버튼)" 두 컴포넌트로 분리하되 둘 다 기존처럼 완전 제어형(controlled)이다. 리사이즈 경계 규칙만 신규 순수 함수로 추가한다.

**Tech Stack:** Next.js(App Router) + React 19 + Tailwind 4. 테스트는 node:test + tsx (`import ... from './x.ts'` 확장자 포함 관례).

## Global Constraints

- 서버·API·DB 변경 금지. `ComposerState`·`DEFAULT_COMPOSER`·localStorage `cbx-composer` 정책(방향성·시안 수는 저장 안 함) 변경 금지.
- AGENTS.md UX 원칙 준수: 내부 개념어 노출 금지, 라벨과 값 일치, 비용 유발 버튼 옆에 조건·비용 표시.
- 시각 층 원칙: 좌패널·필터 헤더·카드 상단 스트립 = 도구층(`bg-x-surface`, text-ui/caption 스케일) / 초안 카드 본문 = X 콘텐츠층(15px/20, max-w-600) 그대로.
- 주석은 한국어, 기존 밀도를 따른다(제약·이유만, 변경 서술 금지).
- 검증 기준: `npx tsc --noEmit` 새 오류 0건, `npm run lint` 기준선(24개) 초과 금지. 컴포넌트 테스트 하네스는 없음 — 신규 테스트는 Task 1의 순수 함수만.
- **병렬 실행 규약**: Wave 1 = Task 1·2·3 병렬(서로 다른 파일, 상호 의존 없음), Wave 2 = Task 4(Task 1·2 산출물 import). **작업자는 git 커밋을 하지 않는다** — 같은 워킹트리에서 병렬 커밋은 인덱스 경합을 일으키므로, 조율자가 태스크별 리뷰 후 커밋한다.

---

### Task 1: 패널 리사이즈 경계 규칙 (순수 함수 + 테스트) — 권장 모델: haiku

**Files:**
- Create: `src/lib/panelResize.ts`
- Create: `src/lib/panelResize.test.ts`

**Interfaces:**
- Produces: `clampPanelWidth(width: number, containerWidth: number): number`, 상수 `PANEL_MIN=260`, `PANEL_MAX=480`, `PANEL_DEFAULT=300`, `RESULTS_MIN=480`, `PANEL_WIDTH_KEY='cbx-composer-width'` — Task 4가 전부 import한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/panelResize.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MIN, PANEL_MAX } from './panelResize.ts';

test('clampPanelWidth: 정상 범위는 그대로', () => {
  assert.equal(clampPanelWidth(300, 1200), 300);
});

test('clampPanelWidth: 하한·상한에서 고정', () => {
  assert.equal(clampPanelWidth(100, 1200), PANEL_MIN);
  assert.equal(clampPanelWidth(900, 1200), PANEL_MAX);
});

test('clampPanelWidth: 좁은 창에서는 우측 최소 폭(480)이 상한을 낮춘다', () => {
  assert.equal(clampPanelWidth(480, 900), 420); // 900 - 480 = 420
});

test('clampPanelWidth: 상한이 하한보다 작아지는 창 폭은 하한으로 (스택 폴백 구간)', () => {
  assert.equal(clampPanelWidth(400, 600), PANEL_MIN);
});

test('clampPanelWidth: 깨진 저장값(NaN)은 기본 폭', () => {
  assert.equal(clampPanelWidth(Number('abc'), 1200), PANEL_DEFAULT);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/panelResize.test.ts`
Expected: FAIL — `Cannot find module ... panelResize.ts`

- [ ] **Step 3: 구현** — `src/lib/panelResize.ts`

```ts
// /generate 워크벤치 좌패널 폭 — 드래그 리사이즈의 경계 규칙 (스펙 2026-08-10 §경계 조건)
export const PANEL_MIN = 260; // 컨트롤이 깨지지 않는 하한
export const PANEL_MAX = 480;
export const PANEL_DEFAULT = 300;
export const RESULTS_MIN = 480; // 우측 카드 영역이 확보해야 하는 최소 폭
export const PANEL_WIDTH_KEY = 'cbx-composer-width';

// 상한은 창 폭에 따라 동적 — 우측이 RESULTS_MIN을 못 지키면 상한을 낮춘다.
// 상한이 하한 아래로 내려가는 창 폭은 스택 폴백(<lg) 구간이므로 하한으로 고정.
export function clampPanelWidth(width: number, containerWidth: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT;
  const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, containerWidth - RESULTS_MIN));
  return Math.min(Math.max(width, PANEL_MIN), max);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/panelResize.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 새 오류 0건 / lint 기준선 초과 없음. (커밋은 조율자 담당 — 하지 않는다)

---

### Task 2: DraftComposer 세로 패널 개편 (섹션부 + 풋터 분리) — 권장 모델: sonnet

**Files:**
- Modify: `src/components/DraftComposer.tsx` (전면 재작성)

**Interfaces:**
- Consumes: 없음 (독립)
- Produces (Task 4가 import):
  - `DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onRemoveRef, onClearRefs })` — 섹션부. 기존 시그니처에서 `generating/onGenerate/onCancel` 제거.
  - `ComposerFooter({ clients, value, refRows, generating, onGenerate, onCancel })` — 하단 고정부.
  - `canGenerate(value: ComposerState, refCount: number): boolean`
  - `ComposerState`, `DEFAULT_COMPOSER` — 변경 없이 유지.

**참고**: 섹션 카드 관례는 `src/app/prompt/page.tsx`의 카드 섹션(테두리+제목 헤더, 커밋 3c50d78)을 먼저 읽고 맞출 것.

- [ ] **Step 1: 파일 재작성**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftFormat, ReferenceMode } from '@/lib/draftTypes';

export interface ComposerState {
  clientId: string | null; procedureIds: string[];
  format: DraftFormat; mode: ReferenceMode; constraintsOn: boolean; direction: string;
  count: number; // 시안 수 (1~5) — 저장하지 않고 생성 후 1로 리셋 (스펙 §1, 비용 opt-in)
}
export const DEFAULT_COMPOSER: ComposerState = {
  clientId: null, procedureIds: [], format: 'single', mode: 'both', constraintsOn: false, direction: '',
  count: 1,
};
const MODE_LABEL: Record<ReferenceMode, string> = { off: '참고 안 함', form: '형식만', angle: '앵글만', both: '형식+앵글' };
// CONTENT_MODEL 변경 시 함께 갱신 (스펙 3-6 — sonnet 실측 ≈$0.015의 보수적 반올림)
const COST_CAPTION = '생성 1회 ≈ $0.02';

// 클라이언트·레퍼런스·방향성 중 하나는 있어야 생성 가능 — 섹션부/풋터가 같은 판정을 쓴다
export function canGenerate(value: ComposerState, refCount: number): boolean {
  return !!value.clientId || (refCount > 0 && value.mode !== 'off') || value.direction.trim().length > 0;
}

// 섹션 래퍼 — 카드 섹션 관례(테두리 + 제목 헤더, /prompt 선례)
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-x-border bg-white">
      <h3 className="border-b border-x-border px-3 py-1.5 text-caption font-bold text-x-secondary">{title}</h3>
      <div className="space-y-2.5 p-3 text-ui">{children}</div>
    </section>
  );
}

// 좌 생성 패널의 섹션부 — 조건은 항상 펼침, '생성 제약'만 고급 옵션으로 접힘 (스펙 B-2)
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onRemoveRef, onClearRefs }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onRemoveRef: (tweetId: string) => void; onClearRefs: () => void;
}) {
  const [advOpen, setAdvOpen] = useState(false);
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const hasRefs = refRows.length > 0;

  return (
    <div className="space-y-3">
      <Section title="생성 조건">
        <label className="block">
          <span className="text-caption text-x-muted">클라이언트</span>
          <div className="mt-1 flex items-center gap-2">
            <select value={value.clientId ?? ''}
                    className="w-full rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue"
                    onChange={(e) => onChange({ ...value, clientId: e.target.value || null, procedureIds: [] })}>
              <option value="">반영 안 함</option>
              {clients.map(({ client }) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          {clients.length === 0 && <a href="/clients" className="text-caption text-x-blue-text hover:underline">클라이언트를 먼저 등록하세요 →</a>}
        </label>
        {cur && cur.procedures.length > 0 && (
          <div>
            <span className="text-caption text-x-muted">시술</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {cur.procedures.map((p) => {
                const on = value.procedureIds.includes(p.id);
                return (
                  <button key={p.id}
                          onClick={() => onChange({ ...value, procedureIds: on ? value.procedureIds.filter((x) => x !== p.id) : [...value.procedureIds, p.id] })}
                          className={`rounded-full border px-2.5 py-0.5 text-caption ${on ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-muted'}`}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <span className="text-caption text-x-muted">형식</span>
          <div className="mt-1 flex gap-2">
            {(['single', 'thread'] as const).map((f) => (
              <button key={f} onClick={() => onChange({ ...value, format: f })}
                      className={`rounded-full border px-3 py-0.5 ${value.format === f ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                {f === 'single' ? '단문' : '스레드'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-caption text-x-muted">단문 = 트윗 1개(X 기준 280 이내) · 스레드 = 트윗 3~5개</p>
        </div>
        <div>
          <span className="text-caption text-x-muted">참고 방식 — 레퍼런스에서 무엇을 가져올지</span>
          <div className="mt-1 flex gap-2">
            {(['form', 'angle', 'both'] as const).map((m) => (
              <button key={m} disabled={!hasRefs} onClick={() => onChange({ ...value, mode: m })}
                      className={`rounded-full border px-3 py-0.5 ${hasRefs && value.mode === m ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'} disabled:opacity-40`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {!hasRefs && <p className="mt-1 text-caption text-x-muted">레퍼런스를 연결하면 선택할 수 있어요</p>}
        </div>
        <label className="block">
          <span className="text-caption text-x-muted">시안 수</span>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={5} value={value.count}
                   onChange={(e) => onChange({ ...value, count: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                   className="w-16 rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue" />
            <span className="text-caption text-x-secondary">서로 다른 앵글로 여러 개 만들어 하나 이상 골라요 — 개수만큼 비용·시간이 늘어요</span>
          </div>
        </label>
      </Section>

      <Section title="레퍼런스">
        {hasRefs ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {refRows.map((r) => (
              <span key={r.tweetId} className="flex items-center gap-1 rounded-full border border-x-border-strong bg-white px-2 py-0.5 text-caption">
                @{r.authorHandle}
                <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
              </span>
            ))}
            {refRows.length >= 2 && (
              <button onClick={onClearRefs} className="shrink-0 text-caption text-x-muted hover:text-red-500 hover:underline">모두 빼기</button>
            )}
          </div>
        ) : (
          <p className="text-caption text-x-secondary">레퍼런스 없이 시작 — 보관함의 좋았던 포스트를 참고하면 원고가 더 좋아져요</p>
        )}
        <button onClick={onOpenPicker} className="text-caption text-x-blue-text hover:underline">
          {hasRefs ? '+ 레퍼런스 추가' : '보관함에서 고르기'}
        </button>
      </Section>

      <Section title="방향성">
        <label className="block">
          <span className="text-caption text-x-muted">이번 초안은 어떤 방향으로 만들까요? (비워도 돼요 — 레퍼런스나 클라이언트 정보만으로도 만들 수 있어요)</span>
          <textarea value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value })}
                    rows={3} placeholder="예: 여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조"
                    className="mt-1 w-full rounded-lg border border-x-border-strong p-2.5 text-[15px] leading-normal outline-none focus:border-x-blue" />
        </label>
      </Section>

      <div>
        <button onClick={() => setAdvOpen(!advOpen)} className="text-caption text-x-blue-text hover:underline">
          {advOpen ? '▾ 고급 옵션 접기' : '▸ 고급 옵션'}
        </button>
        {advOpen && (
          <label className="mt-2 flex items-start gap-2 rounded-lg bg-x-surface p-3">
            <input type="checkbox" checked={value.constraintsOn}
                   onChange={(e) => onChange({ ...value, constraintsOn: e.target.checked })} />
            <span className="text-caption text-x-secondary">
              <b className="text-x-text">생성 제약</b> — 금지 표현을 생성 단계부터 피하기. 끄면 자유롭게 만들고, 검수 표식은 항상 표시돼요
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

// 좌 패널 하단 고정부 — 무엇으로 생성되는지(파생 요약)와 비용을 버튼 옆에 (원칙 2·4·6)
export function ComposerFooter({ clients, value, refRows, generating, onGenerate, onCancel }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; refRows: ReferenceRow[];
  generating: boolean; onGenerate: () => void; onCancel: () => void;
}) {
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const ok = canGenerate(value, refRows.length);
  const summary = [
    cur ? cur.client.name : '클라이언트 없음',
    ...(cur ? cur.procedures.filter((p) => value.procedureIds.includes(p.id)).map((p) => p.name) : []),
    value.format === 'single' ? '단문' : '스레드',
    refRows.length > 0 ? `참고: ${MODE_LABEL[value.mode]}` : null,
    value.count > 1 ? `시안 ${value.count}개` : null,
    value.constraintsOn ? '생성 제약 켬' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-t border-x-border bg-x-surface px-4 py-3">
      {ok ? (
        <>
          <p className="text-caption text-x-secondary">{summary}</p>
          <p className="mt-0.5 text-caption text-x-muted">
            {COST_CAPTION}{value.count > 1 ? ` × ${value.count}` : ''} · 15~30초
            {clients.length > 0 && !value.clientId ? ' · 클라이언트 정보 없이 만들어요 — 위 생성 조건에서 선택할 수 있어요' : ''}
          </p>
        </>
      ) : (
        <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요</p>
      )}
      {generating ? (
        <Button onClick={onCancel} className="mt-2 w-full">취소</Button>
      ) : (
        <button onClick={onGenerate} disabled={!ok}
                className="mt-2 h-9 w-full rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          원고 만들기
        </button>
      )}
    </div>
  );
}
```

주의: `Button`(ui)의 실제 시그니처가 `className`을 받는지 확인하고, 안 받으면 취소 버튼을 기존 `<Button onClick={onCancel}>취소</Button>` 그대로 두고 래퍼 div에 `mt-2`를 준다.

- [ ] **Step 2: 정적 검증**

Run: `npx tsc --noEmit`
Expected: `src/app/generate/page.tsx`에서 `DraftComposer` props 불일치 오류가 나는 것은 **정상**(Task 4가 해소). 그 외 새 오류 0건. 이 오류 목록을 결과 보고에 명시할 것. (커밋 금지 — 조율자 담당)

---

### Task 3: DraftCard 상태 스트립 상단 이동 — 권장 모델: sonnet

**Files:**
- Modify: `src/components/DraftCard.tsx` (두 곳만)

**Interfaces:**
- Consumes/Produces: 없음 — props 시그니처 불변. Task 1·2·4와 독립.

- [ ] **Step 1: 카드 최상단에 도구층 스트립 추가**

`return (` 바로 아래, `<div className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-x-border-strong bg-white">` 여는 태그 다음·`{/* 흰색 = X 콘텐츠층 */}` 주석 앞에 삽입:

```tsx
      {/* 상단 도구층 스트립 — 상태·조건 메타를 좌상단 동일 위치에, 카드를 열지 않고 훑도록 (스펙 §DraftCard) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 py-2">
        <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
        {draft.batchId !== null && siblingTotal !== null && (
          <span className="text-caption text-x-muted">
            시안 {variantLabel(draft.variantIndex ?? 0)} · 같은 조건 {siblingTotal}개 중
          </span>
        )}
        <span className="ml-auto text-caption text-x-muted">
          {[...draft.procedureNames, draft.format === 'thread' ? '스레드' : '단문'].join(' · ')}
        </span>
      </div>
```

- [ ] **Step 2: 하단 회색층의 기존 상태 행 제거**

`{/* 회색 = 도구층: ... */}` 아래의 이 블록을 통째로 삭제 (스트립으로 이동했으므로):

```tsx
        <div className="flex items-center gap-2 pb-1">
          <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
          {draft.batchId !== null && siblingTotal !== null && (
            <span className="text-caption text-x-muted">
              시안 {variantLabel(draft.variantIndex ?? 0)} · 같은 조건 {siblingTotal}개 중
            </span>
          )}
        </div>
```

검수 표식(`active.map`)·무시 카운트·PR 안내·근거 풋터는 그대로 하단 회색층에 남긴다. 흰색 헤더의 "멤버명 · 초안 · 시간"도 그대로 (시간은 스트립에 중복 표기하지 않음 — 스펙).

- [ ] **Step 3: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 새 오류 0건 / lint 기준선 초과 없음. (커밋 금지 — 조율자 담당)

---

### Task 4: page.tsx 2단 레이아웃 + 리사이즈 + 필터 헤더 승격 — 권장 모델: sonnet

**Files:**
- Modify: `src/app/generate/page.tsx` (렌더부·import·리사이즈 상태만 — 데이터 로직 무변경)
- Modify: `src/components/DraftFilterBar.tsx` (루트 클래스 1줄)

**Interfaces:**
- Consumes: Task 1의 `clampPanelWidth`, `PANEL_DEFAULT`, `PANEL_WIDTH_KEY` / Task 2의 `DraftComposer`(새 시그니처: generating/onGenerate/onCancel 없음), `ComposerFooter`
- Produces: 없음 (말단)

- [ ] **Step 1: DraftFilterBar 루트에서 컬럼 폭 제약 제거**

루트 div 클래스를 `flex w-full max-w-[600px] flex-wrap ...` → `flex w-full flex-wrap items-center gap-1.5 text-[13px]`로. (배경·패딩·테두리는 부모 헤더 행이 담당)

- [ ] **Step 2: page.tsx — import·리사이즈 상태 추가**

import에 추가:

```tsx
import { DraftComposer, ComposerFooter, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_WIDTH_KEY } from '@/lib/panelResize';
```

`Workbench` 컴포넌트 상단(기존 state 선언들 옆)에 추가:

```tsx
  // 좌패널 폭 — 드래그 리사이즈, 더블클릭 복원, 저장값은 복원 시 클램프 (스펙 §경계 조건)
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원 (COMPOSER_KEY와 같은 관례)
    setPanelW(clampPanelWidth(Number(raw), rootRef.current?.clientWidth ?? Infinity));
  }, []);
  function applyWidth(w: number) {
    const clamped = clampPanelWidth(w, rootRef.current?.clientWidth ?? Infinity);
    setPanelW(clamped);
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
  }
```

- [ ] **Step 3: page.tsx — 렌더부를 2단 구조로 교체**

기존 `return (<div className="flex flex-col items-center gap-4 p-6">...` 전체를 아래 구조로 교체한다. **내부의 스켈레톤·빈 상태 2종·카드 map·모달·토스트 JSX는 기존 코드를 그대로 옮긴다** (문구·props 변경 금지):

```tsx
  return (
    <div ref={rootRef} style={{ ['--panel-w' as string]: `${panelW}px` }}
         className={`flex flex-col lg:h-full lg:flex-row ${resizing ? 'select-none' : ''}`}>
      {/* 좌: 생성 패널 — lg에서 자체 스크롤 + 하단 고정 풋터 */}
      <div className="flex shrink-0 flex-col lg:min-h-0 lg:w-[var(--panel-w)]">
        <div className="space-y-3 p-4 lg:flex-1 lg:overflow-y-auto">
          <div>
            <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
            <p className="mt-0.5 text-caption text-x-secondary">레퍼런스와 클라이언트 정보를 조합해 인플루언서에게 보낼 X 원고 초안을 만들어요.</p>
          </div>
          {loaded && clients.length === 0 && (
            <p className="rounded-lg bg-x-surface p-3 text-caption text-x-secondary">
              클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 — <a href="/clients" className="font-bold text-x-blue-text hover:underline">등록하러 가기</a>
            </p>
          )}
          <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                         refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                         onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                         onClearRefs={() => setRefRows([])} />
        </div>
        <ComposerFooter clients={clients} value={composer} refRows={refRows}
                        generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate} />
      </div>

      {/* 구분선 — lg 전용 드래그 핸들. 키보드 화살표로도 조절 (스펙 §접근성) */}
      <div role="separator" aria-orientation="vertical" aria-label="패널 폭 조절" tabIndex={0}
           onPointerDown={(e) => { setResizing(true); e.currentTarget.setPointerCapture(e.pointerId); }}
           onPointerMove={(e) => { if (resizing && rootRef.current) applyWidth(e.clientX - rootRef.current.getBoundingClientRect().left); }}
           onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)}
           onDoubleClick={() => applyWidth(PANEL_DEFAULT)}
           onKeyDown={(e) => {
             const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
             if (d) { e.preventDefault(); applyWidth(panelW + d); }
           }}
           className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-x-border hover:bg-x-blue/50 focus:bg-x-blue/60 focus:outline-none lg:block" />

      {/* 우: 결과 영역 — 필터 헤더는 스크롤 밖 고정 행 (Dense Scan List) */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {loaded && drafts.length > 0 && (
          <div className="border-b border-x-border bg-x-surface px-4 py-2">
            <DraftFilterBar counts={counts} total={clientScoped.length} filter={filter}
                            clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                            onChange={setFilter} />
          </div>
        )}
        <div className="flex flex-col items-center gap-4 p-6 lg:flex-1 lg:overflow-y-auto">
          {/* ↓ 기존 JSX 그대로: generating 스켈레톤 → 빈 상태 2종 → visibleDrafts.map(DraftCard) */}
        </div>
      </div>

      {/* ↓ 기존 JSX 그대로: DraftEditModal · RefPickerSheet · 삭제 실행취소 토스트 · 일반 토스트 */}
    </div>
  );
```

기존 상단 헤더 블록(제목+안내 배너 `w-full max-w-[600px]` div)은 좌패널로 옮겼으므로 삭제.

- [ ] **Step 4: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 새 오류 0건(Task 2에서 예고된 props 불일치가 여기서 해소됨) / lint 기준선 초과 없음.

- [ ] **Step 5: 스모크 — dev 서버 렌더 확인**

Run: `npm run dev` 후 `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/generate`
Expected: 200 (OAuth 리다이렉트면 307/302도 정상 — 렌더 크래시로 500이 아니면 됨). 확인 후 서버 종료.
화면 동작(리사이즈·스크롤·스택 폴백)은 조율자→사용자 검수 단계에서 확인.

---

## 실행 순서 요약

| Wave | Task | 파일 | 모델 | 병렬 |
|---|---|---|---|---|
| 1 | T1 리사이즈 유틸 | `src/lib/panelResize*` | haiku | T1·T2·T3 동시 |
| 1 | T2 컴포저 개편 | `src/components/DraftComposer.tsx` | sonnet | 〃 |
| 1 | T3 카드 스트립 | `src/components/DraftCard.tsx` | sonnet | 〃 |
| 2 | T4 페이지 레이아웃 | `src/app/generate/page.tsx`, `DraftFilterBar.tsx` | sonnet | 단독 (T1·T2 의존) |

커밋: 조율자가 태스크 검토 후 태스크별로 수행. Wave 1 완료 시점엔 T2의 예고된 tsc 오류(page.tsx props 불일치)가 남으므로, T2·T3 커밋은 가능하되 T4 완료 후 전체 `tsc`·`lint`·`npm test`(기존 테스트 회귀 확인)로 마감한다.
