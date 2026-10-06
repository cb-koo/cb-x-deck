import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetxapiClient } from './getxapi.ts';
import { fetchPost } from './postMetrics.ts';

const RAW = {
  id: '123', text: '테스트 본문', createdAt: 'Mon Jul 06 12:00:00 +0000 2026',
  author: { userName: 'someone', id: '3073254355' },
  viewCount: 1000, likeCount: 10, retweetCount: 2, replyCount: 1, quoteCount: 0, bookmarkCount: 5,
};
const mk = (fn: (u: string) => Promise<Response>) =>
  new GetxapiClient({ apiKey: 'k', maxRetries: 0, sleep: async () => {}, fetchImpl: fn as typeof fetch });

test('ok: 지표 6종·핸들·본문·게시시각 매핑', async () => {
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: RAW }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.post.metrics, { views: 1000, likes: 10, retweets: 2, replies: 1, bookmarks: 5, quotes: 0 });
  assert.equal(r.post.authorHandle, 'someone');
  assert.equal(r.post.authorUserId, '3073254355');
  assert.equal(r.post.postedAt, '2026-07-06T12:00:00.000Z');
});

test('ok: author.id가 없으면 authorUserId는 null(핸들만 있는 응답도 흡수)', async () => {
  const raw = { ...RAW, author: { userName: 'someone' } };
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: raw }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.authorUserId, null);
});

test('unavailable: 404는 삭제·비공개 — error와 절대 섞이지 않는다', async () => {
  const r = await fetchPost('123', mk(async () => new Response('nf', { status: 404 })));
  assert.equal(r.kind, 'unavailable');
});

test('error: 네트워크 실패는 판단 불가', async () => {
  const r = await fetchPost('123', mk(async () => { throw new Error('conn reset'); }));
  assert.equal(r.kind, 'error');
});

test('error: 5xx 재시도 소진도 판단 불가 — unavailable 아님', async () => {
  const r = await fetchPost('123', mk(async () => new Response('boom', { status: 500 })));
  assert.equal(r.kind, 'error');
});

test('지표 결손은 null로 흡수(ok 유지)', async () => {
  const raw = { ...RAW, viewCount: undefined };
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: raw }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.metrics.views, null);
});

test('error: id 없는 기형 응답은 판단 불가', async () => {
  const raw = { ...RAW, id: undefined };
  const r = await fetchPost('123', mk(async () => new Response(JSON.stringify({ data: raw }), { status: 200 })));
  assert.equal(r.kind, 'error');
});

test('ok: 리포스트 링크는 원본 트윗의 id·본문·지표로 — addByLink.ts와 동일 정책', async () => {
  const wrapper = {
    id: '999', text: '', createdAt: 'Mon Jan 05 00:00:00 +0000 2026',
    author: { userName: 'reposter' },
    viewCount: 1, likeCount: 0, retweetCount: 0, replyCount: 0, quoteCount: 0, bookmarkCount: 0,
    retweeted_tweet: RAW,
  };
  const r = await fetchPost('999', mk(async () => new Response(JSON.stringify({ data: wrapper }), { status: 200 })));
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.post.tweetId, '123');
  assert.equal(r.post.authorHandle, 'someone');
  assert.equal(r.post.text, '테스트 본문');
  assert.deepEqual(r.post.metrics, { views: 1000, likes: 10, retweets: 2, replies: 1, bookmarks: 5, quotes: 0 });
});

// 깨진 글자(U+FFFD) — getxapi가 가끔 일본어 본문을 �로 깨뜨려 보낸다. 다시 조회하면 정상으로 오기도 한다(스펙 §10).
const seq = (texts: string[]) => {
  let calls = 0;
  const client = mk(async () => {
    const text = texts[Math.min(calls, texts.length - 1)];
    calls++;
    return new Response(JSON.stringify({ data: { ...RAW, text } }), { status: 200 });
  });
  return { client, calls: () => calls };
};

test('깨진 글자: 첫 응답이 깨졌고 다시 조회하면 정상 → 정상 본문', async () => {
  const s = seq(['見\uFFFD\uFFFD\uFFFDもり', '見積もり']);
  const r = await fetchPost('123', s.client);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.text, '見積もり');
  assert.equal(s.calls(), 2);
});

test('깨진 글자: 두 번 다 깨지면 그대로 돌려준다(실패로 바꾸지 않는다)', async () => {
  const s = seq(['見\uFFFDもり', '見\uFFFDもり']);
  const r = await fetchPost('123', s.client);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.text, '見\uFFFDもり');
  assert.equal(s.calls(), 2);
});

test('깨진 글자: 다시 조회가 실패하면 첫 응답 그대로', async () => {
  let calls = 0;
  const client = mk(async () => {
    calls++;
    if (calls > 1) throw new Error('conn reset');
    return new Response(JSON.stringify({ data: { ...RAW, text: '見\uFFFDもり' } }), { status: 200 });
  });
  const r = await fetchPost('123', client);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.post.text, '見\uFFFDもり');
});

test('깨진 글자: 정상 본문이면 한 번만 조회한다(비용)', async () => {
  const s = seq(['見積もり']);
  await fetchPost('123', s.client);
  assert.equal(s.calls(), 1);
});
