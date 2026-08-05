# 콘텐츠 생성 UI (Plan 2/2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1에서 완성된 백엔드 위에 스펙 §4·§5의 화면을 구현한다 — 작업대(`/generate`)·클라이언트 관리(`/clients`)·진입점 3개.

**Architecture:** 최상위 셸(GlobalShell: localStorage 마지막 워크스페이스로 사이드바 렌더) → 순수 UI 헬퍼(`draftUi`) → 독립 컴포넌트 4개(DraftCard·DraftEditModal·RefPickerSheet·DraftComposer) → 페이지 와이어링 → 기존 카드에 진입점 A 액션. 서버 타입은 전부 `import type`으로만 소비(런타임 번들 오염 없음 — `library/page.tsx`의 기존 관례).

**Tech Stack:** Next.js 16 App Router('use client' 컴포넌트), Tailwind v4 기존 `@theme` 토큰, `apiFetch`·`Toast`·`Button`·`MediaGrid`·`XIcons` 재사용. 신규 의존성 0. 컴포넌트 테스트 하네스는 레포에 없음 — lib 헬퍼만 `node:test`, 컴포넌트·페이지는 `tsc`+`lint`+`next build`+수동 QA.

## Global Constraints

- **X 실측(초안 카드)**: 폭 `max-w-[600px]` · radius 16px(`rounded-2xl`) · `border-x-border-strong` · 그림자 없음 · 패딩 `px-4 py-3`(16/12px) · 아바타 40px 원형(멤버 색+이니셜) · 이름·본문 `text-[15px] leading-5`(15/20px, 이름만 `font-bold`) · 액션 아이콘 19px(`h-[19px] w-[19px]`)+13px 텍스트 · X 컴포즈 입력 `text-[20px] leading-6` · 저장 버튼 h-9(36px)
- **초안 카드에 넣지 않는 것**: 인증 배지 · 지표 바 · 이미지 플레이스홀더. `MediaGrid`는 붙이되 media 0건이면 null 반환(이미지 확장 지점)
- 라이트 고정. 표면 2층: 회색(`bg-x-surface`)=도구층, 흰색=X 콘텐츠
- **작업대 노출 컨트롤 4개**: 방향성 입력 · 설정 요약 "바꾸기" · 원고 만들기 · 레퍼런스 추가 — 그 외 컨트롤을 앞단에 늘어놓지 않는다
- 검수 표식: 구절 하이라이트(앰버 `text-amber-700`/`bg-amber-100` 계열, 빨강 금지) + 이유 평문 + `무시`(PATCH `dismissedFlags` 영속). 차단 없음
- PR 안내 상시 문구(도구층): "PR 표기(#PR)는 원고와 함께 인플루언서에게 안내하세요 — 스테마 규제"
- 생성 버튼 라벨: `원고 만들기 (약 $0.1 이하)` (브리핑 비용 표기 관례)
- 생성 대기: 카드 모양 스켈레톤 + "원고 작성 중… 보통 15~30초 걸려요" + 취소. 취소 캡션: "취소해도 완성되면 목록에 저장됩니다"
- 삭제: 낙관적 제거 + 5초 실행취소 Toast(보관함 `library/page.tsx` 패턴)
- 빈 상태: 클라이언트 0 → "클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 → [등록하러 가기]" / 초안 0 → 기능 설명+CTA / 레퍼런스 0 = 백지 생성 허용
- 진입점 A: 덱 `TweetCard`는 **저장된 트윗만**(`t.savedBy.length > 0`) 액션 노출, 보관함 `CandidateCard`는 항상. 링크 `/generate?ref=<tweetId>`. 미저장 트윗의 ref 진입은 Toast 평문 안내
- 레퍼런스 선택: 상한 8(이유 병기), 메모 우선 정렬(서버가 함), 전체/워크스페이스 세그먼트+태그 필터는 **RefPickerSheet 안에만**
- 에러는 전부 평문 한국어(서버 `error` 필드 그대로 노출), 스택·코드 금지
- UX 카피는 AGENTS.md 원칙(라벨=이득 언어, 행동 전 기대 설정, 숫자에 판단 병기)
- 서버 모듈은 `import type`으로만 (`DraftRow`·`ReferenceRow`·`ClientRow`·`ProcedureRow`·`DraftContent` 등)
- 검증 명령: lib는 `node --import tsx --env-file-if-exists=.env --test <파일>`, UI는 `npx tsc --noEmit && npm run lint`(기준선 22)
- 커밋 메시지는 레포 관례(한국어, `feat(x-deck):`)

---

### Task 1: `draftUi` — 순수 UI 헬퍼 (TDD)

**Files:**
- Create: `src/lib/draftUi.ts`
- Test: `src/lib/draftUi.test.ts`

**Interfaces:**
- Consumes: `DraftContent`(`draftTypes.ts`), `draftFlags`·`flagKey`·`DraftFlag`(`complianceFlags.ts`)
- Produces (Task 5·6·8이 사용):
  - `hookBoundary(text): { hook: string; rest: string } | null` — 첫 빈 줄 기준 훅/본문 분리
  - `draftCopyText(content: DraftContent): string` — 단문=본문, 스레드=`---` 구분 전체
  - `draftTimeLabel(iso: string): string` — '방금'/'N분'/'N시간'/'M월 D일'
  - `collectDraftFlags(content, banned, dismissed): PostFlag[]` — post별 표식 + dismissed 판정, post 내 중복 제거
  - `interface PostFlag { postIndex: number; flag: DraftFlag; key: string; dismissed: boolean }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/draftUi.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags } from './draftUi.ts';
import type { DraftContent } from './draftTypes.ts';

test('hookBoundary: 첫 빈 줄에서 분리, 없으면 null', () => {
  const b = hookBoundary('正直迷ってた。\n\nでも良かった。');
  assert.equal(b!.hook, '正直迷ってた。');
  assert.equal(b!.rest, 'でも良かった。');
  assert.equal(hookBoundary('한 단락뿐'), null);
  assert.equal(hookBoundary(''), null);
  assert.equal(hookBoundary('끝에만 빈 줄\n\n'), null);
});

test('draftCopyText: 단문=본문 그대로, 스레드=--- 구분', () => {
  assert.equal(draftCopyText({ posts: [{ text: 'A', media: [] }] }), 'A');
  assert.equal(
    draftCopyText({ posts: [{ text: '1番', media: [] }, { text: '2番', media: [] }] }),
    '1番\n\n---\n\n2番');
});

test('draftTimeLabel: 방금/분/시간 구간', () => {
  const now = Date.now();
  assert.equal(draftTimeLabel(new Date(now - 30_000).toISOString()), '방금');
  assert.equal(draftTimeLabel(new Date(now - 5 * 60_000).toISOString()), '5분');
  assert.equal(draftTimeLabel(new Date(now - 3 * 3600_000).toISOString()), '3시간');
});

test('collectDraftFlags: post별 표식 + dismissed 판정 + 중복 제거', () => {
  const content: DraftContent = {
    posts: [{ text: '効果がある。効果がある。', media: [] }, { text: 'B클리닉より', media: [] }],
  };
  const flags = collectDraftFlags(content, ['B클리닉'], ['yakkiho:効果がある']);
  const p0 = flags.filter((f) => f.postIndex === 0);
  assert.equal(p0.length, 1);                       // 같은 post 안 중복 제거
  assert.equal(p0[0].dismissed, true);              // dismissed 반영
  const p1 = flags.filter((f) => f.postIndex === 1);
  assert.ok(p1.some((f) => f.flag.kind === 'banned' && !f.dismissed));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/lib/draftUi.ts`

