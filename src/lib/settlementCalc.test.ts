import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMoney, defaultDeadline, defaultCategory, itemText, purposeText, referenceUrlFor, assessReadiness,
  toMethodSnapshot, describeSnapshot, computeCandidate, effectiveReadiness, effectiveIssues,
} from './settlementCalc.ts';
import { SETTLEMENT_DEFAULTS, sanitizeSettlementSettings } from './settlementSettings.ts';
import type { PaymentMethod } from './influencerPayment.ts';
import type { TaskType } from './campaignJudgment.ts';
import type { TaskProof } from './taskProofGuard.ts';

const paypal: PaymentMethod = { id: 'pm1', type: 'paypal', isDefault: true, holder: 'SAWADA KEIKO', currency: 'JPY', email: 'ucymk@gmail.com', updatedAt: '2026-08-27T00:00:00.000Z' };
// computeCandidate 최소 입력 — 유형·증빙만 바꿔 가며 no-proof 판정을 본다(다른 필드는 readiness에 영향 없게 다 채운다)
function candInput(over: { type: TaskType; proof: TaskProof | null }) {
  return {
    task: { id: 't-proof', type: over.type, influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' as const }, postUrl: 'https://x.com/a/status/1', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null, proof: over.proof },
    campaign: { id: 'c1', name: 'N', kind: 'content' as const, clientId: 'cl1', clientName: '기타' },
    influencer: { inRoster: true, method: paypal },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  };
}
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

// koo 09-14: 요청한 주의 다음 주 월요일(그날 23:59까지 — 날짜 필드라 그날 안이면 된다). 금요일 요청이 당일 마감으로 잡혀
// 실제 지급(다음 주 초)과 어긋나던 옛 규칙("그 주 금요일")을 바꿨다. 급한 건은 요청 전(후보 행)·요청 후(제자리 수정)에서 손으로 고친다.
test('defaultDeadline — 요청일이 속한 주의 다음 주 월요일 (월요일 요청은 7일 뒤, 일요일 요청은 다음날)', () => {
  assert.equal(defaultDeadline('2026-09-14'), '2026-09-21'); // 월 → 다음 주 월(7일 뒤, 당일 아님)
  assert.equal(defaultDeadline('2026-09-16'), '2026-09-21'); // 수
  assert.equal(defaultDeadline('2026-09-11'), '2026-09-14'); // 금 → 다음 주 월(옛 규칙은 당일이었다)
  assert.equal(defaultDeadline('2026-09-12'), '2026-09-14'); // 토
  assert.equal(defaultDeadline('2026-09-13'), '2026-09-14'); // 일 → 다음날(일요일은 그 주의 끝)
  assert.equal(defaultDeadline('2026-08-31'), '2026-09-07'); // 월(월말 넘김)
  assert.equal(defaultDeadline('2026-12-30'), '2027-01-04'); // 수(연말 넘김)
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
  const ok = assessReadiness({ inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', referenceRequired: true, removedAt: null, removedReason: '', clientId: 'cl1', proofMissing: false });
  assert.equal(ok.level, 'ready'); assert.equal(ok.issues.length, 0);
  const noRoster = assessReadiness({ inRoster: false, method: null, category: 'X', referenceUrl: null, referenceRequired: false, removedAt: null, removedReason: '', clientId: 'cl1', proofMissing: false });
  assert.equal(noRoster.level, 'blocked');
  assert.deepEqual(noRoster.issues.map((i) => i.code), ['no-influencer', 'no-reference']);
  assert.match(noRoster.issues[0].text, /명부에 없는 인플루언서예요/);
  const noPm = assessReadiness({ inRoster: true, method: null, category: null, referenceUrl: null, referenceRequired: false, removedAt: '2026-08-27', removedReason: '계정 정지', clientId: 'cl1', proofMissing: false });
  assert.equal(noPm.level, 'blocked');
  assert.deepEqual(noPm.issues.map((i) => i.code), ['no-payment-method', 'no-category', 'no-reference', 'removed']);
  assert.match(noPm.issues[3].text, /게시 내려짐 8-27 · 계정 정지/);
  const warn = assessReadiness({ inRoster: true, method: paypal, category: 'X', referenceUrl: null, referenceRequired: false, removedAt: '2026-08-27', removedReason: '', clientId: 'cl1', proofMissing: false });
  assert.equal(warn.level, 'warn');
  assert.deepEqual(warn.issues.map((i) => i.code), ['no-reference', 'removed']);
  const noClient = assessReadiness({ inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', referenceRequired: true, removedAt: null, removedReason: '', clientId: null, proofMissing: false });
  assert.equal(noClient.level, 'blocked');
  assert.deepEqual(noClient.issues.map((i) => i.code), ['no-client']);
  assert.match(noClient.issues[0].text, /이 캠페인의 클라이언트가 삭제돼 비어 있어요/);
});

// 09-02 koo: 정산 쪽이 지급 전 확인에 쓰는 자료(RT 스크린샷 / 그 외 유형의 게시물 링크)가 없으면 그쪽이 받지 않는다 → 우리가 미리 막는다
test('assessReadiness — 증빙 없는 RT는 🔴, 요청을 막는다', () => {
  const base = { inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', referenceRequired: false, removedAt: null, removedReason: '', clientId: 'cl1' };
  const missing = assessReadiness({ ...base, proofMissing: true });
  assert.equal(missing.level, 'blocked');
  const issue = missing.issues.find((i) => i.code === 'no-proof')!;
  assert.equal(issue.level, 'blocked');
  assert.match(issue.text, /증빙 스크린샷을 넣어야 요청할 수 있어요/);

  const has = assessReadiness({ ...base, proofMissing: false });
  assert.equal(has.level, 'ready');
  assert.equal(has.issues.length, 0);
});

// 09-03 koo: 그쪽이 "PayPay 수취 식별값 없으면 송금 불가"로 확정 → 우리도 요청 단계에서 막는다
test('assessReadiness — PayPay인데 수취 식별 정보가 없으면 🔴, 있으면 통과', () => {
  const base = { inRoster: true, category: 'X', referenceUrl: 'https://x.com/1', referenceRequired: true, removedAt: null, removedReason: '', clientId: 'cl1', proofMissing: false };
  const missing = assessReadiness({ ...base, method: paypay });
  assert.equal(missing.level, 'blocked');
  const issue = missing.issues.find((i) => i.code === 'paypay-no-identifier')!;
  assert.equal(issue.level, 'blocked');
  assert.match(issue.text, /PayPay 수취 정보를 넣어야 요청할 수 있어요/);
  const has = assessReadiness({ ...base, method: { ...paypay, identifier: '090-1234-5678' } });
  assert.equal(has.level, 'ready');
});

test('assessReadiness — 참고 링크 없음은 필수 유형(투고·인용RT·방문)이면 🔴, RT면 🟡', () => {
  const base = { inRoster: true, method: paypal, category: 'X', referenceUrl: null, removedAt: null, removedReason: '', clientId: 'cl1', proofMissing: false };
  const required = assessReadiness({ ...base, referenceRequired: true });
  assert.equal(required.level, 'blocked');
  assert.match(required.issues.find((i) => i.code === 'no-reference')!.text, /참고 링크를 넣어 주세요/);
  const optional = assessReadiness({ ...base, referenceRequired: false });
  assert.equal(optional.level, 'warn');
  assert.equal(optional.issues.find((i) => i.code === 'no-reference')!.text, '참고 링크 없음');
});

test('computeCandidate — 참고 링크 필수 여부는 유형에서 나온다: RT만 선택', () => {
  const noLink = (type: TaskType) => ({ ...candInput({ type, proof: null }), task: { ...candInput({ type, proof: null }).task, postUrl: null } });
  for (const type of ['post', 'quoteRt', 'visit'] as const) {
    const c = computeCandidate(noLink(type));
    assert.equal(c.issues.find((i) => i.code === 'no-reference')?.level, 'blocked', type);
  }
  const rt = computeCandidate(noLink('rt'));
  assert.equal(rt.issues.find((i) => i.code === 'no-reference')?.level, 'warn');
});

test('computeCandidate — RT는 증빙이 없으면 no-proof, 투고는 증빙과 무관', () => {
  const rt = computeCandidate(candInput({ type: 'rt', proof: null }));
  assert.ok(rt.issues.some((i) => i.code === 'no-proof' && i.level === 'blocked'));
  assert.equal(rt.readiness, 'blocked');

  const rtWithProof = computeCandidate(candInput({
    type: 'rt',
    proof: { url: 'task/11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png', by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' },
  }));
  assert.equal(rtWithProof.issues.some((i) => i.code === 'no-proof'), false);
  assert.deepEqual(rtWithProof.proof?.byName, '박구건');

  const post = computeCandidate(candInput({ type: 'post', proof: null }));
  assert.equal(post.issues.some((i) => i.code === 'no-proof'), false);
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
    task: { id: 't1', type: 'quoteRt', influencerHandle: 'seikeinu', cost: { amount: 30000, currency: 'KRW' }, postUrl: 'https://x.com/seikeinu/status/9', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: '원고 A', proof: null },
    campaign: { id: 'c1', name: '손유나 9월 1주', kind: 'content', clientId: 'cl1', clientName: '닥터손유나클리닉' },
    influencer: { inRoster: true, method: { ...paypal, fee: { mode: 'grossUp', percent: 5 } } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: SETTLEMENT_DEFAULTS.categories[2].sendAs, today: '2026-08-28',
  });
  assert.deepEqual(c.cost, { amount: 30000, currency: 'KRW' });
  assert.equal(c.money?.amountGross, 3158);
  assert.equal(c.categoryDefault, SETTLEMENT_DEFAULTS.categories[2].sendAs);
  assert.equal(c.deadlineDefault, '2026-08-31');   // 금(08-28) 요청 → 다음 주 월
  assert.equal(c.referenceDefault, 'https://x.com/seikeinu/status/9');
  assert.equal(c.itemText, '@seikeinu 인용RT 1건 정산');
  assert.equal(c.purposeText, '닥터손유나클리닉 정보성 콘텐츠 Viral 협찬');
  assert.equal(c.readiness, 'ready');
  const blocked = computeCandidate({
    task: { id: 't2', type: 'rt', influencerHandle: 'nobody', cost: { amount: 20000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null, proof: null },
    campaign: { id: 'c1', name: 'N', kind: null, clientId: null, clientName: '기타' },
    influencer: { inRoster: false, method: null }, settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.deepEqual(blocked.cost, { amount: 20000, currency: 'KRW' });
  assert.equal(blocked.money, null); assert.equal(blocked.readiness, 'blocked');
});

test('effectiveReadiness/effectiveIssues — 분류를 지우면 즉시 🔴, 서버 no-category를 사람이 채우면 해제, warn은 유지', () => {
  const filled = computeCandidate({
    task: { id: 't3', type: 'post', influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' }, postUrl: 'https://x.com/a/status/1', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null, proof: null },
    campaign: { id: 'c1', name: 'N', kind: 'content', clientId: 'cl1', clientName: '기타' },
    influencer: { inRoster: true, method: { id: 'pm1', type: 'paypal', isDefault: true, holder: 'A', currency: 'JPY', email: 'a@x.com', updatedAt: '2026-08-27T00:00:00.000Z' } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  // 서버가 분류를 미리 채워 ready — 사람이 그 분류를 지우면 즉시 blocked(비대칭 버그 재발 방지, 08-28 리뷰)
  assert.equal(filled.readiness, 'ready');
  assert.equal(effectiveReadiness(filled, { category: filled.categoryDefault }), 'ready');
  assert.equal(effectiveReadiness(filled, { category: null }), 'blocked');
  assert.deepEqual(effectiveIssues(filled, { category: null }).map((i) => i.code), ['no-category']);
  // 서버 no-category(분류 기본값 없음) + 사람이 골랐으면 더 이상 blocked가 아니다
  const empty = computeCandidate({
    task: { id: 't4', type: 'quoteRt', influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' }, postUrl: 'https://x.com/a/status/1', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null, proof: null },
    campaign: { id: 'c1', name: 'N', kind: 'content', clientId: 'cl1', clientName: '기타' },
    influencer: { inRoster: true, method: { id: 'pm1', type: 'paypal', isDefault: true, holder: 'A', currency: 'JPY', email: 'a@x.com', updatedAt: '2026-08-27T00:00:00.000Z' } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.equal(empty.categoryDefault, null);
  assert.equal(empty.readiness, 'blocked');
  assert.equal(effectiveReadiness(empty, { category: SETTLEMENT_DEFAULTS.categories[0].sendAs }), 'ready');
  assert.deepEqual(effectiveIssues(empty, { category: SETTLEMENT_DEFAULTS.categories[0].sendAs }).map((i) => i.code), []);
  // 투고에 참고 링크가 없으면 🔴 — 사람이 행에서 링크를 넣으면 즉시 풀리고, 지우면 다시 막힌다(분류 칸과 같은 방식)
  const noLink = computeCandidate({
    task: { id: 't5', type: 'post', influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null, proof: null },
    campaign: { id: 'c1', name: 'N', kind: 'content', clientId: 'cl1', clientName: '기타' },
    influencer: { inRoster: true, method: { id: 'pm1', type: 'paypal', isDefault: true, holder: 'A', currency: 'JPY', email: 'a@x.com', updatedAt: '2026-08-27T00:00:00.000Z' } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.equal(noLink.readiness, 'blocked');
  assert.equal(effectiveReadiness(noLink, { category: noLink.categoryDefault }), 'blocked');                       // 편집 정보 없음 → 서버 판정 그대로
  assert.equal(effectiveReadiness(noLink, { category: noLink.categoryDefault, referenceUrl: '' }), 'blocked');
  assert.equal(effectiveReadiness(noLink, { category: noLink.categoryDefault, referenceUrl: 'https://x.com/a/status/9' }), 'ready');
  assert.deepEqual(effectiveIssues(noLink, { category: noLink.categoryDefault, referenceUrl: 'https://x.com/a/status/9' }), []);
  // 서버가 링크를 채워 ready였던 행에서 사람이 링크를 지우면 즉시 🔴
  assert.equal(effectiveReadiness(filled, { category: filled.categoryDefault, referenceUrl: '' }), 'blocked');
  assert.deepEqual(effectiveIssues(filled, { category: filled.categoryDefault, referenceUrl: '' }).map((i) => i.code), ['no-reference']);
  // RT는 링크가 없어도 🟡(원본 트윗은 확인 자료가 아니다 — 증빙이 그 역할)
  const rtNoLink = computeCandidate({
    task: { id: 't6', type: 'rt', influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null,
            proof: { url: 'task/11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png', by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' } },
    campaign: { id: 'c1', name: 'N', kind: 'content', clientId: 'cl1', clientName: '기타' },
    influencer: { inRoster: true, method: { id: 'pm1', type: 'paypal', isDefault: true, holder: 'A', currency: 'JPY', email: 'a@x.com', updatedAt: '2026-08-27T00:00:00.000Z' } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.equal(effectiveReadiness(rtNoLink, { category: rtNoLink.categoryDefault, referenceUrl: '' }), 'warn');
  assert.deepEqual(effectiveIssues(rtNoLink, { category: rtNoLink.categoryDefault, referenceUrl: '' }).map((i) => i.code), ['no-reference']);
});
