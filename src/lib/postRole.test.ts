import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles, normalizeUrl, urlsOf } from './postRole.ts';

const SHORT = 'https://cb.link/tavemo';
const p = (tweetId: string, postedAt: string | null, over: Partial<{ role: 'main'|'thread'|'link'|null; rawUrls: unknown; isReply: boolean | null }> = {}) =>
  ({ tweetId, postedAt, role: null, rawUrls: [], isReply: null, ...over });

test('normalizeUrl: 스킴·후행 슬래시·호스트 대소문자를 무시한다', () => {
  assert.equal(normalizeUrl('HTTPS://CB.link/tavemo/'), normalizeUrl('http://cb.link/tavemo'));
  assert.notEqual(normalizeUrl('https://cb.link/tavemo-2'), normalizeUrl(SHORT));
});

test('urlsOf: entities.urls 배열에서 expanded_url(없으면 url)만 뽑고 기형은 버린다', () => {
  assert.deepEqual(urlsOf([{ expanded_url: 'https://a/x' }, { url: 'https://t.co/b' }, 'junk', null]), ['https://a/x', 'https://t.co/b']);
  assert.deepEqual(urlsOf(null), []);
});

test('링크가 든 게시물은 위치와 무관하게 link, 나머지는 가장 이른 것이 main', () => {
  const posts = [
    p('3', '2026-08-24T01:10:00Z', { rawUrls: [{ expanded_url: SHORT }] }),
    p('1', '2026-08-24T01:00:00Z'),
    p('2', '2026-08-24T01:05:00Z', { isReply: true }),
  ];
  const r = assignRoles(posts, [SHORT]);
  assert.deepEqual(r.map((x) => [x.tweetId, x.role]), [['1', 'main'], ['2', 'thread'], ['3', 'link']]);
});

test('저장된 role은 자동 판정을 덮는다', () => {
  const r = assignRoles([p('1', '2026-08-24T01:00:00Z', { role: 'thread' }), p('2', '2026-08-24T01:05:00Z')], []);
  assert.deepEqual(r.map((x) => [x.tweetId, x.role]), [['2', 'main'], ['1', 'thread']]);
});

test('isReply=false인 게시물이 있으면 시각보다 우선해 main', () => {
  const r = assignRoles([p('a', '2026-08-24T00:00:00Z', { isReply: true }), p('b', '2026-08-24T00:01:00Z', { isReply: false })], []);
  assert.equal(r[0].tweetId, 'b'); assert.equal(r[0].role, 'main');
});

test('링크가 없는 원고(shortUrls 빈 배열)는 main/thread만 나온다 · 빈 입력은 빈 출력', () => {
  const r = assignRoles([p('1', '2026-08-24T00:00:00Z', { rawUrls: [{ expanded_url: SHORT }] })], []);
  assert.equal(r[0].role, 'main');
  assert.deepEqual(assignRoles([], [SHORT]), []);
});
