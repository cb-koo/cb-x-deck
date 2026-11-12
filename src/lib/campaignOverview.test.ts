import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeek, plannedCount, quantityOf, cardStatus, CARD_STATUS_LABEL, type Quantity } from './campaignOverview.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

let n = 0;
const task = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '', otherKind: '', doneNote: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
});

test('resolveWeek: 주 중 날짜는 그 주 월요일로, 틀린 값과 미래 주는 이번 주', () => {
  const today = '2026-11-12';
  assert.deepEqual(resolveWeek(null, today), { weekStart: '2026-11-09', weekEnd: '2026-11-15', isCurrent: true });
  assert.deepEqual(resolveWeek('2026-11-05', today), { weekStart: '2026-11-02', weekEnd: '2026-11-08', isCurrent: false });
  assert.equal(resolveWeek('2026-11-16', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('garbage', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('2026-13-40', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('2026-02-30', today).weekStart, '2026-11-09');
  // 이번 주 안의 다른 날도 이번 주
  assert.deepEqual(resolveWeek('2026-11-15', today), { weekStart: '2026-11-09', weekEnd: '2026-11-15', isCurrent: true });
});

test('quantityOf: 취소는 계획에서 빼고 따로 센다, 예정일 지난 것과 미정을 가른다', () => {
  const today = '2026-11-12';
  const tasks = [
    task({ postedAt: '2026-11-10' }),
    task({ scheduledOn: '2026-11-10' }),            // 예정일 지남
    task({ scheduledOn: '2026-11-14' }),
    task({ scheduledOn: null }),                    // 미정
    task({ cancelledAt: '2026-11-09' }),
  ];
  const q = quantityOf(tasks, today);
  assert.deepEqual(q, { planned: 4, posted: 1, overdue: 1, open: 3, undated: 1, cancelled: 1 });
  assert.equal(plannedCount(tasks), 4);
});

test('quantityOf: 게시된 작업은 예정일이 지났거나 없어도 밀림·미정이 아니다', () => {
  const q = quantityOf([task({ postedAt: '2026-11-10', scheduledOn: '2026-11-01' })], '2026-11-12');
  assert.deepEqual(q, { planned: 1, posted: 1, overdue: 0, open: 0, undated: 0, cancelled: 0 });
});

test('cardStatus 네 가지와 문구', () => {
  const q = (o: Partial<Quantity>) => ({ planned: 5, posted: 2, overdue: 0, open: 3, undated: 0, cancelled: 0, ...o });
  assert.equal(cardStatus(q({ planned: 0, posted: 0, open: 0 })), 'unset');
  assert.equal(cardStatus(q({ posted: 5, open: 0 })), 'done');
  assert.equal(cardStatus(q({ overdue: 2 })), 'late');
  assert.equal(cardStatus(q({})), 'onTrack');
  assert.equal(CARD_STATUS_LABEL('late', 2), '예정일 지난 2건');
  assert.equal(CARD_STATUS_LABEL('done', 0), '✓ 계획 완료');
  assert.equal(CARD_STATUS_LABEL('unset', 0), '세팅 전');
  assert.equal(CARD_STATUS_LABEL('onTrack', 0), '예정대로');
});
