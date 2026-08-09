import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUserPrompt, draftOutputSchema, draftSystem, variantsOutputSchema, PROMPT_DEFAULTS,
  type PromptInput,
} from './generatePrompt.ts';

const base: PromptInput = {
  client: null, procedures: [], references: [], mode: 'off',
  direction: '', format: 'single', constraintsOn: false,
};
const client = { name: 'A클리닉', info: '개원 10년, 원장 직접 시술', bannedPhrases: ['B클리닉'] };
const ref = { tweetId: 't1', handle: 'mika', name: 'みか', excerpt: '正直迷ってた',
              memos: [{ member: '박구건', text: '앵글이 신선' }] };

test('꺼진 요소의 블록은 프롬프트에 부재한다 (반영 토글 계약)', () => {
  const p = buildUserPrompt({ ...base, direction: '다운타임 강조' });
  assert.ok(!p.includes('클라이언트 정보'));
  assert.ok(!p.includes('레퍼런스'));
  assert.ok(p.includes('다운타임 강조'));
});

test('클라이언트+시술 블록 포함, 금지어는 constraintsOn일 때만', () => {
  const proc = { name: '보톡스', description: '주름 완화', effectPhrases: '주름이 부드러워짐', bannedPhrases: ['半永久'] };
  const off = buildUserPrompt({ ...base, client, procedures: [proc], direction: 'x' });
  assert.ok(off.includes('A클리닉') && off.includes('보톡스') && off.includes('주름이 부드러워짐'));
  assert.ok(!off.includes('B클리닉') && !off.includes('半永久'));
  const on = buildUserPrompt({ ...base, client, procedures: [proc], direction: 'x', constraintsOn: true });
  assert.ok(on.includes('B클리닉') && on.includes('半永久'));
});

test('참고 모드별 지시 차이 + 메모(팀 메모) 포함 + 표절 금지 상시', () => {
  const form = buildUserPrompt({ ...base, references: [ref], mode: 'form' });
  assert.ok(form.includes('형식') && !form.includes('앵글만 참고'));
  const angle = buildUserPrompt({ ...base, references: [ref], mode: 'angle' });
  assert.ok(angle.includes('앵글'));
  assert.ok(form.includes('팀 메모') && form.includes('앵글이 신선'));
  assert.ok(form.includes('그대로 옮기지'));
});

test('mode=off면 레퍼런스가 있어도 블록 부재', () => {
  const p = buildUserPrompt({ ...base, references: [ref], mode: 'off', direction: 'x' });
  assert.ok(!p.includes('正直迷ってた'));
});

test('형식 규칙: single=1개·thread=3~5개, 첫 단락 훅 규칙 포함', () => {
  const s = buildUserPrompt({ ...base, direction: 'x', format: 'single' });
  assert.ok(s.includes('1개') && s.includes('첫 단락'));
  const t = buildUserPrompt({ ...base, direction: 'x', format: 'thread' });
  assert.ok(t.includes('3~5'));
});

test('rewrite: 피드백 있으면 반영 지시 + 현재 버전 포함', () => {
  const p = buildUserPrompt({ ...base, direction: 'x',
    rewrite: { current: ['現行1', '現行2'], feedback: '비용 얘기는 빼줘' } });
  assert.ok(p.includes('현재 버전'));
  assert.ok(p.includes('現行1') && p.includes('現行2'));
  assert.ok(p.includes('사용자 피드백') && p.includes('비용 얘기는 빼줘'));
});

test('rewrite: 피드백 없으면 같은 조건 + 겹침 금지 지시', () => {
  const p = buildUserPrompt({ ...base, direction: 'x', rewrite: { current: ['現行'] } });
  assert.ok(p.includes('겹치지 않게'));
  assert.ok(!p.includes('사용자 피드백'));
});

test('출력 스키마: posts 배열 필수', () => {
  const s = draftOutputSchema() as { properties: { posts: object }; required: string[] };
  assert.ok(s.properties.posts);
  assert.deepEqual(s.required, ['posts']);
});

test('variantCount>1 — 다양성 지시가 들어가고, 1이면 흔적도 없다', () => {
  const base = {
    client: null, procedures: [], references: [], mode: 'off' as const,
    direction: '테스트', format: 'single' as const, constraintsOn: false,
  };
  const multi = buildUserPrompt({ ...base, variantCount: 3 });
  assert.ok(multi.includes('시안 3개'));
  assert.ok(multi.includes('서로 다른 앵글'));
  const single = buildUserPrompt({ ...base, variantCount: 1 });
  const none = buildUserPrompt(base);
  assert.equal(single, none);                 // count 1 = 기존 프롬프트와 동일
  assert.ok(!none.includes('시안'));
});

test('variantsOutputSchema — variants 배열 스키마', () => {
  const s = variantsOutputSchema() as { properties: { variants: { items: { properties: object } } }; required: string[] };
  assert.deepEqual(s.required, ['variants']);
  assert.ok('posts' in s.properties.variants.items.properties);
});

const overrideBase: PromptInput = {
  client: { name: '가온피부과', info: '강남역 3번 출구', bannedPhrases: ['완치'] },
  procedures: [{ name: '보톡스', description: '이마 주사', effectPhrases: '주름 완화', bannedPhrases: ['동안'] }],
  references: [{ tweetId: '1', handle: 'beauty_jp', name: null, excerpt: 'サンプル投稿',
                 memos: [{ member: '박구건', text: '훅이 좋아요' }] }],
  mode: 'both', direction: '여름 이벤트', format: 'single', constraintsOn: true,
};

test('오버라이드 없으면 기본 문장 그대로 (리팩토링 계약: 기본 동작 불변)', () => {
  const p = buildUserPrompt(overrideBase);
  assert.ok(p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes(PROMPT_DEFAULTS.noCopy));
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem(), PROMPT_DEFAULTS.system);
});

test('오버라이드가 해당 문장만 교체한다', () => {
  const p = buildUserPrompt(overrideBase, { modeBoth: '커스텀 모드 규칙', noCopy: '커스텀 베끼기 금지', hook: '커스텀 훅' });
  assert.ok(p.includes('커스텀 모드 규칙'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.modeBoth));
  assert.ok(p.includes('커스텀 베끼기 금지'));
  assert.ok(p.includes('커스텀 훅'));
  assert.ok(!p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '커스텀 역할' }), '커스텀 역할');
});

test('빈 문자열·공백 오버라이드는 기본값으로 폴백 (지워서 망가지는 사고 방지)', () => {
  const p = buildUserPrompt(overrideBase, { hook: '  ' });
  assert.ok(p.includes(PROMPT_DEFAULTS.hook));
  assert.equal(draftSystem({ system: '' }), PROMPT_DEFAULTS.system);
});

test('모드별 오버라이드는 그 모드가 선택됐을 때만 적용', () => {
  const p = buildUserPrompt({ ...overrideBase, mode: 'form' }, { modeForm: 'FORM 전용', modeAngle: 'ANGLE 전용' });
  assert.ok(p.includes('FORM 전용'));
  assert.ok(!p.includes('ANGLE 전용'));
});
