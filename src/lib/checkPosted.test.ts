import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChecks, judgeRetweeters, taskToCheck, type CheckTask } from './checkPosted.ts';

const t = (o: Partial<CheckTask> & { id: string }): CheckTask => ({ influencerHandle: 'a', postedAt: null, targetTweetId: '1', targetPending: false, targetCancelled: false, ...o });

test('plan — 트윗별 묶음(같은 트윗 두 작업 = 한 그룹), 대상 미정·게시 대기·인플 없음·대상 취소는 건너뜀, 이미 확인된 것도 그룹에 든다(사라짐 감지)', () => {
  const { byTweet, skipped } = planChecks([
    t({ id: 'a', influencerHandle: 'rio' }), t({ id: 'b', influencerHandle: 'sora' }),
    t({ id: 'c', influencerHandle: 'kei', targetTweetId: '2' }),
    t({ id: 'd', influencerHandle: 'x', targetTweetId: null }),
    t({ id: 'e', influencerHandle: 'y', targetTweetId: null, targetPending: true }),
    t({ id: 'f', influencerHandle: null }),
    t({ id: 'g', influencerHandle: 'hana', postedAt: '2026-09-01' }),
    t({ id: 'h', influencerHandle: 'yuki', targetTweetId: '3', targetCancelled: true }),
  ]);
  assert.deepEqual([...byTweet.keys()], ['1', '2']);
  assert.deepEqual(byTweet.get('1')!.map((x) => x.id), ['a', 'b', 'g']);
  assert.deepEqual(skipped, [
    { taskId: 'd', handle: 'x', reason: 'no_target' }, { taskId: 'e', handle: 'y', reason: 'target_not_posted' }, { taskId: 'f', handle: '', reason: 'no_handle' }, { taskId: 'h', handle: 'yuki', reason: 'target_cancelled' },
  ]);
});

test('judge — lower 비교, 미확인+있음=confirmed, 미확인+없음=pending, 확인됨+없음=missing, 확인됨+있음=아무 것도 아님, targetCancelled 무관', () => {
  const r = judgeRetweeters([
    t({ id: 'a', influencerHandle: 'Rio' }), t({ id: 'b', influencerHandle: 'sora' }),
    t({ id: 'g', influencerHandle: 'hana', postedAt: '2026-09-01' }), t({ id: 'h', influencerHandle: 'ten', postedAt: '2026-09-01' }),
  ], ['rio', 'TEN', 'other']);
  assert.deepEqual(r.confirmed, [{ taskId: 'a', handle: 'Rio' }]);
  assert.deepEqual(r.pending, [{ taskId: 'b', handle: 'sora' }]);
  assert.deepEqual(r.missing, [{ taskId: 'g', handle: 'hana' }]);
});

test('taskToCheck — 대상 URL은 작업 참조의 post_url 우선, 게시 대기 표시, 대상 취소 감지', () => {
  assert.deepEqual(taskToCheck({ id: 'a', influencerHandle: 'rio', postedAt: null, targetTaskId: 't', targetTweetUrl: null, target: { postUrl: 'https://x.com/m/status/77', cancelledAt: null } }),
    { id: 'a', influencerHandle: 'rio', postedAt: null, targetTweetId: '77', targetPending: false, targetCancelled: false });
  assert.deepEqual(taskToCheck({ id: 'b', influencerHandle: 'rio', postedAt: null, targetTaskId: 't', targetTweetUrl: null, target: { postUrl: null, cancelledAt: null } }),
    { id: 'b', influencerHandle: 'rio', postedAt: null, targetTweetId: null, targetPending: true, targetCancelled: false });
  assert.deepEqual(taskToCheck({ id: 'd', influencerHandle: 'rio', postedAt: null, targetTaskId: 't', targetTweetUrl: null, target: { postUrl: 'https://x.com/m/status/88', cancelledAt: '2026-09-01' } }),
    { id: 'd', influencerHandle: 'rio', postedAt: null, targetTweetId: '88', targetPending: false, targetCancelled: true });
  assert.equal(taskToCheck({ id: 'c', influencerHandle: 'rio', postedAt: null, targetTaskId: null, targetTweetUrl: 'https://x.com/i/status/5', target: null }).targetTweetId, '5');
});
