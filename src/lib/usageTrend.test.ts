import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trend } from './usageTrend.ts';

test('증가', () => { assert.deepEqual(trend(112, 100), { pct: 12, direction: 'up' }); });
test('감소', () => { assert.deepEqual(trend(80, 100), { pct: -20, direction: 'down' }); });
test('변화 없음', () => { assert.deepEqual(trend(100, 100), { pct: 0, direction: 'flat' }); });
test('이전 0이면 pct null', () => { assert.deepEqual(trend(5, 0), { pct: null, direction: 'up' }); });
test('둘 다 0', () => { assert.deepEqual(trend(0, 0), { pct: null, direction: 'flat' }); });
