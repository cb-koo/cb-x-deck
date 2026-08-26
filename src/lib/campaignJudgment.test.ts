import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateOnlyString, addDays, daysBetweenDates, weekStartOf, weekDays, initialWeekStart, nextWeekRange, formatDateKo,
  campaignStatus, defaultCostType,
  contentStage, isOverdue, isOutOfRange, isPreparing, matchesStageFilter, summarizeStages, summarizePerf,
  sortContent, deriveInfluencers, campaignTotal, suggestCampaignName, suggestCampaignCode,
  type StageInput, type SortInput,
} from './campaignJudgment.ts';

const T = '2026-08-27'; // 목요일

test('1) 날짜 산술 — 시간대 시프트 없음, 월요일 시작 주, 월/연 경계', () => {
  assert.equal(isDateOnlyString('2026-08-26'), true);
  assert.equal(isDateOnlyString('2026-08-26T00:00:00Z'), false); // 시각이 붙으면 date 컬럼이 하루 민다
  assert.equal(isDateOnlyString('2026-8-26'), false);
  assert.equal(isDateOnlyString('2026-13-40'), false);           // 형식은 맞아도 달력에 없는 날
  assert.equal(isDateOnlyString(null), false);
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetweenDates('2026-08-26', T), 1);
  assert.equal(daysBetweenDates(T, '2026-08-26'), -1);
  assert.equal(weekStartOf(T), '2026-08-24');            // 목 → 월
  assert.equal(weekStartOf('2026-08-30'), '2026-08-24'); // 일 → 그 주 월(다음 주 아님)
  assert.equal(weekStartOf('2026-08-24'), '2026-08-24');
  assert.deepEqual(weekDays('2026-08-24').at(-1), '2026-08-30');
  assert.equal(weekDays('2026-08-24').length, 7);
  assert.deepEqual(nextWeekRange(T), { startsOn: '2026-08-31', endsOn: '2026-09-06' });
  assert.equal(formatDateKo('2026-08-26'), '8/26 수');
});

test('2) 달력 초기 주 — 오늘이 기간 안이면 오늘의 주, 밖이면 시작일의 주', () => {
  assert.equal(initialWeekStart('2026-08-24', '2026-09-06', T), '2026-08-24');
  assert.equal(initialWeekStart('2026-09-07', '2026-09-13', T), '2026-09-07');
  assert.equal(initialWeekStart('2026-08-03', '2026-08-09', T), '2026-08-03'); // 종료된 캠페인
});

test('3) 캠페인 상태 — 기간에서만 파생(경계 포함)', () => {
  assert.equal(campaignStatus('2026-08-28', '2026-09-03', T), 'upcoming');
  assert.equal(campaignStatus('2026-08-27', '2026-08-27', T), 'active');  // 하루짜리, 오늘
  assert.equal(campaignStatus('2026-08-20', '2026-08-26', T), 'ended');
  assert.equal(defaultCostType('visit'), 'visit');
  assert.equal(defaultCostType('content'), 'post');
  assert.equal(defaultCostType(null), 'post');
});

const d = (o: Partial<StageInput>): StageInput => ({ status: 'draft', published: false, scheduledOn: null, ...o });

test('4) 단계·밀림·기간 밖·준비 중 — 게시됨이 status를 이긴다, 미사용은 밀림이 아니다', () => {
  assert.equal(contentStage(d({ status: 'draft', published: true })), 'published');
  assert.equal(contentStage(d({ status: 'delivered' })), 'delivered');
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26' }), T), true);
  assert.equal(isOverdue(d({ scheduledOn: T }), T), false);                        // 오늘은 아직 안 밀림
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26', published: true }), T), false);
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26', status: 'unused' }), T), false);
  assert.equal(isOverdue(d({ scheduledOn: null }), T), false);
  assert.equal(isOutOfRange('2026-09-07', '2026-08-24', '2026-09-06'), true);
  assert.equal(isOutOfRange('2026-09-06', '2026-08-24', '2026-09-06'), false);
  assert.equal(isOutOfRange(null, '2026-08-24', '2026-09-06'), false);
  assert.equal(isPreparing(d({ status: 'approved' })), true);
  assert.equal(isPreparing(d({ status: 'approved', published: true })), false);
  assert.equal(isPreparing(d({ status: 'delivered' })), false);
  assert.equal(matchesStageFilter(d({ status: 'review' }), 'preparing'), true);
  assert.equal(matchesStageFilter(d({ status: 'delivered', published: true }), 'delivered'), false); // 게시됨은 전달됨 필터에 안 걸림
  assert.equal(matchesStageFilter(d({ status: 'delivered', published: true }), 'published'), true);
  assert.equal(matchesStageFilter(d({ status: 'unused' }), 'all'), true);
});

test('5) 요약 — N은 미사용 제외, 게시됨/전달됨/준비 중/밀림이 같은 모집단', () => {
  const s = summarizeStages([
    d({ status: 'draft', scheduledOn: '2026-08-25' }),            // 준비 중 + 밀림
    d({ status: 'review' }),                                      // 준비 중
    d({ status: 'delivered', scheduledOn: '2026-08-26' }),        // 전달됨 + 밀림
    d({ status: 'delivered', published: true, scheduledOn: '2026-08-25' }), // 게시됨(밀림 아님)
    d({ status: 'unused', scheduledOn: '2026-08-20' }),           // 제외
  ], T);
  assert.deepEqual(s, { total: 4, published: 1, delivered: 1, preparing: 2, overdue: 2 });
  assert.deepEqual(summarizeStages([], T), { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0 });
});

