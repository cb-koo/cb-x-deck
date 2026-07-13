'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';
import { useMember } from '@/lib/memberContext';

const MEMBER_COLORS = ['#1d9bf0', '#00ba7c', '#f91880', '#7856ff', '#ff7a00', '#ffd400'];

export function Sidebar({ wsId }: { wsId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { member, members, selectMember, reloadMembers } = useMember();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [newWs, setNewWs] = useState('');
  const [newMember, setNewMember] = useState('');
  const [addingWs, setAddingWs] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const creating = useRef(false);

  useEffect(() => {
    fetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces);
  }, []);

  async function createWs() {
    const name = newWs.trim();
    if (!name || creating.current) return;
    creating.current = true; // 한글 IME Enter 이중 발화·더블클릭으로 인한 중복 생성 방지
    try {
      const r = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (r.ok) {
        const w = (await r.json()) as Workspace;
        setWorkspaces([...workspaces, w]);
        setNewWs(''); setAddingWs(false);
        router.push(`/w/${w.id}`);
      }
    } finally { creating.current = false; }
  }

  async function createNewMember() {
    const name = newMember.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
      const r = await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) });
      if (r.ok) {
        const m = await r.json();
        await reloadMembers();
        selectMember(m.id);
        setNewMember(''); setAddingMember(false);
      }
    } finally { creating.current = false; }
  }

  const nav = [
    { href: `/w/${wsId}/research`, label: '🔍 리서치' },
    { href: `/w/${wsId}`, label: '📊 덱' },
    { href: `/w/${wsId}/library`, label: '📁 보관함' },
  ];
  const item = 'block rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800';

  return (
    <aside className="flex h-screen w-52 shrink-0 flex-col border-r border-gray-200 p-3 dark:border-gray-800">
      <p className="mb-1 px-1 text-[11px] text-gray-400">워크스페이스 (클라이언트)</p>
      <select value={wsId} onChange={(e) => router.push(`/w/${e.target.value}`)}
              className="mb-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {addingWs ? (
        <div className="mb-2 flex gap-1">
          <input value={newWs} onChange={(e) => setNewWs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createWs(); }}
                 placeholder="클라이언트명" autoFocus className="w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-600" />
          <button onClick={createWs} className="text-xs">✓</button>
        </div>
      ) : (
        <button onClick={() => setAddingWs(true)} className="mb-2 px-1 text-left text-xs text-gray-400 hover:text-gray-600">+ 워크스페이스 추가</button>
      )}

      <nav className="mt-2 flex-1">
        {nav.map((n) => (
          <a key={n.href} href={n.href}
             className={`${item} ${pathname === n.href ? 'bg-gray-100 font-bold dark:bg-gray-800' : 'text-gray-600 dark:text-gray-300'}`}>
            {n.label}
          </a>
        ))}
      </nav>

      <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
        <p className="mb-1 px-1 text-[11px] text-gray-400">멤버 (내가 누구인지)</p>
        {!member && <p className="mb-1 px-1 text-[11px] text-amber-600">멤버를 선택해야 저장·봤음이 기록됩니다</p>}
        <select value={member?.id ?? ''} onChange={(e) => e.target.value && selectMember(e.target.value)}
                className="mb-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
          <option value="">— 선택 —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {addingMember ? (
          <div className="flex gap-1">
            <input value={newMember} onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createNewMember(); }}
                   placeholder="이름" autoFocus className="w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-600" />
            <button onClick={createNewMember} className="text-xs">✓</button>
          </div>
        ) : (
          <button onClick={() => setAddingMember(true)} className="px-1 text-left text-xs text-gray-400 hover:text-gray-600">+ 멤버 추가</button>
        )}
      </div>
    </aside>
  );
}
