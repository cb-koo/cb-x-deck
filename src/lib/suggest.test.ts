import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestKeywords } from './suggest.ts';

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}

test('JSON 응답 파싱', async () => {
  const out = await suggestKeywords('レチナール', fakeClient('{"variants":["レチノール","ビタミンA"],"adjacent":["シワ","毛穴"]}'));
  assert.deepEqual(out.variants, ['レチノール', 'ビタミンA']);
  assert.deepEqual(out.adjacent, ['シワ', '毛穴']);
});

test('앞뒤 잡담이 섞여도 첫 JSON 블록 추출', async () => {
  const out = await suggestKeywords('a', fakeClient('はい、こちらです:\n{"variants":["b"],"adjacent":[]}\n以上'));
  assert.deepEqual(out.variants, ['b']);
});

test('파싱 불가면 빈 결과(throw 금지 — UI 무해)', async () => {
  const out = await suggestKeywords('a', fakeClient('죄송합니다'));
  assert.deepEqual(out, { variants: [], adjacent: [] });
});
