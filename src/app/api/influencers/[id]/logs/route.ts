import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { addManualLog, findInfluencerById, type InfluencerChannel } from '@/lib/influencerStore';

const CHANNELS: InfluencerChannel[] = ['dm', 'line', 'email', 'other'];

// 수동 한 줄 기록 추가. 자동 이벤트는 앱이 스스로 남기므로 이 라우트로 들어오지 않는다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  // uuid 형식이 아니면 조회 전에 끊는다(22P02 → 500 방지).
  if (!isUuidLike(id)) return NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { body?: unknown; channel?: unknown };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: '기록할 내용을 입력해 주세요' }, { status: 400 });

  // 화이트리스트 밖이면 오류가 아니라 "채널 없음" — 기록 자체를 막을 이유가 없다.
  const channel = CHANNELS.includes(body.channel as InfluencerChannel)
    ? (body.channel as InfluencerChannel) : null;

  const sql = getSql();
  if (!(await findInfluencerById(sql, id))) {
    return NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });
  }
  return NextResponse.json(await addManualLog(sql, id, { body: text, channel, authorId: gate.member.id }));
}
