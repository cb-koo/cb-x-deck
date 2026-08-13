import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KANBAN_ACTIVE, KANBAN_DONE, columnLimit, orderColumn, isDoneColumn } from './kanbanColumns.ts';

test('열 분류: 진행 3개 · 종착 2개, 겹치지 않고 빠짐도 없다', () => {
  assert.deepEqual(KANBAN_ACTIVE, ['draft', 'review', 'approved']);
  assert.deepEqual(KANBAN_DONE, ['delivered', 'unused']);
  assert.equal(KANBAN_ACTIVE.length + KANBAN_DONE.length, 5);
});

test('isDoneColumn: 결정이 끝난 상태만 true', () => {
  assert.equal(isDoneColumn('delivered'), true);
  assert.equal(isDoneColumn('unused'), true);
  assert.equal(isDoneColumn('draft'), false);
  assert.equal(isDoneColumn('approved'), false);
});

test('columnLimit: 진행 열은 넉넉히, 종착 열은 최근 몇 장만', () => {
  assert.equal(columnLimit('draft'), 50);
  assert.equal(columnLimit('review'), 50);
  assert.equal(columnLimit('approved'), 50);
  assert.equal(columnLimit('delivered'), 10);
  assert.equal(columnLimit('unused'), 10);
});

test('orderColumn: 방금 옮긴 카드를 맨 앞으로 — 나머지 순서는 그대로', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(orderColumn(rows, new Set(['c'])).map((r) => r.id), ['c', 'a', 'b', 'd']);
});

test('orderColumn: 고정이 여러 개면 원래 순서를 유지한 채 앞으로', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(orderColumn(rows, new Set(['d', 'b'])).map((r) => r.id), ['b', 'd', 'a', 'c']);
});

test('orderColumn: 고정이 없거나 이 열에 없으면 원본 그대로 — 원본 배열은 변형하지 않는다', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(orderColumn(rows, new Set()).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(orderColumn(rows, new Set(['zzz'])).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
});
