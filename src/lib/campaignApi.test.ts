import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toApiResult, fetchCampaigns } from './campaignApi.ts';

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

// `call`은 export하지 않는다(브리핑의 Produces 표면을 늘리지 않으려고) — 대신 exported 함수(fetchCampaigns)를 통해
// globalThis.fetch를 스텁해 경계 동작(401 재던지기 vs 그 외 예외를 네트워크 오류로 매핑)을 검증한다.
test('3) 401 → apiFetch가 던진 unauthorized를 그대로 재던짐(네트워크 오류로 뭉개지 않음)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(fetchCampaigns(), (e: unknown) => e instanceof Error && e.message === 'unauthorized');
  } finally {
    globalThis.fetch = original;
  }
});

test('4) fetch 자체가 실패(네트워크 끊김 등) → ok:false 네트워크 오류 문구, status 0', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  try {
    assert.deepEqual(await fetchCampaigns(), {
      ok: false,
      error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요',
      status: 0,
    });
  } finally {
    globalThis.fetch = original;
  }
});
