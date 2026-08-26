import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDraftFieldPatch, CAMPAIGN_ID_MESSAGE, SCHEDULED_ON_MESSAGE,
} from './draftFieldPatch.ts';
import { AMOUNT_MESSAGE } from './campaignCost.ts';

const UUID = '11111111-2222-4333-8444-555555555555';

test('1) 빈 body → 키 없는 패치(전부 건드리지 않음)', () => {
  assert.deepEqual(parseDraftFieldPatch({}), { ok: true, value: {} });
  assert.deepEqual(parseDraftFieldPatch(null), { ok: true, value: {} });   // 객체가 아니면 빈 패치 — 라우트가 다른 필드 검증을 이어간다
  assert.deepEqual(parseDraftFieldPatch('x'), { ok: true, value: {} });
});

test('2) campaignId — uuid 또는 null(캠페인에서 빼기)만', () => {
  assert.deepEqual(parseDraftFieldPatch({ campaignId: UUID }), { ok: true, value: { campaignId: UUID } });
  assert.deepEqual(parseDraftFieldPatch({ campaignId: null }), { ok: true, value: { campaignId: null } });
  const bad = parseDraftFieldPatch({ campaignId: 'abc' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, CAMPAIGN_ID_MESSAGE);
  assert.equal(parseDraftFieldPatch({ campaignId: 3 }).ok, false);
});

test('3) scheduledOn — YYYY-MM-DD 또는 null, 시각이 붙은 ISO·빈 문자열은 거절', () => {
  assert.deepEqual(parseDraftFieldPatch({ scheduledOn: '2026-08-26' }), { ok: true, value: { scheduledOn: '2026-08-26' } });
  assert.deepEqual(parseDraftFieldPatch({ scheduledOn: null }), { ok: true, value: { scheduledOn: null } });
  const bad = parseDraftFieldPatch({ scheduledOn: '2026-08-26T00:00:00Z' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, SCHEDULED_ON_MESSAGE);
  assert.equal(parseDraftFieldPatch({ scheduledOn: '' }).ok, false);     // 지움은 null로만 — ''를 조용히 null로 바꾸지 않는다
});

test('4) cost — parseDraftCost에 위임(문구 그대로), 셋이 함께 와도 각각 검증', () => {
  const ok = parseDraftFieldPatch({
    campaignId: UUID, scheduledOn: '2026-08-26', cost: { type: 'post', amount: '300,000', currency: 'KRW' },
  });
  assert.deepEqual(ok, { ok: true, value: {
    campaignId: UUID, scheduledOn: '2026-08-26', cost: { type: 'post', amount: 300000, currency: 'KRW' },
  } });
  assert.deepEqual(parseDraftFieldPatch({ cost: null }), { ok: true, value: { cost: null } });
  const bad = parseDraftFieldPatch({ cost: { type: 'post', amount: -1, currency: 'KRW' } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, AMOUNT_MESSAGE);
  assert.equal(parseDraftFieldPatch({ cost: 'x' }).ok, false);
});

test('5) 관계없는 키는 무시 — status·title 등은 각 라우트가 따로 검증한다', () => {
  assert.deepEqual(parseDraftFieldPatch({ status: 'review', title: 'x', ids: [UUID] }), { ok: true, value: {} });
});
