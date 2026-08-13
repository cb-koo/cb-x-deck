import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOWUP_DAYS, PROFILE_STALE_DAYS, judgeContact, isProfileStale, summarizeDraftStatuses,
} from './influencerJudgment.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-13T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

test('상수: FOLLOWUP_DAYS=14, PROFILE_STALE_DAYS=30', () => {
  assert.equal(FOLLOWUP_DAYS, 14);
  assert.equal(PROFILE_STALE_DAYS, 30);
});

test('judgeContact: 14일 경계 — 13.9일은 false, 14.1일은 true', () => {
  const under = judgeContact(ago(13.9), ago(100), NOW);
  assert.equal(under.needsFollowup, false);

  const over = judgeContact(ago(14.1), ago(100), NOW);
  assert.equal(over.needsFollowup, true);
});

test('judgeContact: 연락 기록이 없으면 createdAt을 기준으로 팔로업 판단', () => {
  const recent = judgeContact(null, ago(10), NOW);
  assert.equal(recent.needsFollowup, false);
  assert.equal(recent.daysSince, null);
  assert.equal(recent.label, '연락 기록 없음');

  const stale = judgeContact(null, ago(15), NOW);
  assert.equal(stale.needsFollowup, true);
  assert.equal(stale.daysSince, null);
  assert.equal(stale.label, '연락 기록 없음');
});

test('judgeContact: daysSince — 기록 있으면 경과일, 라벨은 "연락 기록 N일 전"', () => {
  const j = judgeContact(ago(3.5), ago(100), NOW);
  assert.equal(j.daysSince, 3);
  assert.equal(j.label, '연락 기록 3일 전');
});

test('judgeContact: 오늘(0일) 연락은 별도 라벨', () => {
  const j = judgeContact(NOW.toISOString(), ago(100), NOW);
  assert.equal(j.daysSince, 0);
  assert.equal(j.label, '오늘 연락 기록');
  assert.equal(j.needsFollowup, false);
});

test('isProfileStale: 30일 경계 — 29.9일 false, 30.1일 true', () => {
  assert.equal(isProfileStale(ago(29.9), NOW), false);
  assert.equal(isProfileStale(ago(30.1), NOW), true);
});

test('isProfileStale: null(미조회)은 항상 false', () => {
  assert.equal(isProfileStale(null, NOW), false);
});

test('summarizeDraftStatuses: 빈 객체 → 빈 문자열', () => {
  assert.equal(summarizeDraftStatuses({}), '');
});

test('summarizeDraftStatuses: 0/부재 상태는 생략, 존재하는 상태만 draftStatus.ts 표시 순서로 결합', () => {
  // DRAFT_STATUSES 순서: draft, review, approved, delivered, unused
  assert.equal(summarizeDraftStatuses({ delivered: 1, draft: 2, review: 0 }), '초안 2 · 전달됨 1');
});

test('summarizeDraftStatuses: 상태 라벨은 draftStatus.ts의 STATUS_LABEL을 그대로 재사용', () => {
  assert.equal(summarizeDraftStatuses({ approved: 3 }), '사용 확정 3');
  assert.equal(summarizeDraftStatuses({ unused: 1, draft: 1, review: 1, approved: 1, delivered: 1 }),
    '초안 1 · 검수 대기 1 · 사용 확정 1 · 전달됨 1 · 미사용 1');
});
