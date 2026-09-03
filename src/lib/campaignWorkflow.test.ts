import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_STAGE_OWNER, WORKFLOW_STAGE_ORDER, COLLAPSED_STAGES,
  readyGaps, isReadyToDeliver, isDelivered, workflowStage, isPostOverdue,
  isBlocked, blockedCount, countByStage, groupTasks, hidesColumn, isGroupBy, nextActionText,
  type WorkflowInput,
} from './campaignWorkflow.ts';

const T = '2026-09-03'; // 목요일

// 준비가 다 끝난 투고 한 건 — 여기서 한 칸씩 비워 각 조건을 본다.
function task(over: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    type: 'post', influencerHandle: 'someone', draftId: 'd1', draftStatus: 'approved', draftBy: 'us',
    targetTweetUrl: null, target: null, cost: { amount: 50000, currency: 'KRW' },
    scheduledOn: null, deliveredOn: null, postedAt: null, cancelledOn: null, settlement: null,
    ...over,
  };
}

test('1) 준비 조건 — 유형마다 전달물이 다르다(§3)', () => {
  assert.deepEqual(readyGaps(task()), []);
  assert.deepEqual(readyGaps(task({ influencerHandle: null })), ['influencer']);
  assert.deepEqual(readyGaps(task({ cost: null })), ['cost']);
  // 예정일은 준비 조건이 아니다 — 비어 있어도 준비가 끝난다
  assert.equal(isReadyToDeliver(task({ scheduledOn: null })), true);
  // 원고: 있거나, 인플이 쓴다고 표시했으면 끝
  assert.deepEqual(readyGaps(task({ draftId: null, draftBy: 'us' })), ['draft']);
  assert.deepEqual(readyGaps(task({ draftId: null, draftBy: 'influencer' })), []);
  // draft_by가 null = 아직 안 정함 → 막힌다(§3-1의 핵심). 047 전에는 원고 없는 작업이 다 여기 걸린다
  assert.deepEqual(readyGaps(task({ draftId: null, draftBy: null })), ['draft']);
  // RT는 원고 개념이 없고 대상 링크가 필수
  assert.deepEqual(readyGaps(task({ type: 'rt', draftId: null, draftStatus: null, draftBy: null })), ['target']);
  assert.deepEqual(readyGaps(task({ type: 'rt', draftId: null, draftStatus: null, draftBy: null, targetTweetUrl: 'https://x.com/a/status/1' })), []);
  // 인용RT는 원고와 대상 링크를 둘 다 본다
  assert.deepEqual(readyGaps(task({ type: 'quoteRt', draftId: null, draftBy: null })), ['draft', 'target']);
  // 가리킨 작업이 아직 게시 안 됐으면 전달할 링크가 없다
  assert.deepEqual(readyGaps(task({ type: 'rt', draftId: null, draftStatus: null, target: { postUrl: null } })), ['target']);
  assert.deepEqual(readyGaps(task({ type: 'rt', draftId: null, draftStatus: null, target: { postUrl: 'https://x.com/a/status/2' } })), []);
  // 방문협찬도 원고 조건이 같다(인플이 직접 쓰는 경우가 많아 표시로 통과)
  assert.deepEqual(readyGaps(task({ type: 'visit', draftId: null, draftBy: 'influencer' })), []);
  // 여러 칸이 비면 순서대로 다 말한다 — 「진행」 칸이 "다음에 무엇을"을 써야 하기 때문
  assert.deepEqual(readyGaps(task({ influencerHandle: null, draftId: null, draftBy: null, cost: null })), ['influencer', 'draft', 'cost']);
});