```ts
import type { DraftContent } from './draftTypes.ts';
import { draftFlags, flagKey, type DraftFlag } from './complianceFlags.ts';

// 첫 단락 = 훅 (스펙 '산출물 규격'). 첫 빈 줄이 경계. 없거나 내용이 뒤에 없으면 null.
export function hookBoundary(text: string): { hook: string; rest: string } | null {
  const i = text.indexOf('\n\n');
  if (i <= 0) return null;
  const rest = text.slice(i + 2);
  if (!rest.trim()) return null;
  return { hook: text.slice(0, i), rest };
}

// 복사 형식 (스펙 §4): 단문=본문 그대로, 스레드=--- 구분 전체
export function draftCopyText(content: DraftContent): string {
  return content.posts.map((p) => p.text).join('\n\n---\n\n');
}

export function draftTimeLabel(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export interface PostFlag { postIndex: number; flag: DraftFlag; key: string; dismissed: boolean }

// 렌더 시 재계산 원칙(스펙 §3) — dismissed_flags만 영속이고 표식 자체는 매번 새로 계산
export function collectDraftFlags(
  content: DraftContent, banned: string[], dismissed: string[],
): PostFlag[] {
  const out: PostFlag[] = [];
  const seen = new Set<string>();
  content.posts.forEach((p, postIndex) => {
    for (const flag of draftFlags(p.text, banned)) {
      const key = flagKey(flag);
      const uniq = `${postIndex}:${key}`;
      if (seen.has(uniq)) continue;
      seen.add(uniq);
      out.push({ postIndex, flag, key, dismissed: dismissed.includes(key) });
    }
  });
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftUi.ts src/lib/draftUi.test.ts
git commit -m "feat(x-deck): 초안 UI 헬퍼 — 훅 경계·복사 형식·표식 수집"
```

---

### Task 2: 최상위 셸·내비 — `/generate`·`/clients` 진입

**Files:**
- Modify: `src/components/XIcons.tsx` (아이콘 2개 추가)
- Modify: `src/components/Sidebar.tsx` (최상위 nav 2항목)
- Create: `src/components/GlobalShell.tsx`
- Create: `src/app/generate/layout.tsx`
- Create: `src/app/clients/layout.tsx`
- Modify: `src/app/w/[wsId]/layout.tsx` (마지막 워크스페이스 기억)

**Interfaces:**
- Produces: `GlobalShell`(children 래퍼), `LAST_WS_KEY = 'cbx-last-ws'`(Task 8이 워크스페이스 스코프 판단에 사용), `PenIcon`·`ClinicIcon`

- [ ] **Step 1: `XIcons.tsx`에 아이콘 추가** (파일 하단)

```tsx
// 콘텐츠 생성(연필 컴포즈) — X compose 아이콘
export const PenIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z" />
);

// 클라이언트(클리닉 건물)
export const ClinicIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M3 21h18v-2h-1V4c0-1.1-.9-2-2-2H6C4.9 2 4 2.9 4 4v15H3v2zM6 4h12v15h-3v-4H9v4H6V4zm2 2h2v2H8V6zm4 0h2v2h-2V6zM8 10h2v2H8v-2zm4 0h2v2h-2v-2z" />
);
```

- [ ] **Step 2: `Sidebar.tsx`에 최상위 nav 추가**

import에 `PenIcon, ClinicIcon` 추가. 기존 `nav` 배열 아래에:

```tsx
  // 워크스페이스 무관 최상위 기능 (스펙 §4 — 콘텐츠 생성·클라이언트는 /w/[wsId] 밖)
  const globalNav = [
    { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
    { href: '/clients', label: '클라이언트', Ic: ClinicIcon },
  ];
```

기존 `<nav>` 안, 워크스페이스 nav 맵 **아래**에 구분선과 함께 렌더:

```tsx
        <div className="my-2 border-t border-x-border" />
        {globalNav.map((n) => (
          <a key={n.href} href={n.href}
             className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
            <n.Ic className="h-[18px] w-[18px]" />{n.label}
          </a>
        ))}
```

- [ ] **Step 3: `GlobalShell.tsx` 생성**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';
import type { Workspace } from '@/lib/types';

export const LAST_WS_KEY = 'cbx-last-ws';

// 최상위 페이지(/generate·/clients)용 셸 — 사이드바는 wsId가 필요하므로
// 마지막 방문 워크스페이스(localStorage)로, 없으면 첫 워크스페이스로 렌더한다 (스펙 통합 이슈 1)
export function GlobalShell({ children }: { children: React.ReactNode }) {
  const [wsId, setWsId] = useState<string | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem(LAST_WS_KEY);
    if (saved) { setWsId(saved); return; }
    apiFetch('/api/workspaces').then((r) => r.json())
      .then((ws: Workspace[]) => { if (ws[0]) setWsId(ws[0].id); });
  }, []);
  return (
    <MemberProvider>
      <div className="flex h-screen">
        {wsId && <Sidebar wsId={wsId} />}
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </MemberProvider>
  );
}
```

- [ ] **Step 4: 레이아웃 2개 생성**

`src/app/generate/layout.tsx`:
```tsx
import { GlobalShell } from '@/components/GlobalShell';

export default function GenerateLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
```
`src/app/clients/layout.tsx`: 동일 내용, 함수명만 `ClientsLayout`.

- [ ] **Step 5: `/w/[wsId]/layout.tsx`에 마지막 워크스페이스 기억 추가**

import에 `useEffect`(react)·`LAST_WS_KEY`(GlobalShell) 추가, 컴포넌트 본문 맨 위에:
```tsx
  useEffect(() => { if (wsId) localStorage.setItem(LAST_WS_KEY, wsId); }, [wsId]);
```

- [ ] **Step 6: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/XIcons.tsx src/components/Sidebar.tsx src/components/GlobalShell.tsx src/app/generate/layout.tsx src/app/clients/layout.tsx "src/app/w/[wsId]/layout.tsx"
git commit -m "feat(x-deck): 최상위 셸·내비 — 콘텐츠 생성/클라이언트 진입, 마지막 워크스페이스 기억"
```

---

### Task 3: `/clients` 페이지 — 클라이언트·시술 CRUD

