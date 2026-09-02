import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertExternalLog, listExternalLog, recordExternalCall } from './externalApiLog.ts';
import { describeExternalCall, describeCaller, describeTarget, describeCursor } from './externalLogCopy.ts';
import type { ExternalLogRow } from './externalLogCopy.ts';

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
  body: null,
  target: null,
  ...over,
});

// --- describeExternalCall: 표 11행 전부 ---

test('describeExternalCall — applied', () => {
  const r = describeExternalCall(row({ outcome: 'applied', sentStatus: 'on_hold' }));
  assert.equal(r.line, "'보류'를 보냈어요 — 반영했어요");
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — 목적격 조사가 받침에 따라 갈린다(\'지급 완료\'을 → 를)', () => {
  assert.equal(describeExternalCall(row({ outcome: 'applied', sentStatus: 'paid' })).line, "'지급 완료'를 보냈어요 — 반영했어요");
  assert.equal(describeExternalCall(row({ outcome: 'applied', sentStatus: 'scheduled' })).line, "'지급 예정'을 보냈어요 — 반영했어요");
  assert.equal(describeExternalCall(row({ outcome: 'stale', sentStatus: 'paid' })).line, "'지급 완료'를 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요");
});

test('describeExternalCall — stale', () => {
  const r = describeExternalCall(row({ outcome: 'stale', sentStatus: 'cancelled' }));
  assert.equal(r.line, "'취소'를 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요");
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — ok, 목록(GET .../requests), 커서 없음(처음)', () => {
  const r = describeExternalCall(row({ outcome: 'ok', path: P + '/requests', method: 'GET' }));
  assert.equal(r.line, '요청 목록을 처음부터 가져갔어요');
  assert.equal(r.tone, 'ok');
});

test('describeExternalCall — ok, 단건 조회(그 외)', () => {
  const r = describeExternalCall(row({ outcome: 'ok', path: P + '/requests/00000000-0000-0000-0000-000000000000', method: 'GET' }));
  assert.equal(r.line, '요청 1건을 조회했어요');
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

// --- describeCaller ---

test('describeCaller — UA 없음', () => {
  const r = describeCaller({ userAgent: null, ip: null });
  assert.deepEqual(r, { label: '알 수 없음', kind: 'unknown' });
});

test('describeCaller — curl', () => {
  const r = describeCaller({ userAgent: 'curl/8.4.0', ip: null });
  assert.deepEqual(r, { label: '우리 쪽 점검', kind: 'us' });
});

test('describeCaller — Mozilla(브라우저)', () => {
  const r = describeCaller({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', ip: null });
  assert.deepEqual(r, { label: '브라우저', kind: 'us' });
});

test('describeCaller — 그 외(node 등)는 정산 프로덕트로 추정', () => {
  const r = describeCaller({ userAgent: 'node-fetch/1.0', ip: null });
  assert.deepEqual(r, { label: '정산 프로덕트', kind: 'partner' });
});

// --- describeTarget ---

test('describeTarget — target 있음, JPY', () => {
  const r = describeTarget({ requestId: 'r1', target: { handle: 'foo', clientName: '클라A', amountGross: 12000, payoutCurrency: 'JPY', taskType: 'post' } });
  assert.equal(r, '@foo · 투고 · 클라A · ¥12,000');
});

test('describeTarget — target 있음, KRW', () => {
  const r = describeTarget({ requestId: 'r1', target: { handle: 'bar', clientName: '클라B', amountGross: 340000, payoutCurrency: 'KRW', taskType: 'visit' } });
  assert.equal(r, '@bar · 방문협찬 · 클라B · ₩340,000');
});

test('describeTarget — 같은 인플루언서라도 작업 유형이 다르면 문구로 구분된다(RT)', () => {
  const r = describeTarget({ requestId: 'r1', target: { handle: 'minchannell', clientName: '손유나클리닉', amountGross: 2000, payoutCurrency: 'JPY', taskType: 'rt' } });
  assert.equal(r, '@minchannell · RT · 손유나클리닉 · ¥2,000');
});

test('describeTarget — requestId 있는데 target 없음', () => {
  const r = describeTarget({ requestId: 'r1', target: null });
  assert.equal(r, '찾을 수 없는 요청');
});

test('describeTarget — requestId 없음', () => {
  const r = describeTarget({ requestId: null, target: null });
  assert.equal(r, '—');
});

// --- insertExternalLog + listExternalLog 왕복 ---

test('insertExternalLog + listExternalLog — 저장·조회 왕복, at desc, 필드 매핑', async () => {
  const path = P + '/requests';
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-1' });
  await new Promise((r) => setTimeout(r, 5));
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-2' });
  await new Promise((r) => setTimeout(r, 5));
  await insertExternalLog(sql, { method: 'GET', path, statusCode: 200, outcome: 'ok', ip: '1.2.3.4', userAgent: 'ua-3' });

  const rows = await listExternalLog(sql, { limit: 50 });
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
  const rows = await listExternalLog(sql, { limit: 50 });
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.equal(r!.requestId, null);
  assert.equal(r!.detail, '보낸 id: not-a-uuid');
});

test('insertExternalLog — 길이 초과 detail은 300자로 잘려 저장', async () => {
  const path = P + '/requests/00000000-0000-0000-0000-000000000001/status';
  const longDetail = 'x'.repeat(400);
  await insertExternalLog(sql, { method: 'POST', path, statusCode: 400, outcome: 'bad-request', detail: longDetail });
  const rows = await listExternalLog(sql, { limit: 50 });
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.equal(r!.detail!.length, 300);
  assert.equal(r!.detail, 'x'.repeat(300));
});

test('listExternalLog — 대상 요청 조인: 존재하지 않는 요청 id면 target null(찾을 수 없는 요청)', async () => {
  const path = P + '/requests/00000000-0000-0000-0000-0000000000fe/status';
  const missingRequestId = '00000000-0000-0000-0000-0000000000fe';
  await insertExternalLog(sql, { method: 'POST', path, requestId: missingRequestId, statusCode: 404, outcome: 'not-found' });
  const rows = await listExternalLog(sql, { limit: 50 });
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.equal(r!.requestId, missingRequestId);
  assert.equal(r!.target, null);
  assert.equal(describeTarget(r!), '찾을 수 없는 요청');
});

// --- 본문 저장 ---

test('본문 — 상태 전송 본문이 원문 그대로 남는다', async () => {
  const body = '{"status":"paid","updated_at":"2026-09-01T01:00:00Z","paid_amount_krw":31650}';
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-ok', statusCode: 200, outcome: 'applied', sentStatus: 'paid', body });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body, body);
});

test('본문 — 깨진 JSON도 원문 그대로 남는다(400으로 거부된 본문이 가장 보고 싶다)', async () => {
  const body = '{"status":"paid", 이건 JSON이 아니다';
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-broken', statusCode: 400, outcome: 'bad-request', detail: 'body', body });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body, body);
});

test('본문 — 4KB를 넘으면 잘리고 잘림 표시가 붙는다', async () => {
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-long', statusCode: 200, outcome: 'applied', body: 'x'.repeat(5000) });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body!.length, 4096);
  assert.ok(row.body!.endsWith('…(본문이 길어 여기서 잘렸어요)'));
});

test('본문 — 이모지가 자르는 지점에 걸려도 홀로 남은 서로게이트(�)가 저장되지 않는다', async () => {
  // BODY_MAX=4096, BODY_CUT 길이=18 → 자르는 지점(cutPoint)=4078.
  // clipBody가 하던 대로 s.slice(0, cutPoint)를 하면 마지막 문자가 정확히 이모지의 높은 서로게이트가 되도록
  // 구성한다: index(cutPoint-1)에 높은 서로게이트, index(cutPoint)에 낮은 서로게이트가 오게 만든다.
  const BODY_MAX = 4096;
  const BODY_CUT = '…(본문이 길어 여기서 잘렸어요)';
  const cutPoint = BODY_MAX - BODY_CUT.length;
  const emoji = '😀'; // U+1F600, 서로게이트 쌍(높은 0xD83D + 낮은 0xDE00) 2코드유닛
  assert.equal(emoji.charCodeAt(0) >= 0xd800 && emoji.charCodeAt(0) <= 0xdbff, true);
  const body = 'x'.repeat(cutPoint - 1) + emoji + 'y'.repeat(50);
  assert.ok(body.length > BODY_MAX); // 반드시 잘리는 경로를 타야 한다
  // 이모지가 정확히 자르는 경계에 걸리는지 확인(테스트 자체가 틀리지 않도록)
  assert.equal(body.charCodeAt(cutPoint - 1) >= 0xd800 && body.charCodeAt(cutPoint - 1) <= 0xdbff, true);

  const path = P + '/body-emoji-boundary';
  await insertExternalLog(sql, { method: 'POST', path, statusCode: 200, outcome: 'applied', body });
  const rows = await listExternalLog(sql, { limit: 50 });
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.ok(!r!.body!.includes('�'), `저장된 본문에 홀로 남은 서로게이트가 �로 깨져 들어갔다: ${JSON.stringify(r!.body!.slice(-30))}`);
  assert.ok(r!.body!.length <= BODY_MAX);
  assert.ok(r!.body!.endsWith(BODY_CUT));
});

test('detail — clip()도 잘리는 경계에 이모지가 걸리면 홀로 남은 서로게이트(�)가 저장되지 않는다', async () => {
  // LIMITS.detail=300. index299에 높은 서로게이트가 오도록 구성해 clip(s, 300)의 slice(0,300)이
  // 이모지 중간을 자르게 만든다.
  const max = 300;
  const emoji = '😀';
  const detail = 'x'.repeat(max - 1) + emoji + 'y'.repeat(50);
  assert.ok(detail.length > max);
  assert.equal(detail.charCodeAt(max - 1) >= 0xd800 && detail.charCodeAt(max - 1) <= 0xdbff, true);

  const path = P + '/detail-emoji-boundary';
  await insertExternalLog(sql, { method: 'POST', path, statusCode: 400, outcome: 'bad-request', detail });
  const rows = await listExternalLog(sql, { limit: 50 });
  const r = rows.find((x) => x.path === path);
  assert.ok(r);
  assert.ok(!r!.detail!.includes('�'), `저장된 detail에 홀로 남은 서로게이트가 �로 깨져 들어갔다: ${JSON.stringify(r!.detail!.slice(-30))}`);
  assert.ok(r!.detail!.length <= max);
});

test('describeCursor — 그쪽이 보낸 커서를 사람 말로 푼다', () => {
  // 2026-08-31T14:19:10.791678Z 마이크로초 + 요청 id
  const raw = '1788185950791678:f65553e4-8c26-47c8-a6cf-3cbab28541e3';
  const cursor = Buffer.from(raw).toString('base64url');
  const out = describeCursor(`?cursor=${cursor}&limit=100`);
  assert.ok(out && out.includes('이후 바뀐 것'), out ?? '(null)');
  assert.ok(out.includes('8/31'), out);
  assert.equal(describeCursor(null), null);
  assert.equal(describeCursor('?limit=100'), null);
  assert.equal(describeCursor('?cursor=쓰레기'), null);
});

test('목록 조회 문구 — 커서가 있으면 어디부터 가져갔는지 말한다', () => {
  const cursor = Buffer.from('1788185950791678:f65553e4-8c26-47c8-a6cf-3cbab28541e3').toString('base64url');
  const line = describeExternalCall(row({ method: 'GET', path: '/api/external/settlement/requests', outcome: 'ok', detail: '0건', query: `?cursor=${cursor}` })).line;
  assert.ok(line.includes('이후 바뀐 것을 가져갔어요'), line);
  assert.ok(line.includes('새로 바뀐 게 없었어요'), line);
});

test('필터 — 상태 전송만 / 거부된 것만 / 요청별', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  await insertExternalLog(sql, { method: 'GET', path: P + '/f-get', statusCode: 200, outcome: 'ok' });
  await insertExternalLog(sql, { method: 'POST', path: P + '/f-post', statusCode: 400, outcome: 'bad-request', detail: 'status' });
  const posts = await listExternalLog(sql, { limit: 50, method: 'POST' });
  assert.ok(posts.every((r) => r.method === 'POST'));
  const rejected = await listExternalLog(sql, { limit: 50, rejectedOnly: true });
  assert.ok(rejected.every((r) => r.statusCode >= 400));
  const byReq = await listExternalLog(sql, { limit: 50, requestId: id });
  assert.ok(byReq.every((r) => r.requestId === id));
});

test('recordExternalCall — EXTERNAL_API_LOG=off이면 아무것도 쓰지 않는다', async () => {
  const prev = process.env.EXTERNAL_API_LOG;
  process.env.EXTERNAL_API_LOG = 'off';
  try {
    await recordExternalCall({ method: 'GET', path: P + '/off-test', statusCode: 200, outcome: 'ok' });
    const rows = await listExternalLog(sql, { limit: 50 });
    assert.equal(rows.filter((r) => r.path === P + '/off-test').length, 0);
  } finally {
    if (prev === undefined) delete process.env.EXTERNAL_API_LOG; else process.env.EXTERNAL_API_LOG = prev;
  }
});
