'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { useMember } from '@/lib/memberContext';
import { SearchIcon, ColumnsIcon, DocIcon, FolderIcon, PenIcon, ClinicIcon } from './XIcons';

export function Sidebar({ wsId }: { wsId: string }) {
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

  const nav = [
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
      <select value={wsId} onChange={(e) => router.push(`/w/${e.target.value}`)}
              className="mb-1 w-full rounded-md border border-x-border-strong bg-transparent px-2 py-1 text-ui outline-none focus:border-x-blue">
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <a href="/workspaces"
         className={`mb-2 block px-1 text-ui hover:text-x-secondary ${pathname === '/workspaces' ? 'font-bold text-x-text' : 'text-x-muted'}`}>
        워크스페이스 관리
      </a>

      <nav className="mt-2 flex-1">
        {nav.map((n) => (
          <a key={n.href} href={n.href} data-tour={n.tour}
             className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
            <n.Ic className="h-[18px] w-[18px]" />{n.label}
          </a>
        ))}
        <div className="my-2 border-t border-x-border" />
        {globalNav.map((n) => (
          <a key={n.href} href={n.href}
             className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
            <n.Ic className="h-[18px] w-[18px]" />{n.label}
          </a>
        ))}
      </nav>

      <div className="mb-2 border-t border-x-border pt-2">
        <a href={`/w/${wsId}/usage`}
           className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === `/w/${wsId}/usage` ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </a>
      </div>

      <div className="border-t border-x-border pt-2">
        <p className="mb-1 px-1 text-caption text-x-muted">나</p>
        {member ? (
          <div className="flex items-center gap-2 px-1 py-1 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: member.color }} />
            <span>{member.name}</span>
          </div>
        ) : (
          <p className="px-1 text-caption text-x-muted">불러오는 중…</p>
        )}
      </div>
    </aside>
  );
}
