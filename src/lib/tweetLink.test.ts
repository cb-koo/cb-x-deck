import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tweetPermalink, parseTweetLink, tweetLinkParseMessage } from './tweetLink.ts';

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

// 스냅샷 없는 브리핑 인용은 핸들이 없다 — ID만으로 된 X 해석 가능 형식으로 떨어진다. (설계 §F)
test('tweetPermalink — 핸들이 null이면 ID만으로 된 링크를 만든다', () => {
  assert.equal(tweetPermalink(null, '1234567890'), 'https://x.com/i/status/1234567890');
});

test('tweetPermalink — 핸들이 undefined면 ID만으로 된 링크를 만든다', () => {
  assert.equal(tweetPermalink(undefined, '1234567890'), 'https://x.com/i/status/1234567890');
});

test('tweetPermalink — 핸들이 빈 문자열이거나 @만 있어도 ID만으로 된 링크를 만든다', () => {
  assert.equal(tweetPermalink('', '1234567890'), 'https://x.com/i/status/1234567890');
  assert.equal(tweetPermalink('@', '1234567890'), 'https://x.com/i/status/1234567890');
});

test('parseTweetLink: 표준 트윗 링크 — 꼬리·쿼리·서브도메인·스킴 없음 모두 ID로', () => {
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('x.com/hadakan__/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://twitter.com/hadakan__/status/1790123456789012345?s=20&t=abc'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://www.x.com/hadakan__/status/1790123456789012345/photo/1'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('mobile.twitter.com/hadakan__/status/1790123456789012345/video/1'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('  https://x.com/a_b/status/123  '), { ok: true, tweetId: '123' });
});

test('parseTweetLink: X 앱 공유 형태(/i/status, /i/web/status)와 레거시(/statuses)', () => {
  assert.deepEqual(parseTweetLink('https://x.com/i/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://x.com/i/web/status/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
  assert.deepEqual(parseTweetLink('https://twitter.com/statuses/1790123456789012345'),
    { ok: true, tweetId: '1790123456789012345' });
});

test('parseTweetLink: X 링크지만 트윗이 아니면 notTweet', () => {
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/with_replies'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/search?q=abc'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/hadakan__/status/abc'), { ok: false, reason: 'notTweet' });
  assert.deepEqual(parseTweetLink('https://x.com/'), { ok: false, reason: 'notTweet' });
});

test('parseTweetLink: X 밖 도메인·형식 오류는 invalid, 빈 입력은 empty', () => {
  assert.deepEqual(parseTweetLink('https://example.com/a/status/123'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink('1790123456789012345'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink('@hadakan__'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseTweetLink(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseTweetLink('   '), { ok: false, reason: 'empty' });
});

test('tweetLinkParseMessage: 사유별 사용자 문구', () => {
  assert.match(tweetLinkParseMessage('empty'), /링크/);
  assert.match(tweetLinkParseMessage('notTweet'), /공유/);
  assert.match(tweetLinkParseMessage('invalid'), /x\.com/);
});
