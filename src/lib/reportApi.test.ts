import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReportMetrics } from './reportApi.ts';

const OK_BODY = JSON.stringify({
  meta: { clinic: { name: '블리비' }, period: { start: '2026-07-01', end: '2026-07-31', days: 31 }, generated_at: 'x' },
  current: { funnel: { active_customers: 1, new_customers: 1, consulted_customers: 1,
    reservers: { by_line_id: 1, by_name: 1 }, visitors: { by_line_id: 1, by_name: 1 } } },
});

function stub(status: number, body: string, capture?: { url?: string; headers?: Record<string, string> }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (capture) { capture.url = String(input); capture.headers = Object.fromEntries(new Headers(init?.headers).entries()); }
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('URL 조립 — 파라미터·인코딩·키 헤더', async () => {
  const cap: { url?: string; headers?: Record<string, string> } = {};
  const r = await fetchReportMetrics(
    { clinic: 'velybjp', start: '2026-07-01', end: '2026-07-31', dateBasis: 'both', compare: 'none', groupBy: 'branch' },
    { fetchFn: stub(200, OK_BODY, cap), apiKey: 'k1' });
  assert.equal(r.kind, 'ok');
  const u = new URL(cap.url!);
  assert.equal(u.searchParams.get('clinic'), 'velybjp');
  assert.equal(u.searchParams.get('date_basis'), 'both');
  assert.equal(u.searchParams.get('compare'), 'none');
  assert.equal(u.searchParams.get('group_by'), 'branch');
  assert.equal(cap.headers!['x-api-key'], 'k1');
});

test('오류 매핑 — 429는 rate_limited, 4xx는 본문 error 메시지', async () => {
  assert.deepEqual(await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' },
    { fetchFn: stub(429, '{}'), apiKey: 'k' }), { kind: 'rate_limited' });
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' },
    { fetchFn: stub(404, JSON.stringify({ error: '없는 클리닉' })), apiKey: 'k' });
  assert.deepEqual(e, { kind: 'error', status: 404, message: '없는 클리닉' });
});

test('네트워크 예외 → error(status 0)', async () => {
  const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' }, { fetchFn: boom, apiKey: 'k' });
  assert.equal(e.kind, 'error');
});

test('키 미설정이면 호출 전에 실패한다', async () => {
  const prev = process.env.REPORT_API_KEY; delete process.env.REPORT_API_KEY;
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' });
  assert.equal(e.kind, 'error');
  if (prev !== undefined) process.env.REPORT_API_KEY = prev;
});
