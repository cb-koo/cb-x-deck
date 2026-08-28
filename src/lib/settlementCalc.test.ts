import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMoney, defaultDeadline, defaultCategory, itemText, purposeText, referenceUrlFor, assessReadiness,
  toMethodSnapshot, describeSnapshot, computeCandidate,
} from './settlementCalc.ts';
import { SETTLEMENT_DEFAULTS, sanitizeSettlementSettings } from './settlementSettings.ts';
import type { PaymentMethod } from './influencerPayment.ts';

const paypal: PaymentMethod = { id: 'pm1', type: 'paypal', isDefault: true, holder: 'SAWADA KEIKO', currency: 'JPY', email: 'ucymk@gmail.com', updatedAt: '2026-08-27T00:00:00.000Z' };
const bankJp: PaymentMethod = { id: 'pm2', type: 'bank', isDefault: true, holder: 'オオクボナナ', currency: 'JPY', bank: '三菱UFJ', branch: '赤坂見附支店(064)', account: '0441321', fee: { mode: 'fixed', amount: 165 }, updatedAt: '2026-08-27T00:00:00.000Z' };
const bankKr: PaymentMethod = { id: 'pm3', type: 'bank', isDefault: true, holder: 'KAWAGOE AMI', currency: 'KRW', bank: '신한', account: '110543468512', updatedAt: '2026-08-27T00:00:00.000Z' };
const paypay: PaymentMethod = { id: 'pm4', type: 'paypay', isDefault: true, holder: 'A', currency: 'JPY', updatedAt: '2026-08-27T00:00:00.000Z' };

test('computeMoney — grossUp 5%는 슬랙 실측 5쌍과 일치(반올림)', () => {
  for (const [net, gross] of [[1000, 1053], [3000, 3158], [8000, 8421], [10000, 10526], [20000, 21053]] as const) {
    const m = computeMoney({ amount: net * 10, currency: 'KRW' }, 'JPY', { mode: 'grossUp', percent: 5 }, 10);
    assert.equal(m.amountNet, net); assert.equal(m.amountGross, gross); assert.equal(m.feeAmount, gross - net);
  }
});
test('computeMoney — 고정 165·인플 부담 0·환산 방향·같은 통화', () => {
  assert.deepEqual(computeMoney({ amount: 20000, currency: 'KRW' }, 'JPY', { mode: 'fixed', amount: 165 }, 10),
    { costAmount: 20000, costCurrency: 'KRW', amountKrw: 20000, payoutCurrency: 'JPY', rateKrwPerJpy: 10, amountNet: 2000, fee: { mode: 'fixed', amount: 165 }, feeAmount: 165, amountGross: 2165 });
  assert.equal(computeMoney({ amount: 30000, currency: 'KRW' }, 'JPY', undefined, 10).amountGross, 3000);
  assert.equal(computeMoney({ amount: 30005, currency: 'KRW' }, 'JPY', undefined, 10).amountNet, 3001);   // 반올림
  assert.equal(computeMoney({ amount: 30000, currency: 'KRW' }, 'KRW', undefined, 10).amountNet, 30000);  // 같은 통화 그대로
  const j = computeMoney({ amount: 3000, currency: 'JPY' }, 'KRW', undefined, 10);
  assert.equal(j.amountNet, 30000); assert.equal(j.amountKrw, 30000);                                       // 엔→원, 원화 열도 채움
  assert.equal(computeMoney({ amount: 3000, currency: 'JPY' }, 'JPY', undefined, 10).amountKrw, 30000);
});

test('defaultDeadline — 월~금 그 주 금요일, 토 다음 금요일, 일 다음날 월요일', () => {
  assert.equal(defaultDeadline('2026-08-24'), '2026-08-28'); // 월
  assert.equal(defaultDeadline('2026-08-26'), '2026-08-28'); // 수
  assert.equal(defaultDeadline('2026-08-28'), '2026-08-28'); // 금 = 당일
  assert.equal(defaultDeadline('2026-08-29'), '2026-09-04'); // 토 → 다음 금
  assert.equal(defaultDeadline('2026-08-30'), '2026-08-31'); // 일 → 월
  assert.equal(defaultDeadline('2026-08-31'), '2026-09-04'); // 월(월말 넘김)
  assert.equal(defaultDeadline('2026-09-01'), '2026-09-04'); // 화
});

