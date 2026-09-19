import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskStage, isTaskOverdue, isTaskPreparing, matchesTaskFilter, targetStatus, targetUrlOf,
  summarizeTasks, summarizeTaskPerf, subtotalsByType, sortTasks, deriveTaskInfluencers, taskCampaignTotal,
  countsByTypeLabel, isSettlementCandidate, isTaskExcluded, flowStage, TASK_STAGE_LABEL, FLOW_STAGE_LABEL,
  TARGETABLE_TYPES, TARGETING_TYPES,
  type TaskStageInput, type TaskCostInput,
} from './campaignJudgment.ts';

const T = '2026-08-28';
const base = (o: Partial<TaskStageInput> = {}): TaskStageInput => ({
  type: 'rt', draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, ...o,
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

test('2) 밀림 — 방문일은 밀림에 쓰지 않는다, 게시됨은 밀림 아님, 미사용은 이제 밀림일 수 있다(R17)', () => {
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27' }), T), true);
  assert.equal(isTaskOverdue(base({ scheduledOn: T }), T), false);
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27', postedAt: '2026-08-27' }), T), false);
  assert.equal(isTaskOverdue(base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' }), T), true); // 미사용은 더 이상 특별 취급 없음
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

test('4) 대상 상태 — 없음/게시 대기/확정/취소, URL은 작업의 post_url 우선', () => {
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: null, targetCancelledAt: null }), 'none');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null, targetCancelledAt: null }), 'pending');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: null, targetCancelledAt: null }), 'ready');
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: 'https://x.com/i/status/2', targetCancelledAt: null }), 'ready');
  assert.equal(targetStatus({ targetTaskId: 'x', targetPostUrl: null, targetTweetUrl: null, targetCancelledAt: '2026-08-20' }), 'cancelled');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: 'https://x.com/i/status/2' }), 'https://x.com/a/status/1');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null }), null);
});

test('5) 요약 — N은 취소만 제외(미사용 포함), 게시됨은 내려짐 포함, 유형별 소계는 있는 유형만·TASK_TYPES 순', () => {
  const items = [
    { ...base({ type: 'post', draftStatus: 'delivered', postedAt: '2026-08-20' }), cost: { amount: 20000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'review' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'unused' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ scheduledOn: '2026-08-26' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ postedAt: '2026-08-20', removedAt: '2026-08-25' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ type: 'visit' }), cost: { amount: 300000, currency: 'KRW' as const } },
  ];
  assert.deepEqual(summarizeTasks(items, T), { total: 6, published: 2, delivered: 0, preparing: 3, overdue: 1, removed: 1, cancelled: 0 });
  const sub = subtotalsByType(items);
  assert.deepEqual(sub.map((s) => s.type), ['rt', 'quoteRt', 'post', 'visit']);
  // 브리프 원문은 published: 2였으나, rt 항목 중 postedAt이 있는 것은 1건(예정일만 있는 item4는 미게시)뿐이라
  // summarizeTasks(전체 published: 2 = post 1건 + rt 1건)와도 맞아떨어지는 값은 1이다 — 브리프 오타로 보고 수정(task-2-report.md 기록).
  assert.deepEqual(sub.find((s) => s.type === 'rt'), { type: 'rt', count: 2, published: 1, cost: { JPY: 6000 } });
  assert.deepEqual(sub.find((s) => s.type === 'quoteRt'), { type: 'quoteRt', count: 2, published: 0, cost: { JPY: 16000 } }); // 미사용 포함(제외는 취소만, R17)
  assert.deepEqual(summarizeTaskPerf(items.map((t) => ({ ...t, perf: t.postedAt ? { views: 100, likes: 1, bookmarks: null } : null, linkClicks: null }))),
    { publishedCount: 2, views: 200, likes: 2, bookmarks: null, linkClicks: null });
});

test('6) 정렬 — 기본 만든 순(밀림도 자리 유지), 취소만 어느 키든 맨 아래(미사용은 더 이상 아니다)', () => {
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

test('7) 인플 목록 — 작업 핸들 ∪ 비용 행, 유형별 건수, 미배정 묶음 맨 아래, 내려짐·미사용 모두 합계 포함(제외는 취소만)', () => {
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
  assert.equal(rio.taskCount, 3);                                  // 미사용 포함(제외는 취소만)
  assert.deepEqual(rio.countsByType, { rt: 2, quoteRt: 1 });
  assert.deepEqual(rio.taskCost, { JPY: 14000 });                    // 내려짐·미사용 포함
  assert.equal(countsByTypeLabel(rio.countsByType), 'RT 2 · 인용RT 1');
  assert.equal(countsByTypeLabel({ post: 1, rt: 3 }), 'RT 3 · 투고 1');   // TASK_TYPES 순(rt·quoteRt·post·visit)
  assert.equal(lines[2].hasCostRow, true);
  assert.equal(lines[2].taskCount, 0);
  assert.deepEqual(lines[3].subtotal, { KRW: 1000 });
  assert.deepEqual(taskCampaignTotal(lines), { JPY: 34000, KRW: 6000 });
});

test('8) 정산 후보 — 게시 확인 + 비용 + 인플 + 취소 아님. 내려짐은 조건이 아니다', () => {
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: '2026-08-21', cancelledAt: null }), true);
  assert.equal(isSettlementCandidate({ postedAt: null, cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null, cancelledAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: null, influencerHandle: 'a', removedAt: null, cancelledAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: null, removedAt: null, cancelledAt: null }), false);
});

