import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetxapiClient } from './getxapi.ts';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  const fn = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

test('searchTweets: q 인코딩 + type=Top + Bearer 헤더로 GET', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { has_more: false, next_cursor: null, tweets: [] } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const page = await c.searchTweets('毛穴 min_faves:500');
  assert.equal(page.tweets.length, 0);
  assert.match(calls[0], /\/twitter\/tweet\/advanced_search\?/);
  assert.match(calls[0], /q=%E6%AF%9B%E7%A9%B4/);
  assert.match(calls[0], /type=Top/);
});

test('cursor 전달', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { has_more: false, next_cursor: null, tweets: [] } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  await c.searchTweets('a', 'CURSOR1');
  assert.match(calls[0], /cursor=CURSOR1/);
});

test('429 → 재시도 후 성공', async () => {
  const { fn, calls } = fakeFetch([
    { status: 429, body: {} },
    { status: 200, body: { has_more: false, next_cursor: null, tweets: [{ id: '1' }] } },
  ]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const page = await c.searchTweets('a');
  assert.equal(page.tweets.length, 1);
  assert.equal(calls.length, 2);
});

test('401 → GetxapiAuthError', async () => {
  const { fn } = fakeFetch([{ status: 401, body: { error: 'bad key' } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  await assert.rejects(() => c.searchTweets('a'), (e: Error) => e.name === 'GetxapiAuthError');
});

test('getUserInfo: data 언래핑', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { status: 'success', data: { id: '99', userName: 'x', name: 'X', followers: 5, profilePicture: null } } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const u = await c.getUserInfo('x');
  assert.equal(u.id, '99');
  assert.equal(u.followers, 5);
});