test('defaultCategory — 설정 defaultFor > 캠페인 종류 규칙 > 인용RT 최근값 > 빈칸', () => {
  const s = SETTLEMENT_DEFAULTS;
  const promo = s.categories[0].sendAs, fee = s.categories[1].sendAs, info = s.categories[2].sendAs;
  assert.equal(defaultCategory({ type: 'rt', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), promo);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), fee);
  assert.equal(defaultCategory({ type: 'visit', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), fee);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'content', settings: s, lastQuoteRtCategory: null }), info);
  assert.equal(defaultCategory({ type: 'post', campaignKind: null, settings: s, lastQuoteRtCategory: null }), info);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: info }), info);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: null }), null);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: '없어진 옵션' }), null);
  // 숨긴 옵션은 기본값이 되지 않는다 — 최근값이 숨긴 옵션이면 빈칸
  const hidden = sanitizeSettlementSettings({ ...s, categories: s.categories.map((c, i) => (i === 2 ? { ...c, hidden: true } : c)) });
  assert.ok(typeof hidden !== 'string');
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: hidden, lastQuoteRtCategory: info }), null);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'content', settings: hidden, lastQuoteRtCategory: null }), null);
  // 설정에서 인용RT 기본값을 지정하면 그게 최근값보다 우선
  const q = sanitizeSettlementSettings({ ...s, categories: s.categories.map((c, i) => (i === 0 ? { ...c, defaultFor: ['rt', 'quoteRt'] } : c)) });
  assert.ok(typeof q !== 'string');
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: q, lastQuoteRtCategory: info }), promo);
});

test('문구 — 항목·목적', () => {
  assert.equal(itemText('seikeinu', 'quoteRt'), '@seikeinu 인용RT 1건 정산');
  assert.equal(itemText('a', 'rt'), '@a RT 1건 정산');
  assert.equal(itemText('a', 'post'), '@a 투고 1건 정산');
  assert.equal(itemText('a', 'visit'), '@a 방문협찬 1건 정산');
  assert.equal(purposeText('닥터손유나클리닉', 'content', 'quoteRt'), '닥터손유나클리닉 정보성 콘텐츠 Viral 협찬');
  assert.equal(purposeText('C', 'visit', 'rt'), 'C 방문협찬 리뷰 바이럴 목적');
  assert.equal(purposeText('C', 'visit', 'post'), 'C 방문협찬 원고료');
  assert.equal(purposeText('C', 'visit', 'visit'), 'C 방문협찬 원고료');
  assert.equal(purposeText('C', 'seeding', 'rt'), 'C 제품협찬 바이럴 목적');
  assert.equal(purposeText('C', null, 'post'), 'C 콘텐츠 협찬');
});

test('referenceUrlFor — RT는 대상, 나머지는 자기 게시물', () => {
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: null, targetTweetUrl: 'https://x.com/a/status/1', targetPostUrl: null }), 'https://x.com/a/status/1');
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: null, targetTweetUrl: null, targetPostUrl: 'https://x.com/b/status/2' }), 'https://x.com/b/status/2');
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: 'https://x.com/z', targetTweetUrl: null, targetPostUrl: null }), null);
  assert.equal(referenceUrlFor({ type: 'quoteRt', postUrl: 'https://x.com/q/status/3', targetTweetUrl: 'https://x.com/a/status/1', targetPostUrl: null }), 'https://x.com/q/status/3');
  assert.equal(referenceUrlFor({ type: 'post', postUrl: null, targetTweetUrl: null, targetPostUrl: null }), null);
});

