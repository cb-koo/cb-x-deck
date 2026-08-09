'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { WorkspaceMeta } from '@/lib/types';

// 상대 시각 — 카드 메타의 "최근 활동" 표기
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return '오늘 활동';
  if (d < 7) return `${d}일 전 활동`;
  if (d < 30) return `${Math.floor(d / 7)}주 전 활동`;
  return `${Math.floor(d / 30)}달 전 활동`;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkspaceMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // 생성
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const creating = useRef(false); // 한글 IME Enter 이중 발화·더블클릭 중복 생성 방지 (Sidebar와 동일 패턴)
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await apiFetch('/api/workspaces?meta=1');
      if (!r.ok) throw new Error(String(r.status));
      setRows(await r.json());
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 목록 조회(기존 코드베이스 관례, RefPickerSheet/page.tsx 선례)
  useEffect(() => { load(); }, [load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로컬 저장값 복원(기존 코드베이스 관례, generate/page.tsx 선례)
  useEffect(() => { setCurrentId(localStorage.getItem(LAST_WS_KEY)); }, []);

  async function createWs() {
    const name = newName.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      const r = await apiFetch('/api/workspaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setNewName(''); setAdding(false); setErr('');
      await load();
    } finally { creating.current = false; }
  }

  return (
    <main className="mx-auto max-w-[640px] px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[20px] font-bold">워크스페이스</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>+ 새 워크스페이스</Button>
      </div>
      <p className="mb-4 text-caption text-x-muted">
        팀 전체가 함께 쓰는 작업 공간입니다. 카드를 클릭하면 해당 덱으로 이동하고, ⠿ 핸들을 끌어 순서를 바꿀 수 있어요.
      </p>

      {adding && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-x-border p-3">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createWs(); }}
                 placeholder="새 워크스페이스 이름"
                 className="w-full rounded-lg border border-x-border-strong bg-transparent px-3 py-1.5 text-content outline-none focus:border-x-blue" />
          <Button variant="primary" onClick={createWs}>만들기</Button>
          <Button variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>취소</Button>
        </div>
      )}
      {err && <p className="mb-2 text-caption text-red-500">{err}</p>}

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">목록을 불러오지 못했습니다</p>
          <Button onClick={load}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && rows.length === 0 && !adding && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">아직 워크스페이스가 없습니다. 첫 워크스페이스를 만들어보세요.</p>
          <Button variant="primary" onClick={() => setAdding(true)}>+ 새 워크스페이스</Button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rows.map((w) => (
          <div key={w.id} role="link" tabIndex={0}
               onClick={() => router.push(`/w/${w.id}`)}
               onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/w/${w.id}`); }}
               className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-x-hover ${
                 w.id === currentId ? 'border-[1.5px] border-x-blue' : 'border-x-border hover:border-x-border-strong'
               }`}>
            <span className="select-none text-ui text-x-muted" aria-hidden>⠿</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-content font-bold">
                {w.name}
                {w.id === currentId && (
                  <span className="rounded-full bg-[#e3f1fb] px-2 py-0.5 text-caption font-normal text-x-blue-text">현재</span>
                )}
              </p>
              <p className="text-ui text-x-secondary">
                컬럼 {w.columnCount}개 · 저장 후보 {w.candidateCount}건 · {relTime(w.lastActivityAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
              <button className="text-ui text-x-secondary hover:text-red-500">삭제</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
