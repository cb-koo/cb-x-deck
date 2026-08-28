import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES, AMOUNT_MESSAGE,
  parseAmount, parseExtraCosts,
  sumMoney, mergeMoney, moneyParts, formatAmount, formatMoneyBy,
} from './campaignCost.ts';
import { PRICE_TYPES, PRICE_TYPE_LABEL } from './influencerPricing.ts';
import { TASK_TYPES, TASK_TYPE_LABEL } from './campaignJudgment.ts';

test('1) 리터럴은 influencerPricing과 한 벌 — 작업 유형이 곧 단가 유형이다(문자열 두 벌 금지)', () => {
  assert.equal(TASK_TYPES, PRICE_TYPES);
  assert.deepEqual([...TASK_TYPES], ['rt', 'quoteRt', 'post', 'visit']);
  assert.equal(TASK_TYPE_LABEL, PRICE_TYPE_LABEL);
  assert.deepEqual([...CURRENCIES], ['KRW', 'JPY']);
});

test('2) parseAmount — 0 이상 정수만, 콤마 문자열은 받고 소수·음수·빈 값은 거절', () => {
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount(30000), 30000);
  assert.equal(parseAmount('30,000'), 30000);   // 입력칸 값은 문자열이다
  assert.equal(parseAmount(' 12 '), 12);
  assert.equal(parseAmount(-1), null);
  assert.equal(parseAmount(1.5), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
  // 2^53 이상·1e300류의 '정수처럼 보이는' 거대한 값 — SQL ::bigint 캐스팅을 터뜨리니 여기서 막는다(최종 리뷰 Critical)
  assert.equal(parseAmount('1e20'), null);
  assert.equal(parseAmount(1e300), null);
  assert.equal(parseAmount('100000000000000000000'), null);
});

test('3) parseExtraCosts — 항목명 공백 트림·필수, 배열 아니면 거절', () => {
  const ok = parseExtraCosts([{ label: ' 교통비 ', amount: 20000, currency: 'KRW' }]);
  assert.deepEqual(ok, { ok: true, value: [{ label: '교통비', amount: 20000, currency: 'KRW' }] });
  assert.deepEqual(parseExtraCosts([]), { ok: true, value: [] });
  assert.equal(parseExtraCosts([{ label: '  ', amount: 1, currency: 'KRW' }]).ok, false);
  const badAmount = parseExtraCosts([{ label: '교통비', amount: -5, currency: 'KRW' }]);
  assert.equal(badAmount.ok, false);
  if (!badAmount.ok) assert.equal(badAmount.message, AMOUNT_MESSAGE);
  assert.equal(parseExtraCosts([{ label: '교통비', amount: 1, currency: 'USD' }]).ok, false);
  assert.equal(parseExtraCosts({ label: 'x' }).ok, false);
});

test('4) 통화별 합계 — 통화 간 합산 금지, 원→엔 고정 순서, 비면 —', () => {
  const m = sumMoney([
    { amount: 300000, currency: 'KRW' }, { amount: 60000, currency: 'KRW' }, { amount: 95000, currency: 'JPY' },
  ]);
  assert.deepEqual(m, { KRW: 360000, JPY: 95000 });
  assert.deepEqual(mergeMoney({ KRW: 1 }, { JPY: 2 }, { KRW: 3 }), { KRW: 4, JPY: 2 });
  assert.deepEqual(moneyParts({ JPY: 5, KRW: 1 }), [{ currency: 'KRW', amount: 1 }, { currency: 'JPY', amount: 5 }]);
  assert.equal(formatAmount(360000, 'KRW'), '360,000원');           // = influencerPricing.formatMoney
  assert.equal(formatMoneyBy({ KRW: 360000, JPY: 95000 }), '360,000원 · 95,000엔');
  assert.equal(formatMoneyBy({}), '—');
  assert.equal(formatMoneyBy({ KRW: 0 }), '0원'); // 0은 값이다 — '없음'과 다르다
});

import { parseTaskCost, suggestTaskCost } from './campaignCost.ts';

test('parseTaskCost — type 없이 amount·currency만, null=지움, 문자열 금액 허용', () => {
  assert.deepEqual(parseTaskCost(null), { ok: true, value: null });
  assert.deepEqual(parseTaskCost({ amount: '3,000', currency: 'JPY' }), { ok: true, value: { amount: 3000, currency: 'JPY' } });
  assert.equal(parseTaskCost({ amount: -1, currency: 'KRW' }).ok, false);
  assert.equal(parseTaskCost({ amount: 1, currency: 'USD' }).ok, false);
  assert.equal(parseTaskCost({ type: 'rt', amount: 1, currency: 'KRW' }).ok, true); // 옛 모양이 와도 type은 무시
  assert.equal(parseTaskCost('x').ok, false);
});
test('suggestTaskCost — 단가[type]과 pricing 통화, 없으면 null', () => {
  assert.deepEqual(suggestTaskCost({ rt: 3000, currency: 'JPY' }, 'rt'), { amount: 3000, currency: 'JPY' });
  assert.deepEqual(suggestTaskCost({ post: 20000 }, 'post'), { amount: 20000, currency: 'KRW' });
  assert.equal(suggestTaskCost({ post: 20000 }, 'rt'), null);
  assert.equal(suggestTaskCost(null, 'rt'), null);
});
