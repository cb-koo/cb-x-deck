import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExaClient } from './exa.ts';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

const OK_BODY = {
  results: [
    { title: '毛穴ケア特集', url: 'https://ex.jp/a', publishedDate: '2026-06-01T00:00:00.000Z', text: '本文…' },
    { title: null, url: 'https://ex.jp/b', text: 'タイトル無し' }, // title/date 결측 허용
  ],
};

test('search: POST /search에 x-api-key·본문 포함, 결과 매핑·결측 필드 안전', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: OK_BODY }]);
  const c = new ExaClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const results = await c.search('毛穴 トレンド', { numResults: 8, maxCharacters: 2000 });

  assert.equal(calls[0].url, 'https://api.exa.ai/search');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>)['x-api-key'], 'k');
  const sent = JSON.parse(String(calls[0].init?.body));
  assert.equal(sent.query, '毛穴 トレンド');
  assert.equal(sent.numResults, 8);
  assert.equal(sent.contents.text.maxCharacters, 2000);

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    title: '毛穴ケア特集', url: 'https://ex.jp/a',
    publishedDate: '2026-06-01T00:00:00.000Z', text: '本文…',
  });
  assert.equal(results[1].title, null);
  assert.equal(results[1].publishedDate, null);
});

test('429/5xx → 재시도 후 성공', async () => {
  const { fn, calls } = fakeFetch([
    { status: 429, body: {} },
    { status: 502, body: {} },
    { status: 200, body: OK_BODY },
  ]);
  const c = new ExaClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  const results = await c.search('a');
  assert.equal(results.length, 2);
  assert.equal(calls.length, 3);
});

test('401 → ExaAuthError, 재시도 없음', async () => {
  const { fn, calls } = fakeFetch([{ status: 401, body: { error: 'bad key' } }]);
  const c = new ExaClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {} });
  await assert.rejects(() => c.search('a'), (e: Error) => e.name === 'ExaAuthError');
  assert.equal(calls.length, 1);
});

test('재시도 소진 시 에러', async () => {
  const { fn } = fakeFetch([
    { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} },
  ]);
  const c = new ExaClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, maxRetries: 2 });
  await assert.rejects(() => c.search('a'), /500.*after 2 retries/);
});
