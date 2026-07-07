import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapRawTweet } from './mappers.ts';

const fixture = JSON.parse(readFileSync('fixtures/search-response.json', 'utf8'));

test('실 픽스처 전건 매핑: id·핸들·지표·ISO 날짜', () => {
  for (const raw of fixture.tweets) {
    const t = mapRawTweet(raw);
    if (t === null) continue; // 리트윗 등 스킵 항목
    assert.ok(t.tweetId.length > 0);
    assert.ok(t.authorHandle.length > 0);
    assert.equal(typeof t.metrics.views, 'number');
    if (t.tweetCreatedAt) assert.ok(!Number.isNaN(Date.parse(t.tweetCreatedAt)));
  }
});

test('레거시 createdAt("Mon Jul 06 23:29:44 +0000 2026") → ISO 변환', () => {
  const t = mapRawTweet({
    id: '1', text: 'x', createdAt: 'Mon Jul 06 23:29:44 +0000 2026',
    author: { userName: 'u', id: '9' },
  });
  assert.ok(t);
  assert.equal(t!.tweetCreatedAt, '2026-07-06T23:29:44.000Z');
});

test('quoted_tweet 축약형 매핑 + user 필드 방어', () => {
  const t = mapRawTweet({
    id: '1', text: 'x', author: { userName: 'u' },
    quoted_tweet: { id: '2', text: 'inner', user: { userName: 'qq' } },
  });
  assert.deepEqual(t!.quoted, { id: '2', text: 'inner', userName: 'qq' });
});

test('리트윗(retweeted_tweet 있음)은 null', () => {
  assert.equal(mapRawTweet({ id: '1', text: 'RT', author: { userName: 'u' }, retweeted_tweet: { id: '2' } }), null);
});

test('author 없으면 null', () => {
  assert.equal(mapRawTweet({ id: '1', text: 'x' }), null);
});
