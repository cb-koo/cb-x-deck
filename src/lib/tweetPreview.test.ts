import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { fetchTweetCached, loadTweetPreview, quotedFromTweet, TweetFetchError } from './tweetPreview.ts';

const sql = getSql();
const ids: string[] = [];
const nextId = () => { const id = `96${process.pid}${ids.length + 1}00000`; ids.push(id); return id; };
after(async () => { await sql`delete from tweet where tweet_id = any(${ids})`; await sql.end(); });

// raw 모양은 generateQuoteTarget.test.ts의 가짜 getTweetDetail 응답을 그대로 복사해 쓴다.
const rawOf = (id: string, text: string) => ({ id, text, author: { userName: 'target' } });

test('1) 캐시 없음 → X 1회 → 저장, 두 번째는 X를 부르지 않는다', async () => {
  const id = nextId();
  let calls = 0;
  const client = { getTweetDetail: async () => { calls++; return rawOf(id, '대상 본문'); } };
  const url = `https://x.com/clinic/status/${id}`;
  const a = await loadTweetPreview(sql, url, client);
  const b = await loadTweetPreview(sql, url, client);
  assert.equal(a.kind, 'ok');
  assert.equal(b.kind, 'ok');
  assert.equal(calls, 1);
});

test('2) 삭제·비공개(null) → unavailable, 잘못된 링크 → badLink', async () => {
  const client = { getTweetDetail: async () => null };
  assert.equal((await loadTweetPreview(sql, `https://x.com/a/status/${nextId()}`, client)).kind, 'unavailable');
  assert.equal((await loadTweetPreview(sql, 'https://example.com/x', client)).kind, 'badLink');
});

test('3) 인용 카드 어댑터 — 작성자·본문이 옮겨진다', () => {
  const q = quotedFromTweet({
    tweetId: '1', authorHandle: 'c', authorName: 'C', authorAvatarUrl: null, authorFollowers: null,
    text: 'hi', media: [], quoted: null,
    metrics: { likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: null,
  });
  assert.equal(q.id, '1'); assert.equal(q.screenName, 'c'); assert.equal(q.userName, 'C'); assert.equal(q.enriched.text, 'hi');
});

test('4) 순수 리포스트 링크 → repost', async () => {
  const id = nextId();
  const client = { getTweetDetail: async () => ({ ...rawOf(id, ''), retweeted_tweet: { id: 'orig' } }) };
  const r = await loadTweetPreview(sql, `https://x.com/a/status/${id}`, client);
  assert.equal(r.kind, 'repost');
});

test('5) 빈 본문 응답(리트윗은 아님) → noText', async () => {
  const id = nextId();
  const client = { getTweetDetail: async () => rawOf(id, '') };
  const r = await loadTweetPreview(sql, `https://x.com/a/status/${id}`, client);
  assert.equal(r.kind, 'noText');
});

test('5b) mapRawTweet이 아예 null(핸들 없음) → noText', async () => {
  const id = nextId();
  const client = { getTweetDetail: async () => ({ id, text: '본문은 있지만 핸들이 없음' }) };
  const r = await loadTweetPreview(sql, `https://x.com/a/status/${id}`, client);
  assert.equal(r.kind, 'noText');
});

test('6) 다른 게시물 id로 응답 → mismatch', async () => {
  const id = nextId();
  const client = { getTweetDetail: async () => rawOf('999999999999999', '다른 글') };
  const r = await loadTweetPreview(sql, `https://x.com/a/status/${id}`, client);
  assert.equal(r.kind, 'mismatch');
});

test('7) getTweetDetail이 던지면 TweetFetchError로 감싸 올린다(cause 보존)', async () => {
  const id = nextId();
  const upstream = new Error('upstream unavailable');
  const client = { getTweetDetail: async () => { throw upstream; } };
  await assert.rejects(loadTweetPreview(sql, `https://x.com/a/status/${id}`, client), (e: unknown) => {
    assert.ok(e instanceof TweetFetchError);
    assert.equal(e.cause, upstream);
    return true;
  });
});

test('8) 클라이언트를 만드는 함수는 캐시 미스에만 부른다 — 적중이면 만들지 않고, 만들다 실패하면 TweetFetchError', async () => {
  const id = nextId();
  let made = 0;
  const factory = () => { made++; return { getTweetDetail: async () => rawOf(id, '대상 본문') }; };
  assert.equal((await fetchTweetCached(sql, id, factory)).kind, 'ok');
  assert.equal((await fetchTweetCached(sql, id, factory)).kind, 'ok');
  assert.equal(made, 1);
  const missing = new Error('GETXAPI_KEY not set');
  await assert.rejects(fetchTweetCached(sql, nextId(), () => { throw missing; }), (e: unknown) => {
    assert.ok(e instanceof TweetFetchError);
    assert.equal(e.cause, missing);
    return true;
  });
});
