import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords } from './research.ts';

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}

test('기사에서 keywords/hooks ja·ko 쌍 추출', async () => {
  const out = await extractKeywords({ title: '毛穴特集', text: '本文…' }, fakeClient(
    '{"keywords":[{"ja":"毛穴開き","ko":"모공 벌어짐"},{"ja":"いちご鼻","ko":"딸기코"}],"hooks":[{"ja":"もう洗顔は古い","ko":"이제 세안은 옛말"}]}'));
  assert.deepEqual(out.keywords, [{ ja: '毛穴開き', ko: '모공 벌어짐' }, { ja: 'いちご鼻', ko: '딸기코' }]);
  assert.deepEqual(out.hooks, [{ ja: 'もう洗顔は古い', ko: '이제 세안은 옛말' }]);
});

test('잡담 섞인 응답에서 JSON 블록 추출', async () => {
  const out = await extractKeywords({ title: 't', text: 'x' }, fakeClient('결과:\n{"keywords":[{"ja":"a","ko":"에이"}],"hooks":[]}\n끝'));
  assert.deepEqual(out.keywords, [{ ja: 'a', ko: '에이' }]);
});

test('파싱 불가면 빈 결과 (throw 금지 — UI 무해)', async () => {
  const out = await extractKeywords({ title: 't', text: 'x' }, fakeClient('추출 실패'));
  assert.deepEqual(out, { keywords: [], hooks: [] });
});

test('ja 없는 항목은 걸러냄', async () => {
  const out = await extractKeywords({ title: 't', text: 'x' }, fakeClient(
    '{"keywords":["문자열",{"ko":"만"},{"ja":"OK","ko":"오케이"}],"hooks":[{"ja":"H"}]}'));
  assert.deepEqual(out.keywords, [{ ja: 'OK', ko: '오케이' }]);
  assert.deepEqual(out.hooks, [{ ja: 'H', ko: '' }]);
});
