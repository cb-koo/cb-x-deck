import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTweetText } from './tweetText.ts';

test('평문은 text 토큰 하나', () => {
  assert.deepEqual(tokenizeTweetText('こんにちは'), [{ type: 'text', value: 'こんにちは' }]);
});

test('멘션: @핸들 → handle 추출, 이메일은 제외', () => {
  assert.deepEqual(tokenizeTweetText('cc @hadakan__ さん'), [
    { type: 'text', value: 'cc ' },
    { type: 'mention', value: '@hadakan__', handle: 'hadakan__' },
    { type: 'text', value: ' さん' },
  ]);
  assert.deepEqual(tokenizeTweetText('mail: a@b.com'), [{ type: 'text', value: 'mail: a@b.com' }]);
});

test('해시태그: 일본어·한국어·영숫자, 전각＃ 포함', () => {
  assert.deepEqual(tokenizeTweetText('#スキンケア 最高'), [
    { type: 'hashtag', value: '#スキンケア', tag: 'スキンケア' },
    { type: 'text', value: ' 最高' },
  ]);
  assert.deepEqual(tokenizeTweetText('＃레티놀'), [{ type: 'hashtag', value: '＃레티놀', tag: '레티놀' }]);
});

test('URL: 링크화 + 일본어 문장부호·괄호 꼬리 제거', () => {
  assert.deepEqual(tokenizeTweetText('詳細→https://t.co/abc123。'), [
    { type: 'text', value: '詳細→' },
    { type: 'url', value: 'https://t.co/abc123', href: 'https://t.co/abc123' },
    { type: 'text', value: '。' },
  ]);
  assert.deepEqual(tokenizeTweetText('(https://x.com/a)'), [
    { type: 'text', value: '(' },
    { type: 'url', value: 'https://x.com/a', href: 'https://x.com/a' },
    { type: 'text', value: ')' },
  ]);
});

test('혼합: 줄바꿈 유지, 토큰 순서 보존', () => {
  assert.deepEqual(tokenizeTweetText('#新作\n@shiro_cosme https://example.com'), [
    { type: 'hashtag', value: '#新作', tag: '新作' },
    { type: 'text', value: '\n' },
    { type: 'mention', value: '@shiro_cosme', handle: 'shiro_cosme' },
    { type: 'text', value: ' ' },
    { type: 'url', value: 'https://example.com', href: 'https://example.com' },
  ]);
});

test('빈 문자열 → 빈 배열', () => {
  assert.deepEqual(tokenizeTweetText(''), []);
});
