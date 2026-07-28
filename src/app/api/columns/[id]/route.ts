import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { deleteColumn, getColumn, updateColumn } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';
import type { WatchlistConfig } from '@/lib/types';
import { handleParseMessage, parseXHandle } from '@/lib/xHandle';

import { requireAllowedUser } from '@/lib/authGuard';
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const patch = await req.json();
  const sql = getSql();

  // Always load column first to ensure it exists
  const existing = await getColumn(sql, id);
  if (!existing) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  // plan gap: PATCH must not blindly persist a new watchlist handle without
  // re-resolving userId (same rule POST enforces on create).
  if (patch?.config && existing.kind === 'watchlist') {
    const oldHandle = (existing.config as WatchlistConfig).handle;
    const rawHandle = String((patch.config as WatchlistConfig).handle ?? '').trim();
    // 폭·정렬만 바꾸는 PATCH는 handle을 안 보낸다 — 그 경로를 막지 않는다.
    if (rawHandle) {
      const parsed = parseXHandle(rawHandle);
      if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
      if (parsed.handle.toLowerCase() === (oldHandle ?? '').toLowerCase()) {
        // 같은 계정을 가리키는 대소문자 차이·링크 표기(URL)만으로는 API를 다시 부르지 않는다.
        // 재해석을 건너뛰는 경로이므로 사용자가 친 임의 표기가 저장되지 않게 정본으로 되돌린다.
        patch.config.handle = oldHandle;
        // config는 통째로 교체되고 트윗 조회는 userId로 키를 잡는다(handle 아님) — 건너뛰는
        // 경로에서도 클라이언트가 실어 보낸 userId를 믿지 말고 저장된 값을 권위로 되돌린다.
        patch.config.userId = (existing.config as WatchlistConfig).userId;
      } else {
        try {
          const info = await makeClient().getUserInfo(parsed.handle);
          if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: @${parsed.handle}` }, { status: 404 });
          patch.config.handle = info.userName;
          patch.config.userId = info.id;
        } catch (e) {
          return NextResponse.json({ error: `계정 확인 실패: ${(e as Error).message}` }, { status: 502 });
        }
      }
    }
  }

  return NextResponse.json(await updateColumn(sql, id, patch));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteColumn(getSql(), id);
  return NextResponse.json({ ok: true });
}
