import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleId, toggleAll, allSelected, pruneSelection, siblingWarning } from './draftSelection.ts';

test('toggleId: 없으면 넣고 있으면 뺀다 — 원본은 그대로', () => {
  const base = new Set(['a']);
  assert.deepEqual([...toggleId(base, 'b')], ['a', 'b']);
  assert.deepEqual([...toggleId(base, 'a')], []);
  assert.deepEqual([...base], ['a'], '입력 집합을 변형하지 않는다');
});

test('toggleAll: 보이는 것이 전부 선택돼 있으면 해제, 아니면 전부 선택', () => {
  assert.deepEqual([...toggleAll(new Set(), ['a', 'b'])], ['a', 'b']);
  assert.deepEqual([...toggleAll(new Set(['a']), ['a', 'b'])], ['a', 'b'], '일부만 선택 → 전부 선택');
  assert.deepEqual([...toggleAll(new Set(['a', 'b']), ['a', 'b'])], []);
});

test('toggleAll: 보이지 않는 선택은 건드리지 않는다', () => {
  // 'z'는 필터에 걸려 화면에 없다 — 전체 해제가 화면 밖 선택까지 지우면 안 된다
  assert.deepEqual([...toggleAll(new Set(['a', 'b', 'z']), ['a', 'b'])], ['z']);
});

test('allSelected: 보이는 것이 없으면 false', () => {
  assert.equal(allSelected(new Set(), []), false);
  assert.equal(allSelected(new Set(['a']), ['a']), true);
  assert.equal(allSelected(new Set(['a']), ['a', 'b']), false);
});

test('pruneSelection: 화면에서 사라진 id를 떨군다', () => {
  assert.deepEqual([...pruneSelection(new Set(['a', 'b']), ['b', 'c'])], ['b']);
});

test('siblingWarning: 같은 batchId가 2개 이상 함께 선택되면 그 최대 개수', () => {
  const rows = [
    { id: 'a', batchId: 'B1' }, { id: 'b', batchId: 'B1' }, { id: 'c', batchId: 'B1' },
    { id: 'd', batchId: 'B2' }, { id: 'e', batchId: null }, { id: 'f', batchId: null },
  ];
  assert.equal(siblingWarning(rows, new Set(['a', 'b', 'c'])), 3);
  assert.equal(siblingWarning(rows, new Set(['a', 'b'])), 2);
  assert.equal(siblingWarning(rows, new Set(['a', 'd'])), 1, '서로 다른 묶음은 형제가 아니다');
  assert.equal(siblingWarning(rows, new Set(['e', 'f'])), 1, 'batchId가 null인 단일 생성끼리는 형제가 아니다');
  assert.equal(siblingWarning(rows, new Set()), 0);
});
