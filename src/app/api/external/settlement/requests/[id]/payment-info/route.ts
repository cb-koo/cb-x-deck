import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { toExternalItem } from '@/lib/settlementExternal';
import { parsePaymentInfoCorrection, maskQrInRawBody } from '@/lib/settlementPaymentCorrection';
import { applyPaymentMethodCorrection, getForExport, precheckCorrectionForQrUpload } from '@/lib/settlementStore';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';
import { parseQrDataUri } from '@/lib/paymentQrInput';
import { uploadPaymentQrBytes } from '@/lib/paymentQr';

// 그쪽(정산 프로덕트)이 이번 지급 건의 수취 정보를 정정했을 때의 회신 수신(계약 §6-1, 그쪽 2026-09-21 요청).
// 규칙 판정은 스토어(applyPaymentMethodCorrection), 여기는 HTTP 매핑만 — 상태 POST 라우트와 같은 구조.
// 200 응답에는 다른 200과 달리 version을 넣지 않는다 — 그쪽 파서가 { applied, correction_id, request } 세 키만 엄격히 받는다(계약 §8).
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const CONFLICT_MESSAGE = {
  'request-cancelled': '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요',
  'paid-locked': '이미 지급 완료된 요청이에요 — 지급 뒤 정정은 사람이 협의해요',
  'revision-mismatch': '이 요청은 그 사이 고쳐졌어요 — 최신 내용으로 다시 확인해 주세요',
} as const;

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'POST' as const,
    path: url.pathname,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  const raw = await req.text().catch(() => '');
  const logBody = maskQrInRawBody(raw);   // 호출 기록엔 항상 이 값만 넘긴다 — base64가 남으면 안 된다(리뷰 2026-09-23 Critical 2).
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const parsed = parsePaymentInfoCorrection(body);
  if (!parsed.ok) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: parsed.field, body: logBody });
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: NO_STORE });
  }
  const sql = getSql();
  // qr만 특별 취급한다 — 받은 base64를 저장소에 넣고, 이후 처리에는 경로만 쓴다.
  // 그래야 정정 이력(patch·before·after)에 base64가 아니라 경로가 남는다(기록 테이블이 붓지 않게).
  // 저장을 DB 트랜잭션보다 먼저 하는 이유: 트랜잭션 안에서 외부 저장소를 만지면 실패 시 롤백이 어긋난다.
  // 저장은 됐는데 DB가 롤백되면 고아 파일이 남지만 비공개 버킷이라 무해하다 — 반대가 위험하다.
  // 업로드 전에 어차피 거절되거나(취소·지급완료·판 불일치·남이 쓴 correction_id) 이미 적용된 재전송인지 가볍게 먼저 본다
  // (리뷰 2026-09-23 Important 1·2) — 최종 판정은 여전히 applyPaymentMethodCorrection의 트랜잭션이 한다.
  const qrRaw = parsed.correction.patch.qr;
  if (typeof qrRaw === 'string' && qrRaw.length > 0) {
    const pre = await precheckCorrectionForQrUpload(sql, id, parsed.correction);
    if (pre.proceed && pre.influencerId) {
      const decoded = parseQrDataUri(qrRaw);
      if ('error' in decoded) {
        recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: 'payment_method.qr', body: logBody });
        return NextResponse.json({ error: decoded.error, field: 'payment_method.qr' }, { status: 400, headers: NO_STORE });
      }
      parsed.correction.patch.qr = await uploadPaymentQrBytes(pre.influencerId, decoded.bytes, decoded.contentType);
    }
    // pre.proceed가 false면 업로드하지 않고 그대로 진행한다 — 아래 applyPaymentMethodCorrection이 not-found·conflict·replayed로
    // 끝나는 경로는 patch를 어디에도 쓰지 않으므로 qr이 base64로 남은 채 넘어가도 안전하다.
  }
  const r = await applyPaymentMethodCorrection(sql, id, parsed.correction);
  if (r === 'not-found') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', body: logBody });
    return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  }
  if (r.kind === 'invalid') {
    // 수단 종류에 맞지 않는 항목 등 — 행을 읽어야 알 수 있는 검증이라 요청을 찾은 뒤에 400이 난다(계약 §6-1 규칙 2-1).
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: r.field, body: logBody });
    return NextResponse.json({ error: r.error, field: r.field }, { status: 400, headers: NO_STORE });
  }
  const exp = await getForExport(sql, id);
  const item = exp ? toExternalItem(exp, new URL(req.url).origin) : null;
  if (r.kind === 'conflict') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 409, outcome: 'conflict', detail: r.code, body: logBody });
    return NextResponse.json({ error: CONFLICT_MESSAGE[r.code], code: r.code, request: item }, { status: 409, headers: NO_STORE });
  }
  // 호출 기록 문구(externalLogCopy)가 detail로 명부 반영 여부를 가른다: replayed(재전송) / roster-applied(명부도 반영) / roster-skip:no_method(명부에 수단 없음).
  const detail = r.kind === 'replayed'
    ? 'replayed'
    : r.rosterApplied ? 'roster-applied' : `roster-skip:${r.rosterSkipReason ?? 'no_method'}`;
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: 'applied', detail, body: logBody });
  return NextResponse.json({ applied: true, correction_id: r.correctionId, request: item }, { headers: NO_STORE });
}
