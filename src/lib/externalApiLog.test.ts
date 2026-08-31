import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertExternalLog, listExternalLog, describeExternalCall, recordExternalCallSafe } from './externalApiLog.ts';
import type { ExternalLogRow } from './externalApiLog.ts';

const sql = getSql();
const P = 'tstlog' + process.pid;

after(async () => {
  await sql`delete from external_api_log where path like ${P + '%'}`;
  await sql.end();
});

const row = (over: Partial<ExternalLogRow> = {}): ExternalLogRow => ({
  id: '00000000-0000-0000-0000-000000000000',
  at: '2026-08-31T00:00:00.000Z',
  method: 'POST',
  path: P + '/requests/00000000-0000-0000-0000-000000000000/status',
  requestId: null,
  statusCode: 200,
  outcome: 'ok',
  detail: null,
  sentStatus: null,
  query: null,
  ip: null,
  userAgent: null,
  ...over,
});

// --- describeExternalCall: 표 11행 전부 ---

test('describeExternalCall — applied', () => {
  const r = describeExternalCall(row({ outcome: 'applied', sentStatus: 'on_hold' }));
  assert.equal(r.line, "정산 프로덕트가 '보류'을 보냈어요 — 반영했어요");
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — stale', () => {
  const r = describeExternalCall(row({ outcome: 'stale', sentStatus: 'cancelled' }));
  assert.equal(r.line, "정산 프로덕트가 '취소'을 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요");
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — ok, 목록(GET .../requests)', () => {
  const r = describeExternalCall(row({ outcome: 'ok', path: P + '/requests', method: 'GET' }));
  assert.equal(r.line, '정산 프로덕트가 요청 목록을 가져갔어요');
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — ok, 단건 조회(그 외)', () => {
  const r = describeExternalCall(row({ outcome: 'ok', path: P + '/requests/00000000-0000-0000-0000-000000000000', method: 'GET' }));
  assert.equal(r.line, '정산 프로덕트가 요청 1건을 조회했어요');
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — unauthorized', () => {
  const r = describeExternalCall(row({ outcome: 'unauthorized' }));
  assert.equal(r.line, 'API 키가 맞지 않아 거부했어요 — 정산 프로덕트에 운영 키를 다시 확인해 달라고 알려 주세요');
  assert.equal(r.tone, 'bad');
});

test('describeExternalCall — bad-request, detail 있음', () => {
  const r = describeExternalCall(row({ outcome: 'bad-request', detail: 'paid_amount_krw' }));
  assert.equal(r.line, "보낸 내용의 'paid_amount_krw' 값이 잘못돼 거부했어요");
  assert.equal(r.tone, 'warn');
});

test('describeExternalCall — bad-request, detail 없음', () => {
  const r = describeExternalCall(row({ outcome: 'bad-request', detail: null }));
  assert.equal(r.line, '보낸 내용의 형식이 잘못돼 거부했어요');
  assert.equal(r.tone, 'warn');
});

test('describeExternalCall — not-found', () => {
  const r = describeExternalCall(row({ outcome: 'not-found' }));
  assert.equal(r.line, '찾을 수 없는 요청이라 거부했어요 — 연습용(스테이징) 요청 번호를 보냈을 수 있어요');
  assert.equal(r.tone, 'warn');
});

test('describeExternalCall — conflict, paid-locked', () => {
  const r = describeExternalCall(row({ outcome: 'conflict', detail: 'paid-locked' }));
  assert.equal(r.line, '이미 지급 완료된 요청이라 거부했어요');
  assert.equal(r.tone, 'warn');
});

test('describeExternalCall — conflict, request-cancelled', () => {
  const r = describeExternalCall(row({ outcome: 'conflict', detail: 'request-cancelled' }));
  assert.equal(r.line, '우리 쪽에서 취소한 요청이라 거부했어요');
  assert.equal(r.tone, 'warn');
});

test('describeExternalCall — error', () => {
  const r = describeExternalCall(row({ outcome: 'error' }));
  assert.equal(r.line, '처리 중 오류가 나 거부했어요');
  assert.equal(r.tone, 'bad');
});

// --- insertExternalLog + listExternalLog 왕복 ---

test('insertExternalLog + listExternalLog — 저장·조회 왕복, at desc, 필드 매핑', async () => {
  const path = P + '/requests';
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-1' });
  await new Promise((r) => setTimeout(r, 5));
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-2' });
  await new Promise((r) => setTimeout(r, 5));
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-3' });

  const rows = await listExternalLog(sql, 50);
  const mine = rows.filter((r) => r.path === path);
  assert.equal(mine.length, 3);
  assert.equal(mine[0].userAgent, 'ua-3');
  assert.equal(mine[1].userAgent, 'ua-2');
  assert.equal(mine[2].userAgent, 'ua-1');
  const r0 = mine[0];
  assert.equal(r0.method, 'GET');
  assert.equal(r0.path, path);
  assert.equal(r0.statusCode, 200);
  assert.equal(r0.outcome, 'ok');
  assert.equal(r0.ip, '1.2.3.4');
  assert.equal(typeof r0.id, 'string');
  assert.equal(typeof r0.at, 'string');
});

test('insertExternalLog — uuid 아닌 requestId는 request_id null + detail에 보낸 값', async () => {
  const path = P + '/requests/not-a-uuid/status';
  await insertExternalLog(sql, { method: 'POST', path, requestId: 'not-a-uuid', statusCode: 404, outcome: 'not-found' });
  const rows = await listExternalLog(sql, 50);
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.equal(r!.requestId, null);
  assert.equal(r!.detail, '보낸 id: not-a-uuid');
});

test('insertExternalLog — 길이 초과 detail은 300자로 잘려 저장', async () => {
  const path = P + '/requests/00000000-0000-0000-0000-000000000001/status';
  const longDetail = 'x'.repeat(400);
  await insertExternalLog(sql, { method: 'POST', path, statusCode: 400, outcome: 'bad-request', detail: longDetail });
  const rows = await listExternalLog(sql, 50);
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.equal(r!.detail!.length, 300);
  assert.equal(r!.detail, 'x'.repeat(300));
});

// --- recordExternalCallSafe: 킬스위치만 동기적으로 확인 ---

test('recordExternalCallSafe — EXTERNAL_API_LOG=off이면 즉시 반환(예외 없음)', () => {
  const prev = process.env.EXTERNAL_API_LOG;
  process.env.EXTERNAL_API_LOG = 'off';
  try {
    assert.doesNotThrow(() => {
      recordExternalCallSafe({ method: 'GET', path: P + '/off-test', statusCode: 200, outcome: 'ok' });
    });
  } finally {
    if (prev === undefined) delete process.env.EXTERNAL_API_LOG;
    else process.env.EXTERNAL_API_LOG = prev;
  }
});