test('9) 취소 — 단계 최상위, 집계·밀림·정산 후보에서 빠지는 유일한 조건, 미사용 원고는 이제 빠지지 않는다 (R17·R21)', () => {
  const canc = base({ type: 'post', draftStatus: 'draft', scheduledOn: '2026-08-01', cancelledAt: '2026-08-20' });
  assert.equal(taskStage(canc, T), 'cancelled');
  assert.equal(TASK_STAGE_LABEL.cancelled, '취소됨');
  assert.equal(isTaskExcluded(canc), true);
  assert.equal(isTaskOverdue(canc, T), false);                       // 취소된 작업은 밀림이 아니다
  assert.equal(matchesTaskFilter(canc, 'preparing', T), false);
  assert.equal(matchesTaskFilter(canc, 'all', T), true);
  // 미사용 원고가 붙은 미게시 작업은 더 이상 제외되지 않는다 — 원고 미사용은 원고 상태, 작업은 진행 중(koo 09-15)
  const unusedTask = base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' });
  assert.equal(isTaskExcluded(unusedTask), false);
  assert.equal(isTaskOverdue(unusedTask, T), true);
  const s = summarizeTasks([canc, unusedTask, base({ postedAt: '2026-08-20' })], T);
  assert.equal(s.total, 2);                                          // 취소 1건만 빠진다
  assert.equal(s.published, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.cancelled, 1);
  const sub = subtotalsByType([{ ...canc, cost: { amount: 1000, currency: 'KRW' } }, { ...unusedTask, cost: { amount: 2000, currency: 'KRW' } }]);
  assert.deepEqual(sub, [{ type: 'post', count: 1, published: 0, cost: { KRW: 2000 } }]);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null, cancelledAt: null }), true);
  assert.equal(isSettlementCandidate({ postedAt: null, cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null, cancelledAt: '2026-08-20' }), false);
});

test('10) 6단계 파생(flowStage) — 취소 > 완료 > 정산 > 게시 > 준비 > 전달', () => {
  const s = (t: TaskStageInput & { influencerHandle: string | null }, settle: { status: 'requested' | 'cancelled'; externalStatus: string | null } | null) => flowStage(t, settle);
  const h = { influencerHandle: 'a' };
  assert.equal(s({ ...base({ cancelledAt: '2026-08-20' }), ...h }, null), 'canc');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: 'paid' }), 'done');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: null }), 'settle');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: 'on_hold' }), 'settle');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'cancelled', externalStatus: null }), 'posted');   // 요청이 취소되면 다시 게시(정산 대기)
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, null), 'posted');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'draft' }), ...h }, null), 'prep');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'approved' }), ...h }, null), 'prep');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'delivered' }), ...h }, null), 'handed');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'unused' }), ...h }, null), 'handed');            // 미사용 = 인플이 자기 글로 진행
  assert.equal(s({ ...base(), ...h }, null), 'handed');                                                   // 원고 없는 RT + 인플 있음
  assert.equal(s({ ...base({ type: 'post' }), influencerHandle: null }, null), 'prep');                   // 미배정
  assert.equal(FLOW_STAGE_LABEL.handed, '전달');
});

test('10-b) flowStage — 원고가 붙는 유형은 원고가 없으면 준비(koo 09-19, 뼈대 우선 워크플로)', () => {
  const s = (t: TaskStageInput & { influencerHandle: string | null }, settle: { status: 'requested' | 'cancelled'; externalStatus: string | null } | null) => flowStage(t, settle);
  const h = { influencerHandle: 'a' };
  // 투고 뼈대 + 인플 배정 + 원고 없음 → 아직 준비(전달로 앞서가지 않는다, 원고를 붙일 때 역행을 막는다)
  assert.equal(s({ ...base({ type: 'post' }), ...h }, null), 'prep');
  // RT는 원고가 없는 것이 정상 — 인플만 있으면 그대로 전달
  assert.equal(s({ ...base({ type: 'rt' }), ...h }, null), 'handed');
  // 투고 + 인플 + 원고 전달됨 → 전달
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'delivered' }), ...h }, null), 'handed');
});

test('flowStage — 그쪽이 요청을 취소하면(externalStatus cancelled) 다시 게시로 돌아간다(§3-1 정산 정의에 없음)', () => {
  const t = { type: 'post' as const, draftStatus: 'delivered' as const, postedAt: '2026-09-10', removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, influencerHandle: 'a' };
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'cancelled' }), 'posted');
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'on_hold' }), 'settle');
  assert.equal(flowStage(t, { status: 'requested', externalStatus: 'paid' }), 'done');
  assert.equal(flowStage(t, { status: 'cancelled', externalStatus: null }), 'posted');   // 우리가 취소한 요청도 게시로
});

test('summarizeTaskPerf — 북마크도 합산, 취소 작업은 제외', () => {
  const b = { type: 'post' as const, draftStatus: null, postedAt: '2026-09-10', removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, linkClicks: null };
  const s = summarizeTaskPerf([
    { ...b, perf: { views: 100, likes: 5, bookmarks: 2 } },
    { ...b, perf: { views: 50, likes: null, bookmarks: 1 } },
    { ...b, cancelledAt: '2026-09-11', perf: { views: 999, likes: 9, bookmarks: 9 } },
  ]);
  assert.equal(s.views, 150); assert.equal(s.likes, 5); assert.equal(s.bookmarks, 3); assert.equal(s.publishedCount, 2);
});
