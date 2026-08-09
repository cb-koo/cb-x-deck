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
    // 저장값을 무검증으로 쓰면 삭제된 워크스페이스의 죽은 사이드바가 그려진다 —
    // 루트(/)와 동일하게 목록 대조 후 폴백 (표시 정확성 스펙 §B-2)
    (async () => {
      try {
        const r = await apiFetch('/api/workspaces');
        if (!r.ok) return; // 사이드바만 생략 — 페이지 콘텐츠는 그대로
        const ws = (await r.json()) as Workspace[];
        const saved = localStorage.getItem(LAST_WS_KEY);
        const target = ws.find((w) => w.id === saved) ?? ws[0];
        if (target) {
          setWsId(target.id);
          localStorage.setItem(LAST_WS_KEY, target.id);
        }
      } catch { /* 사이드바만 생략 */ }
    })();
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
