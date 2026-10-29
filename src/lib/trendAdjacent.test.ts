import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjacentSplit } from './trendAdjacent.ts';

const m = (v: number) => Array(12).fill(v);

test('검색어 구성 — 이름만 검색을 빼고 시술 관련과 화장품·홈케어 관련으로 나눈다', () => {
  const s = adjacentSplit({ total: m(74), noName: m(39), adjacent: m(46) })!;
  assert.equal(Math.round(s.adjacentShare * 100), 54);
  assert.equal(Math.round(s.treatment), 39);
  assert.equal(Math.round(s.adjacent), 46);
  assert.equal(Math.round(s.nameOnly), 35);
});

test('검색어 구성 — 화장품·홈케어 관련이 10% 미만이거나 없으면 보이지 않는다', () => {
  assert.equal(adjacentSplit({ total: m(100), noName: m(95), adjacent: m(5) }), null);
  assert.equal(adjacentSplit({ total: m(100), noName: m(95) }), null);
  assert.equal(adjacentSplit({ total: m(0), noName: m(0), adjacent: m(0) }), null);
  assert.equal(adjacentSplit(null), null);
});

test('검색어 구성 — 최근 12개월만 본다', () => {
  const s = adjacentSplit({ total: [...m(0), ...m(10)], noName: [...m(0), ...m(10)], adjacent: [...m(999), ...m(10)] })!;
  assert.equal(s.adjacentShare, 0.5);
});
