'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './apiFetch';
import type { Member } from './types';

interface MemberCtx {
  member: Member | null;   // 로그인 본인
  members: Member[];       // 필터용 전체 목록
  reloadMembers: () => Promise<void>;
}

const Ctx = createContext<MemberCtx>({ member: null, members: [], reloadMembers: async () => {} });

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);

  const reloadMembers = useCallback(async () => {
    const r = await apiFetch('/api/members');
    if (r.ok) setMembers(await r.json());
  }, []);

  useEffect(() => {
    reloadMembers();
    apiFetch('/api/me').then((r) => r.ok ? r.json() : null).then((m) => m && setMember(m)).catch(() => {});
  }, [reloadMembers]);

  return <Ctx.Provider value={{ member, members, reloadMembers }}>{children}</Ctx.Provider>;
}

export const useMember = () => useContext(Ctx);
