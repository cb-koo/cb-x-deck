import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignOptionsFor } from './draftCampaignOptions.ts';

const T = '2026-08-27';
const all = [
  { id: 'a', clientId: 'c1', startsOn: '2026-08-24', endsOn: '2026-08-30' },   // c1 진행 중
  { id: 'u', clientId: 'c1', startsOn: '2026-09-07', endsOn: '2026-09-13' },   // c1 예정
  { id: 'e', clientId: 'c1', startsOn: '2026-08-03', endsOn: '2026-08-09' },   // c1 종료
  { id: 'o', clientId: 'c2', startsOn: '2026-08-24', endsOn: '2026-08-30' },   // 다른 클라
  { id: 'n', clientId: null, startsOn: '2026-08-24', endsOn: '2026-08-30' },   // 클라 삭제된 캠페인
];

test('1) 클라이언트가 있는 원고 — 그 클라의 진행 중·예정이 open, 종료는 ended, 다른 클라는 제외', () => {
  const r = campaignOptionsFor(all, 'c1', T, null);
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u']);
  assert.deepEqual(r.ended.map((c) => c.id), ['e']);
});

test('2) 현재 소속 캠페인은 클라가 달라도 목록에 남는다 — 표시가 값과 어긋나지 않게(라벨-값 일치)', () => {
  const r = campaignOptionsFor(all, 'c1', T, 'o');
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u', 'o']);
});

test('3) 클라이언트 없는 원고는 전체 캠페인(스펙 §4-2)', () => {
  const r = campaignOptionsFor(all, null, T, null);
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u', 'o', 'n']);
  assert.deepEqual(r.ended.map((c) => c.id), ['e']);
});
