'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { arrayMove } from '@/lib/deckReorder';
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
  // 이름 변경: 편집 중인 카드 id와 입력값
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const renaming = useRef(false); // IME Enter 이중 발화 방지
  // 삭제 모달: 대상 워크스페이스 + 확인 입력값
  const [deleting, setDeleting] = useState<WorkspaceMeta | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const deletingBusy = useRef(false); // 더블클릭 재진입 방지 (creating/renaming과 동일 패턴)
  const [deleteErr, setDeleteErr] = useState(''); // 모달 안에 표시 — 상단 err는 모달 뒤에 가려짐

  // 드래그 순서 변경 — 핸들에서만 시작. 5px 임계값 전엔 클릭으로 취급.
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startY: number; active: boolean; snapshot: WorkspaceMeta[] } | null>(null);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  async function commitOrder(ids: string[]) {
    const r = await apiFetch('/api/workspaces/reorder', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    if (!r.ok) { await load(); return; } // 409(다른 팀원이 추가/삭제) 포함 — 서버 기준으로 재동기화
  }

  function startDrag(id: string, e: React.PointerEvent) {
    if (rowsRef.current.length < 2) return;
    e.preventDefault();
    dragRef.current = { id, startY: e.clientY, active: false, snapshot: rowsRef.current };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active && Math.abs(ev.clientY - d.startY) < 5) return;
      if (!d.active) { d.active = true; setDragId(d.id); }
      // 목표 인덱스 = 포인터보다 중심점이 위에 있는 "다른" 카드의 수.
      // 자기 카드를 세면 자기 중심점을 스칠 때마다 인덱스가 흔들리고,
      // 포인터가 맨 위 카드 중심보다 위일 때 0이 나오지 않는다.
      const cur = rowsRef.current;
      const from = cur.findIndex((w) => w.id === d.id);
      let to = 0;
      for (const el of document.querySelectorAll<HTMLElement>('[data-ws-card]')) {
        if (el.dataset.wsCard === d.id) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) to++;
      }
      if (to !== from) setRows(arrayMove(cur, from, to));
    };
    const finish = (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      setDragId(null);
      if (!d) return;
      if (commit && d.active) commitOrder(rowsRef.current.map((w) => w.id));
      if (!commit && d.active) setRows(d.snapshot); // Escape → 원위치
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name || renaming.current) return;
    renaming.current = true;
    try {
      const r = await apiFetch(`/api/workspaces/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setEditingId(null); setErr('');
      await load();
    } finally { renaming.current = false; }
  }

  async function confirmDelete() {
    if (!deleting || confirmText !== deleting.name || deletingBusy.current) return;
    deletingBusy.current = true;
    try {
      const r = await apiFetch(`/api/workspaces/${deleting.id}`, { method: 'DELETE' });
      if (!r.ok) {
        // 모달을 유지해 재시도 가능하게 — saveRename의 실패 처리와 일관
        setDeleteErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
        return;
      }
      // 현재 보던 워크스페이스를 지웠으면 복귀 지점도 정리 (/ 진입이 첫 번째로 폴백하도록)
      if (localStorage.getItem(LAST_WS_KEY) === deleting.id) {
        localStorage.removeItem(LAST_WS_KEY);
        setCurrentId(null);
      }
      setDeleting(null); setConfirmText(''); setDeleteErr('');
      await load();
    } finally { deletingBusy.current = false; }
  }

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
          <div key={w.id} data-ws-card={w.id} role="link" tabIndex={0}
               onClick={() => router.push(`/w/${w.id}`)}
               onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/w/${w.id}`); }}
               className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-x-hover ${
                 w.id === currentId ? 'border-[1.5px] border-x-blue' : 'border-x-border hover:border-x-border-strong'
               } ${dragId === w.id ? 'shadow-[0_4px_16px_rgba(0,0,0,0.12)]' : ''}`}>
            <span onPointerDown={(e) => startDrag(w.id, e)} onClick={(e) => e.stopPropagation()}
                  className="cursor-grab touch-none select-none text-ui text-x-muted active:cursor-grabbing"
                  title="끌어서 순서 변경" aria-hidden>⠿</span>
            {editingId === w.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveRename(w.id);
                         if (e.key === 'Escape') setEditingId(null);
                       }}
                       className="w-full rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-content outline-none focus:border-x-blue" />
                <Button variant="primary" onClick={() => saveRename(w.id)}>저장</Button>
                <Button variant="ghost" onClick={() => setEditingId(null)}>취소</Button>
              </div>
            ) : (
              <>
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
                  <button onClick={() => { setEditingId(w.id); setEditName(w.name); }}
                          className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
                  <button onClick={() => { setDeleting(w); setConfirmText(''); setDeleteErr(''); }}
                          disabled={rows.length <= 1}
                          title={rows.length <= 1 ? '마지막 워크스페이스는 삭제할 수 없습니다' : undefined}
                          className="text-ui text-x-secondary hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleting(null); setDeleteErr(''); }}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">워크스페이스 삭제</h2>
            <p className="mb-1 text-content">
              &lsquo;{deleting.name}&rsquo;과(와) 컬럼 {deleting.columnCount}개 · 저장 후보 {deleting.candidateCount}건이
              함께 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <p className="mb-3 text-caption text-x-muted">브리핑·발굴 계정·숨김 처리 등 이 워크스페이스에 속한 데이터가 모두 삭제됩니다.</p>
            <p className="mb-1 text-ui text-x-secondary">계속하려면 워크스페이스 이름을 입력하세요</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmDelete(); }}
                   placeholder={deleting.name}
                   className="mb-3 w-full rounded-lg border border-x-border-strong px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            {deleteErr && <p className="mb-2 text-caption text-red-500">{deleteErr}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setDeleting(null); setDeleteErr(''); }}>취소</Button>
              <button onClick={confirmDelete} disabled={confirmText !== deleting.name}
                      className="rounded-full bg-x-pink px-3 py-1 text-ui font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