test('2) 단계 판정 — 위에서 먼저 걸리는 것이 그 단계(§2)', () => {
  assert.equal(workflowStage(task({ draftId: null, draftBy: null }), T), 'preparing');
  assert.equal(workflowStage(task(), T), 'deliverPending');
  assert.equal(workflowStage(task({ deliveredOn: '2026-09-01' }), T), 'postPending');
  assert.equal(workflowStage(task({ deliveredOn: '2026-09-01', postedAt: '2026-09-02T00:00:00Z' }), T), 'settlePending');
  assert.equal(workflowStage(task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'requested', externalStatus: 'scheduled' } }), T), 'payPending');
  assert.equal(workflowStage(task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'requested', externalStatus: 'paid' } }), T), 'done');
  // 취소가 제일 위 — 정산이 어디까지 갔든 취소가 이긴다
  assert.equal(workflowStage(task({ cancelledOn: '2026-09-02', postedAt: '2026-09-02T00:00:00Z' }), T), 'cancelled');
  // 우리가 취소한 정산 요청은 지급 대기가 아니다 — 다시 요청해야 하니 정산 대기로 내려간다
  assert.equal(workflowStage(task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'cancelled', externalStatus: null } }), T), 'settlePending');
  // 게시했으면 준비가 안 끝났어도 정산 대기다(뒷단계가 앞단계를 이긴다)
  assert.equal(workflowStage(task({ cost: null, postedAt: '2026-09-02T00:00:00Z' }), T), 'settlePending');
});

test('3) 전달 판정 — 047 전에는 원고 상태로 대신 읽는다', () => {
  assert.equal(isDelivered(task({ deliveredOn: '2026-09-01' })), true);
  assert.equal(isDelivered(task({ draftStatus: 'delivered' })), true);
  assert.equal(isDelivered(task({ draftStatus: 'approved' })), false);
  // RT는 원고가 없어 이 신호가 없다 — 047의 delivered_on이 필요한 이유
  assert.equal(isDelivered(task({ type: 'rt', draftId: null, draftStatus: null, targetTweetUrl: 'https://x.com/a/status/1' })), false);
});

test('4) 막힌 것 — 우리 차례만 센다(§5)', () => {
  const ours = task({ draftId: null, draftBy: null });                          // 준비
  const toDeliver = task();                                                     // 전달 대기
  const toSettle = task({ postedAt: '2026-09-02T00:00:00Z' });                  // 정산 대기
  const waiting = task({ deliveredOn: '2026-09-01', scheduledOn: '2026-09-10' });   // 게시 대기, 예정일 안 옴
  const late = task({ deliveredOn: '2026-09-01', scheduledOn: '2026-09-01' });      // 게시 대기, 예정일 지남
  const noDate = task({ deliveredOn: '2026-09-01', scheduledOn: null });            // 게시 대기, 예정일 없음
  const paying = task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'requested', externalStatus: 'scheduled' } });
  const done = task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'requested', externalStatus: 'paid' } });
  const cancelled = task({ cancelledOn: '2026-09-02' });

  for (const t of [ours, toDeliver, toSettle, late]) assert.equal(isBlocked(t, T), true);
  for (const t of [waiting, noDate, paying, done, cancelled]) assert.equal(isBlocked(t, T), false);
  assert.equal(blockedCount([ours, toDeliver, toSettle, late, waiting, noDate, paying, done, cancelled], T), 4);
  // 미사용 원고가 붙은 작업은 세워둔 것 — 요약 N에서 빠지는 관례대로 여기서도 안 센다
  assert.equal(isBlocked(task({ draftStatus: 'unused' }), T), false);
  assert.equal(isPostOverdue(task({ scheduledOn: '2026-09-01' }), T), true);
  assert.equal(isPostOverdue(task({ scheduledOn: T }), T), false);              // 오늘은 아직 지나지 않았다
  assert.equal(isPostOverdue(task({ scheduledOn: '2026-09-01', postedAt: '2026-09-02T00:00:00Z' }), T), false);
});

