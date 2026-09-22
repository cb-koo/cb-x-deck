// 호출 기록 문구 순수 테스트 — 정산 수취 정보 정정(056·057) 경로. DB 없음(externalApiLog.test.ts의 DB 테스트와 분리해 로컬에서도 돈다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeExternalCall, describeCorrectionPatch, isPaymentInfoCorrection, type ExternalLogRow, type ExternalOutcome } from './externalLogCopy.ts';

const PATH = '/api/external/settlement/requests/11111111-1111-4111-8111-111111111111/payment-info';
function row(o: Partial<ExternalLogRow> & { outcome: ExternalOutcome }): ExternalLogRow {
  return {
    id: 'l1', at: '2026-09-22T05:00:00.000Z', method: 'POST', path: PATH, requestId: '11111111-1111-4111-8111-111111111111',
    statusCode: 200, detail: null, sentStatus: null, query: null, ip: null, userAgent: null, body: null, target: null, ...o,
  };
}

test('isPaymentInfoCorrection: /payment-info 경로만 참', () => {
  assert.equal(isPaymentInfoCorrection({ path: PATH }), true);
  assert.equal(isPaymentInfoCorrection({ path: '/api/external/settlement/requests/x/status' }), false);
});

test('describeExternalCall: 정정 반영 — 명부에도 반영했어요(roster-applied)', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: 'roster-applied' }));
  assert.equal(d.line, '수취 정보를 정정했어요 — 명부에도 반영했어요');
  assert.equal(d.tone, 'ok');
});

test('describeExternalCall: detail 없이도(옛 기록) 명부 반영 문구 — 빈 "\'\'을 보냈어요"가 아니다', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: null }));
  assert.equal(d.line, '수취 정보를 정정했어요 — 명부에도 반영했어요');
});

test('describeExternalCall: 명부에 수단이 없으면 확인 필요(roster-skip:no_method)', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: 'roster-skip:no_method' }));
  assert.match(d.line, /명부는 확인이 필요해요\(명부에 등록된 결제 수단이 없어요\)/);
  assert.equal(d.tone, 'warn');
});

test('describeExternalCall: 같은 종류 수단이 여럿이면 확인 필요(roster-skip:ambiguous)', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: 'roster-skip:ambiguous' }));
  assert.match(d.line, /명부는 확인이 필요해요\(같은 종류의 결제 수단이 여러 개라/);
  assert.equal(d.tone, 'warn');
});

test('describeExternalCall: 정정이 명부 수단과 안 맞으면 확인 필요(roster-skip:invalid)', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: 'roster-skip:invalid' }));
  assert.match(d.line, /명부는 확인이 필요해요\(정정 내용이 명부의 결제 수단과 맞지 않았어요\)/);
  assert.equal(d.tone, 'warn');
});

test('describeExternalCall: 같은 정정 재전송은 넘겼어요(replayed)', () => {
  const d = describeExternalCall(row({ outcome: 'applied', detail: 'replayed' }));
  assert.match(d.line, /이미 반영된 내용이라 넘겼어요/);
});

test('describeExternalCall: 지급 완료 뒤 정정은 반영 못 함(conflict paid-locked)', () => {
  const d = describeExternalCall(row({ outcome: 'conflict', statusCode: 409, detail: 'paid-locked' }));
  assert.match(d.line, /이미 지급 완료된 요청이라 정정을 반영하지 못했어요/);
  assert.equal(d.tone, 'warn');
});

test('describeExternalCall: 형식 오류는 반영 못 함(bad-request)', () => {
  const d = describeExternalCall(row({ outcome: 'bad-request', statusCode: 400, detail: 'payment_method.account' }));
  assert.match(d.line, /반영하지 못했어요/);
});

test('describeCorrectionPatch: 본문의 payment_method 바뀐 항목만 사람 말로', () => {
  const body = JSON.stringify({ correction_id: 'c1', payment_method: { holder: 'ASAMI HANYU', account: null }, reason: 'x' });
  assert.deepEqual(describeCorrectionPatch(body), [
    { label: '수취인명', to: 'ASAMI HANYU' },
    { label: '계좌번호', to: '(지움)' },
  ]);
});

test('describeCorrectionPatch: 본문이 없거나 깨졌으면 빈 배열', () => {
  assert.deepEqual(describeCorrectionPatch(null), []);
  assert.deepEqual(describeCorrectionPatch('not json'), []);
  assert.deepEqual(describeCorrectionPatch('{}'), []);
});
