import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, draftOutputSchema, type PromptInput } from './generatePrompt.ts';

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

test('avoid(다른 각도로) 포함', () => {
  const p = buildUserPrompt({ ...base, direction: 'x', avoid: '실패담 앵글' });
  assert.ok(p.includes('실패담 앵글') && p.includes('다른 각도'));
});

test('출력 스키마: posts 배열 필수', () => {
  const s = draftOutputSchema() as { properties: { posts: object }; required: string[] };
  assert.ok(s.properties.posts);
  assert.deepEqual(s.required, ['posts']);
});
