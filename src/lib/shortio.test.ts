import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShortioClient, isShortioConfigured, makeShortioClient } from './shortio.ts';

// 가짜 fetch — 호출 순서대로 응답을 소비한다(postMetrics.test 관례)
function fakeFetch(responses: Array<Response | Error>): { fn: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('가짜 fetch 응답 소진');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (responses: Array<Response | Error>) => {
  const f = fakeFetch(responses);
  return { client: new ShortioClient({ apiKey: 'k', domain: 'cb.link', fetchImpl: f.fn, sleep: async () => {}, maxRetries: 2 }), calls: f.calls };
};

test('1) createLink 성공 — 도메인·경로·인증 헤더가 실리고 idString/shortURL을 돌려준다', async () => {
  const { client, calls } = make([json(200, { idString: 'lnk_1', shortURL: 'https://cb.link/a3k9x2' })]);
  const r = await client.createLink({ originalUrl: 'https://c.example.com/?utm_source=x', path: 'a3k9x2', title: 'hana · camp' });
  assert.deepEqual(r, { kind: 'ok', linkId: 'lnk_1', shortUrl: 'https://cb.link/a3k9x2' });
  assert.equal(calls[0].url, 'https://api.short.io/links');
  const headers = calls[0].init!.headers as Record<string, string>;
  assert.equal(headers.authorization, 'k');
  const body = JSON.parse(String(calls[0].init!.body));
  assert.deepEqual(body, { domain: 'cb.link', originalURL: 'https://c.example.com/?utm_source=x', path: 'a3k9x2', title: 'hana · camp' });
});

test('2) createLink 409 → conflict (경로 충돌 — 호출부가 코드 재생성)', async () => {
  const { client } = make([json(409, { error: 'Link already exists' })]);
  assert.deepEqual(await client.createLink({ originalUrl: 'https://a.b/', path: 'dup000' }), { kind: 'conflict' });
});

test('3) createLink — 5xx는 재시도 후 소진되면 error, 네트워크 예외도 error', async () => {
  const a = make([json(500, {}), json(500, {}), json(500, {})]); // maxRetries=2 → 3회 시도 후 포기
  assert.deepEqual(await a.client.createLink({ originalUrl: 'https://a.b/', path: 'x' }), { kind: 'error' });
  assert.equal(a.calls.length, 3);
  const b = make([new Error('ECONNRESET'), json(200, { idString: 'lnk_2', shortURL: 'https://cb.link/y' })]);
  assert.equal((await b.client.createLink({ originalUrl: 'https://a.b/', path: 'y' })).kind, 'ok'); // 재시도로 회복
  const c = make([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
  assert.deepEqual(await c.client.createLink({ originalUrl: 'https://a.b/', path: 'z2' }), { kind: 'error' });
  assert.equal(c.calls.length, 3);
});

test('4) createLink — 200인데 필수 필드가 없으면 error (성공 위장 금지)', async () => {
  const { client } = make([json(200, { ok: true })]);
  assert.deepEqual(await client.createLink({ originalUrl: 'https://a.b/', path: 'z' }), { kind: 'error' });
});

test('5) getLinkStats — 성공/404/5xx 3분기가 절대 섞이지 않는다', async () => {
  const a = make([json(200, { totalClicks: 128, humanClicks: 120 })]);
  const ok = await a.client.getLinkStats('lnk_1');
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    assert.equal(ok.totalClicks, 128);
    assert.equal(ok.humanClicks, 120);
    assert.deepEqual(ok.raw, { totalClicks: 128, humanClicks: 120 });
  }
  assert.equal(a.calls[0].url, 'https://api-v2.short.io/statistics/link/lnk_1?period=total');
  const b = make([json(404, {})]);
  assert.deepEqual(await b.client.getLinkStats('gone'), { kind: 'unavailable' });
  const c = make([json(500, {}), json(500, {}), json(500, {})]);
  assert.deepEqual(await c.client.getLinkStats('x'), { kind: 'error' });
  // 실계약(스모크 2026-08-24): 모르는 링크는 404가 아니라 500 + "not found" 본문 — unavailable로 분류
  const nf = { error: 'Upstream client error: Link lnk_missing_0000 not found' };
  const d = make([json(500, nf), json(500, nf), json(500, nf)]);
  assert.deepEqual(await d.client.getLinkStats('lnk_missing_0000'), { kind: 'unavailable' });
});

test('6) getLinkStats — 클릭 필드가 숫자가 아니면 null (결손 허용, 오류 아님)', async () => {
  const { client } = make([json(200, { totalClicks: 'n/a' })]);
  const r = await client.getLinkStats('lnk_1');
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') { assert.equal(r.totalClicks, null); assert.equal(r.humanClicks, null); }
});

test('7) 설정 판정 — env 둘 다 있어야 configured, 누락 시 makeShortioClient는 던진다', () => {
  const saved = { key: process.env.SHORTIO_API_KEY, domain: process.env.SHORTIO_DOMAIN };
  try {
    process.env.SHORTIO_API_KEY = 'k'; process.env.SHORTIO_DOMAIN = 'cb.link';
    assert.equal(isShortioConfigured(), true);
    delete process.env.SHORTIO_DOMAIN;
    assert.equal(isShortioConfigured(), false);
    assert.throws(() => makeShortioClient());
  } finally {
    if (saved.key === undefined) delete process.env.SHORTIO_API_KEY; else process.env.SHORTIO_API_KEY = saved.key;
    if (saved.domain === undefined) delete process.env.SHORTIO_DOMAIN; else process.env.SHORTIO_DOMAIN = saved.domain;
  }
});
