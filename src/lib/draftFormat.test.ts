import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatForPosts, addSlot, removeSlot } from './draftFormat.ts';

test('formatForPosts: 2칸 이상이면 스레드', () => {
  assert.equal(formatForPosts(1), 'single');
  assert.equal(formatForPosts(2), 'thread');
  assert.equal(formatForPosts(5), 'thread');
  assert.equal(formatForPosts(0), 'single', '0칸은 저장될 수 없지만 파생은 정의돼 있어야 한다');
});

test('addSlot: 끝에 빈 값을 붙인다 — 원본 불변', () => {
  const texts = ['첫 칸'];
  assert.deepEqual(addSlot(texts, ''), ['첫 칸', '']);
  assert.deepEqual(texts, ['첫 칸']);
  assert.deepEqual(addSlot([['a']], []), [['a'], []]);
});

test('removeSlot: 해당 인덱스만 뺀다 — 원본 불변', () => {
  const texts = ['a', 'b', 'c'];
  assert.deepEqual(removeSlot(texts, 1), ['a', 'c']);
  assert.deepEqual(texts, ['a', 'b', 'c']);
});

test('removeSlot: 범위 밖 인덱스는 그대로 돌려준다', () => {
  assert.deepEqual(removeSlot(['a'], 5), ['a']);
  assert.deepEqual(removeSlot(['a'], -1), ['a']);
});
