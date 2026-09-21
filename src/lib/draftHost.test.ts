import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickedHandleNotice } from './draftHost';

test('폼이 비어 있으면 원고의 주인으로 채운다', () => {
  assert.deepEqual(pickedHandleNotice(null, 'asyako0520'), { fill: 'asyako0520', notice: null });
});

test('원고에 주인이 없으면 채울 것도 알릴 것도 없다', () => {
  assert.deepEqual(pickedHandleNotice('toppogi0102', null), { fill: null, notice: null });
});

test('주인이 다르면 채우지 않고 사실을 알린다', () => {
  const r = pickedHandleNotice('toppogi0102', 'asyako0520');
  assert.equal(r.fill, null);
  assert.equal(r.notice, '이 원고는 @asyako0520으로 쓴 글이에요. @toppogi0102 작업에 붙이면 @toppogi0102 것이 돼요.');
});

test('같은 주인이면 아무 일도 없다', () => {
  assert.deepEqual(pickedHandleNotice('asyako0520', 'ASYAKO0520'), { fill: null, notice: null });
});
