import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskOverdueDays, handleInitial, overdueJudgment, publishedSub, costSub, perfSub,
  overdueSuffix, NO_SCHEDULE_LABEL,
  targetLabel, typeFooterLabel, stageTag,
} from './campaignTableView.ts';
import type { TaskSummary } from './campaignJudgment.ts';

const T = '2026-08-27';

const b = { type: 'rt' as const, draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null };

test('1) 작업 밀림 일수·문구 조각 — 게시됨·미사용·오늘·예정일 없음은 밀림 아님(isTaskOverdue와 같은 모집단)', () => {
  assert.equal(taskOverdueDays({ ...b, scheduledOn: '2026-08-26' }, T), 1);
  assert.equal(taskOverdueDays({ ...b, scheduledOn: '2026-08-20' }, T), 7);
  assert.equal(taskOverdueDays({ ...b, scheduledOn: '2026-08-20', postedAt: '2026-08-21T00:00:00Z' }, T), null);
  assert.equal(taskOverdueDays({ ...b, scheduledOn: '2026-08-20', draftStatus: 'unused' }, T), null);
  assert.equal(taskOverdueDays({ ...b, scheduledOn: T }, T), null);          // 오늘은 아직 안 밀림
  assert.equal(taskOverdueDays(b, T), null);                                  // 예정일 미정
  // 밀림 접미사·예정일 없음 문구는 표(ScheduledOnField)와 달력이 같은 상수를 쓴다 — 여기서 문구를 고정한다
  assert.equal(overdueSuffix(1), '1일 지남');
  assert.equal(overdueSuffix(7), '7일 지남');
  assert.equal(NO_SCHEDULE_LABEL, '예정일 미정');
  assert.equal(handleInitial('@hana_kim'), 'H');
  assert.equal(handleInitial('yuki'), 'Y');
});

test('2) 요약 카드 보조 문구 — 판단 한 줄(QA 1라운드), 0인 항목은 빼고 값 없음은 —', () => {
  assert.equal(overdueJudgment(0), '없음 — 예정대로');
  assert.equal(overdueJudgment(2), '예정일 지났는데 아직 안 올라감');
  const sum = (o: Partial<TaskSummary>): TaskSummary =>
    ({ total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0, removed: 0, ...o });
  assert.equal(publishedSub(sum({ total: 4, published: 1, delivered: 1, preparing: 2 })), '전달됨 1 · 준비 중 2');
  assert.equal(publishedSub(sum({ total: 1, preparing: 1 })), '준비 중 1');           // 0인 '전달됨'은 뺀다
  assert.equal(publishedSub(sum({ total: 2, published: 2 })), '모두 게시됨');
  assert.equal(publishedSub(sum({ total: 0 })), '작업 없음');
  // 내려짐은 게시는 됐지만 지금은 없는 작업 — '모두 게시됨'만 보이면 사라진 게 없는 것처럼 읽힌다
  assert.equal(publishedSub(sum({ total: 2, published: 2, removed: 1 })), '모두 게시됨 · 내려짐 1');
  assert.equal(publishedSub(sum({ total: 3, published: 2, preparing: 1, removed: 1 })), '준비 중 1 · 내려짐 1');
  assert.equal(perfSub({ publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 }), '게시 2건 · 좋아요 300 · 링크 클릭 100');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: 2 }), '게시된 작업 없음 · 링크 클릭 2');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: null }), '게시된 작업 없음');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: 0 }), '게시된 작업 없음');  // 0은 붙이지 않는다
});

test('3) 비용 카드 보조 줄 — 통화는 합치지 않고, 한쪽만 있으면 없는 쪽을 말해 준다(오너 문구: 원화/엔화)', () => {
  assert.equal(costSub({ KRW: 30000 }), '원화 기준 · 엔화 없음');
  assert.equal(costSub({ JPY: 5000 }), '엔화 기준 · 원화 없음');
  assert.equal(costSub({ KRW: 30000, JPY: 5000 }), '');   // 숫자 두 줄이 스스로 말한다 — 보조 줄 없음
  assert.equal(costSub({}), '비용 입력 없음');
});

// ── 작업(campaign_task) 표시 문구 — 스펙 2026-08-28 §4-1 ──
test('대상 셀·하단 유형 줄·단계 태그', () => {
  const t = (o: object) => ({ targetTaskId: null, targetTweetUrl: null, target: null, postedSource: null, removedAt: null, removedReason: '', postedAt: null, ...o }) as never;
  assert.deepEqual(targetLabel(t({ targetTaskId: 'x', target: { taskId: 'x', type: 'post', influencerHandle: 'mika', campaignId: 'c1', campaignName: 'A 9월 1주', postUrl: null } }), 'c1'), { text: '@mika 투고', sub: null, muted: false });
  assert.deepEqual(targetLabel(t({ targetTaskId: 'x', target: { taskId: 'x', type: 'quoteRt', influencerHandle: 'yuna', campaignId: 'c0', campaignName: 'A 8월 4주', postUrl: null } }), 'c1'), { text: '@yuna 인용RT', sub: 'A 8월 4주', muted: false });
  assert.deepEqual(targetLabel(t({ targetTweetUrl: 'https://x.com/clinic/status/12345' }), 'c1'), { text: 'x.com/clinic/status/12345', sub: null, muted: false });
  assert.deepEqual(targetLabel(t({}), 'c1'), { text: '대상 미정', sub: null, muted: true });
  assert.equal(typeFooterLabel([{ type: 'rt', count: 3, published: 1, cost: {} }, { type: 'post', count: 1, published: 1, cost: {} }]), 'RT 3 · 투고 1');
  assert.equal(stageTag(t({ postedAt: '2026-09-03', postedSource: 'auto' })), '자동');
  assert.equal(stageTag(t({ postedAt: '2026-09-03', postedSource: 'manual' })), null);
  assert.equal(stageTag(t({ postedAt: '2026-09-03', removedAt: '2026-09-05', removedReason: '본인 요청' })), '본인 요청');
});
