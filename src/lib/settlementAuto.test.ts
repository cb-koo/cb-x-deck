import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastMondaySeven, nextMondaySeven, confirmedInstant, isDue, sendAtFor, pendingGroup, blockingIssues } from './settlementAuto.ts';
import { computeCandidate } from './settlementCalc.ts';
import { SETTLEMENT_DEFAULTS } from './settlementSettings.ts';
import type { PaymentMethod } from './influencerPayment.ts';
import type { TaskType } from './campaignJudgment.ts';

// 서울 벽시계 → 순간
const kst = (s: string) => new Date(`${s}+09:00`);

test('lastMondaySeven — 월요일 7시 전후·주중·일요일 밤', () => {
  // 2026-10-12는 월요일
  assert.equal(lastMondaySeven(kst('2026-10-12T06:59:59')).toISOString(), kst('2026-10-05T07:00:00').toISOString());
  assert.equal(lastMondaySeven(kst('2026-10-12T07:00:00')).toISOString(), kst('2026-10-12T07:00:00').toISOString());
  assert.equal(lastMondaySeven(kst('2026-10-15T13:00:00')).toISOString(), kst('2026-10-12T07:00:00').toISOString());
  assert.equal(lastMondaySeven(kst('2026-10-18T23:59:00')).toISOString(), kst('2026-10-12T07:00:00').toISOString());
  // 서울 월요일 00:30 = UTC 일요일 — UTC 요일로 자르면 틀린다
  assert.equal(lastMondaySeven(kst('2026-10-19T00:30:00')).toISOString(), kst('2026-10-12T07:00:00').toISOString());
  // 월 경계
  assert.equal(lastMondaySeven(kst('2026-11-01T12:00:00')).toISOString(), kst('2026-10-26T07:00:00').toISOString());
});

test('nextMondaySeven — 언제나 now 뒤', () => {
  assert.equal(nextMondaySeven(kst('2026-10-12T06:00:00')).toISOString(), kst('2026-10-12T07:00:00').toISOString());
  assert.equal(nextMondaySeven(kst('2026-10-12T07:00:00')).toISOString(), kst('2026-10-19T07:00:00').toISOString());
  assert.equal(nextMondaySeven(kst('2026-10-18T22:00:00')).toISOString(), kst('2026-10-19T07:00:00').toISOString());
});

test('isDue — 이번 주 월요일 7시 전에 확인된 것만, 놓쳐도 다음 실행에서 잡힌다', () => {
  const now = kst('2026-10-12T07:05:00');
  assert.equal(isDue(kst('2026-10-11T23:00:00'), now), true);    // 일요일 밤 확인 → 월요일 아침에 나감
  assert.equal(isDue(kst('2026-10-12T06:59:00'), now), true);
  assert.equal(isDue(kst('2026-10-12T07:01:00'), now), false);   // 7시 이후 확인 → 다음 주
  assert.equal(isDue(kst('2026-10-12T07:01:00'), kst('2026-10-19T07:00:00')), true);
  assert.equal(isDue(kst('2026-10-08T10:00:00'), kst('2026-10-14T15:00:00')), true);   // 수요일에 고친 지난주 확인 건 → 바로
  assert.equal(sendAtFor(kst('2026-10-13T10:00:00'), kst('2026-10-14T15:00:00'))?.toISOString(), kst('2026-10-19T07:00:00').toISOString());
  assert.equal(sendAtFor(kst('2026-10-08T10:00:00'), kst('2026-10-14T15:00:00')), null);
});

test('confirmedInstant — 070 이전 행은 게시일 서울 00:00', () => {
  assert.equal(confirmedInstant(null, '2026-10-10').toISOString(), kst('2026-10-10T00:00:00').toISOString());
  assert.equal(confirmedInstant('2026-10-10T05:00:00.000Z', '2026-10-09').toISOString(), '2026-10-10T05:00:00.000Z');
});

const paypal: PaymentMethod = { id: 'pm1', type: 'paypal', isDefault: true, holder: 'A', currency: 'JPY', email: 'a@b.c', updatedAt: '2026-08-27T00:00:00.000Z' };
function cand(o: { type?: TaskType; method?: PaymentMethod | null; proof?: boolean; agreement?: boolean; removedAt?: string | null; unseenOn?: string | null; postUrl?: string | null }) {
  const type = o.type ?? 'quoteRt';
  return computeCandidate({
    task: { id: 't', type, influencerHandle: 'a', cost: { amount: 10000, currency: 'KRW' }, postUrl: o.postUrl === undefined ? 'https://x.com/a/status/1' : o.postUrl,
      targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-10-10', removedAt: o.removedAt ?? null, removedReason: '', draftLabel: null,
      proof: o.proof ? { url: 'task/x.png', at: '2026-10-10T00:00:00.000Z', by: 'm', byName: 'M' } : null, hasAgreement: !!o.agreement, unseenOn: o.unseenOn ?? null },
    campaign: { id: 'c', name: 'C', kind: 'content', clientId: 'cl', clientName: '클' },
    influencer: { inRoster: true, method: o.method === undefined ? paypal : o.method },
    settings: { ...SETTLEMENT_DEFAULTS, categories: SETTLEMENT_DEFAULTS.categories.map((c) => ({ ...c, defaultFor: c.id === 'fee' ? ['quoteRt', 'post', 'visit'] : c.defaultFor })) },
    lastQuoteRtCategory: null, today: '2026-10-12',
  });
}
const none = { hold: null, cancelled: null };

