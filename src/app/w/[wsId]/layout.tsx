'use client';
import { useParams } from 'next/navigation';
import { MemberProvider } from '@/lib/memberContext';
import { Sidebar } from '@/components/Sidebar';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  return (
    <MemberProvider>
      <div className="flex h-screen">
        <Sidebar wsId={wsId} />
        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </MemberProvider>
  );
}
