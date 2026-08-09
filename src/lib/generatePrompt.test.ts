import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, draftSystem, PROMPT_DEFAULTS, type PromptInput } from './generatePrompt.ts';

const base: PromptInput = {
  client: { name: '가온피부과', info: '강남역 3번 출구', bannedPhrases: ['완치'] },
  procedures: [{ name: '보톡스', description: '이마 주사', effectPhrases: '주름 완화', bannedPhrases: ['동안'] }],
  references: [{ tweetId: '1', handle: 'beauty_jp', name: null, excerpt: 'サンプル投稿',
                 memos: [{ member: '박구건', text: '훅이 좋아요' }] }],
  mode: 'both', direction: '여름 이벤트', format: 'single', constraintsOn: true,
};

test('오버라이드 없으면 기본 문장 그대로 (리팩토링 계약: 기본 동작 불변)', () => {
  const p = buildUserPrompt(base);
  assert.ok(p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes(PROMPT_DEFAULTS.noCopy));
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem(), PROMPT_DEFAULTS.system);
});

test('오버라이드가 해당 문장만 교체한다', () => {
  const p = buildUserPrompt(base, { modeBoth: '커스텀 모드 규칙', noCopy: '커스텀 베끼기 금지', hook: '커스텀 훅' });
  assert.ok(p.includes('커스텀 모드 규칙'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes('커스텀 베끼기 금지'));
  assert.ok(p.includes('커스텀 훅'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '커스텀 역할' }), '커스텀 역할');
});

test('빈 문자열·공백 오버라이드는 기본값으로 폴백 (지워서 망가지는 사고 방지)', () => {
  const p = buildUserPrompt(base, { hook: '  ' });
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '' }), PROMPT_DEFAULTS.system);
});

test('모드별 오버라이드는 그 모드가 선택됐을 때만 적용', () => {
  const p = buildUserPrompt({ ...base, mode: 'form' }, { modeForm: 'FORM 전용', modeAngle: 'ANGLE 전용' });
  assert.ok(p.includes('FORM 전용'));
  assert.ok(!p.includes('ANGLE 전용'));
});
