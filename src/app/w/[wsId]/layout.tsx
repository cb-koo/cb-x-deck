'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { MemberProvider } from '@/lib/memberContext';
import { ToastProvider } from '@/lib/toastContext';
import { Sidebar } from '@/components/Sidebar';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { Workspace } from '@/lib/types';

// wsId를 워크스페이스 목록과 대조한다. 삭제된/잘못된 링크가 "컬럼이 없습니다" 같은
// 정상 빈 화면으로 위장되고 사이드바가 엉뚱한 이름을 보여주던 것을 막는다 (표시 정확성 스펙 §B-1).
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  const [known, setKnown] = useState<Set<string> | null>(null); // null = 첫 목록 로딩 전
  const [failed, setFailed] = useState(false);
  // wsId가 목록에 없을 때 낡은 목록일 수 있어(다른 탭에서 방금 생성) 한 번 재조회한다.
  // 재조회 후에도 없으면 그때 '없음'으로 확정 — wsId별로 1회만.
  // 재조회를 "이미 시작했는지"는 렌더에서 읽지 않는 ref로(react-hooks/refs: ref는 렌더 중 읽기 금지),
  // "재조회가 끝났는지"(화면 전환 시점)는 별도 state(recheckDone)로 분리한다.
  const dispatchedRef = useRef<string | null>(null);
  const [recheckDone, setRecheckDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/workspaces');
      if (!r.ok) throw new Error(String(r.status));
      const ws = (await r.json()) as Workspace[];
      setKnown(new Set(ws.map((w) => w.id)));
    } catch {
      setFailed(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 워크스페이스 목록 조회(fetch 실패 처리, src/app/page.tsx 선례)
  useEffect(() => { load(); }, [load]);
  // 관리 페이지의 생성·삭제와 같은 채널로 목록 갱신 (Sidebar와 동일 이벤트)
  useEffect(() => {
    const h = () => { load(); };
    window.addEventListener('cbx-workspaces-changed', h);
    return () => window.removeEventListener('cbx-workspaces-changed', h);
  }, [load]);

  const exists = known ? known.has(wsId) : null;

  useEffect(() => {
    if (exists === true) {
      localStorage.setItem(LAST_WS_KEY, wsId); // 검증 통과 후에만 저장 (죽은 id 저장 방지)
    } else if (exists === false) {
      if (dispatchedRef.current !== wsId) {
        dispatchedRef.current = wsId;
        // 낡은 목록 재확인 — 결과가 반영된(recheckDone) 뒤에야 아래 렌더가 '없음'으로 확정
        load().finally(() => setRecheckDone(wsId));
      }
      if (localStorage.getItem(LAST_WS_KEY) === wsId) localStorage.removeItem(LAST_WS_KEY);
    }
  }, [exists, wsId, load]);

  if (failed && !known) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-ui text-x-secondary">워크스페이스 정보를 불러오지 못했습니다.</p>
        <button onClick={() => { setFailed(false); load(); }}
                className="rounded-full border border-x-border-strong px-4 py-1.5 text-ui hover:bg-x-hover">다시 시도</button>
      </div>
    );
  }
  if (!known) return <p className="p-8 text-sm text-x-muted">워크스페이스 확인 중…</p>;
  if (exists === false) {
    // 재확인 중이면 잠깐 '확인 중'을 유지 (방금 만든 워크스페이스 오탐 방지)
    if (recheckDone !== wsId) return <p className="p-8 text-sm text-x-muted">워크스페이스 확인 중…</p>;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-content font-bold">이 워크스페이스를 찾을 수 없습니다</p>
        <p className="text-ui text-x-secondary">삭제됐을 수 있어요. 워크스페이스 목록에서 다시 선택해 주세요.</p>
        <a href="/workspaces"
           className="rounded-full bg-x-blue px-4 py-1.5 text-ui font-medium text-white hover:bg-x-blue-hover">
          워크스페이스 목록으로
        </a>
      </div>
    );
  }

  return (
    <MemberProvider>
      <ToastProvider>
        <div className="flex h-screen">
          <Sidebar wsId={wsId} />
          <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </ToastProvider>
    </MemberProvider>
  );
}
