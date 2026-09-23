import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetPreviewState, targetPreviewStateOfValue } from './targetPreviewView.ts';

const tg = (p: Partial<NonNullable<Parameters<typeof targetPreviewState>[0]['target']>>) => ({
  taskId: 'x', type: 'post' as const, influencerHandle: 'c', campaignId: 'c1', campaignName: '캠', postUrl: null, postedAt: null, cancelledAt: null, ...p,
});

test('대상 상태 — 미정 / 게시 전 / 링크 없는 게시 확인 / 취소 / 링크', () => {
  assert.deepEqual(targetPreviewState({ targetTaskId: null, targetTweetUrl: null, target: null }), { kind: 'none' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({}) }), { kind: 'pending' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ postedAt: '2026-09-20' }) }), { kind: 'pending' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ cancelledAt: '2026-09-20' }) }), { kind: 'cancelled' });
  assert.deepEqual(targetPreviewState({ targetTaskId: 'x', targetTweetUrl: null, target: tg({ postUrl: 'https://x.com/c/status/1' }) }), { kind: 'link', url: 'https://x.com/c/status/1' });
  assert.deepEqual(targetPreviewState({ targetTaskId: null, targetTweetUrl: 'https://x.com/d/status/2', target: null }), { kind: 'link', url: 'https://x.com/d/status/2' });
});

test('새 작업 폼의 대상 — 없음 / 링크 / 고른 작업(조회 전·게시 전·게시됨)', () => {
  assert.deepEqual(targetPreviewStateOfValue(null), { kind: 'none' });
  assert.deepEqual(targetPreviewStateOfValue({ url: 'https://x.com/d/status/2' }), { kind: 'link', url: 'https://x.com/d/status/2' });
  assert.deepEqual(targetPreviewStateOfValue({ taskId: 'x' }), { kind: 'pending' });
  assert.deepEqual(targetPreviewStateOfValue({ taskId: 'x', postUrl: null }), { kind: 'pending' });
  assert.deepEqual(targetPreviewStateOfValue({ taskId: 'x', postUrl: 'https://x.com/c/status/1' }), { kind: 'link', url: 'https://x.com/c/status/1' });
});
