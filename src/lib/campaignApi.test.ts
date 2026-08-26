import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toApiResult } from './campaignApi.ts';

test('1) 2xx → ok:true + 본문 그대로', async () => {
  const r = new Response(JSON.stringify({ id: 'x', total: { KRW: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await toApiResult<{ id: string }>(r), { ok: true, data: { id: 'x', total: { KRW: 1 } } });
});

test('2) 4xx/5xx → 서버 문구 그대로(넘겨짚지 않음), 본문이 JSON이 아니면 상태코드 문구', async () => {
  const bad = new Response(JSON.stringify({ error: '종료일이 시작일보다 앞이에요' }), { status: 400 });
  assert.deepEqual(await toApiResult(bad), { ok: false, error: '종료일이 시작일보다 앞이에요', status: 400 });
  const html = new Response('<html>Bad Gateway</html>', { status: 502 });
  assert.deepEqual(await toApiResult(html), { ok: false, error: '오류 502', status: 502 });
  const empty = new Response(null, { status: 404 });
  assert.deepEqual(await toApiResult(empty), { ok: false, error: '오류 404', status: 404 });
});
