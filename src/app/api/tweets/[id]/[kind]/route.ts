import { NextResponse } from 'next/server';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { mapRawTweet, mapRawUser } from '@/lib/mappers';

const KINDS = new Set(['replies', 'thread', 'retweeters']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params;
  if (!KINDS.has(kind)) return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 404 });
  const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined;

  try {
    const client = makeClient();
    if (kind === 'retweeters') {
      const page = await client.getTweetRetweeters(id, cursor);
      return NextResponse.json({
        users: page.users.map(mapRawUser).filter((u): u is NonNullable<typeof u> => u !== null),
        nextCursor: page.has_more ? page.next_cursor : null,
      });
    }
    const page = kind === 'replies' ? await client.getTweetReplies(id, cursor) : await client.getTweetThread(id, cursor);
    return NextResponse.json({
      tweets: page.tweets.map(mapRawTweet).filter((t): t is NonNullable<typeof t> => t !== null),
      nextCursor: page.has_more ? page.next_cursor : null,
    });
  } catch (e) {
    if (e instanceof GetxapiAuthError) {
      return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
