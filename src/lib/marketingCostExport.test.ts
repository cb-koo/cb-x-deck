import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_TYPES } from './campaignJudgment.ts';
import {
  MARKETING_COST_CATEGORIES, CATEGORY_BY_TASK_TYPE, categoryForTaskType,
  CLIENT_ID_TO_CLINIC_ID, resolveClinicId,
  clampPage, clampPageLimit, toMarketingCostItem, type MarketingCostSource,
} from './marketingCostExport.ts';

test('카테고리 매핑 — 모든 작업 유형이 스펙 4종 키 중 하나로 떨어진다', () => {
  for (const t of TASK_TYPES) {
    const cat = categoryForTaskType(t);
    assert.ok(MARKETING_COST_CATEGORIES.includes(cat), `${t} → ${cat} 는 4종 enum 안이어야 한다`);
  }
});

test('카테고리 매핑 — 유형 경계가 스펙 §4 그대로다', () => {
  assert.equal(CATEGORY_BY_TASK_TYPE.post, 'x_content_quote_rt');
  assert.equal(CATEGORY_BY_TASK_TYPE.quoteRt, 'x_content_quote_rt');   // 인용RT는 콘텐츠 쪽
  assert.equal(CATEGORY_BY_TASK_TYPE.rt, 'x_secondary_viral');          // RT는 2차 바이럴 쪽
  assert.equal(CATEGORY_BY_TASK_TYPE.visit, 'x_visit_manuscript');
  // x_visit_etc는 어떤 작업 유형도 매핑하지 않는다 — 소스가 없다(계약 문서 참조)
  assert.ok(!Object.values(CATEGORY_BY_TASK_TYPE).includes('x_visit_etc'));
});

test('resolveClinicId — 고정 UUID 매핑이 clinic_code보다 우선, 없으면 폴백, 둘 다 없으면 null', () => {
  const mimo = '6a2405e8-fa35-4804-9048-06e5a6e25641';
  assert.equal(resolveClinicId(mimo, null), 'mimodreamjp');            // 매핑만
  assert.equal(resolveClinicId(mimo, 'wrongslug'), 'mimodreamjp');     // 매핑이 clinic_code를 이긴다(표기 흔들림 무시)
  assert.equal(resolveClinicId('unknown-id', 'velybjp'), 'velybjp');   // 매핑 없으면 clinic_code 폴백
  assert.equal(resolveClinicId('unknown-id', null), null);             // 둘 다 없으면 제외
});

test('CLIENT_ID_TO_CLINIC_ID — koo가 준 4개 클라이언트가 스펙 §5 슬러그로 매핑된다', () => {
  assert.equal(CLIENT_ID_TO_CLINIC_ID['6a2405e8-fa35-4804-9048-06e5a6e25641'], 'mimodreamjp');
  assert.equal(CLIENT_ID_TO_CLINIC_ID['70baf347-ea8c-4e8e-a32c-4bb18cca50ff'], 'maindskinjp');
  assert.equal(CLIENT_ID_TO_CLINIC_ID['904cb696-7236-45cf-a7b0-803033f5fbe2'], 'sonyounajp');
  assert.equal(CLIENT_ID_TO_CLINIC_ID['3e9e4e61-c837-4d04-b711-df72a7bd32d5'], 'thesquaredentaljp');
});

test('clampPageLimit — 1~2000, 기본 500·최대 2000, 정수 아님/0 이하는 기본', () => {
  assert.equal(clampPageLimit(null), 500);
  assert.equal(clampPageLimit('0'), 500);
  assert.equal(clampPageLimit('-3'), 500);
  assert.equal(clampPageLimit('abc'), 500);
  assert.equal(clampPageLimit('1.5'), 500);
  assert.equal(clampPageLimit('1'), 1);
  assert.equal(clampPageLimit('999'), 999);
  assert.equal(clampPageLimit('2000'), 2000);
  assert.equal(clampPageLimit('5000'), 2000);   // 최대로 잘린다
});

test('clampPage — 1부터, 이상값은 1', () => {
  assert.equal(clampPage(null), 1);
  assert.equal(clampPage('0'), 1);
  assert.equal(clampPage('-1'), 1);
  assert.equal(clampPage('abc'), 1);
  assert.equal(clampPage('3'), 3);
});

test('toMarketingCostItem — 스펙 §3 행 모양으로 직렬화, amountKrw는 gross_krw 정수', () => {
  const src: MarketingCostSource = {
    id: '11111111-2222-3333-4444-555555555555',
    taskType: 'visit',
    createdAtKst: '2026-09-08 14:10:00',
    clinicCode: 'mimodreamjp',
    clientName: '미모드림의원',
    grossKrw: 120000.4,       // 생성 컬럼이 소수를 내도 정수로 반올림해 보낸다
    amountGross: 12903,
    payoutCurrency: 'JPY',
  };
  assert.deepEqual(toMarketingCostItem(src), {
    id: 'xdeck:11111111-2222-3333-4444-555555555555',
    timestamp: '2026-09-08 14:10:00',
    clinicId: 'mimodreamjp',
    clinic: '미모드림의원',
    category: 'x_visit_manuscript',
    amountKrw: 120000,
    currency: 'JPY',
    originalAmount: 12903,
    splitCount: 1,
  });
});
