# 사이드바 개선 4건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바에 실패 상태·SPA 전환(가드 연동)·접근성 속성·로그아웃을 추가한다.

**Architecture:** `Sidebar`의 `wsId`를 nullable로 넓혀 실패/0개 상태를 컴포넌트 안에서 그리고, `GlobalShell`이 상태 3분기(loading/error/ready)로 공급한다. 페이지 링크는 전부 `<Link>` + `onNavigate` 가드(`interceptNav`). 파일 2개가 서로 독립이라 T1·T2는 병렬 실행 가능 — 단 **커밋은 오케스트레이터가 순차로** 한다(병렬 커밋 인덱스 레이스 전례).

**Tech Stack:** Next.js 16 `<Link onNavigate>`, 기존 navGuard·supabase browser client. API·DB 변경 없음.

**Spec:** `docs/superpowers/specs/2026-08-09-sidebar-improvements-design.md`

## Global Constraints

- 스타일은 기존 토큰만(x-* 팔레트, text-content/ui/caption). 기존 클래스 문자열은 그대로 옮긴다.
- `data-tour="sidebar"`·`nav-deck`·`nav-briefing` 앵커 유지 (투어가 참조).
- lint 기준선 24 유지: **effect 본문에서 동기 setState 금지** — `load`의 setState는 전부 `await` 뒤에 온다. 이 구조를 바꾸지 말 것.
- 서브에이전트 규칙: 브리프/계획 코드가 틀렸다고 보이면 **착수 전에 보고**. 커밋하지 말 것(오케스트레이터가 커밋).

---

### Task 1: Sidebar.tsx 개편 (Link+가드 · 접근성 · 로그아웃 · nullable wsId) — 병렬 레인 A

**Files:**
- Modify: `src/components/Sidebar.tsx` (전체 교체, 이 파일만 수정)

**Interfaces:**
- Consumes: `interceptNav`(`@/lib/navGuard`), `createClient`(`@/lib/supabase/client`), 기존 `swapWorkspacePath`·`useMember`·XIcons
- Produces (Task 2가 사용): `Sidebar({ wsId: string | null; wsError?: boolean; onRetryWs?: () => void })`
  — 기존 호출부(`/w/[wsId]/layout.tsx`, string 전달)와 호환

- [ ] **Step 1: 파일 전체 교체**

