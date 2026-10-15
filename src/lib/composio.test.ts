import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposioClient, ComposioError, googleAdsFromEnv } from './composio.ts';

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, client: new ComposioClient({ apiKey: 'ak_test', fetchImpl }) };
}

test('proxy: 프로젝트 키·연결 계정을 실어 보내고 대상 응답 본문만 돌려준다', async () => {
  const { calls, client } = stub(200, { data: { resourceNames: ['customers/1'] }, status: 200 });
  const data = await client.proxy({ endpoint: 'https://x/y', connectedAccountId: 'ca_1' });
  assert.deepEqual(data, { resourceNames: ['customers/1'] });
  assert.equal(calls[0].url, 'https://backend.composio.dev/api/v3/tools/execute/proxy');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-api-key'], 'ak_test');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    endpoint: 'https://x/y', method: 'GET', connected_account_id: 'ca_1',
  });
});

test('proxy: 대상 API가 4xx면 Composio가 200을 줘도 오류로 던진다', async () => {
  const { client } = stub(200, { data: { error: 'bad' }, status: 400 });
  await assert.rejects(client.proxy({ endpoint: 'https://x', connectedAccountId: 'ca_1' }),
    (e: unknown) => e instanceof ComposioError && e.status === 400);
});

test('proxy: Composio 자체 401은 그 메시지로 던진다', async () => {
  const { client } = stub(401, { error: { message: 'Invalid API key' } });
  await assert.rejects(client.proxy({ endpoint: 'https://x', connectedAccountId: 'ca_1' }), /Invalid API key/);
});

test('googleAdsFromEnv: 둘 중 하나라도 없으면 던진다', () => {
  assert.throws(() => googleAdsFromEnv({ GOOGLE_ADS_CUSTOMER_ID: '1' }), ComposioError);
  assert.deepEqual(
    googleAdsFromEnv({ GOOGLE_ADS_CUSTOMER_ID: '1', COMPOSIO_GOOGLEADS_ACCOUNT_ID: 'ca_1' }),
    { customerId: '1', connectedAccountId: 'ca_1' });
});

test('tool: 기본 도구는 버전·user_id를 실어 보내고, 실패(successful:false)는 오류로', async () => {
  const ok = stub(200, { data: { images_results: [{ title: 'x' }] }, successful: true });
  const d = await ok.client.tool('COMPOSIO_SEARCH_IMAGE', '20260903_00', { query: 'q' });
  assert.deepEqual(d, { images_results: [{ title: 'x' }] });
  assert.equal(ok.calls[0].url, 'https://backend.composio.dev/api/v3/tools/execute/COMPOSIO_SEARCH_IMAGE');
  assert.deepEqual(JSON.parse(ok.calls[0].init.body as string), { arguments: { query: 'q' }, version: '20260903_00', user_id: 'default' });
  const bad = stub(200, { data: null, successful: false, error: 'quota' });
  await assert.rejects(() => bad.client.tool('COMPOSIO_SEARCH_IMAGE', 'v', {}), ComposioError);
});
