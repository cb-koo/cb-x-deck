import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBatchim, subjectParticle, objectParticle, withRo } from './koreanParticle.ts';

test('hasBatchim — 마지막 음절의 받침 여부', () => {
  assert.equal(hasBatchim('박구건'), true);
  assert.equal(hasBatchim('김서아'), false);
  assert.equal(hasBatchim('지급 완료'), false);
  assert.equal(hasBatchim('지급 예정'), true);
  assert.equal(hasBatchim('koo'), false);   // 한글이 아니면 받침 없음으로 본다
  assert.equal(hasBatchim(''), false);
});

test('subjectParticle — 이/가', () => {
  assert.equal(subjectParticle('박구건'), '이');
  assert.equal(subjectParticle('김서아'), '가');
  assert.equal(subjectParticle('koo'), '가');
});

test('objectParticle — 을/를', () => {
  assert.equal(objectParticle('지급 예정'), '을');
  assert.equal(objectParticle('지급 완료'), '를');
  assert.equal(objectParticle('보류'), '를');
  assert.equal(objectParticle('취소'), '를');
  assert.equal(objectParticle('접수'), '를');
  assert.equal(objectParticle(''), '를');
});

test('withRo — 으로/로', () => {
  assert.equal(withRo('6,000엔'), '6,000엔으로');
  assert.equal(withRo('60,000원'), '60,000원으로');
  assert.equal(withRo('서울'), '서울로');   // ㄹ 받침
  assert.equal(withRo('부산'), '부산으로');
  assert.equal(withRo('달러'), '달러로');
  assert.equal(withRo('$40.00'), '$40.00로');
  assert.equal(withRo('—'), '—로');
});
