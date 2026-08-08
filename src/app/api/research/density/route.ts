import { NextResponse } from 'next/server';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { suggestMinFaves } from '@/lib/densityProbe';
import { kstDaysAgo } from '@/lib/datetime';

import { requireAllowedUser } from '@/lib/authGuard';
export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { keywords, lang } = await req.json().catch(() => ({}));
  const kws: string[] = Array.isArray(keywords) ? keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  if (kws.length === 0) return NextResponse.json({ error: '키워드가 필요합니다' }, { status: 400 });

  // 프로브 전용 최소 쿼리 — filter:images 등은 밀도 측정에 불필요. min_faves:50로 최근 7일.
  const since = kstDaysAgo(7);
  const group = kws.length > 1 ? `(${kws.join(' OR ')})` : kws[0];
  const q = `${group}${lang ? ` lang:${lang}` : ''} min_faves:50 since:${since}`;

  try {
    const page = await makeClient().searchTweets(q);
    const likes = page.tweets.map((t) => (typeof (t as { likeCount?: number }).likeCount === 'number' ? (t as { likeCount: number }).likeCount : 0));
    const { suggested, density } = suggestMinFaves(likes, likes.length);
    const range: [number, number] = likes.length ? [Math.min(...likes), Math.max(...likes)] : [0, 0];
    return NextResponse.json({ suggested, sampleSize: likes.length, likeRange: range, density });
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패' }, { status: 401 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