test('pendingGroup — 막힘·확인 필요·기다림·멈춤', () => {
  assert.equal(pendingGroup(cand({}), none), 'waiting');
  assert.equal(pendingGroup(cand({ method: null }), none), 'blocked');
  assert.equal(pendingGroup(cand({ type: 'rt' }), none), 'blocked');                       // RT 증빙 없음
  assert.equal(pendingGroup(cand({ type: 'rt', proof: true, postUrl: null }), none), 'waiting');   // RT 링크 없음(🟡)은 통과
  assert.equal(pendingGroup(cand({ type: 'visit' }), none), 'blocked');                    // 동의서 없음 — 자동 전송에선 막음
  assert.equal(pendingGroup(cand({ type: 'visit', agreement: true }), none), 'waiting');
  assert.equal(pendingGroup(cand({ removedAt: '2026-10-11' }), none), 'attention');
  assert.equal(pendingGroup(cand({ unseenOn: '2026-10-11' }), none), 'attention');
  assert.equal(pendingGroup(cand({ unseenOn: '2026-10-11', method: null }), none), 'attention');   // 사람 판단이 먼저
  assert.equal(pendingGroup(cand({}), { hold: { at: 'x', byName: 'M', reason: 'r' }, cancelled: null }), 'stopped');
  assert.equal(pendingGroup(cand({ method: null }), { hold: null, cancelled: { at: 'x', byName: null, reason: null } }), 'stopped');
});

test('blockingIssues — 내림·안 보임은 막는 이유가 아니다(확인 후 보낼 수 있다)', () => {
  assert.deepEqual(blockingIssues(cand({ removedAt: '2026-10-11' })).map((i) => i.code), []);
  assert.deepEqual(blockingIssues(cand({ type: 'visit' })).map((i) => i.code), ['no-agreement']);
});

import { removalAfterSend, requesterLabel } from './settlementAuto.ts';
test('removalAfterSend — 지급 전이면 할 일, 지급 후면 기록, 확인했으면 기록, 취소면 없음', () => {
  const base = { status: 'requested', externalStatus: 'scheduled', removalAckAt: null, removalAckByName: null, taskRemovedAt: '2026-10-14', taskRemovedReason: '이슈로 내림', taskUnseenOn: null, createdVia: 'auto' as const, createdAt: '2026-10-12T00:00:00.000Z' };
  assert.equal(removalAfterSend(base)?.kind, 'act');
  assert.match(removalAfterSend(base)!.text, /10\/14에 글이 내려갔어요 \(이슈로 내림\)/);
  assert.equal(removalAfterSend({ ...base, externalStatus: 'paid' })?.kind, 'info');
  assert.equal(removalAfterSend({ ...base, removalAckAt: 'x', removalAckByName: 'M' })?.kind, 'acked');
  assert.equal(removalAfterSend({ ...base, status: 'cancelled' }), null);
  assert.equal(removalAfterSend({ ...base, taskRemovedAt: null }), null);
  assert.match(removalAfterSend({ ...base, taskRemovedAt: null, taskUnseenOn: '2026-10-13' })!.text, /10\/13부터 글이 안 보여요/);
  // 사람이 [확인하고 보내기]로 보낸 건 — 보낸 날까지의 내림은 이미 본 것
  assert.equal(removalAfterSend({ ...base, createdVia: 'manual', taskRemovedAt: '2026-10-12' }), null);
  assert.equal(removalAfterSend({ ...base, createdVia: 'manual', taskRemovedAt: '2026-10-13' })?.kind, 'act');
});
test('requesterLabel — 자동은 풀어 쓴다', () => {
  assert.equal(requesterLabel({ createdVia: 'manual', requesterName: '박구건', requesterMemberId: 'm' }), '박구건');
  assert.equal(requesterLabel({ createdVia: 'auto', requesterName: 'moeka', requesterMemberId: 'm' }), '자동 전송 · 작업 만든 사람 moeka');
  assert.equal(requesterLabel({ createdVia: 'auto', requesterName: '자동 전송', requesterMemberId: null }), '자동 전송');
});
