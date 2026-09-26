import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postedOnFromTweetId, postedOnFromTweetLink } from './tweetPostedOn.ts';

// 픽스처 id는 스노플레이크 공식((ms - 1288834974657) << 22)으로 직접 만든 값이다 — 한국 자정 경계 양쪽 1ms.
//  · 2102774990234451968 = 2026-09-23T14:59:59.999Z = 한국 9/23 23:59:59.999
//  · 2102774990238646272 = 2026-09-23T15:00:00.000Z = 한국 9/24 00:00:00.000
// 둘 다 UTC로는 9/23이다 — UTC로 자르면 둘째가 하루 밀린다(이 테스트가 한국 날짜 규칙을 못박는다).
test('postedOnFromTweetId — 한국 자정 경계: 직전 1ms는 전날, 자정부터는 다음 날', () => {
  assert.equal(postedOnFromTweetId('2102774990234451968'), '2026-09-23');
  assert.equal(postedOnFromTweetId('2102774990238646272'), '2026-09-24');
});

// X 공식 문서(Twitter IDs)의 예시 id — 2018-10-10T20:19:24.211Z 생성, 한국으로는 10/11 05:19
test('postedOnFromTweetId — X 문서 예시 id', () => {
  assert.equal(postedOnFromTweetId('1050118621198921728'), '2018-10-11');
});

test('postedOnFromTweetId — 하위 22비트(작업자·순번)는 날짜에 영향이 없다', () => {
  // 자정 id + (2^22 - 1): 같은 ms 안의 마지막 순번 — 여전히 9/24
  assert.equal(postedOnFromTweetId('2102774990242840575'), '2026-09-24');
});

test('postedOnFromTweetId — 숫자가 아니거나 비었거나 시각이 없는 id는 null', () => {
  assert.equal(postedOnFromTweetId(''), null);
  assert.equal(postedOnFromTweetId('abc'), null);
  assert.equal(postedOnFromTweetId('12a34'), null);
  assert.equal(postedOnFromTweetId('-2102774990238646272'), null);
  // 스노플레이크 이전(2010년 11월 전) 순번 id — 시각 성분이 0이라 날짜를 알 수 없다
  assert.equal(postedOnFromTweetId('20'), null);
  // 64비트를 넘는 값
  assert.equal(postedOnFromTweetId('99999999999999999999'), null);
});

test('postedOnFromTweetLink — 게시물 링크 형태면 id에서 날짜를, 아니면 null', () => {
  assert.equal(postedOnFromTweetLink('https://x.com/sakura_tokyo/status/2102774990238646272'), '2026-09-24');
  assert.equal(postedOnFromTweetLink('twitter.com/i/web/status/2102774990234451968?s=20'), '2026-09-23');
  assert.equal(postedOnFromTweetLink('https://x.com/sakura_tokyo'), null);        // 프로필 링크(status 아님)
  assert.equal(postedOnFromTweetLink('https://example.com/a/status/2102774990238646272'), null);
  assert.equal(postedOnFromTweetLink(''), null);
});
