import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestKeywords, translateKeyword, translateTags } from './suggest.ts';

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}

test('JSON 응답 파싱 — ja/ko 쌍', async () => {
  const out = await suggestKeywords('レチナール', fakeClient(
    '{"variants":[{"ja":"レチノール","ko":"레티놀"},{"ja":"ビタミンA","ko":"비타민A"}],"adjacent":[{"ja":"シワ","ko":"주름"}]}'));
  assert.deepEqual(out.variants, [{ ja: 'レチノール', ko: '레티놀' }, { ja: 'ビタミンA', ko: '비타민A' }]);
  assert.deepEqual(out.adjacent, [{ ja: 'シワ', ko: '주름' }]);
});

test('앞뒤 잡담이 섞여도 JSON 블록 추출', async () => {
  const out = await suggestKeywords('a', fakeClient('はい:\n{"variants":[{"ja":"b","ko":"비"}],"adjacent":[]}\n以上'));
  assert.deepEqual(out.variants, [{ ja: 'b', ko: '비' }]);
});

test('파싱 불가면 빈 결과(throw 금지 — UI 무해)', async () => {
  const out = await suggestKeywords('a', fakeClient('죄송합니다'));
  assert.deepEqual(out, { variants: [], adjacent: [] });
});

test('ja 없는 항목·문자열 항목은 걸러냄', async () => {
  const out = await suggestKeywords('a', fakeClient('{"variants":["문자열",{"ko":"만"},{"ja":"OK","ko":"오케이"}],"adjacent":[]}'));
  assert.deepEqual(out.variants, [{ ja: 'OK', ko: '오케이' }]);
});

test('translateKeyword: 맥락 번역 파싱', async () => {
  const out = await translateKeyword('모공', fakeClient('{"ja":"毛穴","ko":"모공"}'));
  assert.deepEqual(out, { ja: '毛穴', ko: '모공' });
});

test('translateKeyword: 파싱 불가면 null', async () => {
  assert.equal(await translateKeyword('모공', fakeClient('번역 못함')), null);
  assert.equal(await translateKeyword('모공', fakeClient('{"ko":"모공만 있음"}')), null);
});

test('translateTags: 태그 배열 → ko 매핑', async () => {
  const out = await translateTags(['スキンケア', 'レチノール'], fakeClient('{"スキンケア":"스킨케어","レチノール":"레티놀"}'));
  assert.deepEqual(out, { 'スキンケア': '스킨케어', 'レチノール': '레티놀' });
});

test('translateTags: 파싱 불가/빈 입력이면 빈 객체', async () => {
  assert.deepEqual(await translateTags(['a'], fakeClient('불가')), {});
  assert.deepEqual(await translateTags([], fakeClient('{}')), {});
});

test('translateTags: 문자열 아닌 값은 걸러냄', async () => {
  const out = await translateTags(['a', 'b'], fakeClient('{"a":"에이","b":123}'));
  assert.deepEqual(out, { a: '에이' });
});
