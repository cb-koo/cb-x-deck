import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { apiKeyAuthorized } from '@/lib/externalAuth';
import { clampPage, clampPageLimit, toMarketingCostItem } from '@/lib/marketingCostExport';
import { listMarketingCosts } from '@/lib/settlementStore';
import { isDateOnlyString } from '@/lib/campaignJudgment';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// LINE 메시지 대시보드가 '마케팅 지표 분석 > 마케팅 비용' 표에 쓰려고 폴링으로 가져간다 — 사람이 아니라 서버가
// 부르므로 세션 게이트가 아니라 공유 시크릿(x-api-key). 계약: docs/api/marketing-costs-external-api.md
// 그쪽 원본 스펙: linemessagedashboard/docs/api/cb-x-deck-marketing-cost-export.md (2026-09-18).
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'MARKETING_EXPORT_API_KEY';

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'GET' as const,
    path: url.pathname,
    query: url.search || null,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function GET(req: Request) {
  const c = common(req);
  // fail-closed: env 미설정이거나 키 불일치면 401(본문 없음). 정상/오류 구분 없이 같은 응답 — 키 오라클 방지(스펙 §2.2).
  if (!apiKeyAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  // from·to 필수(스펙 §2.1). KST YYYY-MM-DD가 아니면 400 — 기간이 없으면 표 컬럼 경계가 어긋나므로 넘겨짚지 않는다.
  if (!isDateOnlyString(from)) {
    recordExternalCallSafe({ ...c, statusCode: 400, outcome: 'bad-request', detail: 'from' });
    return NextResponse.json({ success: false, error: 'from은 YYYY-MM-DD(KST)여야 해요', field: 'from' }, { status: 400, headers: NO_STORE });
  }
  if (!isDateOnlyString(to)) {
    recordExternalCallSafe({ ...c, statusCode: 400, outcome: 'bad-request', detail: 'to' });
    return NextResponse.json({ success: false, error: 'to는 YYYY-MM-DD(KST)여야 해요', field: 'to' }, { status: 400, headers: NO_STORE });
  }
  const limit = clampPageLimit(url.searchParams.get('limit'));
  const page = clampPage(url.searchParams.get('page'));
  const { items, total } = await listMarketingCosts(getSql(), { from, to, page, limit });
  const totalPages = Math.max(1, Math.ceil(total / limit));   // 데이터 0건이어도 1(스펙 §7)
  recordExternalCallSafe({ ...c, statusCode: 200, outcome: 'ok', detail: `${items.length}/${total}건` });
  return NextResponse.json({
    success: true,
    total,
    page,
    limit,
    totalPages,
    data: items.map(toMarketingCostItem),
  }, { headers: NO_STORE });
}
