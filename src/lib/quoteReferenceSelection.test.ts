import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordinaryQuoteReferences } from './quoteReferenceSelection.ts';

test('대상과 같은 글은 일반 참고에서 제외하고 나머지는 첫 선택 순서로 유지한다', () => {
  const rows = [{ tweetId: 'a' }, { tweetId: 'target' }, { tweetId: 'a' }, { tweetId: 'b' }];
  assert.deepEqual(ordinaryQuoteReferences(rows, 'target'), [rows[0], rows[3]]);
  assert.equal(rows.length, 4);
});

test('게시 전 대상에 링크가 생겨 9건이 되어도 선택을 조용히 버리지 않는다', () => {
  const rows = Array.from({ length: 8 }, (_, n) => ({ tweetId: String(n) }));
  assert.equal(ordinaryQuoteReferences(rows, null).length, 8);
  assert.equal(ordinaryQuoteReferences(rows, 'new-target').length + 1, 9);
  assert.equal(ordinaryQuoteReferences(rows, '0').length + 1, 8);
});

test('대상이 바뀌면 이전에 고른 참고 글을 새 대상 기준으로 다시 계산한다', () => {
  const rows = [{ tweetId: 'a' }, { tweetId: 'b' }];
  assert.deepEqual(ordinaryQuoteReferences(rows, 'a'), [rows[1]]);
  assert.deepEqual(ordinaryQuoteReferences(rows, 'b'), [rows[0]]);
});
