'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/types';

export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    apiFetch('/api/workspaces').then((r) => r.json()).then((ws: Workspace[]) => {
      if (ws[0]) router.replace(`/w/${ws[0].id}`);
    });
  }, [router]);
  return <p className="p-8 text-sm text-x-muted">워크스페이스로 이동 중…</p>;
}
