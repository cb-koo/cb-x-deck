import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCostAtPost, costAtPostGateError, costAtPostExtra, noCostPaidGateError, COST_AT_POST_MESSAGE, NO_COST_PAID_MESSAGE } from './costAtPost';

const jpy = (amount: number) => ({ amount, currency: 'JPY' as const });

test('needsCostAtPost — 금액도 비용 없음도 없을 때만', () => {
  assert.equal(needsCostAtPost({ cost: null }), true);
  assert.equal(needsCostAtPost({ cost: null, noCost: false }), true);
  assert.equal(needsCostAtPost({ cost: null, noCost: true }), false);
  assert.equal(needsCostAtPost({ cost: jpy(8000) }), false);
  assert.equal(needsCostAtPost({ cost: jpy(0) }), false);   // 0엔도 금액이다(안내만 한다)
});

test('costAtPostGateError — 첫 게시 확인에 금액·비용 없음이 둘 다 없으면 거절', () => {
  const empty = { postedAt: null, cost: null, noCost: false };
  assert.equal(costAtPostGateError(empty, { postedAt: '2026-11-22' }), COST_AT_POST_MESSAGE);
  // 같은 요청에 함께 보내면 통과(주 경로)
  assert.equal(costAtPostGateError(empty, { postedAt: '2026-11-22', cost: jpy(8000) }), null);
  assert.equal(costAtPostGateError(empty, { postedAt: '2026-11-22', cost: jpy(0) }), null);
  assert.equal(costAtPostGateError(empty, { postedAt: '2026-11-22', noCost: true }), null);
  // 이미 금액·비용 없음이 있으면 통과
  assert.equal(costAtPostGateError({ postedAt: null, cost: jpy(5000) }, { postedAt: '2026-11-22' }), null);
  assert.equal(costAtPostGateError({ postedAt: null, cost: null, noCost: true }, { postedAt: '2026-11-22' }), null);
});

test('costAtPostGateError — 패치 후 상태로 본다(같은 요청에서 비우는 우회 차단)', () => {
  assert.equal(costAtPostGateError({ postedAt: null, cost: jpy(5000) }, { postedAt: '2026-11-22', cost: null }), COST_AT_POST_MESSAGE);
  assert.equal(costAtPostGateError({ postedAt: null, cost: null, noCost: true }, { postedAt: '2026-11-22', noCost: false }), COST_AT_POST_MESSAGE);
  // 비용 없음을 고르면 금액을 비워도 통과(서버가 금액을 지운다)
  assert.equal(costAtPostGateError({ postedAt: null, cost: jpy(5000) }, { postedAt: '2026-11-22', noCost: true, cost: null }), null);
});

test('costAtPostGateError — 게시 확인이 아닌 편집·이미 게시된 작업은 막지 않는다', () => {
  assert.equal(costAtPostGateError({ postedAt: null, cost: null }, { cost: null }), null);
  assert.equal(costAtPostGateError({ postedAt: null, cost: null }, {}), null);
  // 옛 데이터: 비용 없이 이미 게시된 작업의 링크 바꾸기 등
  assert.equal(costAtPostGateError({ postedAt: '2026-11-01', cost: null }, { postedAt: '2026-11-02' }), null);
});

test('costAtPostExtra — 요청에 실을 값', () => {
  assert.deepEqual(costAtPostExtra(false, { noCost: false, cost: null }), {});
  assert.deepEqual(costAtPostExtra(true, { noCost: true, cost: jpy(8000) }), { noCost: true });
  assert.deepEqual(costAtPostExtra(true, { noCost: false, cost: jpy(8000) }), { cost: jpy(8000) });
  assert.equal(costAtPostExtra(true, { noCost: false, cost: null }), null);
});

test("noCostPaidGateError — 지급이 끝난 작업은 '비용 없음'으로 바꾸지 못한다(풀기·다른 편집은 통과)", () => {
  assert.equal(noCostPaidGateError({ noCost: true }, true), NO_COST_PAID_MESSAGE);
  assert.equal(noCostPaidGateError({ noCost: true }, false), null);
  assert.equal(noCostPaidGateError({ noCost: false }, true), null);
  assert.equal(noCostPaidGateError({}, true), null);
});
