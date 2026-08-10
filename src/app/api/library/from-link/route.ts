import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { makeClient } from '@/lib/getxapi';
import { addTweetByLink } from '@/lib/addByLink';
import { tweetLinkParseMessage } from '@/lib/tweetLink';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { url, workspaceId, memo } = await req.json().catch(() => ({}));
  if (typeof url !== 'string' || typeof workspaceId !== 'string' || !workspaceId)
    return NextResponse.json({ error: 'url·workspaceId 필수' }, { status: 400 });
  try {
    const r = await addTweetByLink(getSql(), makeClient(), {
      url, workspaceId, memberId: gate.member.id, // memberId는 서버 해석 — 클라이언트 body 무시(위조 차단, 저장 API 관례)
      memo: typeof memo === 'string' ? memo : undefined,
    });
    if (!r.ok) {
      if (r.error === 'parse') return NextResponse.json({ error: tweetLinkParseMessage(r.reason) }, { status: 400 });
      return NextResponse.json({ error: '삭제됐거나 볼 수 없는 트윗이에요 — 링크를 확인해주세요' }, { status: 404 });
    }
    return NextResponse.json({ tweetId: r.tweetId, alreadyInLibrary: r.alreadyInLibrary }, { status: 201 });
  } catch {
    // GetXAPI 장애(재시도 소진·키 문제) — 사용자에겐 재시도 안내, 입력은 클라이언트가 보존
    return NextResponse.json({ error: 'X에서 트윗을 가져오지 못했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
