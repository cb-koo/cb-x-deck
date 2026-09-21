import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskCreateBody } from './taskCreateBody';

const base = { type: 'post' as const, handle: null, cost: null, scheduledOn: null, visitOn: null, note: '', target: null, draftId: null };

test('인플루언서가 없으면 빈 배열 — 서버가 미배정 한 행을 만든다', () => {
  const b = buildTaskCreateBody(base);
  assert.deepEqual(b.influencers, []);
  assert.equal(b.draftId, undefined);
});

test('인플루언서가 있으면 그 사람 한 줄에 비용이 실린다', () => {
  const b = buildTaskCreateBody({ ...base, handle: 'asyako0520', cost: { amount: 80000, currency: 'KRW' } });
  assert.deepEqual(b.influencers, [{ handle: 'asyako0520', cost: { amount: 80000, currency: 'KRW' } }]);
  assert.equal(b.cost, undefined);   // 사람 줄에 실렸으면 위쪽 cost는 안 보낸다
});

test('고른 원고가 있으면 draftId가 실린다 — 작업 생성과 부착이 한 번에 간다', () => {
  const b = buildTaskCreateBody({ ...base, handle: 'asyako0520', draftId: 'd-1' });
  assert.equal(b.draftId, 'd-1');
  assert.equal(b.influencers.length, 1);   // 서버 제약: draftId는 1개 이하일 때만
  assert.equal(b.count, undefined);        // 서버 제약: count와 함께 못 쓴다
});

test('방문협찬이 아니면 방문일은 보내지 않는다', () => {
  assert.equal(buildTaskCreateBody({ ...base, visitOn: '2026-09-25' }).visitOn, null);
  assert.equal(buildTaskCreateBody({ ...base, type: 'visit', visitOn: '2026-09-25' }).visitOn, '2026-09-25');
});

test('대상은 작업 선택과 링크 둘 중 하나로만 실린다', () => {
  assert.equal(buildTaskCreateBody({ ...base, type: 'rt', target: { taskId: 't-1' } }).targetTaskId, 't-1');
  assert.equal(buildTaskCreateBody({ ...base, type: 'rt', target: { url: 'https://x.com/a/status/1' } }).targetTweetUrl, 'https://x.com/a/status/1');
});
