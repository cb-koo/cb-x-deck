# 클라이언트 페이지 개편 (B안 2단 분할) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/clients`를 좌측 목록(채움 상태 표시) + 우측 상세의 2단 분할로 개편하고, 저장 피드백·편집 유실 방지·삭제 확인을 추가한다.

**Architecture:** 단일 라우트 `/clients` 유지, 선택은 `?client=<id>` 쿼리(`router.replace`). 요약 계산은 순수 함수(`src/lib/clientSummary.ts`)로 분리. 상세 패널은 별도 컴포넌트(`ClientDetail.tsx`)로 분리하고, 부모(page)가 ref 핸들(`isDirty`/`saveAll`)로 유실 방지 모달을 제어한다. API·DB 변경 없음.

**Tech Stack:** Next.js 16.2 (App Router, `useSearchParams`는 `<Suspense>` 필수), Tailwind(기존 x-* 토큰만), node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-08-09-clients-page-redesign-design.md`

## Global Constraints

- 스타일은 기존 토큰만: `x-*` 팔레트, 타이포 3단계(`text-content`/`text-ui`/`text-caption`) + 20px 모달 제목. 새 토큰 금지.
- 미입력 경고 주황만 예외적으로 인라인 값: 텍스트 `#b45309`, 배경 `#fef3c7` (앱에 경고색 토큰 없음).
- 한글 IME: Enter 핸들러는 반드시 `!e.nativeEvent.isComposing` 확인 + 제출 함수는 `useRef` 이중 발화 가드 (workspaces/page.tsx 패턴).
- 마운트 시 setState가 필요한 effect에는 코드베이스 관례대로 `// eslint-disable-next-line react-hooks/set-state-in-effect -- <사유>` 주석.
- UI 카피는 사용자 언어(비개발 기획자 기준), 내부 개념어 금지 (AGENTS.md UX 원칙).
- API·DB·마이그레이션 변경 없음.
- lint 기준선 24개 유지(새 에러 추가 금지), `npx tsc --noEmit` 통과.

---

### Task 1: 요약 순수 함수 `clientSummary` (TDD)

**Files:**
- Create: `src/lib/clientSummary.ts`
- Test: `src/lib/clientSummary.test.ts`

**Interfaces:**
- Consumes: `ClientRow`, `ProcedureRow` (`src/lib/clientStore.ts`의 기존 타입)
- Produces (Task 2·3이 사용):
  - `clientSummary(client: ClientRow, procedures: ProcedureRow[]): { procedureCount: number; bannedTotal: number; infoMissing: boolean }`
  - `procedureSummary(p: ProcedureRow): { empty: boolean; text: string }`

- [x] **Step 1: 실패하는 테스트 작성**

