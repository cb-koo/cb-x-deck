import { NextResponse } from 'next/server';
import { makeExaClient } from '@/lib/exa';
import { translateKeyword } from '@/lib/suggest';

import { requireAllowedUser } from '@/lib/authGuard';
const hasHangul = (s: string) => /[가-힣]/.test(s);

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { query } = await req.json().catch(() => ({}));
  if (typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'query 필수' }, { status: 400 });
  }
  try {
    let applied = query.trim();
    if (hasHangul(applied)) {
      const pair = await translateKeyword(applied);
      if (pair) applied = pair.ja;
    }
    const results = await makeExaClient().search(applied, { numResults: 8, maxCharacters: 2000 });
    return NextResponse.json({ original: query.trim(), applied, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
