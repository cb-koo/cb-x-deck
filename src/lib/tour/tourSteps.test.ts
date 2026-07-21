import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckSteps, BRIEFING_STEPS, type TourStep } from './tourSteps.ts';

const ALLOWED_SELECTORS = new Set([
  '[data-tour="add-column"]', '[data-tour="column-modal"]',
  '[data-tour="col-refresh"]', '[data-tour="col-save"]',
  '[data-tour="bf-column"]', '[data-tour="bf-period"]',
  '[data-tour="bf-generate"]', '[data-tour="bf-history"]',
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

test('덱: 컬럼 없으면 6단계(생성 유도 포함), 있으면 3단계', () => {
  assert.equal(deckSteps(false).length, 6);
  assert.equal(deckSteps(true).length, 3);
});

test('덱 스텝 무결성 (양 갈래)', () => {
  assertWellFormed(deckSteps(false));
  assertWellFormed(deckSteps(true));
});

test('덱 생성 유도 갈래는 행동감지용 id를 포함', () => {
  const ids = deckSteps(false).map((s) => s.id);
  assert.ok(ids.includes('add-column'));
  assert.ok(ids.includes('create-modal'));
});

test('덱 마지막은 항상 마무리(요소 없는 중앙 스텝)', () => {
  for (const steps of [deckSteps(false), deckSteps(true)]) {
    const last = steps[steps.length - 1];
    assert.equal(last.element, undefined);
  }
});

test('브리핑: 5단계 무결성, 자동시작 안내 문구 포함', () => {
  assert.equal(BRIEFING_STEPS.length, 5);
  assertWellFormed(BRIEFING_STEPS);
  assert.ok(BRIEFING_STEPS[0].description.includes('쌓인'));
});
