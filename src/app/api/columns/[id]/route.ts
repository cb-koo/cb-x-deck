import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { deleteColumn, getColumn, updateColumn } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';
import type { WatchlistConfig } from '@/lib/types';

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
  if (patch?.config) {
    if (existing.kind === 'watchlist') {
      const oldHandle = (existing.config as WatchlistConfig).handle;
      const newHandle = String((patch.config as WatchlistConfig).handle ?? '').replace(/^@/, '');
      if (newHandle && newHandle !== oldHandle) {
        try {
          const info = await makeClient().getUserInfo(newHandle);
          if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: ${newHandle}` }, { status: 404 });
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