`src/lib/clientSummary.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientSummary, procedureSummary } from './clientSummary.ts';
import type { ClientRow, ProcedureRow } from './clientStore.ts';

function client(over: Partial<ClientRow> = {}): ClientRow {
  return { id: 'c1', name: '가온피부과', info: '강남역 3번 출구', bannedPhrases: [], position: 0, ...over };
}
function proc(over: Partial<ProcedureRow> = {}): ProcedureRow {
  return { id: 'p1', clientId: 'c1', name: '보톡스', description: '', effectPhrases: '', bannedPhrases: [], position: 0, ...over };
}

test('clientSummary: 시술 수와 금지 표현 합산(공통+시술별)', () => {
  const s = clientSummary(
    client({ bannedPhrases: ['완치', '부작용 없음'] }),
    [proc({ bannedPhrases: ['주름 제거'] }), proc({ id: 'p2', bannedPhrases: ['동안', '반영구'] })],
  );
  assert.equal(s.procedureCount, 2);
  assert.equal(s.bannedTotal, 5);
  assert.equal(s.infoMissing, false);
});

test('clientSummary: 공백뿐인 info는 미입력으로 판정', () => {
  assert.equal(clientSummary(client({ info: '  \n ' }), []).infoMissing, true);
  assert.equal(clientSummary(client({ info: '' }), []).infoMissing, true);
});

test('procedureSummary: 전부 비어 있으면 empty + 안내 문구', () => {
  const s = procedureSummary(proc());
  assert.equal(s.empty, true);
  assert.equal(s.text, '아직 비어 있어요 — 원고에 반영할 내용이 없어요');
});

test('procedureSummary: 설명·효과 표현 모두 입력 + 금지 2건', () => {
  const s = procedureSummary(proc({ description: '이마 주사', effectPhrases: '주름 완화', bannedPhrases: ['주름 제거', '동안'] }));
  assert.equal(s.empty, false);
  assert.equal(s.text, '설명·효과 표현 입력됨 · 금지 2건');
});

test('procedureSummary: 설명만 입력 (효과 표현 비어 있음, 금지 1건)', () => {
  const s = procedureSummary(proc({ description: '이마 주사', bannedPhrases: ['동안'] }));
  assert.equal(s.text, '설명 입력됨 · 효과 표현 비어 있음 · 금지 1건');
});

test('procedureSummary: 금지 표현만 있으면 설명·효과는 비어 있음으로 묶어 표기', () => {
  const s = procedureSummary(proc({ bannedPhrases: ['동안'] }));
  assert.equal(s.empty, false);
  assert.equal(s.text, '설명·효과 표현 비어 있음 · 금지 1건');
});

test('procedureSummary: 금지 0건이면 금지 항목 생략', () => {
  const s = procedureSummary(proc({ description: '이마 주사', effectPhrases: '주름 완화' }));
  assert.equal(s.text, '설명·효과 표현 입력됨');
});

test('procedureSummary: 공백뿐인 설명은 비어 있음으로 판정', () => {
  const s = procedureSummary(proc({ description: '  ' , effectPhrases: '주름 완화' }));
  assert.equal(s.text, '설명 비어 있음 · 효과 표현 입력됨');
});
```

- [x] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/clientSummary.test.ts`
Expected: FAIL — `Cannot find module './clientSummary.ts'`

- [x] **Step 3: 구현**

`src/lib/clientSummary.ts`:

```ts
import type { ClientRow, ProcedureRow } from './clientStore';

// 좌측 목록 요약 — 금지 표현 수는 공통(클라이언트) + 시술별 합산.
// 원고 생성 시 실제 검수에 쓰이는 전체 개수와 일치시키기 위함 (generate/page.tsx의 병합 로직과 같은 기준).
export function clientSummary(client: ClientRow, procedures: ProcedureRow[]):
  { procedureCount: number; bannedTotal: number; infoMissing: boolean } {
  return {
    procedureCount: procedures.length,
    bannedTotal: client.bannedPhrases.length + procedures.reduce((n, p) => n + p.bannedPhrases.length, 0),
    infoMissing: client.info.trim() === '',
  };
}

// 시술 카드 접힘 상태의 요약 줄 — 펼치지 않아도 채움 상태가 보이게 한다.
export function procedureSummary(p: ProcedureRow): { empty: boolean; text: string } {
  const desc = p.description.trim() !== '';
  const effect = p.effectPhrases.trim() !== '';
  const banned = p.bannedPhrases.length;
  if (!desc && !effect && banned === 0) {
    return { empty: true, text: '아직 비어 있어요 — 원고에 반영할 내용이 없어요' };
  }
  const parts: string[] = [];
  if (desc === effect) parts.push(`설명·효과 표현 ${desc ? '입력됨' : '비어 있음'}`);
  else parts.push(`설명 ${desc ? '입력됨' : '비어 있음'}`, `효과 표현 ${effect ? '입력됨' : '비어 있음'}`);
  if (banned > 0) parts.push(`금지 ${banned}건`);
  return { empty: false, text: parts.join(' · ') };
}
```

- [x] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/clientSummary.test.ts`
Expected: PASS (tests 8, fail 0)

