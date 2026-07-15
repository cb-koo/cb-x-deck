import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapRawTweet, mapRawUser } from './mappers.ts';

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
  // 검색 응답 실제 키는 name/screen_name — 과거 userName 키도 폴백으로 수용
  const t = mapRawTweet({
    id: '1', text: 'x', author: { userName: 'u' },
    quoted_tweet: { id: '2', text: 'inner', user: { name: '이름', screen_name: 'handle1' } },
  });
  assert.deepEqual(t!.quoted, { id: '2', text: 'inner', userName: '이름', screenName: 'handle1' });
  const legacy = mapRawTweet({
    id: '1', text: 'x', author: { userName: 'u' },
    quoted_tweet: { id: '2', text: 'inner', user: { userName: 'qq' } },
  });
  assert.deepEqual(legacy!.quoted, { id: '2', text: 'inner', userName: 'qq', screenName: null });
});

test('실 픽스처 quoted: 이름·핸들이 채워진다 (userName null 전량 버그 재발 방지)', () => {
  const withQuoted = fixture.tweets.filter((r: Record<string, unknown>) => r.quoted_tweet);
  assert.ok(withQuoted.length > 0);
  for (const raw of withQuoted) {
    const t = mapRawTweet(raw);
    if (!t?.quoted) continue;
    assert.ok(t.quoted.userName, `quoted.userName 비어 있음: ${JSON.stringify(t.quoted)}`);
    assert.ok(t.quoted.screenName, `quoted.screenName 비어 있음`);
  }
});

test('리트윗(retweeted_tweet 있음)은 null', () => {
  assert.equal(mapRawTweet({ id: '1', text: 'RT', author: { userName: 'u' }, retweeted_tweet: { id: '2' } }), null);
});

test('author 없으면 null', () => {
  assert.equal(mapRawTweet({ id: '1', text: 'x' }), null);
});

test('mapRawUser: 핸들 필수, screen_name 폴백, 필드 매핑', () => {
  assert.deepEqual(mapRawUser({ userName: 'u', name: 'N', profilePicture: 'p', followers: 5 }),
    { handle: 'u', name: 'N', avatarUrl: 'p', followers: 5 });
  assert.deepEqual(mapRawUser({ screen_name: 's' }),
    { handle: 's', name: null, avatarUrl: null, followers: null });
  assert.equal(mapRawUser({ name: '핸들없음' }), null);
});
