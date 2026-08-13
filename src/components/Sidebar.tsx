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
import { SearchIcon, ColumnsIcon, DocIcon, FolderIcon, PenIcon, ClinicIcon, PromptIcon, UserIcon } from './XIcons';

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
    // 실패 시 이전 목록 유지 — 실패 상태 표시는 GlobalShell(wsError)이 책임진다. catch가 없으면
    // 바로 그 실패 시나리오에서 이 fetch가 unhandled rejection을 만든다 (리뷰 지적).
    const loadWs = () => { apiFetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces).catch(() => {}); };
    loadWs();
    // /workspaces 페이지의 이름 변경·삭제·순서 변경을 같은 화면의 이 select에 즉시 반영 (스펙 §1)
    window.addEventListener('cbx-workspaces-changed', loadWs);
    return () => window.removeEventListener('cbx-workspaces-changed', loadWs);
  }, []);

  // 로그아웃 — /denied와 동일 패턴. signOut 후 하드 이동. 편집 유실 가드는 못 태운다
  // (가드 모달의 '이동'이 인증된 상태를 전제) — 알려진 한계, 후속 과제.
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

  // 워크스페이스 무관 최상위 기능 (스펙 §4 — 콘텐츠 생성은 /w/[wsId] 밖)
  // 인플루언서 명부도 워크스페이스 밖 — 원고를 누구에게 줄지는 워크스페이스와 무관한 사람 정보다(스펙 §3)
  const globalNav = [
    { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
    { href: '/influencers', label: '인플루언서', Ic: UserIcon },
  ];

  // 설정 성격 화면(가끔 들어가 재료·규칙을 손보는 곳) — 매일 쓰는 작업 메뉴와 분리 (사이드바 개선 스펙)
  const settingsNav = [
    { href: '/clients', label: '클라이언트', Ic: ClinicIcon },
    { href: '/prompt', label: '프롬프트', Ic: PromptIcon },
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
        {globalNav.length > 0 && <div className="my-2 border-t border-x-border" />}
        <p className="mb-1 px-1 text-caption text-x-muted">설정</p>
        {settingsNav.map((n) => (
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
            <button onClick={signOut} className="ml-auto shrink-0 px-1 py-1 -my-1 text-caption text-x-muted hover:text-x-secondary">로그아웃</button>
          </div>
        ) : (
          <p className="px-1 text-caption text-x-muted">불러오는 중…</p>
        )}
      </div>
    </aside>
  );
}
