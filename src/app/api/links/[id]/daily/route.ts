import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { findLinkById } from '@/lib/linkStore';

const FETCH_FAILED = '클릭 추이를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// 최근 7일 일별 클릭 — 행을 펼칠 때 조회한다(펼침 = 명시적 행동). 클릭은 게시 직후 며칠에 몰린다(기본 해상도 = 7일, koo 확정). short.io는 정액 플랜이라
// 이 조회에 비용이 없다 — opt-in 버튼 원칙(UX 6)은 종량 비용(getxapi·LLM)에 대한 것이다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  if (!isShortioConfigured()) {
    return NextResponse.json({ error: 'short.io 연결이 아직 설정되지 않았어요 — 관리자에게 요청해 주세요' }, { status: 503 });
  }
  const row = await findLinkById(getSql(), id);
  if (!row) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // 시간대 경계 여유 — 내일자 빈 점은 아래서 걷어낸다
  const r = await makeShortioClient().getLinkSeries(row.shortioLinkId, start, end);
  if (r.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (r.kind === 'unavailable') return NextResponse.json({ error: 'short.io에서 링크를 찾을 수 없어요 — 대시보드에서 지워졌을 수 있어요' }, { status: 404 });
  return NextResponse.json({ days: r.points.filter((p) => p.date <= today) });
}
