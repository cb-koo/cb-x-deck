'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { LAST_WS_KEY } from '@/components/GlobalShell';

// 마지막에 보던 워크스페이스로 복귀한다. 없거나 삭제됐으면 첫 번째, 0개면 관리 페이지로.
// (기존: 무조건 첫 번째 → GlobalShell(/generate·/clients)의 복원 동작과 어긋났다)
export default function RootRedirect() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const go = useCallback(async () => {
    try {
      const r = await apiFetch('/api/workspaces');
      if (!r.ok) throw new Error(String(r.status));
      const ws = (await r.json()) as Workspace[];
      if (ws.length === 0) { router.replace('/workspaces'); return; }
      const saved = localStorage.getItem(LAST_WS_KEY);
      const target = ws.find((w) => w.id === saved) ?? ws[0];
      router.replace(`/w/${target.id}`);
    } catch {
      setFailed(true); // 무한 스피너 금지 — 실패는 실패로 보여준다
    }
  }, [router]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 조회 실패를 보여주기 위한 setState(fetch 실패 처리, RefPickerSheet 선례)
  useEffect(() => { go(); }, [go]);

  if (failed) {
    return (
      <div className="p-8 text-sm">
        <p className="mb-2 text-x-secondary">워크스페이스 목록을 불러오지 못했습니다.</p>
        {/* 재시도 시 에러 해제는 여기서 — go() 안에서 하면 이펙트 동기 setState(lint 에러) */}
        <button onClick={() => { setFailed(false); go(); }} className="rounded-full border border-x-border-strong px-3 py-1 hover:bg-x-hover">다시 시도</button>
      </div>
    );
  }
  return <p className="p-8 text-sm text-x-muted">워크스페이스로 이동 중…</p>;
}
