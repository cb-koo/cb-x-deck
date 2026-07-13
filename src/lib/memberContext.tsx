'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Member } from './types';

interface MemberCtx {
  member: Member | null;
  members: Member[];
  selectMember: (id: string) => void;
  reloadMembers: () => Promise<void>;
}

const Ctx = createContext<MemberCtx>({ member: null, members: [], selectMember: () => {}, reloadMembers: async () => {} });

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);

  const reloadMembers = useCallback(async () => {
    const r = await fetch('/api/members');
    if (r.ok) setMembers(await r.json());
  }, []);

  useEffect(() => {
    reloadMembers();
    setMemberId(localStorage.getItem('cbxdeck-member'));
  }, [reloadMembers]);

  const selectMember = (id: string) => {
    localStorage.setItem('cbxdeck-member', id);
    setMemberId(id);
  };

  const member = members.find((m) => m.id === memberId) ?? null;
  return <Ctx.Provider value={{ member, members, selectMember, reloadMembers }}>{children}</Ctx.Provider>;
}

export const useMember = () => useContext(Ctx);
