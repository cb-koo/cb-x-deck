import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLinklessPosted, linklessNote, linklessGateError, LINKLESS_REASON_REQUIRED_MESSAGE, LINKLESS_KEEP_REMOVED_MESSAGE } from './linklessPost.ts';
import { postedAtFromLinkGate, POST_URL_REQUIRED_MESSAGE } from './campaignTaskInput.ts';

// ISSUE-009 링크 없이 게시 확인 — 게시일 + 내림(확인한 날) + 지워진 이유가 한 묶음이다
const pre = { type: 'quoteRt' as const, postedAt: null, postUrl: null, removedAt: null, removedReason: '' };
const done = { ...pre, postedAt: '2026-10-30', removedAt: '2026-11-04', removedReason: '이슈로 내림' };

test('isLinklessPosted·linklessNote — 이유 있는 내림과 함께인 링크 없는 게시만', () => {
  assert.equal(isLinklessPosted(done), true);
  assert.equal(linklessNote(done), '[게시물 삭제] 이슈로 내림 (게시 10/30, 지워짐 확인 11/4)');
  assert.equal(isLinklessPosted({ ...done, type: 'rt' }), false);                       // RT는 원래 링크가 없다
  assert.equal(isLinklessPosted({ ...done, postUrl: 'https://x.com/a/status/1' }), false);
  assert.equal(isLinklessPosted({ ...done, removedReason: '  ' }), false);
  assert.equal(linklessNote(pre), null);
});

test('linklessGateError — 링크 없는 게시 확인은 같은 요청에 지워진 이유가 있어야 한다', () => {
  assert.equal(linklessGateError(pre, { postedAt: '2026-10-30' }), LINKLESS_REASON_REQUIRED_MESSAGE);
  assert.equal(linklessGateError(pre, { postedAt: '2026-10-30', removedAt: '2026-11-04', removedReason: ' ' }), LINKLESS_REASON_REQUIRED_MESSAGE);
  assert.equal(linklessGateError(pre, { postedAt: '2026-10-30', removedAt: '2026-11-04', removedReason: '이슈로 내림' }), null);
  assert.equal(linklessGateError(pre, { postedAt: '2026-10-30', postUrl: 'https://x.com/a/status/1' }), null);   // 보통 경로
  assert.equal(linklessGateError({ ...pre, type: 'rt' }, { postedAt: '2026-10-30' }), null);                  // RT는 증빙 규칙이 맡는다
});

test('linklessGateError — 링크 없이 게시된 작업은 내림을 풀거나 이유를 비울 수 없다(링크를 붙이면 괜찮다)', () => {
  assert.equal(linklessGateError(done, { removedAt: null, removedReason: '' }), LINKLESS_KEEP_REMOVED_MESSAGE);
  assert.equal(linklessGateError(done, { removedReason: '' }), LINKLESS_KEEP_REMOVED_MESSAGE);
  assert.equal(linklessGateError(done, { removedReason: '협의 후 내림' }), null);
  assert.equal(linklessGateError(done, { removedAt: null, removedReason: '', postUrl: 'https://x.com/a/status/1' }), null);
  assert.equal(linklessGateError(done, { note: '메모' } as never), null);
});

test('postedAtFromLinkGate — 지워진 이유가 함께 오면 링크 없이 보낸 날짜 그대로', () => {
  assert.deepEqual(postedAtFromLinkGate({ type: 'quoteRt', postUrl: null }, { postedAt: '2026-10-30', removedAt: '2026-11-04', removedReason: '이슈로 내림' }), { ok: true, value: '2026-10-30' });
  assert.deepEqual(postedAtFromLinkGate({ type: 'post', postUrl: null }, { postedAt: '2026-10-30', removedAt: '2026-11-04', removedReason: '' }), { ok: false, message: POST_URL_REQUIRED_MESSAGE });
});
