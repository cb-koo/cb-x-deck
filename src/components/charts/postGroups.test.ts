import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPosts } from './postGroups';

const daily = new Map([
  ['2026-09-15', 3], ['2026-09-16', 3], ['2026-09-17', 17], ['2026-09-18', 19], ['2026-09-19', 3],
  ['2026-09-27', 3], ['2026-09-28', 6], ['2026-09-29', 11], ['2026-09-30', 11], ['2026-10-01', 8],
]);

test('게시일이 하루 이내로 이어지는 글은 한 묶음, 인입 증가는 묶음 창에서 한 번만 센다', () => {
  const g = groupPosts([
    { handle: 'a', date: '2026-09-16', views: 21270, bookmarks: 148 },
    { handle: 'b', date: '2026-09-17', views: 868970, bookmarks: 2661 },
  ], daily, 3);
  assert.equal(g.length, 1);
  assert.equal(g[0].from, '2026-09-16');
  assert.equal(g[0].to, '2026-09-18');
  assert.equal(g[0].windowDays, 3);
  assert.equal(g[0].lift, 3 + 17 + 19 - 9);
  assert.equal(g[0].posts[0].handle, 'b'); // 북마크 많은 순
  assert.equal(g[0].posts[0].estLift, Math.round(30 * 2661 / 2809));
});

test('창이 겹치지 않으면(이틀 이상 차이) 따로 센다', () => {
  const g = groupPosts([
    { handle: 'p', date: '2026-09-28', views: 1006143, bookmarks: 2438 },
    { handle: 'q', date: '2026-09-30', views: 137674, bookmarks: 619 },
  ], daily, 3);
  assert.equal(g.length, 2);
  assert.equal(g[0].lift, 6 + 11 - 6);
  assert.equal(g[1].lift, 11 + 8 - 6);
});

test('북마크가 기준 미만인 작은 글은 묶음을 잇지 않는다', () => {
  const g = groupPosts([
    { handle: 'p', date: '2026-09-27', views: 94548, bookmarks: 337 },
    { handle: 'tiny', date: '2026-09-28', views: 46, bookmarks: 0 },
    { handle: 'q', date: '2026-09-30', views: 137674, bookmarks: 619 },
  ], daily, 3);
  assert.deepEqual(g.map((x) => x.posts.map((p) => p.handle)), [['p'], ['q']]);
});
