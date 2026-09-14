import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, clampLimit, toExternalItem, parseStatusUpdate, type ExportRow } from './settlementExternal.ts';
import { withRevisionV2 } from './settlementRevisionFlag.ts';
import type { PaymentRequestRow } from './settlementStore.ts';
import type { TaskProof } from './taskProofGuard.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://cb-x-deck.example';   // 라우트가 new URL(req.url).origin으로 넘기는 값의 대역 — 하드코딩 방지 확인용
// proof 추가 이전 응답의 전체 키 집합 — 파트너 영향 0을 못박는 기준선(proof 하나만 늘어야 한다)
const ITEM_KEYS_BEFORE_PROOF = [
  'request_id', 'revision', 'status', 'created_at', 'updated_at', 'cancelled', 'task_id', 'campaign', 'clinic',
  'influencer', 'task_type', 'category', 'item', 'purpose', 'amount_krw', 'cost_currency', 'payout', 'deadline',
  'reference_url', 'payment_method', 'requester', 'note', 'settlement',
].sort();
test('커서 — 왕복, 깨진 값은 null', () => {
  const s = encodeCursor({ updatedAtUs: '1756368000123456', id: ID });
  assert.deepEqual(decodeCursor(s), { updatedAtUs: '1756368000123456', id: ID });
  assert.equal(decodeCursor('not-base64!!'), null);
  assert.equal(decodeCursor(Buffer.from('abc:def').toString('base64url')), null);      // µs가 숫자 아님
  assert.equal(decodeCursor(Buffer.from('123:nope').toString('base64url')), null);     // uuid 아님
  assert.equal(decodeCursor(Buffer.from('99999999999999999:' + ID).toString('base64url')), null); // 17자리 — bigint 넘침 방지
});
test('limit — 기본 100, 최대 500, 잘못된 값은 기본', () => {
  assert.equal(clampLimit(null), 100); assert.equal(clampLimit('50'), 50); assert.equal(clampLimit('9999'), 500);
  assert.equal(clampLimit('0'), 100); assert.equal(clampLimit('abc'), 100);
});

