import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryEntry } from './candidateStore.ts';
import { sortLibraryEntries, commentSummary, savedByLabel } from './libraryTable.ts';

function entry(over: {
  tweetId?: string; addedAt?: string; views?: number | null; followers?: number | null;
  tweetCreatedAt?: string | null; memos?: string[]; memberNames?: string[]; addedBy?: string | null;
}): LibraryEntry {
  const names = over.memberNames ?? (over.memos ?? []).map((_, i) => `멤버${i}`);
  return {
    tweet: {
      tweetId: over.tweetId ?? 't1',
      // ??가 아니라 undefined 검사 — null을 넘기면 null이 그대로 남아야 'null은 뒤로' 정렬을 검증할 수 있다
      tweetCreatedAt: over.tweetCreatedAt !== undefined ? over.tweetCreatedAt : '2026-08-01T00:00:00Z',
      authorFollowers: over.followers ?? null,
      metrics: { views: over.views ?? null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    },
    addedBy: over.addedBy === undefined ? null : over.addedBy === null ? null : { id: 'm0', name: over.addedBy, color: '#000' },
    addedAt: over.addedAt ?? '2026-08-10T00:00:00Z',
    candidates: (over.memos ?? []).map((memo, i) => ({
      id: `c${i}`, memo, savedAt: `2026-08-1${i}T00:00:00Z`,
      member: { id: `m${i + 1}`, name: names[i], color: '#000' },
    })),
  } as unknown as LibraryEntry;
}

test('지표 정렬 desc — null은 항상 뒤로', () => {
  const rows = [entry({ tweetId: 'a', views: 10 }), entry({ tweetId: 'b', views: null }), entry({ tweetId: 'c', views: 99 })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'views', dir: 'desc' }).map((e) => e.tweet.tweetId), ['c', 'a', 'b']);
  assert.deepEqual(sortLibraryEntries(rows, { key: 'views', dir: 'asc' }).map((e) => e.tweet.tweetId), ['a', 'c', 'b']);
});

test('담은 시각·게시일 문자열 정렬', () => {
  const rows = [entry({ tweetId: 'old', addedAt: '2026-08-01T00:00:00Z' }), entry({ tweetId: 'new', addedAt: '2026-08-14T00:00:00Z' })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'addedAt', dir: 'desc' }).map((e) => e.tweet.tweetId), ['new', 'old']);
});

test('코멘트 수 정렬 — 메모 있는 행만 센다', () => {
  const rows = [entry({ tweetId: 'a', memos: ['x', ' '] }), entry({ tweetId: 'b', memos: ['x', 'y'] })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'comments', dir: 'desc' }).map((e) => e.tweet.tweetId), ['b', 'a']);
});

test('게시일 정렬 — null 게시일은 뒤로', () => {
  const rows = [
    entry({ tweetId: 'a', tweetCreatedAt: '2026-07-01T00:00:00Z' }),
    entry({ tweetId: 'n', tweetCreatedAt: null }),
    entry({ tweetId: 'b', tweetCreatedAt: '2026-08-01T00:00:00Z' }),
  ];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'date', dir: 'desc' }).map((e) => e.tweet.tweetId), ['b', 'a', 'n']);
});

test('sortLibraryEntries는 원본을 바꾸지 않는다', () => {
  const rows = [entry({ tweetId: 'a', views: 1 }), entry({ tweetId: 'b', views: 2 })];
  sortLibraryEntries(rows, { key: 'views', dir: 'desc' });
  assert.deepEqual(rows.map((e) => e.tweet.tweetId), ['a', 'b']);
});

test('commentSummary — 없음/1개/여러 개(최신 첫 줄)', () => {
  assert.equal(commentSummary(entry({ memos: [] })), '–');
  assert.equal(commentSummary(entry({ memos: ['하나뿐'] })), '하나뿐');
  assert.equal(commentSummary(entry({ memos: ['먼저', '최신 첫 줄\n둘째 줄'] })), '2 · 최신 첫 줄');
  assert.equal(commentSummary(entry({ memos: ['', '  '] })), '–');   // 빈 메모 후보행만 있으면 없음
});

test('savedByLabel — 코멘트 행 멤버, 없으면 담은 사람 폴백', () => {
  assert.equal(savedByLabel(entry({ memos: ['a', 'b'], memberNames: ['구건', '민지'] })), '구건, 민지');
  assert.equal(savedByLabel(entry({ memos: [], addedBy: '하늘' })), '하늘 (담음)');
  assert.equal(savedByLabel(entry({ memos: [], addedBy: null })), '–');
});
