import { NextResponse } from 'next/server';
import { translateKeyword } from '@/lib/suggest';

export async function POST(req: Request) {
  const { keyword } = await req.json().catch(() => ({}));
  if (typeof keyword !== 'string' || !keyword.trim()) {
    return NextResponse.json({ error: 'keyword 필수' }, { status: 400 });
  }
  try {
    const pair = await translateKeyword(keyword.trim());
    if (!pair) return NextResponse.json({ error: '번역 실패 — 다시 시도하세요' }, { status: 502 });
    return NextResponse.json(pair);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