const row: PaymentRequestRow = {
  id: ID, taskId: 't', campaignId: 'c', campaignName: '캠', clientId: 'cl', clientName: '마인드피부과', influencerHandle: 'sawada_k', taskType: 'post',
  category: '마케팅비 > 원고료', categoryDefault: null, itemText: '항목', purposeText: '목적', amountKrw: 30000, costCurrency: 'KRW', payoutCurrency: 'JPY',
  rateKrwPerJpy: 10, amountNet: 3000, fee: { mode: 'grossUp', percent: 5 }, feeAmount: 158, amountGross: 3158, grossKrw: 31580, deadlineOn: '2026-08-29', referenceUrl: null, proof: null,
  paymentMethod: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypalId: 'keiko' }, requesterMemberId: 'm', requesterName: '모에카',
  status: 'requested', cancelledAt: null, cancelledByName: null, cancelReason: null, sentAt: null, externalId: null, note: '',
  createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
  externalStatus: null, paidAmountKrw: null, paidAt: null, externalNote: null, externalUpdatedAt: null, influencerId: 'inf', categoryOptionId: 'fee', diffAckAt: null, diffAckByName: null, externalOperatorId: null, externalOperatorName: null, revision: 0, revisedAt: null, paidAmountUsd: null, paidAmountJpy: null,
};
test('toExternalItem — 금액 분리·snake_case·되비침 null', () => {
  const e: ExportRow = { row, updatedAtUs: '1', requester: { email: 'a@b.c', slackId: null }, proof: null };
  const it = toExternalItem(e, ORIGIN);
  assert.equal(it.request_id, ID); assert.equal(it.revision, 0); assert.equal(it.status, 'requested');
  assert.equal(it.amount_krw, 30000); assert.equal(it.cost_currency, 'KRW');
  assert.deepEqual(it.payout, { currency: 'JPY', net: 3000, fee: { mode: 'grossUp', percent: 5 }, fee_amount: 158, gross: 3158, rate_krw_per_jpy: 10, gross_krw: 31580 });
  assert.deepEqual(it.influencer, { id: 'inf', handle: 'sawada_k' });
  assert.deepEqual(it.clinic, { id: 'cl', name: '마인드피부과' });
  assert.deepEqual(it.category, { code: 'fee', label: '마케팅비 > 원고료' });
  assert.deepEqual(it.payment_method, { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypal_id: 'keiko' });
  assert.deepEqual(it.requester, { name: '모에카', email: 'a@b.c', slack_id: null });
  assert.equal(it.cancelled, null);
  assert.deepEqual(it.settlement, { status: null, paid_amount_krw: null, paid_amount_usd: null, paid_amount_jpy: null, paid_at: null, note: null, updated_at: null, external_id: null });
  assert.equal(it.deadline, '2026-08-29'); assert.equal(it.reference_url, null);
  // 증빙 없음(RT 아닌 유형이거나, RT인데 아직 없음) → proof는 null(스펙 §3)
  assert.equal(it.proof, null);
  // 응답 키 집합 — proof 추가 외에는 그대로다(파트너 영향 0을 못박는다, 스펙 §10)
  assert.deepEqual(Object.keys(it).sort(), [...ITEM_KEYS_BEFORE_PROOF, 'proof', 'revised_at'].sort());
});
test('toExternalItem — 취소·지급 완료 되비침', () => {
  const r2: PaymentRequestRow = { ...row, status: 'cancelled', cancelledAt: '2026-08-29T01:00:00.000Z', cancelledByName: '정산 프로덕트', cancelReason: '중복',
    externalStatus: 'paid', paidAmountKrw: 29700, paidAt: '2026-08-30T05:00:00.000Z', externalNote: '환율', externalUpdatedAt: '2026-08-30T05:00:00.000Z', externalId: 'X-1', requesterMemberId: null };
  const it = toExternalItem({ row: r2, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null }, ORIGIN);
  assert.equal(it.revision, 1);
  assert.deepEqual(it.cancelled, { at: '2026-08-29T01:00:00.000Z', by_name: '정산 프로덕트', reason: '중복' });
  assert.deepEqual(it.settlement, { status: 'paid', paid_amount_krw: 29700, paid_amount_usd: null, paid_amount_jpy: null, paid_at: '2026-08-30T05:00:00.000Z', note: '환율', updated_at: '2026-08-30T05:00:00.000Z', external_id: 'X-1' });
});

test('toExternalItem — proof 있으면 고정 엔드포인트 URL(origin은 호출부가 넘긴 값)·업로더·시각을 싣는다', () => {
  const proof: TaskProof = { url: 'task/tt/ff.png', by: 'm1', byName: '박구건', at: '2026-08-31T10:12:00.000Z' };
  const it = toExternalItem({ row, updatedAtUs: '1', requester: { email: null, slackId: null }, proof }, ORIGIN);
  assert.deepEqual(it.proof, {
    url: `${ORIGIN}/api/external/settlement/requests/${ID}/proof`,
    uploaded_at: '2026-08-31T10:12:00.000Z',
    uploaded_by: '박구건',
  });
  // 우리 내부 모양(TaskProof: url/by/byName/at)이 그대로 새지 않는다 — 그쪽 계약 키(url/uploaded_at/uploaded_by)로만 변환
  assert.deepEqual(Object.keys(it.proof!).sort(), ['uploaded_at', 'uploaded_by', 'url']);
  // 스토리지 상대경로(task/tt/ff.png)가 아니라 우리 API 절대 주소가 나간다 — 서명 URL 만료 문제를 피하려는 설계(스펙 §4)
  assert.ok(it.proof!.url.startsWith('https://'));
  assert.equal(it.proof!.url.includes('task/tt/ff.png'), false);
});

