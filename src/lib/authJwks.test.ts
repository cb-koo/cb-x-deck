import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedJwks, invalidateJwks, __resetForTest } from './authJwks.ts';

const KEYS = { keys: [{ kid: 'k1', kty: 'EC', key_ops: ['verify'] }] };

// 호출 횟수를 세는 가짜 fetch. 응답 본문은 JWKS 모양이면 충분하다.
function fakeFetch(body: unknown, ok = true) {
  const calls = { n: 0 };
  const impl = (async () => {
    calls.n += 1;
    return { ok, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => { __resetForTest(); });

test('처음 부르면 받아오고, 두 번째부터는 캐시를 쓴다', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.equal(calls.n, 1, '캐시가 살아 있으면 네트워크를 다시 타지 않는다');
});

test('동시에 여러 번 불러도 fetch는 한 번만 — 콜드 스타트 직후 요청이 몰릴 때', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  const [a, b, c] = await Promise.all([getCachedJwks(impl), getCachedJwks(impl), getCachedJwks(impl)]);
  assert.deepEqual([a, b, c], [KEYS, KEYS, KEYS]);
  assert.equal(calls.n, 1, '진행 중인 요청을 공유해야 한다');
});

test('무효화하면 다음 호출에서 다시 받는다 — 키 회전 대비', async () => {
  const { impl, calls } = fakeFetch(KEYS);
  await getCachedJwks(impl);
  invalidateJwks();
  await getCachedJwks(impl);
  assert.equal(calls.n, 2);
});

test('실패하면 null — 던지지 않는다(인증이 죽으면 안 된다)', async () => {
  const bad = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.equal(await getCachedJwks(bad), null);
  // 실패를 캐시하지 않는다 — 다음 요청에서 다시 시도해야 한다
  const { impl, calls } = fakeFetch(KEYS);
  assert.deepEqual(await getCachedJwks(impl), KEYS);
  assert.equal(calls.n, 1);
});

test('키가 비어 있으면 null — 쓸 수 없는 응답을 캐시하지 않는다', async () => {
  const { impl } = fakeFetch({ keys: [] });
  assert.equal(await getCachedJwks(impl), null);
});
