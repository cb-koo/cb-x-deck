import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tweetPermalink } from './tweetLink.ts';

test('tweetPermalink — 핸들과 ID로 x.com 정규 링크를 만든다', () => {
  assert.equal(tweetPermalink('nintendo', '1234567890'), 'https://x.com/nintendo/status/1234567890');
});

test('tweetPermalink — 표시용 @ 접두사가 붙어 들어와도 링크가 깨지지 않는다', () => {
  assert.equal(tweetPermalink('@nintendo', '1234567890'), 'https://x.com/nintendo/status/1234567890');
});

test('tweetPermalink — 도메인은 항상 x.com (twitter.com 아님)', () => {
  const url = tweetPermalink('nintendo', '1');
  assert.ok(url.startsWith('https://x.com/'), url);
  assert.ok(!url.includes('twitter.com'), url);
});
