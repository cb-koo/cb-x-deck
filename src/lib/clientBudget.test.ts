import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JPY_TO_KRW, BUDGET_AMOUNT_MESSAGE, PERIOD_DATE_MESSAGE, PERIOD_ORDER_MESSAGE,
  toKrw, remainingOf, periodFor, overageBadge, periodRow, campaignPeriodBudget,
  periodLabel, periodLabelFull, budgetTipText, badgeText, budgetJudgment, parseBudgetAmount, parseBudgetPeriodInput,
  type BudgetPeriod, type PeriodSpend, type SpanningCampaign,
} from './clientBudget.ts';

const period = (id: string, startsOn: string, endsOn: string, amountKrw: number): BudgetPeriod =>
  ({ id, startsOn, endsOn, amountKrw });
const spend = (over: Partial<PeriodSpend> = {}): PeriodSpend =>
  ({ total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0, ...over });

test('1) toKrw — 엔화는 1엔=JPY_TO_KRW원으로 환산해 합산, 엔화 원금은 따로 알려준다', () => {
  assert.equal(JPY_TO_KRW, 10);
  assert.deepEqual(toKrw({}), { krw: 0, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ KRW: 300_000 }), { krw: 300_000, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ JPY: 95_000 }), { krw: 950_000, jpyIncluded: 95_000 });
  assert.deepEqual(toKrw({ KRW: 300_000, JPY: 95_000 }), { krw: 1_250_000, jpyIncluded: 95_000 });
});

test('2) remainingOf — 예산 - 지출', () => {
  assert.equal(remainingOf(3_000_000, 1_200_000), 1_800_000);
  assert.equal(remainingOf(2_500_000, 2_850_000), -350_000);
});

test('3) periodFor — 경계값(시작일·종료일 포함), 겹침 없음 전제라 최대 1개, 빈틈이면 null', () => {
  const periods = [period('a', '2026-08-01', '2026-08-31', 1), period('b', '2026-09-01', '2026-09-30', 2)];
  assert.equal(periodFor(periods, '2026-08-01')!.id, 'a');   // 시작일 포함
  assert.equal(periodFor(periods, '2026-08-31')!.id, 'a');   // 종료일 포함
  assert.equal(periodFor(periods, '2026-09-01')!.id, 'b');
  assert.equal(periodFor(periods, '2026-07-31'), null);      // 빈틈(첫 기간 이전)
  assert.equal(periodFor([], '2026-08-01'), null);
});

test('4) overageBadge — 정상 범위면 null, 마이너스인데 걸치는 캠페인 없으면 null, 있으면 count·가장 늦은 종료일', () => {
  assert.equal(overageBadge(100, []), null);                                  // 정상
  assert.equal(overageBadge(-100, []), null);                                 // 마이너스지만 걸치는 캠페인 없음
  const spanning: SpanningCampaign[] = [{ id: 'x', endsOn: '2026-09-04' }, { id: 'y', endsOn: '2026-09-02' }];
  assert.deepEqual(overageBadge(-100, spanning), { latestEndsOn: '2026-09-04', count: 2 });  // 가장 늦은 날짜 선택
  assert.deepEqual(overageBadge(-1, [{ id: 'z', endsOn: '2026-09-04' }]), { latestEndsOn: '2026-09-04', count: 1 });
});

test('5) periodRow — 계산·초과 배지 결합', () => {
  const p = period('p1', '2026-08-01', '2026-08-31', 2_500_000);
  const row = periodRow(p, spend({ total: { KRW: 1_900_000, JPY: 95_000 }, campaignCount: 3, feeKrw: 53_000, feeUnknown: 2 }),
                         [{ id: 'aug2', endsOn: '2026-09-06' }]);
  assert.equal(row.spentKrw, 2_850_000);
  assert.equal(row.jpyIncluded, 95_000);
  assert.equal(row.campaignCount, 3);
  assert.equal(row.remaining, -350_000);
  assert.equal(row.spentWithFeeKrw, 2_903_000);
  assert.equal(row.feeKrw, 53_000);
  assert.equal(row.feeUnknown, 2);
  assert.deepEqual(row.badge, { latestEndsOn: '2026-09-06', count: 1 });
  // 정상 범위(초과 없음)면 걸치는 캠페인이 있어도 배지 없음
  const normal = periodRow(period('p2', '2026-09-01', '2026-09-30', 5_000_000), spend({ total: { KRW: 3_200_000 }, campaignCount: 4 }), [{ id: 'z', endsOn: '2026-10-04' }]);
  assert.equal(normal.badge, null);
});