test('assessReadiness — 🔴 > 🟡, 문구 나열', () => {
  const ok = assessReadiness({ inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', removedAt: null, removedReason: '' });
  assert.equal(ok.level, 'ready'); assert.equal(ok.issues.length, 0);
  const noRoster = assessReadiness({ inRoster: false, method: null, category: 'X', referenceUrl: null, removedAt: null, removedReason: '' });
  assert.equal(noRoster.level, 'blocked');
  assert.deepEqual(noRoster.issues.map((i) => i.code), ['no-influencer', 'no-reference']);
  assert.match(noRoster.issues[0].text, /명부에 없는 인플루언서예요/);
  const noPm = assessReadiness({ inRoster: true, method: null, category: null, referenceUrl: null, removedAt: '2026-08-27', removedReason: '계정 정지' });
  assert.equal(noPm.level, 'blocked');
  assert.deepEqual(noPm.issues.map((i) => i.code), ['no-payment-method', 'no-category', 'no-reference', 'removed']);
  assert.match(noPm.issues[3].text, /게시 내려짐 8-27 · 계정 정지/);
  const warn = assessReadiness({ inRoster: true, method: paypay, category: 'X', referenceUrl: null, removedAt: null, removedReason: '' });
  assert.equal(warn.level, 'warn');
  assert.deepEqual(warn.issues.map((i) => i.code), ['no-reference', 'paypay-no-identifier']);
});

test('snapshot — 필드 선별·양식 8번 문자열', () => {
  const s = toMethodSnapshot(bankJp);
  assert.deepEqual(s, { type: 'bank', holder: 'オオクボナナ', currency: 'JPY', bank: '三菱UFJ', branch: '赤坂見附支店(064)', account: '0441321' });
  assert.equal(describeSnapshot(s), '계좌이체 | オオクボナナ | 三菱UFJ / 赤坂見附支店(064) / 0441321');
  assert.equal(describeSnapshot(toMethodSnapshot(bankKr)), '계좌이체 | KAWAGOE AMI | 신한 /  / 110543468512');
  assert.equal(describeSnapshot(toMethodSnapshot(paypal)), 'PayPal | SAWADA KEIKO | ucymk@gmail.com');
  assert.equal(describeSnapshot(toMethodSnapshot({ ...paypal, email: undefined, paypalId: 'keiko' })), 'PayPal | SAWADA KEIKO | paypal.me/keiko');
  assert.equal(describeSnapshot(toMethodSnapshot(paypay)), 'PayPay | A | ');
});

test('computeCandidate — 전부 합친 한 건', () => {
  const c = computeCandidate({
    task: { id: 't1', type: 'quoteRt', influencerHandle: 'seikeinu', cost: { amount: 30000, currency: 'KRW' }, postUrl: 'https://x.com/seikeinu/status/9', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: '원고 A' },
    campaign: { id: 'c1', name: '손유나 9월 1주', kind: 'content', clientId: 'cl1', clientName: '닥터손유나클리닉' },
    influencer: { inRoster: true, method: { ...paypal, fee: { mode: 'grossUp', percent: 5 } } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: SETTLEMENT_DEFAULTS.categories[2].sendAs, today: '2026-08-28',
  });
  assert.equal(c.money?.amountGross, 3158);
  assert.equal(c.categoryDefault, SETTLEMENT_DEFAULTS.categories[2].sendAs);
  assert.equal(c.deadlineDefault, '2026-08-28');
  assert.equal(c.referenceDefault, 'https://x.com/seikeinu/status/9');
  assert.equal(c.itemText, '@seikeinu 인용RT 1건 정산');
  assert.equal(c.purposeText, '닥터손유나클리닉 정보성 콘텐츠 Viral 협찬');
  assert.equal(c.readiness, 'ready');
  const blocked = computeCandidate({
    task: { id: 't2', type: 'rt', influencerHandle: 'nobody', cost: { amount: 20000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null },
    campaign: { id: 'c1', name: 'N', kind: null, clientId: null, clientName: '기타' },
    influencer: { inRoster: false, method: null }, settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.equal(blocked.money, null); assert.equal(blocked.readiness, 'blocked');
});