**Files:**
- Create: `src/app/clients/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/clients`, `PATCH/DELETE /api/clients/[id]`, `POST /api/clients/[id]/procedures`, `PATCH/DELETE /api/procedures/[id]`, `import type { ClientRow, ProcedureRow } from '@/lib/clientStore'`, `Button`
- Produces: 없음 (독립 페이지)

- [ ] **Step 1: 구현** — `src/app/clients/page.tsx`

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';

type ClientWithProcs = { client: ClientRow; procedures: ProcedureRow[] };

// 줄바꿈 textarea ↔ string[] (금지 표현 입력)
const toLines = (arr: string[]) => arr.join('\n');
const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export default function ClientsPage() {
  const [rows, setRows] = useState<ClientWithProcs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await apiFetch('/api/clients');
    if (r.ok) setRows(await r.json());
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = rows.find((x) => x.client.id === selectedId) ?? null;

  async function createClient() {
    const name = newName.trim();
    if (!name) return;
    const r = await apiFetch('/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    const c = (await r.json()) as ClientRow;
    setNewName(''); await load(); setSelectedId(c.id);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-[20px] font-bold">클라이언트</h1>
      <p className="mt-1 text-ui text-x-secondary">
        클리닉 정보와 금지 표현을 한 번 등록해두면, 원고를 만들 때마다 자동으로 반영돼요.
      </p>
      {err && <p className="mt-2 text-ui text-red-500">{err}</p>}

      <div className="mt-4 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createClient(); }}
               placeholder="새 클라이언트 이름 (예: A클리닉)"
               className="w-64 rounded-md border border-x-border-strong bg-white px-3 py-1.5 text-ui outline-none focus:border-x-blue" />
        <Button variant="primary" onClick={createClient}>추가</Button>
      </div>

      {loaded && rows.length === 0 && (
        <p className="mt-6 rounded-lg bg-x-surface p-4 text-ui text-x-secondary">
          아직 클라이언트가 없어요. 위에서 이름을 추가하면 상세 정보를 채울 수 있어요.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {rows.map(({ client }) => (
          <button key={client.id} onClick={() => setSelectedId(client.id)}
                  className={`rounded-full border px-3 py-1 text-ui ${selectedId === client.id ? 'border-x-blue text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
            {client.name}
          </button>
        ))}
      </div>

      {selected && <ClientEditor key={selected.client.id} data={selected} onChanged={load} onDeleted={() => { setSelectedId(null); load(); }} />}
    </div>
  );
}

function ClientEditor({ data, onChanged, onDeleted }: {
  data: ClientWithProcs; onChanged: () => Promise<void>; onDeleted: () => void;
}) {
  const { client, procedures } = data;
  const [info, setInfo] = useState(client.info);
  const [banned, setBanned] = useState(toLines(client.bannedPhrases));
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newProc, setNewProc] = useState('');

  async function save() {
    setSaving(true);
    await apiFetch(`/api/clients/${client.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ info, bannedPhrases: fromLines(banned) }),
    });
    setSaving(false); await onChanged();
  }
  async function removeClient() {
    await apiFetch(`/api/clients/${client.id}`, { method: 'DELETE' });
    onDeleted();
  }
  async function addProc() {
    const name = newProc.trim();
    if (!name) return;
    await apiFetch(`/api/clients/${client.id}/procedures`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    setNewProc(''); await onChanged();
  }

  return (
    <div className="mt-6 rounded-2xl border border-x-border-strong">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-[15px] font-bold">{client.name}</h2>
        {confirmDel ? (
          <span className="flex items-center gap-2 text-caption">
            <span className="text-red-600">시술·초안 연결이 함께 정리돼요. 초안은 스냅샷으로 남아요.</span>
            <button onClick={removeClient} className="rounded bg-red-600 px-2 py-0.5 text-white">삭제 확정</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="text-caption text-x-muted hover:text-red-500">클라이언트 삭제</button>
        )}
      </div>

      <div className="space-y-4 border-t border-x-border px-4 py-4">
        <label className="block">
          <span className="text-caption text-x-muted">클리닉·의사 정보 — 원고를 만드는 재료예요. 기존 소개 문서를 붙여넣어도 좋아요</span>
          <textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={6}
                    className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
        </label>
        <label className="block">
          <span className="text-caption text-x-muted">금지 표현 (한 줄에 하나) — 원고 검수 기준으로도 쓰여요 (예: 경쟁사명, 계약상 못 쓰는 표현)</span>
          <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={3}
                    className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
        </label>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
      </div>

      <div className="border-t border-x-border px-4 py-4">
        <h3 className="text-ui font-medium">시술 ({procedures.length})</h3>
        <p className="text-caption text-x-muted">원고를 만들 때 이번 건에 해당하는 시술만 골라 반영해요</p>
        <div className="mt-2 space-y-3">
          {procedures.map((p) => <ProcedureEditor key={p.id} proc={p} onChanged={onChanged} />)}
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
  );
}

function ProcedureEditor({ proc, onChanged }: { proc: ProcedureRow; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(proc.description);
  const [effect, setEffect] = useState(proc.effectPhrases);
  const [banned, setBanned] = useState(toLines(proc.bannedPhrases));

  async function save() {
    await apiFetch(`/api/procedures/${proc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, effectPhrases: effect, bannedPhrases: fromLines(banned) }),
    });
    setOpen(false); await onChanged();
  }
  async function remove() {
    await apiFetch(`/api/procedures/${proc.id}`, { method: 'DELETE' });
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-3 py-2">
      <div className="flex items-baseline justify-between">
        <button onClick={() => setOpen(!open)} className="text-ui font-medium hover:text-x-blue-text">
          {proc.name} {open ? '⌃' : '⌄'}
        </button>
        <button onClick={remove} className="text-caption text-x-muted hover:text-red-500">삭제</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-caption text-x-muted">시술 설명</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <label className="block">
            <span className="text-caption text-x-muted">효과·결과로 쓸 수 있는 표현 — 여기 적힌 범위까지만 원고에 사용돼요</span>
            <textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <label className="block">
            <span className="text-caption text-x-muted">이 시술만의 금지 표현 (한 줄에 하나)</span>
            <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <Button variant="primary" onClick={save}>시술 저장</Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/app/clients/page.tsx
git commit -m "feat(x-deck): 클라이언트 관리 페이지 — 클리닉 정보·금지 표현·시술 CRUD"
```

---

### Task 4: `RefPickerSheet` — 레퍼런스 선택 시트 (진입점 B)

**Files:**
- Create: `src/components/RefPickerSheet.tsx`

**Interfaces:**
- Consumes: `GET /api/references?scope=&tag=`, `import type { ReferenceRow } from '@/lib/referenceStore'`, `Button`
- Produces (Task 8이 사용): `<RefPickerSheet open onClose lastWsId selectedIds onApply(rows: ReferenceRow[])/>`

- [ ] **Step 1: 구현** — `src/components/RefPickerSheet.tsx`

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import type { ReferenceRow } from '@/lib/referenceStore';

export const MAX_REFS_UI = 8; // 서버 MAX_REFS와 동일 (generate.ts)

// 레퍼런스 선택 — 진입점 B에서만 만나는 화면. 전체/워크스페이스 세그먼트 + 태그 필터 + 메모 우선(서버 정렬)
export function RefPickerSheet({ open, onClose, lastWsId, selectedIds, onApply }: {
  open: boolean; onClose: () => void; lastWsId: string | null;
  selectedIds: string[]; onApply: (rows: ReferenceRow[]) => void;
}) {
  const [scope, setScope] = useState<'all' | 'ws'>('all');
  const [rows, setRows] = useState<ReferenceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>(selectedIds);

  useEffect(() => { if (open) setSel(selectedIds); }, [open, selectedIds]);
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const s = scope === 'ws' && lastWsId ? lastWsId : 'all';
    apiFetch(`/api/references?scope=${s}`).then((r) => r.json())
      .then((data: ReferenceRow[]) => { setRows(data); setLoaded(true); });
  }, [open, scope, lastWsId]);

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].slice(0, 12), [rows]);
  const visible = tag ? rows.filter((r) => r.tags.includes(tag)) : rows;

  if (!open) return null;
  function toggle(id: string) {
    setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id)
      : cur.length >= MAX_REFS_UI ? cur : [...cur, id]);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-x-text/40 p-6" onClick={onClose}>
      <div className="max-h-full w-full max-w-[640px] overflow-y-auto rounded-2xl bg-white"
           role="dialog" aria-label="레퍼런스 선택" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center gap-3 border-b border-x-border bg-white px-4 py-3">
          <h2 className="text-[15px] font-bold">참고할 레퍼런스</h2>
          <span className="ml-auto text-ui tabular-nums text-x-secondary"><b className="text-x-text">{sel.length}</b> / {MAX_REFS_UI} 선택</span>
          <button onClick={onClose} aria-label="닫기" className="rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 py-2">
          <span className="text-caption text-x-muted">범위</span>
          <div className="flex overflow-hidden rounded-full border border-x-border-strong bg-white text-ui">
            <button onClick={() => setScope('all')} className={`px-3 py-1 ${scope === 'all' ? 'bg-x-blue font-medium text-white' : 'text-x-secondary'}`}>전체 보관함</button>
            <button onClick={() => setScope('ws')} className={`px-3 py-1 ${scope === 'ws' ? 'bg-x-blue font-medium text-white' : 'text-x-secondary'}`}>이 워크스페이스</button>
          </div>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)}
                    className={`rounded-full border px-2.5 py-0.5 text-caption ${tag === t ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-muted'}`}>
              #{t}
            </button>
          ))}
        </div>

        <p className="flex gap-1.5 border-b border-x-border bg-x-blue/5 px-4 py-2 text-caption text-x-secondary">
          <span>ℹ️</span><span><b>메모가 달린 것부터</b> 보여드려요 — 메모가 "이 레퍼런스의 무엇이 좋은지"를 알려줘서 원고 품질에 직접 기여해요.</span>
        </p>

        <div>
          {!loaded && <p className="p-4 text-ui text-x-muted">불러오는 중…</p>}
          {loaded && visible.length === 0 && (
            <p className="p-4 text-ui text-x-secondary">보관함이 비어 있어요 — 덱에서 트윗을 ☆ 저장하면 여기서 참고할 수 있어요.</p>
          )}
          {visible.map((r) => {
            const on = sel.includes(r.tweetId);
            return (
              <button key={r.tweetId} onClick={() => toggle(r.tweetId)}
                      className={`flex w-full gap-2.5 border-b border-x-border px-4 py-2.5 text-left ${on ? 'bg-x-blue/5 shadow-[inset_3px_0_0_#1d9bf0]' : 'hover:bg-x-hover'}`}>
                <span aria-hidden className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-caption font-bold ${on ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong bg-white'}`}>{on ? '✓' : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui"><b>{r.authorName ?? r.authorHandle}</b> <span className="text-x-muted">@{r.authorHandle}{r.likes != null && ` · ♡${r.likes}`}</span></span>
                  <span className="mt-0.5 line-clamp-2 block text-[15px] leading-5">{r.text}</span>
                  {r.memos.map((m, i) => (
                    <span key={i} className="mt-1 block rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</span>
                  ))}
                  <span className="mt-1 block text-caption text-x-muted">
                    {r.memos.length === 0 && '메모 없음 — 저장만 되어 있어요 · '}
                    {r.tags.map((t) => `#${t}`).join(' ')}{r.tags.length > 0 && ' · '}
                    {r.workspaces.length > 1 ? `${r.workspaces.length}곳에 저장됨 · ` : ''}{r.workspaces.map((w) => w.name).join(', ')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="sticky bottom-0 border-t border-x-border bg-white px-4 py-3">
          <p className="mb-2 text-caption text-amber-700">
            {MAX_REFS_UI}건까지 고를 수 있어요. 더 넣으면 원고가 레퍼런스 문구를 그대로 베낄 위험이 커져요 — 서로 다른 앵글로 3~5건이 가장 좋아요.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => { onApply(rows.filter((r) => sel.includes(r.tweetId))); onClose(); }}>
              {sel.length}건 적용
            </Button>
            <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
            <span className="ml-auto text-caption text-x-muted">선택은 다음 생성에도 유지돼요</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/RefPickerSheet.tsx
git commit -m "feat(x-deck): 레퍼런스 선택 시트 — 전체/워크스페이스·태그 필터·상한 8 안내"
```

---

### Task 5: `DraftCard` — 초안 카드 (X 실측)

**Files:**
- Create: `src/components/DraftCard.tsx`

**Interfaces:**
- Consumes: `import type { DraftRow } from '@/lib/draftStore'`, `import type { RefSnapshot } from '@/lib/draftTypes'`, `xWeightedLength`·`X_MAX_WEIGHTED`(`xLength`), `hookBoundary`·`draftCopyText`·`draftTimeLabel`·`collectDraftFlags`(`draftUi`), `MediaGrid`, `RefreshIcon`·`TrashIcon`(`XIcons`)
- Produces (Task 8이 사용):
  `<DraftCard draft banned onEdit onAnother anotherBusy onDelete onRegenPost regenBusyIndex onDismissFlag />`

- [ ] **Step 1: 구현** — `src/components/DraftCard.tsx`

```tsx
'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { RefSnapshot } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags } from '@/lib/draftUi';
import { MediaGrid } from '@/components/MediaGrid';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';

const MODE_LABEL: Record<DraftRow['referenceMode'], string> = {
  off: '참고 없음', form: '형식만', angle: '앵글만', both: '형식 + 앵글',
};

// 초안 카드 — X 실측(600px·radius16·아바타40·본문 15/20). 지표·배지·이미지 자리 없음(없는 데이터는 자리도 안 만듦)
export function DraftCard({ draft, banned, onEdit, onAnother, anotherBusy, onDelete, onRegenPost, regenBusyIndex, onDismissFlag }: {
  draft: DraftRow; banned: string[];
  onEdit: () => void; onAnother: () => void; anotherBusy: boolean;
  onDelete: () => void; onRegenPost: (index: number) => void; regenBusyIndex: number | null;
  onDismissFlag: (key: string, dismiss: boolean) => void;
}) {
  const [refsOpen, setRefsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = draft.edited ?? draft.content;
  const flags = collectDraftFlags(content, banned, draft.dismissedFlags);
  const active = flags.filter((f) => !f.dismissed);
  const dismissedCount = flags.length - active.length;
  const total = content.posts.reduce((n, p) => n + xWeightedLength(p.text), 0);
  const isThread = draft.format === 'thread';

  async function copyAll() {
    await navigator.clipboard.writeText(draftCopyText(content));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-x-border-strong bg-white">
      {/* 흰색 = X 콘텐츠층 */}
      <div className="flex gap-3 px-4 py-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
              style={{ background: draft.member?.color ?? '#1d9bf0' }}>
          {(draft.member?.name ?? '초').slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5">
            <b>{draft.member?.name ?? '초안'}</b>
            <span className="text-x-secondary"> · 초안 · {draftTimeLabel(draft.createdAt)}</span>
            {draft.edited && <span className="text-x-muted"> · 편집됨</span>}
          </p>
          <div className={isThread ? 'relative mt-1 space-y-3 pl-3 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:bg-x-border-strong' : 'mt-0.5'}>
            {content.posts.map((p, i) => {
              const hb = hookBoundary(p.text);
              const len = xWeightedLength(p.text);
              return (
                <div key={i}>
                  {isThread && <p className="text-caption font-bold text-x-muted">{i + 1} / {content.posts.length}</p>}
                  {hb ? (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">
                      {hb.hook}
                      <span className="relative my-1.5 block border-t border-dashed border-x-border-strong">
                        <span className="absolute -top-2 right-0 bg-white px-1 text-[10.5px] text-x-muted">↑ 첫 단락 = 타임라인에서 시선을 잡는 훅</span>
                      </span>
                      {hb.rest}
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">{p.text}</p>
                  )}
                  <MediaGrid media={p.media} />
                  <p className="mt-1 flex items-center gap-3 text-caption tabular-nums text-x-muted">
                    <span className={len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : ''}>{len} / {X_MAX_WEIGHTED} (가중 — 일본어 약 140자)</span>
                    {isThread && (
                      <button onClick={() => onRegenPost(i)} disabled={regenBusyIndex !== null}
                              className="text-x-blue-text hover:underline disabled:opacity-50">
                        {regenBusyIndex === i ? '다시 만드는 중…' : '이 트윗만 다시'}
                      </button>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          {/* 액션 행 — X 액션 바 자리에 우리 액션 (없는 지표를 채우지 않고 교체) */}
          <div className="mt-3 flex max-w-[440px] items-center gap-1 text-[13px] text-x-secondary">
            <button onClick={onEdit} className="flex items-center gap-1.5 rounded-full px-2 py-1 text-x-blue-text hover:bg-x-blue/10">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z" /></svg>
              편집
            </button>
            <button onClick={onAnother} disabled={anotherBusy} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5 disabled:opacity-50">
              <RefreshIcon className="h-[19px] w-[19px]" />{anotherBusy ? '만드는 중…' : '다른 각도로'}
            </button>
            <button onClick={copyAll} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
              {copied ? '복사됨 ✓' : '복사'}
            </button>
            <button onClick={onDelete} aria-label="초안 삭제" className="flex items-center rounded-full px-2 py-1 hover:bg-red-50 hover:text-red-600">
              <TrashIcon className="h-[19px] w-[19px]" />
            </button>
            <span className="ml-auto tabular-nums">{isThread ? `${content.posts.length}개 · 총 ${total}자` : ''}</span>
          </div>
        </div>
      </div>

      {/* 회색 = 도구층: 검수 표식 + PR 안내 + 근거 풋터 (spec §2 표면 2층) */}
      <div className="border-t border-x-border bg-x-surface px-4 py-2.5">
        {active.map((f) => (
          <p key={`${f.postIndex}:${f.key}`} className="flex items-baseline gap-2 py-0.5 text-[13px]">
            <span className="border-b-2 border-amber-700 font-bold text-amber-700">{f.flag.term}</span>
            <span className="text-x-secondary">{f.flag.reason}{isThread ? ` (${f.postIndex + 1}번)` : ''}</span>
            <button onClick={() => onDismissFlag(f.key, true)} className="ml-auto shrink-0 text-x-blue-text hover:underline">무시</button>
          </p>
        ))}
        {dismissedCount > 0 && (
          <p className="py-0.5 text-caption text-x-muted">
            무시한 표식 {dismissedCount}개
            <button onClick={() => draft.dismissedFlags.forEach((k) => onDismissFlag(k, false))} className="ml-2 text-x-blue-text hover:underline">모두 되돌리기</button>
          </p>
        )}
        <p className="py-0.5 text-caption text-x-muted">ℹ️ PR 표기(#PR)는 원고와 함께 인플루언서에게 안내하세요 — 스테마 규제</p>

        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-x-border pt-1.5 text-[13px]">
          <button onClick={() => setRefsOpen(!refsOpen)} disabled={draft.refs.length === 0}
                  className="text-left disabled:cursor-default">
            참고 레퍼런스 {draft.refs.length}건{draft.refs.length > 0 && <span className="text-x-blue-text"> · {MODE_LABEL[draft.referenceMode]} {refsOpen ? '⌃' : '⌄'}</span>}
          </button>
          <span className="shrink-0 text-caption tabular-nums text-x-muted">
            {[draft.clientName, ...draft.procedureNames].filter(Boolean).join(' · ')}{draft.model ? ` · ${draft.model}` : ''}
          </span>
        </div>
        {refsOpen && draft.refs.map((r: RefSnapshot) => (
          <div key={r.tweetId} className="mt-2 rounded-lg border border-x-border bg-white px-3 py-2">
            <p className="text-ui"><b>{r.name ?? r.handle}</b> <span className="text-x-muted">@{r.handle}</span>
              <a href={`https://x.com/i/status/${r.tweetId}`} target="_blank" rel="noreferrer" className="ml-2 text-x-blue-text hover:underline">원문 ↗</a>
            </p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{r.excerpt}</p>
            {r.memos.map((m, i) => (
              <p key={i} className="mt-1 rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/DraftCard.tsx
git commit -m "feat(x-deck): DraftCard — X 실측 초안 카드·검수 표식·근거 풋터 펼침"
```

---

### Task 6: `DraftEditModal` — X 컴포즈식 편집

**Files:**
- Create: `src/components/DraftEditModal.tsx`

**Interfaces:**
- Consumes: `PATCH /api/drafts/[id]`, `import type { DraftRow } from '@/lib/draftStore'`, `import type { DraftContent } from '@/lib/draftTypes'`, `xWeightedLength`·`X_MAX_WEIGHTED`
- Produces (Task 8이 사용): `<DraftEditModal draft onClose onSaved(updated: DraftRow) />`

- [ ] **Step 1: 구현** — `src/components/DraftEditModal.tsx`

```tsx
'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftContent } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';

// X 컴포즈 모달 구조: ✕ / 원본과 비교 / 아바타 40 / 입력 20px·lh24 / 하단 바 + 저장 36px (스펙 §4)
export function DraftEditModal({ draft, onClose, onSaved }: {
  draft: DraftRow; onClose: () => void; onSaved: (updated: DraftRow) => void;
}) {
  const base = draft.edited ?? draft.content;
  const [texts, setTexts] = useState(base.posts.map((p) => p.text));
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const empty = texts.some((t) => !t.trim());

  async function save() {
    setErr(''); setSaving(true);
    const edited: DraftContent = {
      posts: base.posts.map((p, i) => ({ text: texts[i], media: p.media })),
    };
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edited }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    onSaved((await r.json()) as DraftRow);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[600px] rounded-2xl bg-white" role="dialog" aria-label="초안 편집"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={onClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
          <button onClick={() => setCompare(!compare)} className="text-[15px] font-bold text-x-blue-text hover:underline">
            {compare ? '편집으로 돌아가기' : '원본과 비교'}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">
          {base.posts.map((p, i) => {
            const len = xWeightedLength(texts[i]);
            return (
              <div key={i} className="flex gap-3 py-2">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                      style={{ background: draft.member?.color ?? '#1d9bf0' }}>
                  {(draft.member?.name ?? '초').slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  {base.posts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {base.posts.length}</p>}
                  {compare ? (
                    <div className="space-y-2">
                      <p className="whitespace-pre-wrap rounded-lg bg-x-surface p-2 text-[15px] leading-5 text-x-secondary">{draft.content.posts[i]?.text}</p>
                      <p className="whitespace-pre-wrap text-[15px] leading-5">{texts[i]}</p>
                    </div>
                  ) : (
                    <textarea value={texts[i]} rows={Math.max(3, texts[i].split('\n').length + 1)}
                              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
                              className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted"
                              placeholder="본문을 입력하세요" autoFocus={i === 0} />
                  )}
                  <p className={`text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>{len} / {X_MAX_WEIGHTED}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="border-t border-x-border px-4 py-2 text-[14px] font-bold text-x-blue-text">
          🌐 인플루언서가 자기 계정으로 게시합니다 — PR 표기 안내를 함께 전달하세요
        </p>
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-2.5">
          {err && <span className="text-ui text-red-500">{err}</span>}
          <button onClick={save} disabled={saving || empty || compare}
                  className="ml-auto h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/DraftEditModal.tsx
git commit -m "feat(x-deck): DraftEditModal — X 컴포즈식 편집·원본과 비교·가중 카운터"
```

---

### Task 7: `DraftComposer` — 방향성·설정 요약·생성

**Files:**
- Create: `src/components/DraftComposer.tsx`

**Interfaces:**
- Consumes: `import type { ClientRow, ProcedureRow } from '@/lib/clientStore'`, `import type { ReferenceRow } from '@/lib/referenceStore'`, `import type { DraftFormat, ReferenceMode } from '@/lib/draftTypes'`, `Button`
- Produces (Task 8이 사용):
  - `interface ComposerState { clientId: string | null; procedureIds: string[]; format: DraftFormat; mode: ReferenceMode; constraintsOn: boolean; direction: string }`
  - `<DraftComposer clients value onChange refRows onOpenPicker onRemoveRef generating onGenerate onCancel />`

- [ ] **Step 1: 구현** — `src/components/DraftComposer.tsx`

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
}
export const DEFAULT_COMPOSER: ComposerState = {
  clientId: null, procedureIds: [], format: 'single', mode: 'both', constraintsOn: false, direction: '',
};
const MODE_LABEL: Record<ReferenceMode, string> = { off: '참고 안 함', form: '형식만', angle: '앵글만', both: '형식+앵글' };

// 작업대 상단 — 노출 컨트롤 4개(방향성·바꾸기·원고 만들기·레퍼런스 추가), 나머지는 접힌 요약 (스펙 §4)
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onRemoveRef, generating, onGenerate, onCancel }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onRemoveRef: (tweetId: string) => void;
  generating: boolean; onGenerate: () => void; onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const canGenerate = !!value.clientId || (refRows.length > 0 && value.mode !== 'off') || value.direction.trim().length > 0;

  const summary = [
    cur ? cur.client.name : '클라이언트 없음',
    ...(cur ? cur.procedures.filter((p) => value.procedureIds.includes(p.id)).map((p) => p.name) : []),
    value.format === 'single' ? '단문' : '스레드',
    `참고: ${refRows.length > 0 ? MODE_LABEL[value.mode] : '없음'}`,
    value.constraintsOn ? '생성 제약 켬' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="w-full max-w-[600px] rounded-2xl border border-x-border-strong bg-white">
      {/* 진입 컨텍스트 — 레퍼런스 연결 상태 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-x-border bg-x-surface px-4 py-2 text-[13px] text-x-secondary">
        {refRows.length > 0 ? (
          <>
            <span>레퍼런스 {refRows.length}건 연결됨</span>
            {refRows.map((r) => (
              <span key={r.tweetId} className="flex items-center gap-1 rounded-full border border-x-border-strong bg-white px-2 py-0.5 text-caption">
                @{r.authorHandle}
                <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
              </span>
            ))}
          </>
        ) : (
          <span>레퍼런스 없이 시작 — 보관함의 좋았던 포스트를 참고하면 원고가 더 좋아져요</span>
        )}
        <button onClick={onOpenPicker} className="ml-auto shrink-0 text-x-blue-text hover:underline">
          {refRows.length > 0 ? '+ 레퍼런스 추가' : '보관함에서 고르기'}
        </button>
      </div>

      <div className="px-4 py-3">
        <label className="block">
          <span className="text-[13px] text-x-secondary">이번 초안은 어떤 방향으로 만들까요? (비워도 돼요 — 레퍼런스나 클라이언트 정보만으로도 만들 수 있어요)</span>
          <textarea value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value })}
                    rows={2} placeholder="예: 여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조"
                    className="mt-1 w-full rounded-lg border border-x-border-strong p-2.5 text-[15px] leading-normal outline-none focus:border-x-blue" />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-x-secondary">{summary}</span>
          <button onClick={() => setOpen(!open)} className="text-x-blue-text hover:underline">{open ? '접기' : '바꾸기'}</button>
          <span className="ml-auto" />
          {generating ? (
            <Button onClick={onCancel}>취소</Button>
          ) : (
            <button onClick={onGenerate} disabled={!canGenerate}
                    className="h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
              원고 만들기 (약 $0.1 이하)
            </button>
          )}
        </div>
        {!canGenerate && !generating && (
          <p className="mt-1 text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요</p>
        )}

        {open && (
          <div className="mt-3 space-y-3 rounded-lg bg-x-surface p-3 text-ui">
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">클라이언트</span>
              <select value={value.clientId ?? ''} className="rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue"
                      onChange={(e) => onChange({ ...value, clientId: e.target.value || null, procedureIds: [] })}>
                <option value="">반영 안 함</option>
                {clients.map(({ client }) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              {clients.length === 0 && <a href="/clients" className="text-caption text-x-blue-text hover:underline">클라이언트를 먼저 등록하세요 →</a>}
            </label>
            {cur && cur.procedures.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 pt-0.5 text-caption text-x-muted">시술</span>
                <span className="flex flex-wrap gap-1.5">
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
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">형식</span>
              {(['single', 'thread'] as const).map((f) => (
                <button key={f} onClick={() => onChange({ ...value, format: f })}
                        className={`rounded-full border px-3 py-0.5 ${value.format === f ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                  {f === 'single' ? '단문 (~140자)' : '스레드 (3~5개)'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">참고 방식</span>
              {(['form', 'angle', 'both'] as const).map((m) => (
                <button key={m} onClick={() => onChange({ ...value, mode: m })}
                        className={`rounded-full border px-3 py-0.5 ${value.mode === m ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                  {MODE_LABEL[m]}
                </button>
              ))}
              <span className="text-caption text-x-muted">— 레퍼런스에서 무엇을 가져올지</span>
            </div>
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">생성 제약</span>
              <input type="checkbox" checked={value.constraintsOn}
                     onChange={(e) => onChange({ ...value, constraintsOn: e.target.checked })} />
              <span className="text-caption text-x-secondary">금지 표현을 생성 단계부터 피하기 — 끄면 자유롭게 만들고, 검수 표식은 항상 표시돼요</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/DraftComposer.tsx
git commit -m "feat(x-deck): DraftComposer — 방향성 중심 4컨트롤·설정 접힘 요약"
```

---

### Task 8: `/generate` 페이지 — 작업대 와이어링

**Files:**
- Create: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: Task 4~7 컴포넌트 전부, `GET/POST /api/drafts`·`PATCH/DELETE /api/drafts/[id]`·`POST /api/drafts/[id]/regen-post`·`GET /api/clients`·`GET /api/references`, `LAST_WS_KEY`, `Toast`, `import type { DraftRow } from '@/lib/draftStore'`

- [ ] **Step 1: 구현** — `src/app/generate/page.tsx`

```tsx
'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Toast } from '@/components/Toast';
import { DraftCard } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { RefPickerSheet } from '@/components/RefPickerSheet';
import { DraftComposer, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { DraftRow } from '@/lib/draftStore';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';

const COMPOSER_KEY = 'cbx-composer'; // 직전 설정 유지 (스펙 §4 "바꾸기 — 직전 값 유지")

export default function GeneratePage() {
  return (
    <Suspense>
      <Workbench />
    </Suspense>
  );
}

function Workbench() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Array<{ client: ClientRow; procedures: ProcedureRow[] }>>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(DEFAULT_COMPOSER);
  const [refRows, setRefRows] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [anotherOf, setAnotherOf] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<DraftRow | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWsId = typeof window !== 'undefined' ? localStorage.getItem(LAST_WS_KEY) : null;

  useEffect(() => {
    try { const s = localStorage.getItem(COMPOSER_KEY); if (s) setComposer({ ...DEFAULT_COMPOSER, ...JSON.parse(s) }); } catch { /* 무시 */ }
    Promise.all([
      apiFetch('/api/clients').then((r) => r.json()),
      apiFetch('/api/drafts').then((r) => r.json()),
    ]).then(([c, d]) => { setClients(c); setDrafts(d); setLoaded(true); });
  }, []);
  const updateComposer = useCallback((v: ComposerState) => {
    setComposer(v);
    localStorage.setItem(COMPOSER_KEY, JSON.stringify({ ...v, direction: '' })); // 방향성은 매번 새로
  }, []);

  // 진입점 A: /generate?ref=<tweetId> — 보관함에 있으면 레퍼런스로 연결
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (!ref) return;
    apiFetch('/api/references?scope=all').then((r) => r.json()).then((rows: ReferenceRow[]) => {
      const found = rows.find((x) => x.tweetId === ref);
      if (found) setRefRows((cur) => (cur.some((x) => x.tweetId === ref) ? cur : [...cur, found]));
      else setToast('이 트윗은 보관함에 없어요 — 덱에서 ☆ 저장한 뒤 다시 시도해주세요');
    });
  }, [searchParams]);

  const bannedFor = useCallback((d: DraftRow) => {
    const c = clients.find((x) => x.client.id === d.clientId);
    if (!c) return [];
    return [...c.client.bannedPhrases, ...c.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)];
  }, [clients]);

  async function generate(avoid?: string, fromDraftId?: string) {
    if (generating) return;
    setGenerating(true);
    if (fromDraftId) setAnotherOf(fromDraftId);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await apiFetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({
          clientId: composer.clientId, procedureIds: composer.procedureIds,
          refTweetIds: refRows.map((x) => x.tweetId),
          mode: refRows.length > 0 ? composer.mode : 'off',
          direction: composer.direction, format: composer.format,
          constraintsOn: composer.constraintsOn, avoid,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setDrafts((cur) => [body as DraftRow, ...cur]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setToast('생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setGenerating(false); setAnotherOf(null); abortRef.current = null;
    }
  }

  function cancelGenerate() {
    abortRef.current?.abort();
    setToast('기다리기를 취소했어요 — 완성되면 목록에 저장됩니다 (새로고침으로 확인)');
  }

  async function patchDraft(id: string, body: object) {
    const r = await apiFetch(`/api/drafts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((d) => (d.id === id ? updated : d))); return updated; }
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    return null;
  }

  // 삭제: 낙관적 제거 + 5초 실행취소 (보관함 패턴)
  function requestRemove(d: DraftRow) {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) void apiFetch(`/api/drafts/${pendingRemove.id}`, { method: 'DELETE' });
    setPendingRemove(d);
    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
    removeTimer.current = setTimeout(() => {
      void apiFetch(`/api/drafts/${d.id}`, { method: 'DELETE' });
      setPendingRemove(null);
    }, 5000);
  }
  function undoRemove() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) setDrafts((cur) => [pendingRemove, ...cur]);
    setPendingRemove(null);
  }

  async function regenPost(d: DraftRow, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await apiFetch(`/api/drafts/${d.id}/regen-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((x) => (x.id === d.id ? updated : x))); }
    else setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setRegenBusy(null);
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="w-full max-w-[600px]">
        <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
        <p className="mt-0.5 text-ui text-x-secondary">레퍼런스와 클라이언트 정보를 조합해 인플루언서에게 보낼 X 원고 초안을 만들어요.</p>
        {loaded && clients.length === 0 && (
          <p className="mt-2 rounded-lg bg-x-surface p-3 text-ui text-x-secondary">
            클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 — <a href="/clients" className="font-bold text-x-blue-text hover:underline">등록하러 가기</a>
          </p>
        )}
      </div>

      <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                     refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                     onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                     generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate} />

      {generating && (
        <div className="w-full max-w-[600px] animate-pulse rounded-2xl border border-x-border-strong bg-white px-4 py-3">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-full bg-x-border" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 w-1/3 rounded bg-x-border" />
              <div className="h-3.5 w-full rounded bg-x-border" />
              <div className="h-3.5 w-4/5 rounded bg-x-border" />
            </div>
          </div>
          <p className="mt-2 text-ui text-x-secondary">원고 작성 중… 보통 15~30초 걸려요</p>
        </div>
      )}

      {loaded && drafts.length === 0 && !generating && (
        <p className="w-full max-w-[600px] rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
          아직 초안이 없어요. 방향성을 적거나 레퍼런스를 골라 첫 원고를 만들어보세요 — 만든 초안은 자동으로 저장돼요.
        </p>
      )}

      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} banned={bannedFor(d)}
                   onEdit={() => setEditing(d)}
                   onAnother={() => generate((d.edited ?? d.content).posts[0]?.text, d.id)}
                   anotherBusy={generating && anotherOf === d.id}
                   onDelete={() => requestRemove(d)}
                   onRegenPost={(i) => regenPost(d, i)}
                   regenBusyIndex={regenBusy?.draftId === d.id ? regenBusy.index : null}
                   onDismissFlag={(key, dismiss) => {
                     const next = dismiss ? [...d.dismissedFlags, key] : d.dismissedFlags.filter((k) => k !== key);
                     void patchDraft(d.id, { dismissedFlags: next });
                   }} />
      ))}

      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { setDrafts((cur) => cur.map((d) => (d.id === u.id ? u : d))); setEditing(null); }} />
      )}
      <RefPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} lastWsId={lastWsId}
                      selectedIds={refRows.map((x) => x.tweetId)} onApply={setRefRows} />
      {pendingRemove && <Toast message="초안을 삭제했어요" actionLabel="실행 취소" onAction={undoRemove} />}
      {toast && !pendingRemove && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/app/generate/page.tsx
git commit -m "feat(x-deck): 콘텐츠 생성 작업대 — 진입점 연결·생성 대기·자동 저장·실행취소"
```

---

### Task 9: 진입점 A — 덱·보관함 카드에 "초안 만들기"

**Files:**
- Modify: `src/components/TweetCard.tsx` (풋터 액션 1개)
- Modify: `src/components/CandidateCard.tsx` (액션 1개)

두 파일 모두 먼저 **전체를 읽고** 풋터/액션 영역의 기존 구조에 맞춰 삽입한다(정확한 삽입점은 파일마다 다름 — 아래 앵커 기준).

**Interfaces:**
- Consumes: `/generate?ref=<tweetId>` (Task 8이 처리), `PenIcon`(Task 2)

- [ ] **Step 1: `TweetCard.tsx`** — 회색 풋터의 판단 그룹(☆ 저장 · ✕ 버림 버튼들이 있는 우측 그룹) **앞**에 추가. `t.savedBy.length > 0`일 때만 노출(보관함에 없는 트윗은 백엔드가 레퍼런스로 거절하므로 저장된 것만 안내 — 스펙 진입점 A 규칙):

```tsx
{t.savedBy.length > 0 && (
  <a href={`/generate?ref=${t.tweetId}`} title="이 트윗을 레퍼런스로 초안 만들기"
     className="flex items-center gap-1 rounded-full px-2 py-1 text-ui text-x-secondary hover:bg-x-blue/10 hover:text-x-blue-text">
    <PenIcon className="h-[15px] w-[15px]" />초안
  </a>
)}
```

import에 `PenIcon` 추가 (`./XIcons`).

- [ ] **Step 2: `CandidateCard.tsx`** — 카드 액션 영역(원문 링크·태그 등이 있는 곳)에 항상 노출로 추가 (보관함 카드는 이미 저장된 트윗이므로 조건 없음). 같은 JSX(변수명은 그 파일의 트윗 id 접근자에 맞춤 — 파일을 읽고 확인).

- [ ] **Step 3: 검증 + Commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

```bash
git add src/components/TweetCard.tsx src/components/CandidateCard.tsx
git commit -m "feat(x-deck): 진입점 A — 덱·보관함 카드에서 '초안 만들기'"
```

---

### Task 10: 마감 검증 — 빌드·전체 테스트·수동 QA 목록

**Files:** 없음 (검증만)

- [ ] **Step 1: 정적 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 0 · lint 22 이하

- [ ] **Step 2: 프로덕션 빌드** (서버/클라이언트 경계·라우트 조립 검증)

Run: `npm run build`
Expected: 에러 없이 완료. `/generate`·`/clients` 라우트가 출력 목록에 존재

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: 전체 PASS (Plan 1의 261+개 + Task 1의 4개)

- [ ] **Step 4: 수동 QA 체크리스트를 리포트에 기록** (실행은 사용자 — OAuth 게이팅으로 화면 확인은 사용자만 가능)

1. `/generate` 진입 → 사이드바 활성·클라이언트 0 안내 → `/clients`에서 등록 → 복귀
2. 방향성만으로 생성 → 스켈레톤·15~30초 문구 → 카드 등장 (자동 저장)
3. 보관함 카드 "초안" → `?ref=` 연결 → 칩 표시 → 생성 → 근거 풋터 펼침·원문 링크
4. 덱의 미저장 트윗엔 "초안" 버튼이 없고, 저장된 트윗엔 있음
5. 검수 표식: 「効果」 포함 원고에서 앰버 표식 + 무시 → 새로고침 후에도 유지
6. 편집 → 원본과 비교 → 저장 → 카드에 "편집됨"
7. 스레드 생성 → "이 트윗만 다시" → 해당 트윗만 교체·원본 비교로 확인
8. 다른 각도로 → 새 카드 추가(이전 유지) / 삭제 → 5초 실행취소
9. 글자수: 140자 초과 시 앰버 (차단 없음)
10. 레퍼런스 9건째 선택이 막히고 이유 문구 노출

- [ ] **Step 5: Commit** (변경 파일이 있으면 — 없으면 스킵)

---

## 범위 밖 (Plan 1과 동일 + UI 추가분)

Reading 타이포 전역 상향 · 다크모드 · 이미지 첨부/생성 · 보관함 다중 체크 진입 · 보관함 페이지 "전체" 보기 · `edited` 되돌리기(백로그 — draftStore가 null 되돌림 미지원) · 표식 대안 문구 · Plan 1 백로그 전체(원장 참조)
