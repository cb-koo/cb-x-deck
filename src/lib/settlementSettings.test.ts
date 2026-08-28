import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTLEMENT_DEFAULTS, sanitizeSettlementSettings, visibleCategories, categoryBySendAs, defaultCategoryFor,
} from './settlementSettings.ts';

test('기본값 — 슬랙 3분류, RT만 기본값, 환율 10', () => {
  assert.equal(SETTLEMENT_DEFAULTS.categories.length, 3);
  assert.equal(SETTLEMENT_DEFAULTS.rateKrwPerJpy, 10);
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'rt')?.label, '프로모션 RT·인용RT');
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'quoteRt'), null);   // 인용RT는 요청자 최근 선택으로
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'post'), null);      // 투고는 캠페인 종류 규칙(calc)
});

test('sanitize — 정상 입력은 정돈되어 통과', () => {
  const r = sanitizeSettlementSettings({
    categories: [{ id: 'a', label: ' 프로모션 ', sendAs: 'X', hidden: false, defaultFor: ['rt'] }],
    rateKrwPerJpy: 10,
  });
  assert.ok(typeof r !== 'string');
  assert.equal(r.categories[0].label, '프로모션');
});

test('sanitize — 거절 사유', () => {
  assert.equal(typeof sanitizeSettlementSettings(null), 'string');
  assert.equal(sanitizeSettlementSettings({ categories: [], rateKrwPerJpy: 10 }), '분류가 하나 이상 필요해요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: '', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '분류 이름을 입력해 주세요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: '', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '정산 쪽 이름을 입력해 주세요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: ['rt'] }, { id: 'b', label: 'B', sendAs: 'Y', hidden: false, defaultFor: ['rt'] }], rateKrwPerJpy: 10 }), '한 유형은 한 분류의 기본값으로만 둘 수 있어요 (RT)');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 0 }), '환율은 1 이상 정수예요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10.5 }), '환율은 1 이상 정수예요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: ['nope'] }], rateKrwPerJpy: 10 }), '알 수 없는 작업 유형이에요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }, { id: 'a', label: 'B', sendAs: 'Y', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '분류 id가 겹쳐요');
});

test('visible/bySendAs/defaultFor — 숨김 처리', () => {
  const s = sanitizeSettlementSettings({
    categories: [
      { id: 'a', label: 'A', sendAs: 'X', hidden: true, defaultFor: ['rt'] },
      { id: 'b', label: 'B', sendAs: 'Y', hidden: false, defaultFor: [] },
    ], rateKrwPerJpy: 10,
  });
  assert.ok(typeof s !== 'string');
  assert.deepEqual(visibleCategories(s).map((c) => c.id), ['b']);
  assert.equal(categoryBySendAs(s, 'X')?.id, 'a');           // 스냅샷 표시용 — 숨김도 찾는다
  assert.equal(categoryBySendAs(s, null), null);
  assert.equal(defaultCategoryFor(s, 'rt'), null);          // 숨긴 옵션은 기본값으로 쓰지 않는다
});
