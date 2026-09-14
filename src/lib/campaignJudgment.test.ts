import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateOnlyString, addDays, daysBetweenDates, weekStartOf, weekDays, nextWeekRange, formatDateKo,
  campaignStatus, isOutOfRange, isCampaignKind,
  suggestCampaignName, suggestCampaignCode, draftWriteHref,
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
  assert.equal(weekStartOf('2026-01-01'), '2025-12-29'); // 연 경계 — 새해 첫날이 목요일이라 월요일은 작년으로 넘어간다
  assert.deepEqual(weekDays('2026-08-24').at(-1), '2026-08-30');
  assert.equal(weekDays('2026-08-24').length, 7);
  assert.deepEqual(nextWeekRange(T), { startsOn: '2026-08-31', endsOn: '2026-09-06' });
  assert.equal(formatDateKo('2026-08-26'), '8/26 수');
});

test('2) 캠페인 상태 — 기간에서만 파생(경계 포함)', () => {
  assert.equal(campaignStatus('2026-08-28', '2026-09-03', T), 'upcoming');
  assert.equal(campaignStatus('2026-08-27', '2026-08-27', T), 'active');  // 하루짜리, 오늘
  assert.equal(campaignStatus('2026-08-20', '2026-08-26', T), 'ended');
  assert.equal(isCampaignKind('visit'), true);
  assert.equal(isCampaignKind('gift'), false);
  assert.equal(isCampaignKind(null), false);
});

test('3) 기간 밖 — 경고 표시용 판정(경계 포함, 예정일 없으면 아님)', () => {
  assert.equal(isOutOfRange('2026-09-07', '2026-08-24', '2026-09-06'), true);
  assert.equal(isOutOfRange('2026-08-23', '2026-08-24', '2026-09-06'), true);
  assert.equal(isOutOfRange('2026-09-06', '2026-08-24', '2026-09-06'), false);
  assert.equal(isOutOfRange('2026-08-24', '2026-08-24', '2026-09-06'), false);
  assert.equal(isOutOfRange(null, '2026-08-24', '2026-09-06'), false);
});

test('4) 이름·코드 제안 — {클라} {M월 N주}(그 주의 목요일 기준), {영문 소문자}-{YYYYMMDD}, 영문 없으면 날짜만, 규칙 위반 문자 제거', () => {
  assert.equal(suggestCampaignName('리프팅클리닉', '2026-08-24'), '리프팅클리닉 8월 4주'); // 월, 그 주 목요일=8/27
  assert.equal(suggestCampaignName('  ', '2026-09-01'), '9월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-07'), 'A 8월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-08'), 'A 8월 1주'); // 토 — 8/7과 같은 주(목=8/6)라 주차도 같다
  assert.equal(suggestCampaignName('A', '2026-08-31'), 'A 9월 1주'); // 월, 그 주 목요일=9/3 — 달이 넘어간다
  assert.equal(suggestCampaignName('A', '2026-08-27'), 'A 8월 4주'); // 목요일 그 자체
  assert.equal(suggestCampaignCode('Lifting Clinic', '2026-08-24'), 'lifting-clinic-20260824');
  assert.equal(suggestCampaignCode('', '2026-08-24'), '20260824');
  assert.equal(suggestCampaignCode('클리닉', '2026-08-24'), '20260824'); // 비영문만이면 날짜만
});

test('5) 작업 맥락을 실은 원고 화면 주소', () => {
  // /generate는 task·campaign 두 파라미터가 다 있어야 배너를 켠다(generate/page.tsx:299)
  assert.equal(draftWriteHref('t1', 'c1'), '/generate?task=t1&campaign=c1');
  // 실제 값은 uuid라 이스케이프가 필요 없지만, 주소 조립이 한 곳에만 있게 하는 것이 이 함수의 목적이다
  assert.equal(
    draftWriteHref('9f1c0e2a-0000-4000-8000-000000000001', '9f1c0e2a-0000-4000-8000-000000000002'),
    '/generate?task=9f1c0e2a-0000-4000-8000-000000000001&campaign=9f1c0e2a-0000-4000-8000-000000000002',
  );
  // 예상 밖 문자가 들어와도 주소가 깨지지 않는다
  assert.equal(draftWriteHref('a&b', 'c d'), '/generate?task=a%26b&campaign=c%20d');
});