- [x] **Step 5: Commit**

```bash
git add src/lib/clientSummary.ts src/lib/clientSummary.test.ts
git commit -m "feat(clients): 클라이언트·시술 채움 상태 요약 순수 함수"
```

---

### Task 2: 상세 패널 `ClientDetail` 컴포넌트

**Files:**
- Create: `src/app/clients/ClientDetail.tsx`

**Interfaces:**
- Consumes: Task 1의 `procedureSummary`; 기존 `apiFetch`, `Button`, `ClientRow`/`ProcedureRow`
- Produces (Task 3이 사용):
  ```ts
  export interface DetailHandle { isDirty: () => boolean; saveAll: () => Promise<boolean> }
  export function ClientDetail(props: {
    data: { client: ClientRow; procedures: ProcedureRow[] };
    handleRef: React.MutableRefObject<DetailHandle | null>;
    onChanged: () => Promise<void>;   // 저장·시술 추가/삭제 후 재로드
    onDeleted: () => void;            // 클라이언트 삭제 후 (부모가 선택 정리)
  }): JSX.Element
  ```

컴포넌트 하나가 기본 정보 편집·시술 목록·이름 변경·삭제 모달을 담당한다. 내부 편집기(기본 정보, 펼친 시술)는 레지스트리에 `isDirty`/`save`를 등록하고, 부모는 `handleRef`로 전체 dirty 확인·일괄 저장을 한다.

- [x] **Step 1: 컴포넌트 작성**

`src/app/clients/ClientDetail.tsx` 전체:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { procedureSummary } from '@/lib/clientSummary';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';

// 부모(page)가 미저장 확인·일괄 저장에 쓰는 핸들
export interface DetailHandle { isDirty: () => boolean; saveAll: () => Promise<boolean> }
// 내부 편집기(기본 정보/펼친 시술)가 레지스트리에 등록하는 인터페이스
type Editor = { isDirty: () => boolean; save: () => Promise<boolean> };
type Register = (key: string, editor: Editor) => () => void;

// 줄바꿈 textarea ↔ string[] (금지 표현 입력) — 기존 page.tsx에서 이동
const toLines = (arr: string[]) => arr.join('\n');
const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

