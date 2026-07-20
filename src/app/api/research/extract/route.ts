import { NextResponse } from 'next/server';
import { extractKeywords } from '@/lib/research';

import { requireAllowedUser } from '@/lib/authGuard';
export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { title, text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text 필수' }, { status: 400 });
  }
  try {
    const out = await extractKeywords({ title: typeof title === 'string' ? title : '', text });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
