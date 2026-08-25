import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { isShortioConfigured, makeShortioClient, recentWindow } from '@/lib/shortio';
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

  const shortio = makeShortioClient();
  const result = await shortio.getLinkStats(row.shortioLinkId);
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (result.kind === 'unavailable') await markLinkUnavailable(sql, id);
  else {
    // 7일 추이도 같은 시점에 기록(030, koo A안) — 스파크라인·펼침 차트의 소스. 추이 조회가 실패해도
    // 합계 기록은 살린다(추이는 null = 미수집으로 정직하게 표시).
    const w = recentWindow(7);
    const series = await shortio.getLinkSeries(row.shortioLinkId, w.start, w.end);
    const daily = series.kind === 'ok' ? series.points.filter((pt) => pt.date <= w.today) : null;
    await appendClickSnapshot(sql, id, { totalClicks: result.totalClicks, humanClicks: result.humanClicks }, result.raw, daily);
  }
  return NextResponse.json({ row: await findLinkById(sql, id) });
}
