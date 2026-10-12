import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskSectionOpen, visitPhaseFromRow, changedAtLabel, type TaskSectionKey, type TaskSectionPrefs } from './taskSectionView.ts';
import type { CampaignTaskItem } from './campaignStore.ts';
import type { VisitPhase } from './reservationPolicy.ts';

const T = '2026-09-18';
let n = 0;
const mk = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: 'a', type: 'visit', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null,
  createdAt: '', updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null, costChangeCount: 0, replies: [], unseenSince: null, seenAfterRemovedAt: null,
  published: false, perf: null, linkClicks: null, settlement: null, ...p,
});
const keys: TaskSectionKey[] = ['history', 'consent', 'money', 'draft', 'memo', 'posting'];
const opened = (phase: VisitPhase, preferences: TaskSectionPrefs = {}) => keys.filter((key) => taskSectionOpen(phase, key, preferences));

test('방문 단계에 필요한 상자만 기본으로 펼친다(목업 task-presentation과 같은 규칙)', () => {
  assert.deepEqual(opened('unregistered'), []);
  assert.deepEqual(opened('waiting'), []);
  assert.deepEqual(opened('confirmed'), ['consent']);
  assert.deepEqual(opened('visited'), ['draft', 'posting']);
  assert.deepEqual(opened('uploaded'), ['money']);
  assert.deepEqual(opened('settling'), ['money']);
  assert.deepEqual(opened('completed'), []);
  assert.deepEqual(opened('cancelled'), []);
  assert.deepEqual(opened('visit_no_show'), []);
});

test('직접 펼친 내역과 메모는 단계가 바뀌어도 유지한다', () => {
  const preferences: TaskSectionPrefs = { history: { open: true, phase: 'waiting' }, memo: { open: true, phase: 'waiting' } };
  assert.deepEqual(opened('confirmed', preferences), ['history', 'consent', 'memo']);
  assert.deepEqual(opened('visited', preferences), ['history', 'draft', 'memo', 'posting']);
  assert.deepEqual(opened('uploaded', preferences), ['history', 'money', 'memo']);
});

test('지금 단계에서 접은 상자는 그대로 접고, 새로 관련 있는 단계에 들어서면 다시 펼친다', () => {
  assert.equal(taskSectionOpen('visited', 'posting', { posting: { open: false, phase: 'visited' } }), false);
  assert.equal(taskSectionOpen('visited', 'posting', { posting: { open: false, phase: 'confirmed' } }), true);
  assert.equal(taskSectionOpen('uploaded', 'money', { money: { open: false, phase: 'visited' } }), true);
  assert.equal(taskSectionOpen('uploaded', 'posting', { posting: { open: true, phase: 'visited' } }), true);
});

test('표 행만으로 어림한 방문 단계 — 서버 visitPhase와 같은 순서·판정', () => {
  assert.equal(visitPhaseFromRow(mk({ cancelledAt: '2026-09-10T00:00:00Z' }), T), 'cancelled');
  assert.equal(visitPhaseFromRow(mk({ postedAt: '2026-09-10', noCost: true }), T), 'completed');
  assert.equal(visitPhaseFromRow(mk({ postedAt: '2026-09-10', settledElsewhereAt: '2026-09-11T00:00:00Z' }), T), 'uploaded');   // 서버 방문 단계와 같게(flowStage의 '완료'와 다르다)
  assert.equal(visitPhaseFromRow(mk({ postedAt: '2026-09-10', settlement: { status: 'requested', externalStatus: 'paid' } as CampaignTaskItem['settlement'] }), T), 'completed');
  assert.equal(visitPhaseFromRow(mk({ postedAt: '2026-09-10', settlement: { status: 'requested', externalStatus: 'received' } as CampaignTaskItem['settlement'] }), T), 'settling');
  assert.equal(visitPhaseFromRow(mk({ postedAt: '2026-09-10' }), T), 'uploaded');
  assert.equal(visitPhaseFromRow(mk({}), T), 'unregistered');                              // 예약 칸 없는 DB
  assert.equal(visitPhaseFromRow(mk({ reservation: null }), T), 'unregistered');
  assert.equal(visitPhaseFromRow(mk({ reservation: 'waiting', visitOn: '2026-09-01' }), T), 'waiting');   // 대기 중 방문일이 지나도 방문이 아니다
  assert.equal(visitPhaseFromRow(mk({ reservation: 'confirmed', visitOn: T }), T), 'confirmed');       // 당일은 아직 확정
  assert.equal(visitPhaseFromRow(mk({ reservation: 'confirmed', visitOn: '2026-09-17' }), T), 'visited');
  assert.equal(visitPhaseFromRow(mk({ reservation: 'confirmed' }), T), 'confirmed');
});

test('변경 시각은 한국 시간 "YYYY. MM. DD. HH:mm"', () => {
  assert.equal(changedAtLabel('2026-10-07T05:04:00Z'), '2026. 10. 07. 14:04');
  assert.equal(changedAtLabel('not-a-date'), '');
});