export function ClientDetail({ data, handleRef, onChanged, onDeleted }: {
  data: { client: ClientRow; procedures: ProcedureRow[] };
  handleRef: React.MutableRefObject<DetailHandle | null>;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const { client, procedures } = data;
  const editors = useRef(new Map<string, Editor>());
  const register: Register = useCallback((key, editor) => {
    editors.current.set(key, editor);
    return () => { editors.current.delete(key); };
  }, []);
  useEffect(() => {
    const reg = editors.current;
    handleRef.current = {
      isDirty: () => [...reg.values()].some((e) => e.isDirty()),
      saveAll: async () => {
        for (const e of reg.values()) if (e.isDirty() && !(await e.save())) return false;
        return true;
      },
    };
    return () => { handleRef.current = null; };
  }, [handleRef]);

  // 이름 변경 (인라인) — workspaces/page.tsx saveRename 패턴
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const renaming = useRef(false);
  // 삭제 모달 — 이름 입력 확인 (workspaces 삭제와 동일 격)
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const deletingBusy = useRef(false);
  const [deleteErr, setDeleteErr] = useState('');
  // 시술 추가
  const [newProc, setNewProc] = useState('');
  const addingProc = useRef(false);
  const [err, setErr] = useState('');

  async function saveRename() {
    const name = editName.trim();
    if (!name || renaming.current) return;
    renaming.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setEditingName(false); setErr(''); await onChanged();
    } finally { renaming.current = false; }
  }

  async function confirmDelete() {
    if (confirmText !== client.name || deletingBusy.current) return;
    deletingBusy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      if (!r.ok) { setDeleteErr(await errOf(r)); return; } // 모달 유지해 재시도 가능하게
      setDeleting(false); setConfirmText(''); setDeleteErr('');
      onDeleted();
    } finally { deletingBusy.current = false; }
  }

  async function addProc() {
    const name = newProc.trim();
    if (!name || addingProc.current) return;
    addingProc.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}/procedures`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setErr(''); setNewProc(''); await onChanged();
    } finally { addingProc.current = false; }
  }

  return (
    <div className="min-w-0 flex-1 px-6 py-6">
      <div className="flex items-baseline justify-between gap-3">
        {editingName ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveRename();
                     if (e.key === 'Escape') setEditingName(false);
                   }}
                   className="w-full max-w-[320px] rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={saveRename}>저장</Button>
            <Button variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => setEditingName(false)}>취소</Button>
          </div>
        ) : (
          <>
            <h1 className="min-w-0 truncate text-[20px] font-bold">{client.name}</h1>
            <span className="flex shrink-0 items-center gap-3">
              <button onClick={() => { setEditingName(true); setEditName(client.name); }}
                      className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
              <button onClick={() => { setDeleting(true); setConfirmText(''); setDeleteErr(''); }}
                      className="text-ui text-x-secondary hover:text-red-500">삭제</button>
            </span>
          </>
        )}
      </div>
      {err && <p className="mt-2 text-ui text-red-500">{err}</p>}

      <BasicInfoEditor key={client.id} client={client} register={register} onSaved={onChanged} />

      <div className="mt-4 rounded-2xl border border-x-border-strong">
        <div className="px-4 py-3">
          <h3 className="text-content font-bold">시술 <span className="text-ui font-normal text-x-secondary">{procedures.length}개</span></h3>
          <p className="text-caption text-x-muted">원고를 만들 때 이번 건에 해당하는 시술만 골라 반영해요.</p>
        </div>
        <div className="border-t border-x-border px-4 py-4">
          <div className="space-y-2">
            {procedures.map((p) => (
              <ProcedureCard key={p.id} proc={p} register={register} onChanged={onChanged} />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newProc} onChange={(e) => setNewProc(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addProc(); }}
                   placeholder="새 시술 이름 (예: 보톡스)"
                   className="w-56 rounded-md border border-x-border-strong px-2 py-1 text-ui outline-none focus:border-x-blue" />
            <Button onClick={addProc}>시술 추가</Button>
          </div>
        </div>
      </div>

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleting(false); setDeleteErr(''); }}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">클라이언트 삭제</h2>
            <p className="mb-1 text-content">
              &lsquo;{client.name}&rsquo;과(와) 시술 {procedures.length}개가 함께 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <p className="mb-3 text-caption text-x-muted">이 클라이언트로 만든 초안은 스냅샷으로 남아요.</p>
            <p className="mb-1 text-ui text-x-secondary">계속하려면 클라이언트 이름을 입력하세요</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmDelete(); }}
                   placeholder={client.name}
                   className="mb-3 w-full rounded-lg border border-x-border-strong px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            {deleteErr && <p className="mb-2 text-caption text-red-500">{deleteErr}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setDeleting(false); setDeleteErr(''); }}>취소</Button>
              <button onClick={confirmDelete} disabled={confirmText !== client.name}
                      className="rounded-full bg-x-pink px-3 py-1 text-ui font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 기본 정보(클리닉·의사 정보 + 공통 금지 표현) 편집기.
// baseline(마지막 저장값) 대비로 dirty를 판정하고, 저장 성공 시 "저장됨 ✓"를 잠시 표시한다.
function BasicInfoEditor({ client, register, onSaved }: {
  client: ClientRow; register: Register; onSaved: () => Promise<void>;
}) {
  const [info, setInfo] = useState(client.info);
  const [banned, setBanned] = useState(toLines(client.bannedPhrases));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const baseline = useRef({ info: client.info, banned: toLines(client.bannedPhrases) });
  const cur = useRef({ info, banned });
  cur.current = { info, banned };
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ info: cur.current.info, bannedPhrases: fromLines(cur.current.banned) }),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      baseline.current = { ...cur.current };
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await onSaved();
      return true;
    } finally { setSaving(false); }
  }, [client.id, onSaved]);

  useEffect(() => register('info', {
    isDirty: () => cur.current.info !== baseline.current.info || cur.current.banned !== baseline.current.banned,
    save,
  }), [register, save]);

  return (
    <div className="mt-4 rounded-2xl border border-x-border-strong px-4 py-4">
      {err && <p className="mb-2 text-ui text-red-500">{err}</p>}
      <label className="block">
        <span className="text-ui font-bold">클리닉·의사 정보</span>
        <p className="text-caption text-x-muted">원고를 만드는 재료예요. 기존 소개 문서를 붙여넣어도 좋아요.</p>
        <textarea value={info} onChange={(e) => { setInfo(e.target.value); setSaved(false); }} rows={6}
                  className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      </label>
      <label className="mt-3 block">
        <span className="text-ui font-bold">금지 표현 <span className="font-normal text-x-muted">한 줄에 하나</span></span>
        <p className="text-caption text-x-muted">원고에 절대 쓰면 안 되는 말 — 검수 기준으로도 쓰여요. (예: 경쟁사명, 계약상 못 쓰는 표현)</p>
        <textarea value={banned} onChange={(e) => { setBanned(e.target.value); setSaved(false); }} rows={3}
                  className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      </label>
      <div className="mt-3 flex items-center gap-2.5">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
        {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓</span>}
      </div>
    </div>
  );
}

// 시술 카드 — 접힘 시 요약 줄(채움 상태), 펼침 시 편집기. 삭제는 2단계 확인.
function ProcedureCard({ proc, register, onChanged }: {
  proc: ProcedureRow; register: Register; onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');
  const summary = procedureSummary(proc);

  async function remove() {
    const r = await apiFetch(`/api/procedures/${proc.id}`, { method: 'DELETE' });
    if (!r.ok) { setErr(await errOf(r)); return; }
    setErr(''); await onChanged();
  }

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <span className="text-ui font-medium hover:text-x-blue-text">{proc.name} {open ? '⌃' : '⌄'}</span>
          {!open && (
            <p className={`text-caption ${summary.empty ? 'text-[#b45309]' : 'text-x-secondary'}`}>{summary.text}</p>
          )}
        </button>
        {confirmDel ? (
          <span className="flex shrink-0 items-center gap-2 text-caption">
            <button onClick={remove} className="rounded bg-red-600 px-2 py-0.5 text-white">삭제 확정</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="shrink-0 text-caption text-x-muted hover:text-red-500">삭제</button>
        )}
      </div>
      {err && <p className="mt-1 text-ui text-red-500">{err}</p>}
      {open && <ProcedureEditor proc={proc} register={register} onSaved={onChanged} onClose={() => setOpen(false)} />}
    </div>
  );
}

// 펼친 시술 편집기 — 펼쳐진 동안만 레지스트리에 등록된다 (접으면 dirty 대상에서 제외).
function ProcedureEditor({ proc, register, onSaved, onClose }: {
  proc: ProcedureRow; register: Register; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [description, setDescription] = useState(proc.description);
  const [effect, setEffect] = useState(proc.effectPhrases);
  const [banned, setBanned] = useState(toLines(proc.bannedPhrases));
  const [err, setErr] = useState('');
  const baseline = useRef({ description: proc.description, effect: proc.effectPhrases, banned: toLines(proc.bannedPhrases) });
  const cur = useRef({ description, effect, banned });
  cur.current = { description, effect, banned };

  const save = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch(`/api/procedures/${proc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: cur.current.description, effectPhrases: cur.current.effect,
        bannedPhrases: fromLines(cur.current.banned),
      }),
    });
    if (!r.ok) { setErr(await errOf(r)); return false; }
    baseline.current = { ...cur.current };
    setErr('');
    await onSaved();
    return true;
  }, [proc.id, onSaved]);

  useEffect(() => register(`proc:${proc.id}`, {
    isDirty: () =>
      cur.current.description !== baseline.current.description ||
      cur.current.effect !== baseline.current.effect ||
      cur.current.banned !== baseline.current.banned,
    save,
  }), [register, save, proc.id]);

  async function saveAndClose() { if (await save()) onClose(); }

  return (
    <div className="mt-2 space-y-2">
      {err && <p className="text-ui text-red-500">{err}</p>}
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">시술 설명</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">효과·결과로 쓸 수 있는 표현</span>
        <p className="text-caption text-x-muted">여기 적힌 범위까지만 원고에 사용돼요.</p>
        <textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">이 시술만의 금지 표현 <span className="font-normal text-x-muted">한 줄에 하나</span></span>
        <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <Button variant="primary" onClick={saveAndClose}>시술 저장</Button>
    </div>
  );
}
```

- [x] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0 (기존 page.tsx는 아직 옛 구조 — 이 파일은 독립 컴파일)

- [x] **Step 3: Commit**

```bash
git add src/app/clients/ClientDetail.tsx
git commit -m "feat(clients): 상세 패널 컴포넌트 — 저장 피드백·시술 요약·2단계 삭제·이름확인 모달"
```

---

### Task 3: `page.tsx` 개편 — 좌측 목록 + 쿼리 선택 + 유실 방지

**Files:**
- Modify: `src/app/clients/page.tsx` (전면 교체)

**Interfaces:**
- Consumes: Task 1 `clientSummary`, Task 2 `ClientDetail`/`DetailHandle`
- Produces: 없음 (최종 화면)

동작 요약: `?client=<id>`로 선택 표현(`router.replace`, w/[wsId] setView 패턴). 쿼리 없음/무효 → 첫 번째 폴백(무효 딥링크면 안내 표시). dirty 상태에서 다른 클라이언트 클릭 → 3버튼 모달. 새 클라이언트 생성은 dirty면 자동 저장 후 진행(생성 의사가 명확하므로 모달 생략). 탭 닫기/새로고침은 beforeunload.

- [x] **Step 1: page.tsx 전체 교체**

```tsx
'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { clientSummary } from '@/lib/clientSummary';
import { ClientDetail, type DetailHandle } from './ClientDetail';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';

