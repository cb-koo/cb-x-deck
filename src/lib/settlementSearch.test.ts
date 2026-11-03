import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTokens, matchesSearch } from './settlementSearch.ts';

const row = { influencerHandle: 'rena_beauty07', campaignName: '백수약국_10월4주차', clientName: '백수약국' };
const hit = (q: string) => matchesSearch(row, searchTokens(q));

test('빈 검색어는 전부 맞는다', () => {
  assert.equal(hit(''), true);
  assert.equal(hit('   '), true);
});
test('세 칸 어디에서나 찾는다', () => {
  assert.equal(hit('rena'), true);
  assert.equal(hit('4주차'), true);
  assert.equal(hit('백수'), true);
  assert.equal(hit('가은'), false);
});
test('@·대소문자 무시', () => {
  assert.equal(hit('@RENA_beauty07'), true);
});
test('낱말은 모두 들어 있어야 맞는다(칸이 달라도)', () => {
  assert.equal(hit('백수약국 4주차'), true);
  assert.equal(hit('rena 4주차'), true);
  assert.equal(hit('백수약국 5주차'), false);
});
test('인플루언서 미배정(null)도 다른 칸으로 찾는다', () => {
  assert.equal(matchesSearch({ influencerHandle: null, campaignName: '가은치유한의원_10월4주차', clientName: '가은치유한의원' }, searchTokens('가은')), true);
});
