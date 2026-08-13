import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftShareUrl, draftLinksText, SHARE_LABEL_MAX } from './draftShare.ts';

const row = (id: string, over: Partial<{ title: string | null; koTitle: string | null; koLatest: string[] | null; direction: string }> = {}) => ({
  id,
  title: null, koTitle: null, koLatest: null, direction: '',
  content: { posts: [{ text: '원문 첫 줄' }] }, edited: null,
  ...over,
});

test('draftShareUrl: 지금 보고 있는 주소를 기준으로 만든다', () => {
  assert.equal(draftShareUrl('https://cb-x-deck.vercel.app', 'abc'),
    'https://cb-x-deck.vercel.app/generate?draft=abc');
  assert.equal(draftShareUrl('http://127.0.0.1:3001', 'abc'),
    'http://127.0.0.1:3001/generate?draft=abc');
});

test('draftLinksText: 제목 줄 + 링크 줄, 사이는 빈 줄', () => {
  const text = draftLinksText([
    row('id-1', { title: '리투오 후기' }),
    row('id-2', { title: '다운타임 설명' }),
  ], 'https://x.test');
  assert.equal(text,
    '리투오 후기\nhttps://x.test/generate?draft=id-1\n\n다운타임 설명\nhttps://x.test/generate?draft=id-2');
});

test('draftLinksText: 제목이 없으면 목록에 나오는 라벨을 그대로 쓴다', () => {
  // draftLabel의 폴백 체인(사람 제목 → 자동 제목 → 한국어 첫 줄 → 원문 첫 줄)을 그대로 따른다 —
  // 화면에서 보던 이름과 복사된 이름이 다르면 그게 더 헷갈린다.
  const text = draftLinksText([row('id-1', { koTitle: '자동 제목' })], 'https://x.test');
  assert.equal(text.split('\n')[0], '자동 제목');
  const fallback = draftLinksText([row('id-2')], 'https://x.test');
  assert.equal(fallback.split('\n')[0], '원문 첫 줄');
});

test('draftLinksText: 긴 라벨은 잘라낸다 — 메신저에 붙였을 때 한 줄로 읽혀야 한다', () => {
  const long = 'あ'.repeat(200);
  const text = draftLinksText([row('id-1', { title: long })], 'https://x.test');
  const first = text.split('\n')[0];
  assert.equal(first.length, SHARE_LABEL_MAX + 1, '잘린 뒤 말줄임표 한 글자가 붙는다');
  assert.ok(first.endsWith('…'));
});

test('draftLinksText: 한 건이면 빈 줄 없이 두 줄', () => {
  const text = draftLinksText([row('id-1', { title: '하나' })], 'https://x.test');
  assert.equal(text, '하나\nhttps://x.test/generate?draft=id-1');
});

test('draftLinksText: 빈 목록은 빈 문자열', () => {
  assert.equal(draftLinksText([], 'https://x.test'), '');
});
