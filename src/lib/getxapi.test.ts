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
  const { fn } = fakeFetch([{ status: 200, body: { status: 'success', data: { id: '99', userName: 'x', name: 'X', followers: 5, profilePicture: null, description: '뷰티 인플루언서' } } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const u = await c.getUserInfo('x');
  assert.equal(u.id, '99');
  assert.equal(u.followers, 5);
  assert.equal(u.description, '뷰티 인플루언서');
});

test('getUserInfo: description 없으면 null', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { data: { id: '1', userName: 'x' } } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const u = await c.getUserInfo('x');
  assert.equal(u.description, null);
});

test('getTweetDetail: 200이면 data 반환, id 파라미터 사용', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { status: 'ok', data: { id: '7', text: 'q' } } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const raw = await c.getTweetDetail('7');
  assert.equal((raw as { id: string }).id, '7');
  assert.match(calls[0], /\/twitter\/tweet\/detail\?id=7/);
});

test('getTweetDetail: 404/400은 재시도 없이 null (삭제·비공개 인용)', async () => {
  for (const status of [404, 400]) {
    const { fn, calls } = fakeFetch([{ status, body: { error: 'nope' } }]);
    const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
    assert.equal(await c.getTweetDetail('8'), null);
    assert.equal(calls.length, 1);
  }
});

test('getTweetDetail: data 없는 200(응답 이상)도 null', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { status: 'ok' } }]);
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  assert.equal(await c.getTweetDetail('9'), null);
});

function fakeFetchJson(payload: unknown, urls: string[]): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

test('getTweetReplies/Thread: 경로·tweetId·cursor + tweets/replies/data 키 정규화', async () => {
  const urls: string[] = [];
  const c1 = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ tweets: [{ id: '1' }], has_more: true, next_cursor: 'N' }, urls), sleep: async () => {} });
  const p1 = await c1.getTweetReplies('T1', 'CUR');
  assert.match(urls[0], /\/twitter\/tweet\/replies\?/);
  assert.match(urls[0], /id=T1/); // 실계약: tweetId가 아니라 id (400 Missing required query param: id 로 확인)
  assert.match(urls[0], /cursor=CUR/);
  assert.deepEqual(p1, { tweets: [{ id: '1' }], has_more: true, next_cursor: 'N' });

  const c2 = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ replies: [{ id: '2' }] }, []), sleep: async () => {} });
  const p2 = await c2.getTweetThread('T2');
  assert.deepEqual(p2, { tweets: [{ id: '2' }], has_more: false, next_cursor: null });
});

test('getTweetRetweeters: users/retweeters/data 키 정규화', async () => {
  const urls: string[] = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fakeFetchJson({ retweeters: [{ userName: 'u1' }], has_more: false, next_cursor: '' }, urls), sleep: async () => {} });
  const p = await c.getTweetRetweeters('T3');
  assert.match(urls[0], /\/twitter\/tweet\/retweeters\?/);
  assert.deepEqual(p, { users: [{ userName: 'u1' }], has_more: false, next_cursor: null }); // 빈 문자열 커서 → null
});

test('onUsage: 성공 호출마다 operation과 함께 콜백', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { has_more: false, next_cursor: null, tweets: [] } }]);
  const events: Array<{ operation: string; ok: boolean; status: number }> = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, onUsage: (e) => events.push(e) });
  await c.searchTweets('a');
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'getxapi.search');
  assert.equal(events[0].ok, true);
});

test('onUsage: userInfo operation 파생', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { data: { id: '1', userName: 'x' } } }]);
  const events: Array<{ operation: string }> = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, onUsage: (e) => events.push(e) });
  await c.getUserInfo('x');
  assert.equal(events[0].operation, 'getxapi.userInfo');
});
