import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskStage, isTaskUnused, isTaskOverdue, isTaskPreparing, matchesTaskFilter, targetStatus, targetUrlOf,
  summarizeTasks, summarizeTaskPerf, subtotalsByType, sortTasks, deriveTaskInfluencers, taskCampaignTotal,
  countsByTypeLabel, isSettlementCandidate, TASK_STAGE_LABEL, TARGETABLE_TYPES, TARGETING_TYPES,
  type TaskStageInput, type TaskCostInput,
} from './campaignJudgment.ts';

const T = '2026-08-28';
const base = (o: Partial<TaskStageInput> = {}): TaskStageInput => ({
  type: 'rt', draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, ...o,
});

test('1) 단계 우선순위 — 내려짐 > 게시됨 > 원고 상태 > 방문 > 예정', () => {
  assert.equal(taskStage(base({ postedAt: '2026-08-27', removedAt: '2026-08-28' }), T), 'removed');
  assert.equal(taskStage(base({ postedAt: '2026-08-27', draftStatus: 'draft' }), T), 'published');
  assert.equal(taskStage(base({ type: 'post', draftStatus: 'review' }), T), 'review');
  assert.equal(taskStage(base({ type: 'visit', visitOn: '2026-09-10' }), T), 'visitPending');
  assert.equal(taskStage(base({ type: 'visit', visitOn: '2026-08-27' }), T), 'visited');
  assert.equal(taskStage(base({ type: 'visit' }), T), 'visitPending');       // 방문일 미정도 '방문 전'
  assert.equal(taskStage(base(), T), 'planned');
  assert.equal(TASK_STAGE_LABEL.planned, '예정');
  assert.equal(TASK_STAGE_LABEL.visited, '방문 완료');
  assert.equal(TASK_STAGE_LABEL.removed, '내려짐');
  assert.deepEqual(TARGETABLE_TYPES, ['post', 'quoteRt', 'visit']);
  assert.deepEqual(TARGETING_TYPES, ['rt', 'quoteRt']);
});

test('2) 미사용·밀림 — 방문일은 밀림에 쓰지 않는다, 게시됨·미사용은 밀림 아님', () => {
  assert.equal(isTaskUnused(base({ type: 'post', draftStatus: 'unused' })), true);
  assert.equal(isTaskUnused(base({ type: 'post', draftStatus: 'unused', postedAt: '2026-08-20' })), false); // 게시했으면 미사용이 아니다
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27' }), T), true);
  assert.equal(isTaskOverdue(base({ scheduledOn: T }), T), false);
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27', postedAt: '2026-08-27' }), T), false);
  assert.equal(isTaskOverdue(base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' }), T), false);
  assert.equal(isTaskOverdue(base({ type: 'visit', visitOn: '2026-08-01' }), T), false);           // 방문일만 지남 → 밀림 아님
});

test('3) 준비 중·필터 — 준비 중 = 원고 초안·검수·확정 + 예정·방문 전·방문 완료', () => {
  assert.equal(isTaskPreparing(base(), T), true);
  assert.equal(isTaskPreparing(base({ type: 'visit', visitOn: '2026-08-01' }), T), true);
  assert.equal(isTaskPreparing(base({ type: 'post', draftStatus: 'delivered' }), T), false);
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'delivered' }), 'delivered', T), true);
  assert.equal(matchesTaskFilter(base({ postedAt: '2026-08-20' }), 'published', T), true);
  assert.equal(matchesTaskFilter(base({ postedAt: '2026-08-20', removedAt: '2026-08-21' }), 'published', T), true); // 내려짐도 게시는 했다
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'unused' }), 'all', T), true);
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'unused' }), 'preparing', T), false);
});

test('4) 대상 상태 — 없음/게시 대기/확정, URL은 작업의 post_url 우선', () => {
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: null }), 'none');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null }), 'pending');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: null }), 'ready');
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: 'https://x.com/i/status/2' }), 'ready');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: 'https://x.com/i/status/2' }), 'https://x.com/a/status/1');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null }), null);
});

