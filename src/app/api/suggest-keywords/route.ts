import { NextResponse } from 'next/server';
import { suggestKeywords } from '@/lib/suggest';

export async function POST(req: Request) {
  const { keyword } = await req.json();
  if (!keyword?.trim()) return NextResponse.json({ error: 'keyword 필수' }, { status: 400 });
  try {
    return NextResponse.json(await suggestKeywords(keyword.trim()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