test('parseStatusUpdate — 정상·정규화', () => {
  const r = parseStatusUpdate({ status: 'paid', updated_at: '2026-08-30T05:00:00Z', paid_amount_krw: 29700, paid_at: '2026-08-30T05:00:00+09:00', note: ' 환율 ', external_id: 'X-1' });
  assert.ok(r.ok);
  assert.deepEqual(r.update, { status: 'paid', updatedAt: '2026-08-30T05:00:00.000Z', paidAmountKrw: 29700, paidAt: '2026-08-29T20:00:00.000Z', note: '환율', externalId: 'X-1', operator: null, revision: null, paidAmountUsd: null, paidAmountJpy: null, paidCurrency: null });
  const h = parseStatusUpdate({ status: 'on_hold', updated_at: '2026-08-29T00:00:00Z', note: '계좌 확인' });
  assert.ok(h.ok); assert.equal(h.update.paidAmountKrw, null); assert.equal(h.update.externalId, null); assert.equal(h.update.operator, null);
});
// 09-04 그쪽 요청: 사람이 실행한 전이에는 operator { id, name }(처리한 결제 담당자)가 실린다. 자동 전이에는 키 자체가 없다.
test('parseStatusUpdate — operator는 선택, 있으면 { id, name }만 받는다', () => {
  const r = parseStatusUpdate({ status: 'cancelled', updated_at: '2026-09-04T09:12:33.120Z', note: '조건 변경', operator: { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: ' 전태정 ' } });
  assert.ok(r.ok);
  assert.deepEqual(r.update.operator, { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: '전태정' });
  const bad = (body: unknown) => { const x = parseStatusUpdate(body); assert.ok(!x.ok); assert.equal(x.field, 'operator'); };
  bad({ status: 'paid', updated_at: '2026-09-04T09:12:33Z', paid_amount_krw: 1, paid_at: '2026-09-04T09:00:00Z', operator: '전태정' });
  bad({ status: 'on_hold', updated_at: '2026-09-04T09:12:33Z', operator: { id: 'x' } });                 // name 없음
  bad({ status: 'on_hold', updated_at: '2026-09-04T09:12:33Z', operator: { id: '', name: '전태정' } });   // id 비어 있음
  bad({ status: 'on_hold', updated_at: '2026-09-04T09:12:33Z', operator: { id: 'x', name: 'n'.repeat(101) } });
  // null은 "없음"으로 본다
  const n = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-04T09:00:00Z', operator: null });
  assert.ok(n.ok); assert.equal(n.update.operator, null);
});
test('parseStatusUpdate — 모르는 키는 무시한다(그쪽이 필드를 추가해도 400이 나지 않는다)', () => {
  const r = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-04T09:00:00Z', something_new: { a: 1 }, another: 'x' });
  assert.ok(r.ok);
});
test('parseStatusUpdate — 거절 사유는 필드 단위', () => {
  const bad = (body: unknown, field: string) => { const r = parseStatusUpdate(body); assert.ok(!r.ok); assert.equal(r.field, field); };
  bad(null, 'body'); bad([], 'body');
  bad({ updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'done', updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'received' }, 'updated_at');
  bad({ status: 'received', updated_at: 'yesterday' }, 'updated_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 100 }, 'paid_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: -1, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 1.5, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 'x'.repeat(501) }, 'note');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', external_id: 'x'.repeat(101) }, 'external_id');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 5 }, 'note');
});

test('toExternalItem — 원화 지급이면 gross_krw는 환산 없이 gross 그대로', () => {
  const krw: PaymentRequestRow = { ...row, payoutCurrency: 'KRW', amountNet: 20000, fee: null, feeAmount: 0, amountGross: 20000, grossKrw: 20000, amountKrw: 20000 };
  const it = toExternalItem({ row: krw, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null }, ORIGIN);
  assert.deepEqual(it.payout, { currency: 'KRW', net: 20000, fee: null, fee_amount: 0, gross: 20000, rate_krw_per_jpy: 10, gross_krw: 20000 });
});

test('toExternalItem — 수수료가 붙으면 gross_krw가 amount_krw보다 크다(실제 나간 돈 ≠ 단가)', () => {
  const it = toExternalItem({ row, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null }, ORIGIN);
  assert.equal(it.amount_krw, 30000);
  assert.equal(it.payout.gross_krw, 31580);   // 수수료 158엔 × 환율 10 = 1,580원 더
});

