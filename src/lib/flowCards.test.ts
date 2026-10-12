import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FlowStage } from './campaignJudgment.ts';
import { isPillActive, nextStagesForPill, pillCount, costTableRows, pctLabelLeft, remainText, budgetCardView } from './flowCards.ts';

const set = (...s: FlowStage[]) => new Set<FlowStage>(s);

test('1) 알약 켜짐 — 단계 묶음이 정확히 그 조건일 때만', () => {
  assert.equal(isPillActive(set('prep', 'handed'), 'waiting'), true);
  assert.equal(isPillActive(set('handed', 'prep'), 'waiting'), true);
  assert.equal(isPillActive(set('prep'), 'waiting'), false);
  assert.equal(isPillActive(set('prep', 'handed', 'canc'), 'waiting'), false);
  assert.equal(isPillActive(set('canc'), 'cancelled'), true);
  assert.equal(isPillActive(set(), 'cancelled'), false);
});

test('2) 알약 누르기 — 꺼져 있으면 그 조건으로 덮어쓰고, 켜져 있으면 비운다', () => {
  assert.deepEqual([...nextStagesForPill(set(), 'waiting')], ['prep', 'handed']);
  assert.deepEqual([...nextStagesForPill(set('prep'), 'waiting')], ['prep', 'handed']);   // 하나만 뒤집지 않는다
  assert.deepEqual([...nextStagesForPill(set('posted', 'done'), 'cancelled')], ['canc']);
  assert.equal(nextStagesForPill(set('prep', 'handed'), 'waiting').size, 0);
  assert.equal(nextStagesForPill(set('canc'), 'cancelled').size, 0);
  assert.deepEqual([...nextStagesForPill(set('canc'), 'waiting')], ['prep', 'handed']);
});

test('3) 알약 개수 — 게시 대기 = 준비 + 전달', () => {
  const c = { prep: 2, handed: 1, posted: 4, settle: 0, done: 1, canc: 2 } as Record<FlowStage, number>;
  assert.equal(pillCount(c, 'waiting'), 3);
  assert.equal(pillCount(c, 'cancelled'), 2);
});

test('4) 비용 표 — 있는 통화만, 집행이 없는 통화는 —', () => {
  assert.deepEqual(costTableRows({ KRW: 200_000, JPY: 17_000 }, { KRW: 200_000, JPY: 24_000 }).map((r) => [r.label, r.spent, r.planned]),
    [['원화', '200,000원', '200,000원'], ['엔화', '17,000엔', '24,000엔']]);
  assert.deepEqual(costTableRows({}, { JPY: 3_000 }).map((r) => [r.label, r.spent, r.planned]), [['엔화', '—', '3,000엔']]);
  assert.deepEqual(costTableRows({}, {}), []);
});

test('5) 막대 위 비율 위치 — 양 끝에서 가둔다', () => {
  assert.equal(pctLabelLeft(84.1), 'clamp(18px, 84.1%, calc(100% - 18px))');
});

test('6) 잔액 글자 — 넘치면 초과', () => {
  assert.deepEqual(remainText(4_030_000), { text: '4,030,000원', over: false });
  assert.deepEqual(remainText(-120_000), { text: '120,000원 초과', over: true });
  assert.deepEqual(remainText(0), { text: '0원', over: false });
});

test('7) 예산 카드 — 시안 값(5백만 예산)과 막대 순서', () => {
  const v = budgetCardView(5_000_000, { othersPlannedKrw: 850_000, othersSpentKrw: 600_000, thisPlannedKrw: 440_000, thisSpentKrw: 370_000 });
  assert.equal(v.b.remainingNow, 4_030_000);
  assert.equal(v.b.remainingAfterPlan, 3_710_000);
  assert.equal(v.pendingTotal, 320_000);
  assert.deepEqual(v.segs.map((s) => s.key), ['othersSpent', 'othersPending', 'thisSpent', 'thisPending']);
  assert.deepEqual(v.segs.map((s) => s.value), [600_000, 250_000, 370_000, 70_000]);
  assert.deepEqual(v.segs.map((s) => Math.round(s.width * 10) / 10), [12, 5, 7.4, 1.4]);
});

test('8) 예산 카드 — 넘치면 막대는 100%에서 자르고 숫자는 그대로', () => {
  const v = budgetCardView(1_000_000, { othersPlannedKrw: 900_000, othersSpentKrw: 900_000, thisPlannedKrw: 300_000, thisSpentKrw: 200_000 });
  assert.equal(v.b.remainingNow, -100_000);
  assert.equal(v.b.remainingAfterPlan, -200_000);
  assert.equal(v.segs.reduce((n, s) => n + s.width, 0), 100);
  assert.equal(v.segs.find((s) => s.key === 'thisSpent')?.value, 200_000);
  assert.equal(v.segs.find((s) => s.key === 'thisPending')?.width, 0);
});
