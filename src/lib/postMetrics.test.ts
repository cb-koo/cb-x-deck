import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetxapiClient } from './getxapi.ts';
import { fetchPost } from './postMetrics.ts';

const RAW = {
  id: '123', text: '테스트 본문', createdAt: 'Mon Jul 06 12:00:00 +0000 2026',
  author: { userName: 'someone' },
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
  assert.equal(r.post.postedAt, '2026-07-06T12:00:00.000Z');
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
