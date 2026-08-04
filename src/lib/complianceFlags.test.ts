import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagYakkiho } from './complianceFlags.ts';

test('리스크 용어 매칭', () => {
  assert.deepEqual(flagYakkiho('このクリームでシミが消える！'), ['シミが消える']);
  assert.ok(flagYakkiho('ニキビが治る').includes('治る'));
});
test('여러 용어 매칭', () => {
  const f = flagYakkiho('効果がある医薬品');
  assert.ok(f.includes('効果がある') && f.includes('医薬品'));
});
test('리스크 없으면 빈 배열', () => {
  assert.deepEqual(flagYakkiho('新作コスメを試してみた'), []);
  assert.deepEqual(flagYakkiho(''), []);
});

import { draftFlags, flagKey } from './complianceFlags.ts';

test('draftFlags: 약기법 용어는 kind=yakkiho', () => {
  const f = draftFlags('効果があるらしい');
  assert.ok(f.some((x) => x.kind === 'yakkiho' && x.term === '効果がある'));
});
test('draftFlags: 체험담·비포애프터 힌트는 kind=medical_ad', () => {
  const f = draftFlags('施術を受けてみた。ビフォーはこちら');
  assert.ok(f.some((x) => x.kind === 'medical_ad' && x.term === '受けてみた'));
  assert.ok(f.some((x) => x.kind === 'medical_ad' && x.term === 'ビフォー'));
});
test('draftFlags: 클라이언트 금지어는 kind=banned', () => {
  const f = draftFlags('B클리닉より安い', ['B클리닉']);
  assert.deepEqual(f.filter((x) => x.kind === 'banned').map((x) => x.term), ['B클리닉']);
});
test('draftFlags: 매칭 없으면 빈 배열, flagKey는 kind:term', () => {
  assert.deepEqual(draftFlags('新作コスメの紹介', []), []);
  assert.equal(flagKey({ term: '効く', reason: 'r', kind: 'yakkiho' }), 'yakkiho:効く');
});
