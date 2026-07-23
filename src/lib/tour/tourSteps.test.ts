import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckSteps, BRIEFING_STEPS, type TourStep } from './tourSteps.ts';

const ALLOWED_SELECTORS = new Set([
  '[data-tour="add-column"]', '[data-tour="column-modal"]',
  '[data-tour="col-refresh"]', '[data-tour="col-sort"]',
  '[data-tour="col-view"]', '[data-tour="col-translate"]', '[data-tour="col-save"]',
  '[data-tour="sidebar"]', '[data-tour="help-button"]',
  '[data-tour="bf-column"]', '[data-tour="bf-period"]',
  '[data-tour="bf-generate"]', '[data-tour="bf-result"]',
  '[data-tour="bf-history"]',
]);

function assertWellFormed(steps: TourStep[]) {
  const ids = new Set<string>();
  for (const s of steps) {
    assert.ok(s.id, 'id 필수');
    assert.ok(!ids.has(s.id), `id 중복: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title.trim().length > 0, `title 필수: ${s.id}`);
    assert.ok(s.description.trim().length > 0, `description 필수: ${s.id}`);
    if (s.element) assert.ok(ALLOWED_SELECTORS.has(s.element), `허용되지 않은 셀렉터: ${s.element}`);
  }
}

test('덱: 항상 컬럼 생성부터 시작하는 10단계 단일 시나리오', () => {
  assert.equal(deckSteps().length, 10);
});

test('덱 스텝 무결성', () => {
  assertWellFormed(deckSteps());
});

test('덱: 생성 유도 + 정렬/보기 + 사이드바 스텝을 포함', () => {
  const ids = deckSteps().map((s) => s.id);
  // 행동감지 자동전진용
  assert.ok(ids.includes('add-column'));
  assert.ok(ids.includes('create-modal'));
  // 이번 개편으로 추가된 커버리지
  assert.ok(ids.includes('col-sort'));
  assert.ok(ids.includes('col-view'));
  assert.ok(ids.includes('col-translate'));
  assert.ok(ids.includes('deck-sidebar'));
});

test('덱 마무리 스텝은 ? 버튼을 하이라이트(재실행 위치를 눈으로 보여줌)', () => {
  const last = deckSteps()[deckSteps().length - 1];
  assert.equal(last.element, '[data-tour="help-button"]');
});

test('브리핑: 결과·마무리 포함 7단계, 무결성', () => {
  assert.equal(BRIEFING_STEPS.length, 7);
  assertWellFormed(BRIEFING_STEPS);
  assert.ok(BRIEFING_STEPS[0].description.includes('쌓인'));
  const ids = BRIEFING_STEPS.map((s) => s.id);
  assert.ok(ids.includes('bf-result'));
});

test('브리핑 마무리 스텝도 ? 버튼을 하이라이트', () => {
  const last = BRIEFING_STEPS[BRIEFING_STEPS.length - 1];
  assert.equal(last.element, '[data-tour="help-button"]');
});