// ── 제자리 수정(2026-09-07 스펙 §2·§5): 스위치 꺼짐이면 옛 의미(0 요청/1 취소), 켜짐이면 수정 횟수 + revised_at ──
test('toExternalItem — revision: 스위치 꺼짐이면 취소=1, 켜짐이면 payment_request.revision·revised_at', () => {
  const revised: PaymentRequestRow = { ...row, revision: 2, revisedAt: '2026-09-07T03:50:14.000Z' };
  const e = (r: PaymentRequestRow): ExportRow => ({ row: r, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null });
  withRevisionV2(false, () => {
    assert.equal(toExternalItem(e(revised), ORIGIN).revision, 0);                                   // 옛 의미: 요청됨
    assert.equal(toExternalItem(e(revised), ORIGIN).revised_at, null);                              // 전환 전엔 항상 null
    assert.equal(toExternalItem(e({ ...revised, status: 'cancelled' }), ORIGIN).revision, 1);      // 옛 의미: 취소
  });
  withRevisionV2(true, () => {
    const it = toExternalItem(e(revised), ORIGIN);
    assert.equal(it.revision, 2); assert.equal(it.revised_at, '2026-09-07T03:50:14.000Z');
    assert.equal(toExternalItem(e({ ...revised, status: 'cancelled' }), ORIGIN).revision, 2);      // 취소돼도 수정 횟수 유지 — 취소는 status로만
    assert.equal(toExternalItem(e(row), ORIGIN).revision, 0);
  });
});
test('parseStatusUpdate — revision은 정수(≥0)만, 없으면 null(필수 여부는 라우트가 스위치로 판단)', () => {
  const ok = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-07T09:00:00Z', revision: 2 });
  assert.ok(ok.ok); assert.equal(ok.update.revision, 2);
  const none = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-07T09:00:00Z' });
  assert.ok(none.ok); assert.equal(none.update.revision, null);
  for (const bad of ['1', 1.5, -1, null]) {
    const r = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-07T09:00:00Z', revision: bad });
    if (bad === null) { assert.ok(r.ok); assert.equal(r.update.revision, null); continue; }   // null은 "없음"
    assert.ok(!r.ok); assert.equal(r.field, 'revision');
  }
});

// 09-09 그쪽: PayPal 지급 완료·정정 POST에 paid_amount_usd를 paid_amount_krw와 함께 보낸다. 달러 값은 보관·표시·되비침용이고 차액 판정은 원화(gross_krw)로만 한다.
test('parseStatusUpdate — paid_amount_usd는 선택(소수 허용, 0 이상), 없으면 null', () => {
  const ok = parseStatusUpdate({ status: 'paid', updated_at: '2026-09-08T11:13:50Z', paid_amount_krw: 25934, paid_amount_usd: 18.62, paid_at: '2026-09-08T11:12:00Z' });
  assert.ok(ok.ok); assert.equal(ok.update.paidAmountUsd, 18.62); assert.equal(ok.update.paidAmountKrw, 25934);
  const none = parseStatusUpdate({ status: 'paid', updated_at: '2026-09-08T11:13:50Z', paid_amount_krw: 25934, paid_at: '2026-09-08T11:12:00Z' });
  assert.ok(none.ok); assert.equal(none.update.paidAmountUsd, null);
  for (const bad of ['18.62', -1, NaN]) {
    const r = parseStatusUpdate({ status: 'paid', updated_at: '2026-09-08T11:13:50Z', paid_amount_krw: 25934, paid_amount_usd: bad, paid_at: '2026-09-08T11:12:00Z' });
    assert.ok(!r.ok); assert.equal(r.field, 'paid_amount_usd');
  }
  // 원화 없이 달러만 → 여전히 paid_amount_krw 400(원화가 판정 기준)
  const krwMissing = parseStatusUpdate({ status: 'paid', updated_at: '2026-09-08T11:13:50Z', paid_amount_usd: 18.62, paid_at: '2026-09-08T11:12:00Z' });
  assert.ok(!krwMissing.ok); assert.equal(krwMissing.field, 'paid_amount_krw');
});
test('toExternalItem — settlement.paid_amount_usd 되비침', () => {
  const r2: PaymentRequestRow = { ...row, externalStatus: 'paid', paidAmountKrw: 25934, paidAmountUsd: 18.62, paidAt: '2026-09-08T11:12:00.000Z', externalUpdatedAt: '2026-09-08T11:13:50.000Z' };
  const it = toExternalItem({ row: r2, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null }, ORIGIN);
  assert.equal(it.settlement.paid_amount_usd, 18.62);
});

