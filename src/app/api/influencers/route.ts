import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { makeClient, type UserInfo } from '@/lib/getxapi';
import {
  listInfluencers, findByHandle, findInfluencerById, createInfluencer,
  renameInfluencer, applyProfileSnapshot,
} from '@/lib/influencerStore';

const LOOKUP_FAILED = '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listInfluencers(getSql()));
}

// 등록 — 한 요청 = 핸들 하나. 여러 줄 붙여넣기는 클라이언트가 순차 호출한다(스펙 §5).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { handle?: unknown };

  const trimmed = String(body.handle ?? '').trim();
  if (!trimmed) return NextResponse.json({ error: '핸들을 입력해 주세요' }, { status: 400 });
  const parsed = parseXHandle(trimmed);
  if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });

  // 이미 명부에 있는 핸들은 오류가 아니라 정보다 — 기존 행을 그대로 돌려준다(스펙 §6).
  const existing = await findByHandle(sql, parsed.handle);
  if (existing) return NextResponse.json({ created: false, influencer: existing });

  let info: UserInfo;
  try {
    info = await makeClient().getUserInfo(parsed.handle);
  } catch (e) {
    // 인증 오류(GetxapiAuthError)든 네트워크 오류든 사용자에겐 같은 이야기다 — 원인은 로그로만 남긴다.
    console.error('[influencer] 프로필 조회 실패', {
      handle: parsed.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: LOOKUP_FAILED }, { status: 502 });
  }
  // 매퍼가 없는 계정에도 id: ''를 채운다 — falsy면 "X에 없는 핸들".
  if (!info.id) return NextResponse.json({ error: 'X에서 이 핸들을 찾을 수 없어요' }, { status: 404 });

  // 같은 x_user_id 행이 이미 있으면 = 그 사람이 개명한 것. 중복 행을 만들지 않고 개명 플로우를 탄다(스펙 §5-3).
  const twin = await sql<Array<{ id: string }>>`
    select id from influencer where x_user_id = ${info.id} limit 1`;
  if (twin.length) {
    const twinId = twin[0].id;
    const renamed = await sql.begin(async (tx) => {
      // from은 반드시 트랜잭션 안에서 지금 읽은 값이어야 한다 — renameInfluencer는 from을 그대로 믿고
      // draft를 lower(from)으로 갱신하는데, influencer UPDATE가 먼저라 틀린 from은 복구할 방법이 없다.
      const cur = await tx<Array<{ handle: string }>>`
        select handle from influencer where id = ${twinId} for update`;
      if (!cur.length) return false; // 그 사이 삭제됨 — 아래에서 findInfluencerById가 null을 준다
      const from = cur[0].handle;
      const tsql = tx as unknown as postgres.Sql;
      // 표기만 다른 경우까지 개명으로 기록하지 않는다(위 findByHandle과 이 지점 사이의 레이스).
      const isRename = from.toLowerCase() !== parsed.handle.toLowerCase();
      if (isRename) {
        await renameInfluencer(tsql, { influencerId: twinId, from, to: parsed.handle, actorId: gate.member.id });
      }
      await applyProfileSnapshot(tsql, twinId, info);
      return isRename;
    });
    return NextResponse.json({
      created: false, renamed, influencer: await findInfluencerById(sql, twinId),
    });
  }

  const { row } = await createInfluencer(sql, {
    handle: parsed.handle, createdBy: gate.member.id, snapshot: info,
  });
  return NextResponse.json({ created: true, influencer: row });
}
