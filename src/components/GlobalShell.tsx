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
      .then((ws: Workspace[]) => { if (ws[0]) { setWsId(ws[0].id); localStorage.setItem(LAST_WS_KEY, ws[0].id); } });
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
