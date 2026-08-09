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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(기존 코드베이스 관례)
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
