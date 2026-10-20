import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { getChannel, saveChannel, removeChannel, readOnboardingXHandle } from '@/lib/ownedChannelStore';
import { collectChannel, lookupAccount } from '@/lib/ownedChannelCollect';

// 클라이언트 상세 › 기본 정보의 'X 계정'·'업로드 약속'(스펙 2026-10-20 §2-2)
export const maxDuration = 60;

async function latestFollowers(channelId: string): Promise<number | null> {
  const [r] = await getSql()<Array<{ followers: number }>>`
    select followers from owned_channel_snapshot where channel_id = ${channelId} order by captured_on desc limit 1`;
  return r?.followers ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const sql = getSql();
  const ch = await getChannel(sql, id);
  // 온보딩 제안은 칸이 비었을 때만 쓴다 — 읽기 실패(다른 앱 스키마 변경 등)가 이 칸 전체를 막지 않게 삼킨다
  const suggestion = ch ? null : await readOnboardingXHandle(sql, id).catch(() => null);
  return NextResponse.json({
    channel: ch ? { handle: ch.handle, weeklyTarget: ch.weeklyTarget, followers: await latestFollowers(ch.id), lastError: ch.lastError } : null,
    suggestion,
  });
}

/** 저장할 때 계정을 확인한다 — 틀린 핸들로 매일 0을 세지 않게. 새 계정이면 지난 8주 글을 바로 받아 온다. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { handle?: string; weeklyTarget?: number | null };
  const parsed = parseXHandle(body.handle ?? '');
  if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
  const target = body.weeklyTarget ?? null;
  if (target !== null && !(Number.isInteger(target) && target >= 1 && target <= 14))
    return NextResponse.json({ error: '업로드 약속은 주 1~14회로 정해 주세요' }, { status: 400 });

  const sql = getSql();
  const cur = await getChannel(sql, id);
  let client;
  try { client = makeClient({ maxRetries: 1, usagePrefix: 'channels' }); }
  catch { return NextResponse.json({ error: 'X 데이터 연결이 설정되지 않았어요 — 관리자에게 알려 주세요' }, { status: 503 }); }

  try {
    // 같은 계정(대소문자만 다름)이면 다시 조회하지 않는다 — 약속만 바꾸는 저장에 비용을 쓰지 않게
    let account: { handle: string; accountId: string; accountCreatedAt: string | null; name: string | null; followers: number | null };
    if (cur && cur.handle.toLowerCase() === parsed.handle.toLowerCase()) {
      account = { handle: cur.handle, accountId: cur.accountId, accountCreatedAt: cur.accountCreatedAt, name: null, followers: await latestFollowers(cur.id) };
    } else {
      const looked = await lookupAccount(client, parsed.handle);
      if (!looked.ok) {
        return looked.error === 'notFound'
          ? NextResponse.json({ error: `X에서 @${parsed.handle} 계정을 찾지 못했어요` }, { status: 404 })
          : NextResponse.json({ error: 'X에서 계정을 확인하지 못했어요 — 잠시 뒤 다시 저장해 주세요' }, { status: 502 });
      }
      account = { handle: looked.info.userName || parsed.handle, accountId: looked.info.id, accountCreatedAt: looked.info.createdAt ?? null,
        name: looked.info.name, followers: looked.info.followers };
    }
    const saved = await saveChannel(sql, id, { handle: account.handle, accountId: account.accountId, accountCreatedAt: account.accountCreatedAt, weeklyTarget: target });
    // 새 계정이면 지난 8주를 바로 받는다 — 페이지에 들어가면 첫날부터 흐름이 보이게. 실패해도 저장은 된 것(내일 아침 다시 받는다)
    if (saved.isNew) await collectChannel(sql, client, saved.channel, { firstCollect: true, deadlineAt: Date.now() + 40_000 }).catch((e) => {
      if (e instanceof GetxapiAuthError) throw e;
    });
    return NextResponse.json({ channel: { handle: saved.channel.handle, weeklyTarget: saved.channel.weeklyTarget, followers: account.followers, lastError: null },
      name: account.name, replaced: saved.replaced });
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'X 데이터를 받지 못했어요 — 관리자에게 알려 주세요(API 잔액 확인)' }, { status: 502 });
    throw e;
  }
}

/** 칸을 비우면 연결을 끊는다 — 기록도 지운다(화면이 저장 전에 확인을 받는다). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await removeChannel(getSql(), id);
  return NextResponse.json({ ok: true });
}
