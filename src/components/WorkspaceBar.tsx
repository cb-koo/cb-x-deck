'use client';
// 워크스페이스 선택 줄 — 덱 · 브리핑 · 보관함 화면 맨 위(koo 10-17).
// 워크스페이스에 묶인 건 이 화면들뿐이라(캠페인·원고·인플루언서·정산은 무관) 사이드바가 아니라 이 화면 안에서 고른다 —
// 사이드바 맨 위에 있을 땐 아래 메뉴 전체에 걸리는 것처럼 보였다.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { swapWorkspacePath } from '@/lib/wsNav';
import { interceptNav } from '@/lib/navGuard';
import type { Workspace } from '@/lib/types';

export function WorkspaceBar({ wsId }: { wsId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    // 실패 시 이전 목록 유지 — 이 화면이 열렸다면 레이아웃이 이미 목록을 한 번 확인했다
    const load = () => { apiFetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces).catch(() => {}); };
    load();
    // /workspaces 페이지의 이름 변경·삭제·순서 변경을 즉시 반영(Sidebar가 쓰던 것과 같은 이벤트)
    window.addEventListener('cbx-workspaces-changed', load);
    return () => window.removeEventListener('cbx-workspaces-changed', load);
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-x-border px-4 py-1.5 text-ui">
      <span className="text-x-muted">워크스페이스</span>
      <select value={wsId} aria-label="워크스페이스 선택"
              onChange={(e) => {
                const target = swapWorkspacePath(pathname, window.location.search, e.target.value);
                // 편집 중 유실 방지 — 링크는 onNavigate 가드, 이 select는 여기서 가드
                if (interceptNav(target)) { e.target.value = wsId; return; } // 가드가 모달로 이어감 — 표시 원복
                router.push(target);
              }}
              className="h-7 max-w-56 rounded-full border border-x-border-strong bg-white px-2.5 font-semibold outline-none focus:border-x-blue">
        {workspaces.length === 0 && <option value={wsId}>…</option>}
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <span className="text-caption text-x-muted">덱 · 브리핑 · 보관함은 워크스페이스마다 따로 있어요</span>
      <Link href="/workspaces" onNavigate={(e) => { if (interceptNav('/workspaces')) e.preventDefault(); }}
            className="ml-auto text-caption text-x-muted hover:text-x-secondary">워크스페이스 관리</Link>
    </div>
  );
}
