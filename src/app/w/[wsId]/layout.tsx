'use client';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';
import { LAST_WS_KEY } from '@/components/GlobalShell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  useEffect(() => { if (wsId) localStorage.setItem(LAST_WS_KEY, wsId); }, [wsId]);
  return (
    <MemberProvider>
      <div className="flex h-screen">
        <Sidebar wsId={wsId} />
        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </MemberProvider>
  );
}