test('5) 요약 — N은 미사용 제외, 게시됨은 내려짐 포함, 유형별 소계는 있는 유형만·TASK_TYPES 순', () => {
  const items = [
    { ...base({ type: 'post', draftStatus: 'delivered', postedAt: '2026-08-20' }), cost: { amount: 20000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'review' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'unused' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ scheduledOn: '2026-08-26' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ postedAt: '2026-08-20', removedAt: '2026-08-25' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ type: 'visit' }), cost: { amount: 300000, currency: 'KRW' as const } },
  ];
  assert.deepEqual(summarizeTasks(items, T), { total: 5, published: 2, delivered: 0, preparing: 3, overdue: 1, removed: 1 });
  const sub = subtotalsByType(items);
  assert.deepEqual(sub.map((s) => s.type), ['rt', 'quoteRt', 'post', 'visit']);
  // 브리프 원문은 published: 2였으나, rt 항목 중 postedAt이 있는 것은 1건(예정일만 있는 item4는 미게시)뿐이라
  // summarizeTasks(전체 published: 2 = post 1건 + rt 1건)와도 맞아떨어지는 값은 1이다 — 브리프 오타로 보고 수정(task-2-report.md 기록).
  assert.deepEqual(sub.find((s) => s.type === 'rt'), { type: 'rt', count: 2, published: 1, cost: { JPY: 6000 } });
  assert.deepEqual(sub.find((s) => s.type === 'quoteRt'), { type: 'quoteRt', count: 1, published: 0, cost: { JPY: 8000 } }); // 미사용 제외
  assert.deepEqual(summarizeTaskPerf(items.map((t) => ({ ...t, perf: t.postedAt ? { views: 100, likes: 1 } : null, linkClicks: null }))),
    { publishedCount: 2, views: 200, likes: 2, linkClicks: null });
});

test('6) 정렬 — 기본 만든 순(밀림도 자리 유지), 미사용은 어느 키든 맨 아래', () => {
  const mk = (id: string, createdAt: string, o: Partial<TaskStageInput> = {}, handle: string | null = null) =>
    ({ id, ...base(o), createdAt, influencerHandle: handle });
  const items = [
    mk('c', '2026-08-03', { type: 'post', draftStatus: 'unused' }),
    mk('a', '2026-08-01', { scheduledOn: '2026-08-20' }, 'zed'),
    mk('b', '2026-08-02', { scheduledOn: '2026-08-10' }, 'amy'),
  ];
  assert.deepEqual(sortTasks(items, 'created', T).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sortTasks(items, 'scheduled', T).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortTasks(items, 'influencer', T).map((x) => x.id), ['b', 'a', 'c']);
});

test('7) 인플 목록 — 작업 핸들 ∪ 비용 행, 유형별 건수, 미배정 묶음 맨 아래, 내려짐도 합계 포함', () => {
  const tasks: TaskCostInput[] = [
    { ...base({ type: 'post', draftStatus: 'delivered' }), influencerHandle: 'Mika', cost: { amount: 20000, currency: 'JPY' } },
    { ...base(), influencerHandle: 'rio', cost: { amount: 3000, currency: 'JPY' } },
    { ...base({ postedAt: '2026-08-20', removedAt: '2026-08-21' }), influencerHandle: 'RIO', cost: { amount: 3000, currency: 'JPY' } },
    { ...base({ type: 'quoteRt', draftStatus: 'unused' }), influencerHandle: 'rio', cost: { amount: 8000, currency: 'JPY' } },
    { ...base(), influencerHandle: null, cost: { amount: 1000, currency: 'KRW' } },
  ];
  const lines = deriveTaskInfluencers(tasks, [{ influencerHandle: 'hana', extraCosts: [{ label: '교통비', amount: 5000, currency: 'KRW' }], note: '' }]);
  assert.deepEqual(lines.map((l) => l.handle), ['rio', 'Mika', 'hana', null]);
  const rio = lines[0];
  assert.equal(rio.taskCount, 2);                                  // 미사용 제외
  assert.deepEqual(rio.countsByType, { rt: 2 });
  assert.deepEqual(rio.taskCost, { JPY: 6000 });                    // 내려짐 포함
  assert.equal(countsByTypeLabel(rio.countsByType), 'RT 2');
  assert.equal(countsByTypeLabel({ post: 1, rt: 3 }), 'RT 3 · 투고 1');   // TASK_TYPES 순(rt·quoteRt·post·visit)
  assert.equal(lines[2].hasCostRow, true);
  assert.equal(lines[2].taskCount, 0);
  assert.deepEqual(lines[3].subtotal, { KRW: 1000 });
  assert.deepEqual(taskCampaignTotal(lines), { JPY: 26000, KRW: 6000 });
});

test('8) 정산 후보 — 게시 확인 + 비용 + 인플. 내려짐은 조건이 아니다', () => {
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: '2026-08-21' }), true);
  assert.equal(isSettlementCandidate({ postedAt: null, cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: null, influencerHandle: 'a', removedAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: null, removedAt: null }), false);
});
