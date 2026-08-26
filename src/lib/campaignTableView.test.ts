import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overdueDays, scheduledOnLabel, contentTypeLabel, perfLabel, handleInitial, overdueJudgment, publishedSub, costSub, perfSub,
  overdueSuffix, NO_SCHEDULE_LABEL,
} from './campaignTableView.ts';
import { formatDateKo } from './campaignJudgment.ts';

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

test('2) 유형 열·성과·이니셜', () => {
  // QA 1라운드: 콘텐츠 칸 보조줄 → 유형 전용 열(단문/스레드 표기는 뺀다)
  assert.equal(contentTypeLabel({ cost: { type: 'post', amount: 1, currency: 'KRW' } }), '투고');
  assert.equal(contentTypeLabel({ cost: { type: 'quoteRt', amount: 1, currency: 'JPY' } }), '인용RT');
  assert.equal(contentTypeLabel({ cost: null }), '—');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: 96 }), '조회 12,400 · 링크 96');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: null }), '조회 12,400');
  assert.equal(perfLabel({ published: true, perf: { views: null }, linkClicks: null }), '조회 —');   // 스냅샷 없음 → —(0으로 위장 금지, §7)
  assert.equal(perfLabel({ published: false, perf: null, linkClicks: 4 }), '—');                    // 미게시는 링크 클릭이 있어도 — (성과 열은 게시된 것의 것)
  assert.equal(handleInitial('@hana_kim'), 'H');
  assert.equal(handleInitial('yuki'), 'Y');
});

test('4) scheduledOnLabel 조립이 overdueSuffix·NO_SCHEDULE_LABEL과 어긋나지 않는다(두 경로 문구 단일 소스, 리뷰 반영)', () => {
  const scheduledOn = '2026-08-26';
  const n = overdueDays({ status: 'draft', published: false, scheduledOn }, T);
  assert.notEqual(n, null);
  assert.equal(
    scheduledOnLabel({ status: 'draft', published: false, scheduledOn }, T),
    `${formatDateKo(scheduledOn)} · ${overdueSuffix(n as number)}`,
  );
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: null }, T), NO_SCHEDULE_LABEL);
});

test('3) 요약 카드 보조 문구 — 판단 한 줄(QA 1라운드), 0인 항목은 빼고 값 없음은 —', () => {
  assert.equal(overdueJudgment(0), '없음 — 예정대로');
  assert.equal(overdueJudgment(2), '예정일 지났는데 아직 안 올라감');
  assert.equal(publishedSub({ total: 4, published: 1, delivered: 1, preparing: 2, overdue: 0 }), '전달됨 1 · 준비 중 2');
  assert.equal(publishedSub({ total: 1, published: 0, delivered: 0, preparing: 1, overdue: 0 }), '준비 중 1');   // 0인 '전달됨'은 뺀다
  assert.equal(publishedSub({ total: 2, published: 2, delivered: 0, preparing: 0, overdue: 0 }), '모두 게시됨');
  assert.equal(publishedSub({ total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0 }), '콘텐츠 없음');
  assert.equal(perfSub({ publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 }), '게시 2건 · 좋아요 300 · 링크 클릭 100');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: 2 }), '게시된 콘텐츠 없음 · 링크 클릭 2');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: null }), '게시된 콘텐츠 없음');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: 0 }), '게시된 콘텐츠 없음');  // 0은 붙이지 않는다
});

test('5) 비용 카드 보조 줄 — 통화는 합치지 않고, 한쪽만 있으면 없는 쪽을 말해 준다(오너 문구: 원화/엔화)', () => {
  assert.equal(costSub({ KRW: 30000 }), '원화 기준 · 엔화 없음');
  assert.equal(costSub({ JPY: 5000 }), '엔화 기준 · 원화 없음');
  assert.equal(costSub({ KRW: 30000, JPY: 5000 }), '');   // 숫자 두 줄이 스스로 말한다 — 보조 줄 없음
  assert.equal(costSub({}), '비용 입력 없음');
});
