import { test } from 'node:test';
import assert from 'node:assert/strict';
import { altRejected } from './trendAltSpell.ts';

const M = (same: number, med = 0, disease = false) => ({ same, other: med, med, self: 0, unrelated: 0, total: 20, disease, note: '' });

test('값 없음 다른 표기 — 같은 시술 15/20 이상·병명 아님·다른 진료과 2개 이하만 남긴다(koo 10-17)', () => {
  assert.equal(altRejected(M(20)), false);               // ホクロ取り
  assert.equal(altRejected(M(14)), true);                // 같은 시술 부족
  assert.equal(altRejected(M(20, 0, true), '脂漏性角化症', '老人性イボ'), true);  // 병 이름만 — 뺀다
  assert.equal(altRejected(M(20, 0, true), 'にきび治療', 'ニキビ治療'), false);  // 원래도 '증상+治療' — 같은 형태는 병명 아님
  assert.equal(altRejected(M(20, 0, true), '扁平疣贅治療', '扁平イボ'), true);     // 원래 이름에 치료 말이 없으면 뺀다
  assert.equal(altRejected(M(17, 3)), true);             // 咬筋ボトックス처럼 치과 이갈이 섞임
  assert.equal(altRejected(M(18, 2)), false);
  assert.equal(altRejected(null), true);
});
