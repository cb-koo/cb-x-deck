import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropIndex, arrayMove, shiftFor, edgeScrollVelocity, type ColumnBox } from './deckReorder.ts';

// 폭이 제각각인 3개 컬럼: A[0,300) B[300,400) C[400,900)
const BOXES: ColumnBox[] = [
  { id: 'a', left: 0, width: 300 },
  { id: 'b', left: 300, width: 100 },
  { id: 'c', left: 400, width: 500 },
];

test('dropIndex — 제자리에 있으면 원래 인덱스', () => {
  assert.equal(dropIndex(BOXES, 0, 0), 0);
  assert.equal(dropIndex(BOXES, 1, 300), 1);
  assert.equal(dropIndex(BOXES, 2, 400), 2);
});

test('dropIndex — 맨 앞/맨 뒤 경계는 넘어가지 않는다', () => {
  assert.equal(dropIndex(BOXES, 2, -9999), 0);
  assert.equal(dropIndex(BOXES, 0, 9999), 2);
  assert.equal(dropIndex(BOXES, 0, -9999), 0);
  assert.equal(dropIndex(BOXES, 2, 9999), 2);
});

test('dropIndex — 다른 컬럼의 중심을 지나야 자리를 내준다 (폭 제각각)', () => {
  // 판정 기준은 '잡은 컬럼의 중심'. 중심 = draggedLeft + 잡은 컬럼 폭/2.
  // 상대 중심: A=150, B=350, C=650.
  // C는 폭 500이므로 중심 = draggedLeft + 250.
  assert.equal(dropIndex(BOXES, 2, 200), 2);   // 중심 450 → A·B 둘 다 지남
  assert.equal(dropIndex(BOXES, 2, 0), 1);     // 중심 250 → A만 지남
  assert.equal(dropIndex(BOXES, 2, -200), 0);  // 중심 50 → 아무것도 안 지남
  // A는 폭 300이므로 중심 = draggedLeft + 150.
  assert.equal(dropIndex(BOXES, 0, 100), 0);   // 중심 250 → B(350) 안 지남
  assert.equal(dropIndex(BOXES, 0, 250), 1);   // 중심 400 → B만 지남
  assert.equal(dropIndex(BOXES, 0, 600), 2);   // 중심 750 → B·C 둘 다 지남
});

test('arrayMove', () => {
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(arrayMove(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
});

test('shiftFor — 오른쪽으로 옮기면 사이 컬럼들이 잡은 컬럼의 폭만큼 왼쪽으로 당겨진다', () => {
  assert.deepEqual(shiftFor(BOXES, 0, 2), [0, -300, -300]);
  assert.deepEqual(shiftFor(BOXES, 0, 1), [0, -300, 0]);
});

test('shiftFor — 왼쪽으로 옮기면 사이 컬럼들이 오른쪽으로 밀린다', () => {
  assert.deepEqual(shiftFor(BOXES, 2, 0), [500, 500, 0]);
  assert.deepEqual(shiftFor(BOXES, 1, 0), [100, 0, 0]);
});

test('shiftFor — 제자리면 전부 0', () => {
  assert.deepEqual(shiftFor(BOXES, 1, 1), [0, 0, 0]);
});

test('edgeScrollVelocity — 가운데선 0, 가장자리로 갈수록 제곱으로 빨라진다', () => {
  // 뷰포트: left=0, width=1000 → 시작 250px 지점, 최고속 50px 지점
  assert.equal(edgeScrollVelocity(500, 0, 1000), 0);
  assert.equal(edgeScrollVelocity(250, 0, 1000), 0);   // 경계 = 아직 0
  assert.equal(edgeScrollVelocity(750, 0, 1000), 0);
  assert.ok(edgeScrollVelocity(100, 0, 1000) < 0);     // 왼쪽 = 음수
  assert.ok(edgeScrollVelocity(900, 0, 1000) > 0);     // 오른쪽 = 양수
  assert.equal(edgeScrollVelocity(0, 0, 1000, 1700), -1700);
  assert.equal(edgeScrollVelocity(1000, 0, 1000, 1700), 1700);
  // 제곱 가속: 절반 지점의 속도는 최고속의 1/4보다 작다
  const half = edgeScrollVelocity(150, 0, 1000, 1700);  // 250→50 구간의 중간
  assert.ok(Math.abs(half) < 1700 * 0.3);
});

test('edgeScrollVelocity — 뷰포트가 화면 왼쪽 끝이 아닐 때도 동작', () => {
  assert.equal(edgeScrollVelocity(700, 200, 1000), 0); // 200~1200 안의 가운데
  assert.ok(edgeScrollVelocity(250, 200, 1000) < 0);
});
