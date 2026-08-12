import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droppedMediaOnRewrite } from './DraftCard.tsx';
import type { DraftContent } from '../lib/draftTypes.ts';

// media 개수만 의미가 있는 테스트라 경로는 자리표시자 — 판정에 url은 쓰이지 않는다
const post = (text: string, n = 0): DraftContent['posts'][number] => ({
  text,
  media: Array.from({ length: n }, (_, k) => ({ type: 'photo', url: `draft/x/${text}-${k}.jpg`, videoUrl: null })),
});
const content = (...posts: DraftContent['posts']): DraftContent => ({ posts });

test('스레드가 짧아져 뒤쪽 이미지가 빠지면 트윗 번호와 장수를 돌려준다', () => {
  const base = content(post('1'), post('2', 1), post('3'), post('4', 1), post('5', 1));
  const next = content(post('1'), post('2'), post('3'));
  assert.deepEqual(droppedMediaOnRewrite(base, next, 1), {
    versionIndex: 1, postNumbers: [4, 5], count: 2, newPostCount: 3,
  });
});

test('한 트윗에 여러 장이면 장수를 합산한다', () => {
  const base = content(post('1'), post('2', 4), post('3', 3));
  const next = content(post('1'));
  assert.deepEqual(droppedMediaOnRewrite(base, next, 0), {
    versionIndex: 0, postNumbers: [2, 3], count: 7, newPostCount: 1,
  });
});

test('트윗 수가 그대로면 손실 없음 — 위치 기준 이월이 전부 살아남는다', () => {
  const base = content(post('1', 2), post('2', 1));
  const next = content(post('1'), post('2'));
  assert.equal(droppedMediaOnRewrite(base, next, 0), null);
});

test('짧아졌어도 잘린 자리에 이미지가 없었으면 알리지 않는다 — 없는 손실을 알리면 거짓 경고다', () => {
  const base = content(post('1', 2), post('2'), post('3'));
  const next = content(post('1'));
  assert.equal(droppedMediaOnRewrite(base, next, 0), null);
});

test('스레드가 길어지면 손실 없음', () => {
  const base = content(post('1', 1));
  const next = content(post('1'), post('2'), post('3'));
  assert.equal(droppedMediaOnRewrite(base, next, 0), null);
});

test('단문 → 단문은 항상 손실 없음', () => {
  assert.equal(droppedMediaOnRewrite(content(post('1', 4)), content(post('1')), 0), null);
});

test('스레드가 단문으로 접히면 1번을 뺀 전부가 손실', () => {
  const base = content(post('1', 2), post('2', 1), post('3', 1));
  assert.deepEqual(droppedMediaOnRewrite(base, content(post('1')), 2), {
    versionIndex: 2, postNumbers: [2, 3], count: 2, newPostCount: 1,
  });
});