type ClientWithProcs = { client: ClientRow; procedures: ProcedureRow[] };

export default function ClientsPage() {
  // useSearchParams는 Suspense 경계 필수 (generate/page.tsx 선례)
  return <Suspense><ClientsSplit /></Suspense>;
}

function ClientsSplit() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlId = searchParams.get('client');

  const [rows, setRows] = useState<ClientWithProcs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [notice, setNotice] = useState(''); // 무효 딥링크 폴백 안내
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const creating = useRef(false); // IME Enter 이중 발화·더블클릭 중복 생성 방지
  const [err, setErr] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null); // 미저장 확인 모달의 이동 대상
  const [guardErr, setGuardErr] = useState('');
  const guardBusy = useRef(false);
  const detailRef = useRef<DetailHandle | null>(null);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await apiFetch('/api/clients');
      if (!r.ok) throw new Error(String(r.status));
      setRows(await r.json());
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = rows.find((x) => x.client.id === urlId) ?? null;

  // 쿼리 없음/무효 → 첫 번째로 폴백. 무효 딥링크(삭제된 클라이언트 등)면 정직하게 알린다 (87f8353 원칙).
  useEffect(() => {
    if (!loaded || loadErr || rows.length === 0 || selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴백 안내는 URL 교체와 함께 1회 설정 (기존 코드베이스 관례)
    if (urlId) setNotice('링크가 가리키는 클라이언트를 찾을 수 없어 첫 번째 클라이언트를 표시했어요.');
    router.replace(`${pathname}?client=${rows[0].client.id}`);
  }, [loaded, loadErr, rows, selected, urlId, pathname, router]);

  // 탭 닫기·새로고침 유실 방지 (페이지 내 전환은 selectClient 모달이 담당)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (detailRef.current?.isDirty()) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  function applySelect(id: string) {
    setNotice('');
    router.replace(`${pathname}?client=${id}`);
  }
  function selectClient(id: string) {
    if (id === urlId) return;
    if (detailRef.current?.isDirty()) { setPendingId(id); setGuardErr(''); return; }
    applySelect(id);
  }

  async function guardSaveAndMove() {
    if (!pendingId || guardBusy.current) return;
    guardBusy.current = true;
    try {
      const ok = (await detailRef.current?.saveAll()) ?? true;
      if (!ok) { setGuardErr('저장하지 못했어요 — 네트워크를 확인하고 다시 시도해주세요.'); return; }
      applySelect(pendingId); setPendingId(null);
    } finally { guardBusy.current = false; }
  }

  async function createClient() {
    const name = newName.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      // 편집 중이던 내용은 자동 저장 후 진행 — 생성 의사가 명확하므로 모달을 띄우지 않는다
      if (detailRef.current?.isDirty() && !(await detailRef.current.saveAll())) {
        setErr('편집 중인 내용을 저장하지 못해 생성을 멈췄어요 — 네트워크를 확인해주세요.');
        return;
      }
      const r = await apiFetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const c = (await r.json()) as ClientRow;
      setNewName(''); setAdding(false); setErr('');
      await load();
      applySelect(c.id);
    } finally { creating.current = false; }
  }

  // 삭제 후: 쿼리를 비우면 폴백 effect가 첫 번째(남은 것)를 안내 없이 선택한다
  function handleDeleted() {
    router.replace(pathname);
    load();
  }

  return (
    <div className="flex">
      <aside className="sticky top-0 max-h-screen w-[236px] shrink-0 self-start overflow-y-auto border-r border-x-border px-3 py-5">
        <div className="mb-3 flex items-center justify-between px-2">
          <h2 className="text-content font-bold">클라이언트</h2>
          <button onClick={() => setAdding(true)} className="text-ui font-medium text-x-blue-text hover:underline">+ 추가</button>
        </div>
        <p className="mb-3 px-2 text-caption text-x-muted">
          클리닉 정보와 금지 표현을 등록해두면 원고를 만들 때마다 자동으로 반영돼요.
        </p>
        {adding && (
          <div className="mb-2 px-1">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) createClient();
                     if (e.key === 'Escape') { setAdding(false); setNewName(''); }
                   }}
                   placeholder="새 클라이언트 이름"
                   className="w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue" />
            <div className="mt-1.5 flex gap-1.5">
              <Button variant="primary" onClick={createClient}>만들기</Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>취소</Button>
            </div>
          </div>
        )}
        {err && <p className="mb-2 px-2 text-caption text-red-500">{err}</p>}

        {!loaded && <p className="px-2 py-4 text-ui text-x-muted">불러오는 중…</p>}
        {loaded && loadErr && (
          <div className="px-2 py-4">
            <p className="mb-2 text-ui text-x-secondary">목록을 불러오지 못했습니다</p>
            <Button onClick={load}>다시 시도</Button>
          </div>
        )}
        {loaded && !loadErr && rows.map(({ client, procedures }) => {
          const s = clientSummary(client, procedures);
          const on = client.id === urlId;
          return (
            <button key={client.id} onClick={() => selectClient(client.id)}
                    className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                      on ? 'bg-[#e3f1fb]' : 'hover:bg-x-hover'
                    }`}>
              <p className={`flex items-center gap-1.5 text-ui font-semibold ${on ? 'text-x-blue-text' : ''}`}>
                <span className="min-w-0 truncate">{client.name}</span>
                {s.infoMissing && <span title="클리닉 정보 미입력" className="shrink-0 text-caption text-[#b45309]">⚠️</span>}
              </p>
              <p className="text-caption text-x-muted">
                시술 {s.procedureCount} · {s.infoMissing ? '정보 미입력' : `금지 ${s.bannedTotal}`}
              </p>
            </button>
          );
        })}
      </aside>

      <main className="min-w-0 flex-1">
        {notice && (
          <p className="mx-6 mt-4 rounded-lg bg-x-surface px-3 py-2 text-ui text-x-secondary">{notice}</p>
        )}
        {loaded && !loadErr && rows.length === 0 && !adding && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content font-bold">아직 클라이언트가 없어요</p>
            <p className="mb-4 text-ui text-x-secondary">
              클리닉 정보와 금지 표현을 등록해두면, 원고를 만들 때마다 자동으로 반영돼요.
            </p>
            <Button variant="primary" onClick={() => setAdding(true)}>+ 새 클라이언트</Button>
          </div>
        )}
        {selected && (
          <ClientDetail key={selected.client.id} data={selected}
                        handleRef={detailRef} onChanged={load} onDeleted={handleDeleted} />
        )}
      </main>

      {pendingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingId(null)}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">저장 안 한 변경이 있어요</h2>
            <p className="mb-4 text-content">지금 이동하면 편집 중인 내용이 사라져요. 어떻게 할까요?</p>
            {guardErr && <p className="mb-2 text-caption text-red-500">{guardErr}</p>}
            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={guardSaveAndMove}>저장하고 이동</Button>
              <Button onClick={() => { const id = pendingId; setPendingId(null); applySelect(id); }}>저장 안 하고 이동</Button>
              <Button variant="ghost" onClick={() => setPendingId(null)}>취소</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc 에러 0, lint 기준선 24개(신규 에러 없음)

- [x] **Step 3: Commit**

```bash
git add src/app/clients/page.tsx
git commit -m "feat(clients): 2단 분할 개편 — 채움 상태 목록·쿼리 선택·편집 유실 방지"
```

---

### Task 4: 전체 검증 + 수동 확인 안내

**Files:** 변경 없음 (검증만)

- [x] **Step 1: 단위 테스트**

Run: `node --import tsx --test src/lib/clientSummary.test.ts`
Expected: PASS (tests 8, fail 0)

- [x] **Step 2: 타입·린트 재확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc 에러 0, lint 신규 에러 없음 (기준선 24)

- [x] **Step 3: dev 서버로 수동 확인 항목 정리** (화면 확인은 OAuth 게이팅으로 사용자 몫 — 체크리스트 전달)

Run: `npm run dev` 후 사용자에게 안내:

1. `/clients` 진입 → 첫 클라이언트 자동 선택, URL에 `?client=` 붙음
2. 좌측 목록에 시술 수·금지 수 표시, 정보 비어 있는 클라이언트에 ⚠️ + "정보 미입력"
3. 정보 수정 후 저장 → "저장됨 ✓" 2.5초 표시
4. 정보 수정 중(저장 안 함) 다른 클라이언트 클릭 → 3버튼 모달 (저장하고 이동 동작 확인)
5. 정보 수정 중 새로고침 → 브라우저 이탈 경고
6. 시술 접힘 카드에 요약 줄 표시 (빈 시술은 주황 안내)
7. 시술 삭제 → "삭제 확정/취소" 2단계
8. 클라이언트 삭제 → 이름 입력 모달, 삭제 후 첫 번째 클라이언트로 이동
9. `/clients?client=없는id` 직접 진입 → 첫 번째 폴백 + 안내 문구
10. 클라이언트 0개 상태(테스트 환경) → 중앙 빈 상태 + CTA
11. 생성 페이지 `/generate`의 "등록하러 가기" 링크 정상 동작

- [x] **Step 4: 계획 체크박스 갱신 커밋**

```bash
git add docs/superpowers/plans/2026-08-09-clients-page-redesign.md
git commit -m "docs(clients): 구현 계획 체크박스 갱신"
```