test('5) 누구 차례 — 막힌 것과 배치의 근거', () => {
  assert.equal(WORKFLOW_STAGE_OWNER.preparing, 'us');
  assert.equal(WORKFLOW_STAGE_OWNER.deliverPending, 'us');
  assert.equal(WORKFLOW_STAGE_OWNER.settlePending, 'us');
  assert.equal(WORKFLOW_STAGE_OWNER.postPending, 'influencer');
  assert.equal(WORKFLOW_STAGE_OWNER.payPending, 'settlement');
  assert.equal(WORKFLOW_STAGE_OWNER.done, 'closed');
  assert.equal(WORKFLOW_STAGE_OWNER.cancelled, 'closed');
  // 묶음 순서는 업무 순서 — 우리가 손댈 것이 위에 온다
  assert.deepEqual([...WORKFLOW_STAGE_ORDER], ['preparing', 'deliverPending', 'postPending', 'settlePending', 'payPending', 'done', 'cancelled']);
  assert.deepEqual([...COLLAPSED_STAGES], ['done', 'cancelled']);
});

test('6) 묶기 — 빈 묶음은 숨기고, 묶은 기준은 열에서 빠진다(§6-1)', () => {
  const items = [
    task({ draftId: null, draftBy: null, influencerHandle: 'Bravo' }),                 // 준비
    task({ influencerHandle: 'alpha' }),                                                // 전달 대기
    task({ influencerHandle: null, type: 'rt', draftId: null, draftStatus: null, targetTweetUrl: 'https://x.com/a/status/1' }), // 준비 — 인플 미배정
    task({ postedAt: '2026-09-02T00:00:00Z', settlement: { status: 'requested', externalStatus: 'paid' }, influencerHandle: 'alpha' }), // 완료
  ];
  const byStage = groupTasks(items, 'stage', T);
  assert.deepEqual(byStage.map((g) => g.label), ['준비', '전달 대기', '완료']);   // 게시 대기·정산 대기·지급 대기·취소는 비어서 안 나온다
  assert.deepEqual(byStage.map((g) => g.items.length), [2, 1, 1]);
  assert.deepEqual(byStage.map((g) => g.collapsedByDefault), [false, false, true]);

  const byInf = groupTasks(items, 'influencer', T);
  assert.deepEqual(byInf.map((g) => g.label), ['alpha', 'Bravo', '미배정']);      // 표기는 보존, 정렬은 lower(), 미배정은 맨 아래
  assert.deepEqual(byInf.map((g) => g.items.length), [2, 1, 1]);

  assert.deepEqual(groupTasks(items, 'type', T).map((g) => g.label), ['RT', '투고']);   // 묶음 순서는 PRICE_TYPES 관례를 따른다
  const none = groupTasks(items, 'none', T);
  assert.equal(none.length, 1);
  assert.equal(none[0].items.length, 4);
  assert.equal(none[0].label, '');
  assert.deepEqual(groupTasks([], 'stage', T), []);
  assert.deepEqual(groupTasks([], 'none', T), []);

  assert.equal(hidesColumn('influencer', 'influencer'), true);
  assert.equal(hidesColumn('influencer', 'type'), false);
  assert.equal(hidesColumn('stage', 'stage'), true);
  assert.equal(hidesColumn('none', 'type'), false);
  assert.equal(isGroupBy('stage'), true);
  assert.equal(isGroupBy('원고'), false);

  const counts = countByStage(items, T);
  assert.equal(counts.preparing, 2);
  assert.equal(counts.deliverPending, 1);
  assert.equal(counts.done, 1);
  assert.equal(counts.cancelled, 0);
});

test('7) 다음 행동 문구 — 무엇이 비었는지까지 말한다', () => {
  assert.equal(nextActionText(task({ draftId: null, draftBy: null, cost: null }), T), '원고 · 비용 채우기');
  assert.equal(nextActionText(task(), T), '인플루언서에게 전달하고 전달함 표시');
  assert.equal(nextActionText(task({ deliveredOn: '2026-09-01', scheduledOn: '2026-09-10' }), T), '인플루언서가 올릴 차례');
  assert.equal(nextActionText(task({ deliveredOn: '2026-09-01', scheduledOn: '2026-09-01' }), T), '예정일이 지났어요 — 게시됐는지 확인');
  assert.equal(nextActionText(task({ postedAt: '2026-09-02T00:00:00Z' }), T), '정산 요청 올리기');
  assert.equal(nextActionText(task({ cancelledOn: '2026-09-02' }), T), '');
});