// 09-09 그쪽 요청(22): 계좌(일본)·PayPay의 엔화 실지급액 paid_amount_jpy. 규칙은 그쪽 표 그대로 + 우리 제안 paid_currency.
test('parseStatusUpdate — paid_amount_jpy: 0 이상 안전 정수, paid에서만, USD와 동시 금지', () => {
  const base = { status: 'paid', updated_at: '2026-09-09T06:00:00Z', paid_amount_krw: 13685, paid_at: '2026-09-09T05:59:00Z' };
  const ok = parseStatusUpdate({ ...base, paid_amount_jpy: 1500 }); assert.ok(ok.ok); assert.equal(ok.update.paidAmountJpy, 1500);
  const zero = parseStatusUpdate({ ...base, paid_amount_jpy: 0 }); assert.ok(zero.ok); assert.equal(zero.update.paidAmountJpy, 0);   // 0도 유효(존재로 판정)
  const none = parseStatusUpdate(base); assert.ok(none.ok); assert.equal(none.update.paidAmountJpy, null);
  for (const bad of [-1, 1.5, '1500', null, 9007199254740992]) {
    const r = parseStatusUpdate({ ...base, paid_amount_jpy: bad }); assert.ok(!r.ok, String(bad)); assert.equal(r.field, 'paid_amount_jpy', String(bad));
  }
  const notPaid = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-09T06:00:00Z', paid_amount_jpy: 1500 }); assert.ok(!notPaid.ok); assert.equal(notPaid.field, 'paid_amount_jpy');
  const notPaidUsd = parseStatusUpdate({ status: 'scheduled', updated_at: '2026-09-09T06:00:00Z', paid_amount_usd: 6.5 }); assert.ok(!notPaidUsd.ok); assert.equal(notPaidUsd.field, 'paid_amount_usd');   // 달러도 같은 규칙으로 맞춤
  const both = parseStatusUpdate({ ...base, paid_amount_usd: 10, paid_amount_jpy: 1500 }); assert.ok(!both.ok); assert.equal(both.field, 'paid_amount_jpy');
  const krwMissing = parseStatusUpdate({ status: 'paid', updated_at: '2026-09-09T06:00:00Z', paid_amount_jpy: 1500, paid_at: '2026-09-09T05:59:00Z' }); assert.ok(!krwMissing.ok); assert.equal(krwMissing.field, 'paid_amount_krw');
});
test('parseStatusUpdate — paid_currency(우리 제안): KRW·JPY·USD만, paid에서만, 없으면 null', () => {
  const base = { status: 'paid', updated_at: '2026-09-09T06:20:00Z', paid_amount_krw: 14000, paid_at: '2026-09-09T05:59:00Z' };
  const krw = parseStatusUpdate({ ...base, paid_currency: 'KRW' }); assert.ok(krw.ok); assert.equal(krw.update.paidCurrency, 'KRW');
  const none = parseStatusUpdate(base); assert.ok(none.ok); assert.equal(none.update.paidCurrency, null);
  const bad = parseStatusUpdate({ ...base, paid_currency: 'EUR' }); assert.ok(!bad.ok); assert.equal(bad.field, 'paid_currency');
  const mismatch = parseStatusUpdate({ ...base, paid_currency: 'USD', paid_amount_jpy: 1500 }); assert.ok(!mismatch.ok); assert.equal(mismatch.field, 'paid_currency');   // 통화와 외화 필드가 어긋남
  const notPaid = parseStatusUpdate({ status: 'on_hold', updated_at: '2026-09-09T06:20:00Z', paid_currency: 'KRW' }); assert.ok(!notPaid.ok); assert.equal(notPaid.field, 'paid_currency');
});
test('toExternalItem — settlement.paid_amount_jpy 되비침', () => {
  const r2: PaymentRequestRow = { ...row, externalStatus: 'paid', paidAmountKrw: 13685, paidAmountJpy: 1500, paidAt: '2026-09-09T05:59:00.000Z', externalUpdatedAt: '2026-09-09T06:00:00.000Z' };
  const it = toExternalItem({ row: r2, updatedAtUs: '1', requester: { email: null, slackId: null }, proof: null }, ORIGIN);
  assert.equal(it.settlement.paid_amount_jpy, 1500); assert.equal(it.settlement.paid_amount_usd, null);
});
