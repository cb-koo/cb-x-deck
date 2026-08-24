import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { findLinkById, appendClickSnapshot, markLinkUnavailable } from '@/lib/linkStore';

const NOT_CONFIGURED = 'short.io 연결이 아직 설정되지 않았어요 — 관리자에게 SHORTIO_API_KEY·SHORTIO_DOMAIN 설정을 요청해 주세요';
const FETCH_FAILED = '클릭 수를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// ok → 스냅샷 추가(복귀 수용 포함) / unavailable(404) → 시각 기록 / error → 아무것도 저장 안 함
// (tracking refresh와 동일 문법 — 틀린 기록보다 빈 기록)
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  if (!isShortioConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const sql = getSql();
  const row = await findLinkById(sql, id);
  if (!row) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });

  const result = await makeShortioClient().getLinkStats(row.shortioLinkId);
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (result.kind === 'unavailable') await markLinkUnavailable(sql, id);
  else await appendClickSnapshot(sql, id, { totalClicks: result.totalClicks, humanClicks: result.humanClicks }, result.raw);
  return NextResponse.json({ row: await findLinkById(sql, id) });
}
