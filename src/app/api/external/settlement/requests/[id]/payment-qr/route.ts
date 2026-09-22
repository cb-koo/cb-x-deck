import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { getForExport } from '@/lib/settlementStore';
import { downloadPaymentQrBytes } from '@/lib/paymentQr';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// PayPay 수취 QR 이미지를 그쪽(정산 프로덕트)에 흘려보낸다. proof 라우트(../proof/route.ts)를 그대로 본떴다 —
// 인증·404 처리·recordExternalCallSafe 호출·응답 만들기가 같다. 다른 건 셋뿐이다: 읽는 값이
// row.row.paymentMethod.qr(스냅샷의 저장소 경로), 다운로드 함수가 downloadPaymentQrBytes, detail이 no-qr·storage-miss.
//
// 302 리다이렉트가 아니라 바이트를 직접 주는 이유·경로 파라미터가 요청 id 하나뿐인 이유는 proof 라우트 주석 참고.

const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'GET' as const,
    path: url.pathname,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  const row = await getForExport(getSql(), id);
  if (!row) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const qrPath = row.row.paymentMethod.qr;
  if (!qrPath) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', detail: 'no-qr' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const img = await downloadPaymentQrBytes(qrPath);
  if (!img) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', detail: 'storage-miss' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: 'ok' });
  return new NextResponse(img.body, { status: 200, headers: { ...NO_STORE, 'Content-Type': img.contentType } });
}
