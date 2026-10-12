import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from './data';
import { taskSectionOpen, type TaskSectionKey, type TaskSectionPrefs } from './task-presentation';
const waiting = seedData().tasks.find((task) => task.id === 'visit-waiting')!;
const confirmed = seedData().tasks.find((task) => task.id === 'visit-confirmed')!;
const visited = { ...confirmed, visited: true };
const uploaded = { ...visited, posted: true };
const keys: TaskSectionKey[] = ['history', 'consent', 'money', 'draft', 'memo', 'posting'];
const opened = (task: typeof waiting, preferences: TaskSectionPrefs = {}) =>
  keys.filter((key) => taskSectionOpen(task, key, preferences));

test('방문 단계에 필요한 카드만 기본으로 펼치고 카드 순서는 바꾸지 않는다', () => {
  assert.deepEqual(opened(waiting), []);
  assert.deepEqual(opened(confirmed), ['consent']);
  assert.deepEqual(opened(visited), ['draft', 'posting']);
  assert.deepEqual(opened(uploaded), ['money']);
  assert.deepEqual(opened({ ...uploaded, settlementActive: true }), ['money']);
  assert.deepEqual(opened({ ...uploaded, paid: true }), []);
  assert.deepEqual(opened({ ...waiting, end: { kind: '취소', reason: '일정 취소', at: '' } }), []);
});
test('직접 펼친 내역과 메모는 단계가 바뀌어도 유지한다', () => {
  const preferences: TaskSectionPrefs = {
    history: { open: true, stage: '대기' },
    memo: { open: true, stage: '대기' },
  };
  assert.deepEqual(opened(confirmed, preferences), ['history', 'consent', 'memo']);
  assert.deepEqual(opened(visited, preferences), ['history', 'draft', 'memo', 'posting']);
  assert.deepEqual(opened(uploaded, preferences), ['history', 'money', 'memo']);
});
test('현재 단계에서 닫은 카드는 그대로 닫고 새 관련 단계에 진입하면 펼친다', () => {
  assert.equal(taskSectionOpen(visited, 'posting', { posting: { open: false, stage: '방문' } }), false);
  assert.equal(taskSectionOpen(visited, 'posting', { posting: { open: false, stage: '확정' } }), true);
  assert.equal(taskSectionOpen(uploaded, 'money', { money: { open: false, stage: '방문' } }), true);
  assert.equal(taskSectionOpen(uploaded, 'posting', { posting: { open: true, stage: '방문' } }), true);
});
