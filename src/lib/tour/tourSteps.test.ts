import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckSteps, BRIEFING_STEPS, type TourStep } from './tourSteps.ts';

const ALLOWED_SELECTORS = new Set([
  '[data-tour="add-column"]', '[data-tour="column-modal"]',
  '[data-tour="col-refresh"]', '[data-tour="col-sort"]',
  '[data-tour="col-view"]', '[data-tour="col-analyze"]', '[data-tour="col-translate"]',
  '[data-tour="col-save"]', '[data-tour="col-reorder"]',
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

test('덱: 항상 컬럼 생성부터 시작하는 12단계 단일 시나리오', () => {
  assert.equal(deckSteps().length, 12);
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
  // main 합류 후 추가된 기능 — 안내가 없으면 발견되지 않는다
  assert.ok(ids.includes('col-analyze'), '분석 줄(주간 추이·전체 번역·주제별로 묶기) 안내 누락');
  assert.ok(ids.includes('col-reorder'), '컬럼 순서 손잡이 안내 누락');
});

test('비용 유발 액션은 금액·과금 조건을 함께 말한다 (AGENTS.md 원칙 6)', () => {
  const byId = new Map(deckSteps().map((s) => [s.id, s.description]));
  // 분석 줄: 유료/무료 구분 기준을 알려줘야 '눌러도 되나' 판단이 선다
  assert.match(byId.get('col-analyze')!, /비용|\$/);
  // 새로고침·번역: 팀 공용이라 남이 이미 쓴 결과를 재사용한다는 안심 맥락
  assert.match(byId.get('col-refresh')!, /팀 공용/);
  assert.match(byId.get('col-translate')!, /비용/);
});

test('덱 스텝 순서 — 컬럼 만들기가 앞, 마무리가 끝', () => {
  const ids = deckSteps().map((s) => s.id);
  assert.ok(ids.indexOf('add-column') < ids.indexOf('col-refresh'));
  assert.ok(ids.indexOf('col-analyze') < ids.indexOf('col-translate'), '분석 줄 소개 뒤에 전체 번역 상세');
  assert.equal(ids[0], 'deck-intro');
  assert.equal(ids[ids.length - 1], 'deck-outro');
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
