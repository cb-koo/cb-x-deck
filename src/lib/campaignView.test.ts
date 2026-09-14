import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCampaigns, pickCampaignId, periodLabel, listSubline, parseDetailView, DETAIL_VIEW_KEY } from './campaignView.ts';

const T = '2026-08-27';
const rows = [
  { id: 'u', startsOn: '2026-09-07', endsOn: '2026-09-13', taskCount: 0 },  // 예정
  { id: 'a', startsOn: '2026-08-24', endsOn: '2026-08-30', taskCount: 3 },  // 진행 중
  { id: 'e', startsOn: '2026-08-03', endsOn: '2026-08-09', taskCount: 5 },  // 종료
];

test('1) 그룹 — 상태는 campaignStatus로만(수동 상태 없음), 그룹 안 순서는 입력 순서 유지', () => {
  const g = groupCampaigns(rows, T);
  assert.deepEqual(g.active.map((r) => r.id), ['a']);
  assert.deepEqual(g.upcoming.map((r) => r.id), ['u']);
  assert.deepEqual(g.ended.map((r) => r.id), ['e']);
});

test('2) 선택 — ?id=가 있으면 그것, 없으면 진행 중→예정→종료 첫 번째, 무효 id는 missing=true + 폴백', () => {
  assert.deepEqual(pickCampaignId(rows, 'e', T), { id: 'e', missing: false });
  assert.deepEqual(pickCampaignId(rows, null, T), { id: 'a', missing: false });
  assert.deepEqual(pickCampaignId(rows, 'zzz', T), { id: 'a', missing: true });
  assert.deepEqual(pickCampaignId([rows[0], rows[2]], null, T), { id: 'u', missing: false });   // 진행 중 없음 → 예정
  assert.deepEqual(pickCampaignId([rows[2]], null, T), { id: 'e', missing: false });            // 종료만 있으면 종료
  assert.deepEqual(pickCampaignId([], 'zzz', T), { id: null, missing: true });
  assert.deepEqual(pickCampaignId([], null, T), { id: null, missing: false });
});

test('3) 문구·보기 기억', () => {
  assert.equal(periodLabel('2026-08-24', '2026-08-30'), '8/24 월 ~ 8/30 일');
  assert.equal(listSubline(rows[1]), '8/24 월 ~ 8/30 일 · 작업 3건');
  assert.equal(parseDetailView('calendar'), 'calendar');
  assert.equal(parseDetailView('table'), 'table');
  assert.equal(parseDetailView(null), 'table');        // 기본 표(스펙 §3-2)
  assert.equal(parseDetailView('garbage'), 'table');
  assert.equal(DETAIL_VIEW_KEY, 'campaign-detail-view');
});
