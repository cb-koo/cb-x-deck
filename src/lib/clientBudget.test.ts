import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JPY_TO_KRW, BUDGET_AMOUNT_MESSAGE, MONTH_MESSAGE, isMonthKey, budgetOverridesOf,
  toKrw, monthOf, addMonths, budgetForMonth, budgetRows, campaignMonthBudget, remainingOf,
  budgetJudgment, monthLabel, monthShort, budgetTipText, parseBudgetAmount, type MonthSpend,
} from './clientBudget.ts';

const client = (monthlyBudget: number | null, budgetOverrides: Record<string, number> = {}) => ({ monthlyBudget, budgetOverrides });

test('1) toKrw — 엔화는 1엔=JPY_TO_KRW원으로 환산해 합산, 엔화 원금은 따로 알려준다', () => {
  assert.equal(JPY_TO_KRW, 10);
  assert.deepEqual(toKrw({}), { krw: 0, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ KRW: 300_000 }), { krw: 300_000, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ JPY: 95_000 }), { krw: 950_000, jpyIncluded: 95_000 });
  assert.deepEqual(toKrw({ KRW: 300_000, JPY: 95_000 }), { krw: 1_250_000, jpyIncluded: 95_000 });
});

test('2) monthOf·addMonths — 월 경계·연 경계에서 시간대 시프트 없음', () => {
  assert.equal(monthOf('2026-08-31'), '2026-08');
  assert.equal(monthOf('2026-09-01'), '2026-09');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-08', 0), '2026-08');
});

test('3) isMonthKey·budgetOverridesOf — 형식·정수 검증 통과분만', () => {
  assert.ok(isMonthKey('2026-09'));
  assert.ok(!isMonthKey('2026-13'));
  assert.ok(!isMonthKey('2026-9'));
  assert.ok(!isMonthKey('2026-09-01'));
  assert.deepEqual(budgetOverridesOf(null), {});
  assert.deepEqual(budgetOverridesOf([1]), {});
  assert.deepEqual(budgetOverridesOf({ '2026-09': 100, bad: 1, '2026-10': -1, '2026-11': 1.5 }), { '2026-09': 100 });
});

test('4) budgetForMonth — 예외 → 기본 → 미설정. 예외가 기본과 같은 금액이어도 override', () => {
  assert.deepEqual(budgetForMonth(client(3_000_000, { '2026-08': 2_500_000 }), '2026-08'), { amount: 2_500_000, source: 'override' });
  assert.deepEqual(budgetForMonth(client(3_000_000, { '2026-08': 3_000_000 }), '2026-08'), { amount: 3_000_000, source: 'override' });
  assert.deepEqual(budgetForMonth(client(3_000_000), '2026-09'), { amount: 3_000_000, source: 'default' });
  assert.deepEqual(budgetForMonth(client(null, { '2026-08': 1 }), '2026-09'), { amount: null, source: 'none' });
  assert.deepEqual(budgetForMonth(client(null, { '2026-08': 1 }), '2026-08'), { amount: 1, source: 'override' });
});

test('5) remainingOf·budgetJudgment — 남음/초과/미설정 문구', () => {
  assert.equal(remainingOf(null, 100), null);
  assert.equal(remainingOf(3_000_000, 1_200_000), 1_800_000);
  assert.equal(remainingOf(2_500_000, 2_850_000), -350_000);
  assert.equal(budgetJudgment(3_000_000, 1_800_000), '1,800,000원 남음');
  assert.equal(budgetJudgment(2_500_000, -350_000), '350,000원 초과');
  assert.equal(budgetJudgment(1_000_000, 0), '0원 남음');
  assert.equal(budgetJudgment(null, null), '예산을 설정하면 잔액이 보여요');
});

const spend = (entries: Array<[string, MonthSpend]>) => new Map(entries);

test('6) budgetRows — 캠페인 없으면 이번 달·다음 달 2행, 최신 위', () => {
  const rows = budgetRows(client(3_000_000), spend([]), '2026-08-27');
  assert.deepEqual(rows.map((r) => r.month), ['2026-09', '2026-08']);
  assert.deepEqual(rows[1], {
    month: '2026-08', budget: 3_000_000, source: 'default', spentKrw: 0, jpyIncluded: 0, campaignCount: 0, remaining: 3_000_000,
    spentWithFeeKrw: 0, feeKrw: 0, feeUnknown: 0,
  });
});

