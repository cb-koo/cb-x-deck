import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { deleteColumn, getColumn, updateColumn } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';
import type { WatchlistConfig } from '@/lib/types';
import { resolveWatchlistAccount } from '@/lib/watchlistAccount';

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
    const rawHandle = String((patch.config as WatchlistConfig).handle ?? '').trim();
    // 폭·정렬만 바꾸는 PATCH는 handle을 안 보낸다 — 그 경로를 막지 않는다.
    if (rawHandle) {
      // 기존 계정을 넘기므로, 같은 계정이면 조회를 건너뛰고 저장된 handle·userId가 그대로 온다.
      const acc = await resolveWatchlistAccount(rawHandle, (h) => makeClient().getUserInfo(h),
        existing.config as WatchlistConfig);
      if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
      patch.config.handle = acc.handle;
      patch.config.userId = acc.userId;
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
