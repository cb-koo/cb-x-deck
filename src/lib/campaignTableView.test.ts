import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overdueDays, scheduledOnLabel, contentSubline, perfLabel, handleInitial, overdueJudgment, publishedSub, perfSub,
} from './campaignTableView.ts';

const T = '2026-08-27';

test('1) 밀림 일수·예정일 문구 — 게시됨·미사용·오늘·없음은 밀림 아님(campaignJudgment.isOverdue 그대로)', () => {
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: '2026-08-26' }, T), 1);
  assert.equal(overdueDays({ status: 'delivered', published: false, scheduledOn: '2026-08-20' }, T), 7);
  assert.equal(overdueDays({ status: 'draft', published: true, scheduledOn: '2026-08-20' }, T), null);
  assert.equal(overdueDays({ status: 'unused', published: false, scheduledOn: '2026-08-20' }, T), null);
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: T }, T), null);
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: null }, T), null);
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: '2026-08-26' }, T), '8/26 수 · 1일 지남');
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: '2026-08-29' }, T), '8/29 토');
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: null }, T), '예정일 없음');
});

test('2) 보조줄·성과·이니셜', () => {
  assert.equal(contentSubline({ cost: { type: 'post', amount: 1, currency: 'KRW' }, format: 'single' }), '투고 · 단문');
  assert.equal(contentSubline({ cost: { type: 'quoteRt', amount: 1, currency: 'JPY' }, format: 'thread' }), '인용RT · 스레드');
  assert.equal(contentSubline({ cost: null, format: 'thread' }), '스레드');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: 96 }), '조회 12,400 · 링크 96');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: null }), '조회 12,400');
  assert.equal(perfLabel({ published: true, perf: { views: null }, linkClicks: null }), '조회 —');   // 스냅샷 없음 → —(0으로 위장 금지, §7)
  assert.equal(perfLabel({ published: false, perf: null, linkClicks: 4 }), '—');                    // 미게시는 링크 클릭이 있어도 — (성과 열은 게시된 것의 것)
  assert.equal(handleInitial('@hana_kim'), 'H');
  assert.equal(handleInitial('yuki'), 'Y');
});

test('3) 요약 카드 보조 문구 — 숫자에 판단을 붙인다(UX 원칙 3), 값 없음은 —', () => {
  assert.equal(overdueJudgment(0), '밀린 콘텐츠가 없어요');
  assert.equal(overdueJudgment(2), '예정일 지났는데 아직 안 올라감');
  assert.equal(publishedSub({ total: 4, published: 1, delivered: 1, preparing: 2, overdue: 0 }), '전달됨 1 · 준비 중 2');
  assert.equal(perfSub({ publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 }), '게시 2건 · 좋아요 300 · 링크 클릭 100');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: null }), '게시 0건 · 좋아요 — · 링크 클릭 —');
});