test('6) campaignPeriodBudget — 기간 없으면 source none, 있으면 othersKrw·배지', () => {
  const none = campaignPeriodBudget(null, undefined, [], 0);
  assert.deepEqual(none, { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null });

  const p = period('p1', '2026-08-01', '2026-08-31', 3_000_000);
  const b = campaignPeriodBudget(p, spend({ total: { KRW: 1_850_000 }, campaignCount: 2 }), [], 1_200_000);
  assert.deepEqual(b, { period: p, source: 'period', othersKrw: 650_000, campaignCount: 2, badge: null });

  // 이 기간이 마이너스이고 걸치는 캠페인이 있으면 카드에도 같은 배지가 뜬다(기간 전체 상태)
  const over = campaignPeriodBudget(period('p2', '2026-08-01', '2026-08-31', 1_000_000),
    spend({ total: { KRW: 1_200_000 }, campaignCount: 1 }), [{ id: 'x', endsOn: '2026-09-04' }], 1_200_000);
  assert.deepEqual(over.badge, { latestEndsOn: '2026-09-04', count: 1 });
});

test('7) periodLabel·budgetTipText·badgeText', () => {
  assert.equal(periodLabel(period('p', '2026-09-01', '2026-09-30', 1)), '9/1 ~ 9/30');
  assert.ok(budgetTipText().includes(`1엔 = ${JPY_TO_KRW}원`));
  assert.ok(budgetTipText().includes('시작일이 속한 기간'));
  assert.equal(badgeText({ latestEndsOn: '2026-09-04', count: 1 }), '9/4까지 이어지는 캠페인 때문에 초과됐어요');
  assert.equal(badgeText({ latestEndsOn: '2026-09-04', count: 3 }), '3개 캠페인이 기간을 넘어가요 · 가장 늦게는 9/4까지');
  assert.equal(periodLabelFull(period('p', '2026-09-01', '2026-09-30', 1)), '2026년 9월 1일 ~ 9월 30일');
  assert.equal(periodLabelFull(period('p', '2026-12-15', '2027-01-14', 1)), '2026년 12월 15일 ~ 2027년 1월 14일');
});

test('8) budgetJudgment — 남음/초과 문구', () => {
  assert.equal(budgetJudgment(1_800_000), '1,800,000원 남음');
  assert.equal(budgetJudgment(-350_000), '350,000원 초과');
  assert.equal(budgetJudgment(0), '0원 남음');
});

test('9) parseBudgetAmount — 0 이상 정수·콤마 문자열만, null/빈 문자열/음수/소수는 거부(기간은 항상 금액 필수)', () => {
  assert.deepEqual(parseBudgetAmount('3,000,000'), { ok: true, value: 3_000_000 });
  assert.deepEqual(parseBudgetAmount(0), { ok: true, value: 0 });
  assert.deepEqual(parseBudgetAmount(null), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(''), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(-1), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(1.5), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
});

test('10) parseBudgetPeriodInput — 날짜 형식·순서·금액 검증', () => {
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 }),
    { ok: true, value: { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 } });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-40', endsOn: '2026-09-30', amountKrw: 1 }),
    { ok: false, message: PERIOD_DATE_MESSAGE });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-30', endsOn: '2026-09-01', amountKrw: 1 }),
    { ok: false, message: PERIOD_ORDER_MESSAGE });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-01', amountKrw: 1 }).ok, true);  // 하루짜리 허용
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: -1 }),
    { ok: false, message: BUDGET_AMOUNT_MESSAGE });
});