test('7) budgetRows — 첫 캠페인 달부터 다음 달까지 빈 달도 채우고, 집행·예외·엔화가 행에 붙는다', () => {
  const rows = budgetRows(
    client(3_000_000, { '2026-08': 2_500_000 }),
    spend([
      ['2026-06', { total: { KRW: 100_000 }, campaignCount: 1, feeKrw: 0, feeUnknown: 0 }],
      ['2026-08', { total: { KRW: 1_900_000, JPY: 95_000 }, campaignCount: 3, feeKrw: 53_000, feeUnknown: 2 }],
    ]),
    '2026-08-27',
  );
  assert.deepEqual(rows.map((r) => r.month), ['2026-09', '2026-08', '2026-07', '2026-06']);
  const aug = rows[1];
  assert.equal(aug.budget, 2_500_000);
  assert.equal(aug.source, 'override');
  assert.equal(aug.spentKrw, 2_850_000);
  assert.equal(aug.jpyIncluded, 95_000);
  assert.equal(aug.campaignCount, 3);
  assert.equal(aug.remaining, -350_000);              // 잔액은 지금처럼 단가(spentKrw) 기준
  // 지출 기준 토글(스펙 §5-5) — spentWithFeeKrw = spentKrw + feeKrw, 화면은 remainingOf(budget, spentWithFeeKrw)로 잔액을 다시 낸다
  assert.equal(aug.feeKrw, 53_000);
  assert.equal(aug.spentWithFeeKrw - aug.spentKrw, aug.feeKrw);
  assert.equal(aug.spentWithFeeKrw, 2_903_000);
  assert.equal(aug.feeUnknown, 2);
  assert.equal(remainingOf(aug.budget, aug.spentWithFeeKrw), -403_000);
  assert.equal(rows[2].campaignCount, 0);           // 7월은 캠페인 없음이지만 행은 있다
  const jun = rows[3];
  assert.equal(jun.feeKrw, 0);
  assert.equal(jun.spentWithFeeKrw, jun.spentKrw);   // 수수료가 전부 0이면 두 값이 같다
  assert.equal(jun.feeUnknown, 0);
});

test('8) budgetRows — 12행 상한(최신 12개), 첫 캠페인이 미래여도 이번 달부터', () => {
  const many = budgetRows(client(1), spend([['2024-01', { total: {}, campaignCount: 1, feeKrw: 0, feeUnknown: 0 }]]), '2026-08-27');
  assert.equal(many.length, 12);
  assert.equal(many[0].month, '2026-09');
  assert.equal(many[11].month, '2025-10');
  const future = budgetRows(client(1), spend([['2026-11', { total: {}, campaignCount: 1, feeKrw: 0, feeUnknown: 0 }]]), '2026-08-27');
  // 위 끝은 항상 다음 달 — 먼 미래 캠페인이 이번 달·다음 달을 표 밖으로 밀어내면 안 된다
  assert.deepEqual(future.map((r) => r.month), ['2026-09', '2026-08']);
  const farFuture = budgetRows(client(1), spend([['2027-12', { total: {}, campaignCount: 1, feeKrw: 0, feeUnknown: 0 }]]), '2026-08-27');
  assert.deepEqual(farFuture.map((r) => r.month).slice(0, 2), ['2026-09', '2026-08']);   // 이번 달이 절대 빠지지 않는다
});

test('9) campaignMonthBudget — othersKrw는 같은 달 합계에서 이 캠페인 몫을 뺀 값', () => {
  const b = campaignMonthBudget(client(3_000_000), '2026-08', { total: { KRW: 1_850_000 }, campaignCount: 2, feeKrw: 0, feeUnknown: 0 }, 1_200_000);
  assert.deepEqual(b, { month: '2026-08', amount: 3_000_000, source: 'default', othersKrw: 650_000, campaignCount: 2 });
  // 그 달에 집계가 없으면(이 캠페인이 아직 비용 0) 0
  assert.deepEqual(campaignMonthBudget(client(null), '2026-08', undefined, 0),
    { month: '2026-08', amount: null, source: 'none', othersKrw: 0, campaignCount: 0 });
});

test('10) 라벨·안내 문구 — 환율은 상수에서 나온다', () => {
  assert.equal(monthLabel('2026-09'), '2026년 9월');
  assert.equal(monthShort('2026-09'), '9월');
  assert.equal(monthShort('2026-12'), '12월');
  assert.ok(budgetTipText().includes(`1엔 = ${JPY_TO_KRW}원`));
  assert.ok(budgetTipText().includes('시작한 달'));
  assert.ok(budgetTipText().includes('캠페인에 넣은 콘텐츠'));
});

test('11) parseBudgetAmount — null 허용, 0 이상 정수, 콤마 문자열 허용', () => {
  assert.deepEqual(parseBudgetAmount(null), { ok: true, value: null });
  assert.deepEqual(parseBudgetAmount(''), { ok: true, value: null });   // 입력칸을 비우면 미설정
  assert.deepEqual(parseBudgetAmount('3,000,000'), { ok: true, value: 3_000_000 });
  assert.deepEqual(parseBudgetAmount(0), { ok: true, value: 0 });
  assert.deepEqual(parseBudgetAmount(-1), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(1.5), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount('abc'), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.equal(MONTH_MESSAGE, '달 형식이 올바르지 않아요 (예: 2026-09)');
});
