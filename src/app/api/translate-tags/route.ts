import { NextResponse } from 'next/server';
import { translateTags } from '@/lib/suggest';

import { requireAllowedUser } from '@/lib/authGuard';
export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { tags } = await req.json().catch(() => ({}));
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    return NextResponse.json({ error: 'tags(string[]) 필수' }, { status: 400 });
  }
  try {
    const translations = await translateTags(tags.slice(0, 20));
    return NextResponse.json({ translations });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