test('6) 성과 합계 — 스냅샷 없으면 null 유지(0으로 위장 금지), 링크 클릭은 미게시 원고 것도 합산', () => {
  const p = summarizePerf([
    { published: true, perf: { views: 12400, likes: 300 }, linkClicks: 96 },
    { published: true, perf: { views: null, likes: null }, linkClicks: null },
    { published: false, perf: null, linkClicks: 4 },
  ]);
  assert.deepEqual(p, { publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 });
  assert.deepEqual(summarizePerf([{ published: true, perf: { views: null, likes: null }, linkClicks: null }]),
    { publishedCount: 1, views: null, likes: null, linkClicks: null });
});

const s = (o: Partial<SortInput>): SortInput => ({ status: 'draft', published: false, scheduledOn: null, influencerHandle: null, createdAt: '2026-08-20T00:00:00Z', ...o });

test('7) 기본 정렬 — 밀린 것 → 예정일 오름차순 → 예정일 없음 → 미사용 맨 아래', () => {
  const rows = [
    s({ status: 'unused', scheduledOn: '2026-08-01', createdAt: 'a' }),
    s({ scheduledOn: null, createdAt: 'b' }),
    s({ scheduledOn: '2026-08-29', createdAt: 'c' }),
    s({ scheduledOn: '2026-08-25', createdAt: 'd' }),                 // 밀림
    s({ scheduledOn: '2026-08-28', createdAt: 'e' }),
    s({ scheduledOn: '2026-08-26', published: true, createdAt: 'f' }), // 게시됨 — 밀림 아님, 예정일 순
  ];
  assert.deepEqual(sortContent(rows, 'default', T).map((r) => r.createdAt), ['d', 'f', 'e', 'c', 'b', 'a']);
  assert.deepEqual(sortContent(rows, 'scheduled', T).map((r) => r.createdAt), ['d', 'f', 'e', 'c', 'b', 'a']);
  const byInf = sortContent([s({ influencerHandle: 'Zed', createdAt: 'z' }), s({ influencerHandle: 'amy', createdAt: 'y' }), s({ createdAt: 'x' })], 'influencer', T);
  assert.deepEqual(byInf.map((r) => r.createdAt), ['y', 'z', 'x']); // 미배정은 뒤
  const byStage = sortContent([s({ status: 'delivered', createdAt: 'p' }), s({ status: 'draft', createdAt: 'q' }), s({ published: true, createdAt: 'r' })], 'stage', T);
  assert.deepEqual(byStage.map((r) => r.createdAt), ['q', 'p', 'r']);
  assert.notEqual(sortContent(rows, 'default', T), rows); // 원본 불변(새 배열)
});

test('8) 인플 목록 파생 — 소문자 합집합, 비용 행만 있어도 나옴, 미배정 묶음, 통화별 소계·합계', () => {
  const lines = deriveInfluencers([
    { influencerHandle: 'Hana', status: 'delivered', cost: { type: 'post', amount: 300000, currency: 'KRW' } },
    { influencerHandle: 'hana', status: 'draft', cost: { type: 'rt', amount: 60000, currency: 'KRW' } },
    { influencerHandle: 'hana', status: 'unused', cost: { type: 'rt', amount: 999999, currency: 'KRW' } }, // 제외
    { influencerHandle: 'Yuki', status: 'approved', cost: { type: 'post', amount: 95000, currency: 'JPY' } },
    { influencerHandle: null, status: 'draft', cost: { type: 'post', amount: 1000, currency: 'KRW' } },
    { influencerHandle: 'Yuki', status: 'draft', cost: null },
  ], [
    { influencerHandle: 'HANA', extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }], note: '패키지' },
    { influencerHandle: 'ghost', extraCosts: [{ label: '선물', amount: 5000, currency: 'JPY' }], note: '' },
  ]);
  assert.deepEqual(lines.map((l) => l.handle), ['Hana', 'Yuki', 'ghost', null]); // 원고 많은 순 → 사전순, 미배정 맨 뒤
  const hana = lines[0];
  assert.equal(hana.contentCount, 2);
  assert.deepEqual(hana.contentCost, { KRW: 360000 });
  assert.deepEqual(hana.extraCost, { KRW: 20000 });
  assert.deepEqual(hana.subtotal, { KRW: 380000 });
  assert.equal(hana.note, '패키지');
  assert.equal(hana.hasCostRow, true);
  const ghost = lines[2];
  assert.equal(ghost.contentCount, 0);              // "배정 원고 없음" 표시 근거
  assert.deepEqual(ghost.subtotal, { JPY: 5000 });
  assert.equal(lines[3].contentCount, 1);
  assert.deepEqual(campaignTotal(lines), { KRW: 381000, JPY: 100000 });
  assert.deepEqual(deriveInfluencers([{ influencerHandle: null, status: 'unused', cost: null }], []), []); // 미배정+미사용만이면 줄 없음
});

test('9) 이름·코드 제안 — {클라} {M월 N주}, {영문 소문자}-{YYYYMMDD}, 영문 없으면 날짜만, 규칙 위반 문자 제거', () => {
  assert.equal(suggestCampaignName('리프팅클리닉', '2026-08-24'), '리프팅클리닉 8월 4주');
  assert.equal(suggestCampaignName('  ', '2026-09-01'), '9월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-07'), 'A 8월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-08'), 'A 8월 2주');
  assert.equal(suggestCampaignCode('Lifting Clinic', '2026-08-24'), 'lifting-clinic-20260824');
  assert.equal(suggestCampaignCode('', '2026-08-24'), '20260824');
  assert.equal(suggestCampaignCode('클리닉', '2026-08-24'), '20260824'); // 비영문만이면 날짜만
});
