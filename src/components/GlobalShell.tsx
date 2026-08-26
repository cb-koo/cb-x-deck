'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';
import type { Workspace } from '@/lib/types';

export const LAST_WS_KEY = 'cbx-last-ws';
export const LAST_WS_CHANGED_EVENT = 'cbx-last-ws-changed';

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
        // 같은 탭의 구독자(예: /updates의 {ws} 바로가기)가 바로 반영할 수 있게 — storage 이벤트는 같은 탭엔 안 온다
        window.dispatchEvent(new Event(LAST_WS_CHANGED_EVENT));
      } else {
        setWsId(null); // 워크스페이스 0개 — 전역 메뉴만이라도 쓰도록 사이드바는 그린다
      }
      setState('ready');
    } catch {
      // ready 중의 재조회 실패(이벤트 구독 경로)는 멀쩡한 사이드바를 오류 화면으로 바꾸지 않는다 —
      // w/[wsId]/layout의 failed && !known과 같은 보수성 (최종 리뷰 Minor 7)
      setState((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(기존 코드베이스 관례)
  useEffect(() => { load(); }, [load]);
  // /workspaces의 생성·삭제와 같은 채널로 재조회 — 아니면 거기서 만들거나(0개 안내를 따른 경우)
  // 현재 선택된 걸 지웠을 때 GlobalShell의 wsId가 낡은 채 남는다 (src/app/w/[wsId]/layout.tsx와 동일 패턴)
  useEffect(() => {
    window.addEventListener('cbx-workspaces-changed', load);
    return () => window.removeEventListener('cbx-workspaces-changed', load);
  }, [load]);

  return (
    <MemberProvider>
      <div className="flex h-screen">
        {state !== 'loading' && (
          // key={state}: error→ready는 리마운트가 아니라 props 갱신이라 Sidebar 내부의
          // 목록 fetch([]-dep effect)가 재실행되지 않는다 — key로 강제 리마운트해 재시도 성공 후
          // 셀렉트가 0개로 남는 것을 막는다.
          <Sidebar key={state} wsId={state === 'ready' ? wsId : null} wsError={state === 'error'} onRetryWs={load} />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </MemberProvider>
  );
}
