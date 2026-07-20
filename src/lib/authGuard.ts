import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isAllowedUser } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { resolveMember } from '@/lib/workspaceStore';
import type { Member } from '@/lib/types';

export async function requireAllowedUser(): Promise<
  { user: User; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedUser(user)) {
    return {
      user: null,
      response: NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 }),
    };
  }
  return { user, response: null };
}

export async function requireMember(): Promise<
  { member: Member; user: User; response: null } | { member: null; user: null; response: NextResponse }
> {
  const gate = await requireAllowedUser();
  if (gate.response) return { member: null, user: null, response: gate.response };
  const member = await resolveMember(getSql(), gate.user);
  return { member, user: gate.user, response: null };
}