```tsx
'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { swapWorkspacePath } from '@/lib/wsNav';
import { interceptNav } from '@/lib/navGuard';
import { createClient } from '@/lib/supabase/client';
import { SearchIcon, ColumnsIcon, DocIcon, FolderIcon, PenIcon, ClinicIcon } from './XIcons';

// SPA 이동 가드 — /clients 등이 등록한 편집 유실 방지(navGuard)에 걸리면 이동을 중단한다.
// <a> 시절엔 beforeunload가 잡았지만 Link(클라이언트 라우팅)는 우회하므로 onNavigate에 연결.
const guardedNavigate = (href: string) => (e: { preventDefault: () => void }) => {
  if (interceptNav(href)) e.preventDefault();
};

export function Sidebar({ wsId, wsError = false, onRetryWs }: {
  wsId: string | null; // null = 목록 실패(wsError=true) 또는 워크스페이스 0개 — 전역 메뉴만 렌더
  wsError?: boolean;
  onRetryWs?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { member } = useMember();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    const loadWs = () => { apiFetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces); };
    loadWs();
    // /workspaces 페이지의 이름 변경·삭제·순서 변경을 같은 화면의 이 select에 즉시 반영 (스펙 §1)
    window.addEventListener('cbx-workspaces-changed', loadWs);
    return () => window.removeEventListener('cbx-workspaces-changed', loadWs);
  }, []);

  // 로그아웃 — /denied와 동일 패턴. 하드 이동이라 편집 중이면 beforeunload가 잡는다.
  const signOut = async () => {
    await createClient().auth.signOut();
    window.location.href = '/login';
  };

  const nav = wsId === null ? [] : [
    { href: `/w/${wsId}/research`, label: '리서치', Ic: SearchIcon, tour: undefined as string | undefined },
    { href: `/w/${wsId}`, label: '덱', Ic: ColumnsIcon, tour: 'nav-deck' },
    { href: `/w/${wsId}/briefing`, label: '브리핑', Ic: DocIcon, tour: 'nav-briefing' },
    { href: `/w/${wsId}/library`, label: '보관함', Ic: FolderIcon, tour: undefined },
  ];

  // 워크스페이스 무관 최상위 기능 (스펙 §4 — 콘텐츠 생성·클라이언트는 /w/[wsId] 밖)
  const globalNav = [
    { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
    { href: '/clients', label: '클라이언트', Ic: ClinicIcon },
  ];

  return (
    <aside data-tour="sidebar" className="flex h-screen w-52 shrink-0 flex-col border-r border-x-border bg-x-surface p-3">
      <p className="mb-1 px-1 text-caption text-x-muted">워크스페이스</p>
      {wsId !== null ? (
        <select value={wsId} aria-label="워크스페이스 선택"
                onChange={(e) => {
                  const target = swapWorkspacePath(pathname, window.location.search, e.target.value);
                  // 편집 중 유실 방지 — 페이지 링크는 onNavigate 가드, 이 select는 여기서 가드
                  if (interceptNav(target)) { e.target.value = wsId; return; } // 가드가 모달로 이어감 — select 표시 원복
                  router.push(target);
                }}
                className="mb-1 w-full rounded-md border border-x-border-strong bg-transparent px-2 py-1 text-ui outline-none focus:border-x-blue">
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      ) : (
        <div className="mb-1 px-1 py-1">
          {wsError ? (
            <>
              <p className="text-caption text-x-secondary">목록을 불러오지 못했습니다</p>
              <button onClick={onRetryWs}
                      className="mt-1 rounded-full border border-x-border-strong bg-white px-2.5 py-0.5 text-caption hover:bg-x-hover">
                다시 시도
              </button>
            </>
          ) : (
            <p className="text-caption text-x-secondary">워크스페이스가 없습니다 — 아래 관리에서 만들 수 있어요</p>
          )}
        </div>
      )}
      <Link href="/workspaces" onNavigate={guardedNavigate('/workspaces')}
            aria-current={pathname === '/workspaces' ? 'page' : undefined}
            className={`mb-2 block px-1 text-ui hover:text-x-secondary ${pathname === '/workspaces' ? 'font-bold text-x-text' : 'text-x-muted'}`}>
        워크스페이스 관리
      </Link>

      <nav className="mt-2 flex-1">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} data-tour={n.tour} onNavigate={guardedNavigate(n.href)}
                aria-current={pathname === n.href ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
            <n.Ic className="h-[18px] w-[18px]" />{n.label}
          </Link>
        ))}
        {nav.length > 0 && <div className="my-2 border-t border-x-border" />}
        {globalNav.map((n) => (
          <Link key={n.href} href={n.href} onNavigate={guardedNavigate(n.href)}
                aria-current={pathname === n.href ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
            <n.Ic className="h-[18px] w-[18px]" />{n.label}
          </Link>
        ))}
      </nav>

      <div className="mb-2 border-t border-x-border pt-2">
        <Link href="/usage" onNavigate={guardedNavigate('/usage')}
              aria-current={pathname === '/usage' ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/usage' ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </Link>
      </div>

      <div className="border-t border-x-border pt-2">
        <p className="mb-1 px-1 text-caption text-x-muted">나</p>
        {member ? (
          <div className="flex items-center gap-2 px-1 py-1 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: member.color }} />
            <span className="min-w-0 truncate">{member.name}</span>
            <button onClick={signOut} className="ml-auto shrink-0 text-caption text-x-muted hover:text-x-secondary">로그아웃</button>
          </div>
        ) : (
          <p className="px-1 text-caption text-x-muted">불러오는 중…</p>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 자체 점검** — 클래스 문자열·data-tour가 원본과 동일한지 diff로 확인. tsc는 돌리지 말 것(짝 레인 T2가 같은 시각에 GlobalShell을 고치는 중 — 전체 검증은 Task 3).

---

### Task 2: GlobalShell.tsx 상태 3분기 — 병렬 레인 B

**Files:**
- Modify: `src/components/GlobalShell.tsx` (전체 교체, 이 파일만 수정)

**Interfaces:**
- Consumes: Task 1의 `Sidebar({ wsId: string | null; wsError?; onRetryWs? })` — **T1과 동시 진행되므로 이 시그니처를 전제로 작성** (tsc는 Task 3에서 일괄)
- Produces: `LAST_WS_KEY` export 유지 (외부 3곳이 import)

- [ ] **Step 1: 파일 전체 교체**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';
import type { Workspace } from '@/lib/types';

export const LAST_WS_KEY = 'cbx-last-ws';

// 최상위 페이지(/generate·/clients 등)용 셸 — 사이드바는 wsId가 필요하므로
// 마지막 방문 워크스페이스(localStorage)로, 없으면 첫 워크스페이스로 렌더한다 (스펙 통합 이슈 1)
export function GlobalShell({ children }: { children: React.ReactNode }) {
  const [wsId, setWsId] = useState<string | null>(null);
  // 실패를 "사이드바 없음"으로 위장하지 않는다 — 실패 시에도 전역 메뉴 + 다시 시도 (사이드바 개선 스펙 ①)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  // setState가 전부 await 뒤(비동기 콜백)라 set-state-in-effect에 안 걸린다 — 동기 setState를 앞에 넣지 말 것
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/workspaces');
      if (!r.ok) throw new Error(String(r.status));
      const ws = (await r.json()) as Workspace[];
      // 저장값을 무검증으로 쓰면 삭제된 워크스페이스의 죽은 사이드바가 그려진다 —
      // 루트(/)와 동일하게 목록 대조 후 폴백 (표시 정확성 스펙 §B-2)
      const saved = localStorage.getItem(LAST_WS_KEY);
      const target = ws.find((w) => w.id === saved) ?? ws[0];
      if (target) {
        setWsId(target.id);
        localStorage.setItem(LAST_WS_KEY, target.id);
      } else {
        setWsId(null); // 워크스페이스 0개 — 전역 메뉴만이라도 쓰도록 사이드바는 그린다
      }
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <MemberProvider>
      <div className="flex h-screen">
        {state !== 'loading' && (
          <Sidebar wsId={state === 'ready' ? wsId : null} wsError={state === 'error'} onRetryWs={load} />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </MemberProvider>
  );
}
```

재시도 중 상태를 'loading'으로 되돌리지 않는다 — 버튼이 남아 있다가 성공하면 즉시 전체 사이드바로 바뀐다
(되돌리면 재시도마다 사이드바가 깜빡이며 사라진다).

- [ ] **Step 2: 자체 점검** — `LAST_WS_KEY` export가 남아 있는지 확인. tsc는 Task 3에서 일괄.

---

### Task 3: 일괄 검증 (T1·T2 완료 후)

- [ ] `npx tsc --noEmit` — 에러 0
- [ ] `npm run lint` — 24 problems (기준선, 신규 없음)
- [ ] `npm run build` — 성공
- [ ] `grep -n "data-tour" src/components/Sidebar.tsx` — sidebar·nav-deck·nav-briefing 3개 유지

---

### Task 4: 코드 리뷰 (검증 통과 후)

스펙 대비 diff 리뷰. 중점: ①가드 연동 누락 링크 없는지(페이지 링크 7곳 전부 onNavigate) ②실패/0개 상태 분기
③기존 클래스·앵커 보존 ④lint 함정(동기 setState, 렌더 중 ref) ⑤`/w/[wsId]/layout.tsx` 호환.
