import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getxapiActual, exaActual, getProviderActuals } from './actualCost.ts';

// 요청 URL → 응답 매핑 fake fetch
function fakeFetch(routes: Array<{ match: string; status?: number; body: unknown }>) {
  return (async (url: string | URL) => {
    const u = String(url);
    const r = routes.find((x) => u.includes(x.match)) ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}

const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  try { await fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
};

test('getxapiActual: /account/me 파싱', async () => {
  await withEnv({ GETXAPI_KEY: 'k' }, async () => {
    const f = fakeFetch([{ match: '/account/me', body: { credits_remaining: 38.1, credits_used: 24.3, total_requests: 21703 } }]);
    const out = await getxapiActual(f);
    assert.deepEqual(out, { creditsRemaining: 38.1, creditsUsed: 24.3, totalRequests: 21703 });
  });
});

test('getxapiActual: 키 없으면 null', async () => {
  await withEnv({ GETXAPI_KEY: '' }, async () => {
    assert.equal(await getxapiActual(fakeFetch([])), null);
  });
});

test('getxapiActual: 호출 실패면 null (throw 안 함)', async () => {
  await withEnv({ GETXAPI_KEY: 'k' }, async () => {
    const f = (async () => { throw new Error('network'); }) as typeof fetch;
    assert.equal(await getxapiActual(f), null);
  });
});

test('exaActual: 키목록→usage 파싱 + 예산', async () => {
  await withEnv({ EXA_SERVICE_KEY: 's' }, async () => {
    const f = fakeFetch([
      { match: '/team-management/api-keys/', body: { period: {}, total_cost_usd: 4.165 } }, // usage (더 구체적 경로 먼저)
      { match: '/team-management/api-keys', body: { apiKeys: [{ id: 'key_1', budgetCents: 5000, isOverBudget: false }] } },
    ]);
    const out = await exaActual(new Date('2026-06-23T00:00:00Z'), new Date('2026-07-23T00:00:00Z'), f);
    assert.equal(out?.totalCostUsd, 4.165);
    assert.equal(out?.budgetUsd, 50);
    assert.equal(out?.overBudget, false);
    assert.equal(out?.periodStart, '2026-06-23');
  });
});

test('exaActual: 키 없으면 null', async () => {
  await withEnv({ EXA_SERVICE_KEY: '' }, async () => {
    assert.equal(await exaActual(new Date(), new Date(), fakeFetch([])), null);
  });
});

test('getProviderActuals: 실패 시 카드별 폴백 + anthropic 안내', async () => {
  await withEnv({ GETXAPI_KEY: '', EXA_SERVICE_KEY: '' }, async () => {
    const out = await getProviderActuals(new Date(), new Date(), { fetchImpl: fakeFetch([]), now: () => 1 });
    const gx = out.find((c) => c.api === 'getxapi')!;
    const ex = out.find((c) => c.api === 'exa')!;
    const an = out.find((c) => c.api === 'anthropic')!;
    assert.equal(gx.actualUsd, null); assert.ok(gx.note);
    assert.equal(ex.actualUsd, null); assert.ok(ex.note);
    assert.equal(an.kind, 'estimate-only'); assert.ok(an.note);
  });
});
