import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCandidates, filterGroups } from './candidateGroups.ts';
import type { CandidateRow, StoredTweet, Member } from './types.ts';

const M1: Member = { id: 'm1', name: '박구건', color: '#f00' };
const M2: Member = { id: 'm2', name: '심영훈', color: '#00f' };

function tweet(tweetId: string): StoredTweet {
  return {
    tweetId, authorHandle: 'a', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: 't', media: [], quoted: null,
    metrics: { views: null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
    firstSeenAt: '2026-07-01T00:00:00.000Z', lastFetchedAt: '2026-07-01T00:00:00.000Z',
    isNew: false, savedBy: [],
  };
}

function row(p: { id: string; tweetId: string; member: Member; savedAt: string; memo?: string; tags?: string[] }): CandidateRow {
  return {
    id: p.id, tweet: { ...tweet(p.tweetId), savedBy: [p.member] }, memo: p.memo ?? '',
    savedAt: p.savedAt, sourceColumnId: null,
    tags: (p.tags ?? []).map((name, i) => ({ id: `${p.id}-tag${i}`, name })),
    member: p.member, workspaceId: 'ws1',
  };
}

test('groupCandidates: tweet별 병합, 엔트리는 저장순, 그룹은 최신 저장 내림차순', () => {
  const rows = [
    row({ id: 'c1', tweetId: 'tw1', member: M1, savedAt: '2026-07-10T00:00:00.000Z' }),
    row({ id: 'c2', tweetId: 'tw2', member: M1, savedAt: '2026-07-11T00:00:00.000Z' }),
    row({ id: 'c3', tweetId: 'tw1', member: M2, savedAt: '2026-07-12T00:00:00.000Z' }),
  ];
  const groups = groupCandidates(rows);
  assert.equal(groups.length, 2);
  // tw1이 c3(7/12) 덕에 최신 → 첫 번째
  assert.equal(groups[0].tweet.tweetId, 'tw1');
  assert.equal(groups[1].tweet.tweetId, 'tw2');
  // 엔트리는 저장 시각 오름차순 (먼저 단 코멘트가 위)
  assert.deepEqual(groups[0].entries.map((e) => e.id), ['c1', 'c3']);
  assert.equal(groups[0].latestSavedAt, '2026-07-12T00:00:00.000Z');
  // 카드의 savedBy는 그룹 멤버 합집합
  assert.deepEqual(groups[0].tweet.savedBy.map((m) => m.id), ['m1', 'm2']);
});

test('filterGroups: 멤버 필터는 그룹 선별(코멘트는 전원 유지)', () => {
  const groups = groupCandidates([
    row({ id: 'c1', tweetId: 'tw1', member: M1, savedAt: '2026-07-10T00:00:00.000Z' }),
    row({ id: 'c2', tweetId: 'tw1', member: M2, savedAt: '2026-07-11T00:00:00.000Z' }),
    row({ id: 'c3', tweetId: 'tw2', member: M2, savedAt: '2026-07-12T00:00:00.000Z' }),
  ]);
  const mine = filterGroups(groups, { memberId: 'm1' });
  assert.deepEqual(mine.map((g) => g.tweet.tweetId), ['tw1']);
  assert.equal(mine[0].entries.length, 2); // 타인 코멘트 유지
});

test('filterGroups: 태그 필터는 그룹 내 누구든 매칭, 멤버 필터와 AND 조합', () => {
  const groups = groupCandidates([
    row({ id: 'c1', tweetId: 'tw1', member: M1, savedAt: '2026-07-10T00:00:00.000Z', tags: ['포맷'] }),
    row({ id: 'c2', tweetId: 'tw1', member: M2, savedAt: '2026-07-11T00:00:00.000Z' }),
    row({ id: 'c3', tweetId: 'tw2', member: M2, savedAt: '2026-07-12T00:00:00.000Z', tags: ['훅'] }),
  ]);
  assert.deepEqual(filterGroups(groups, { tag: '포맷' }).map((g) => g.tweet.tweetId), ['tw1']);
  assert.deepEqual(filterGroups(groups, { tag: '훅' }).map((g) => g.tweet.tweetId), ['tw2']);
  // m2 저장 + 포맷 태그(m1이 붙임) → tw1 매칭 (태그는 그룹 단위)
  assert.deepEqual(filterGroups(groups, { memberId: 'm2', tag: '포맷' }).map((g) => g.tweet.tweetId), ['tw1']);
  assert.deepEqual(filterGroups(groups, { memberId: 'm1', tag: '훅' }), []);
});

test('filterGroups: 필터 없으면 원본 그대로', () => {
  const groups = groupCandidates([row({ id: 'c1', tweetId: 'tw1', member: M1, savedAt: '2026-07-10T00:00:00.000Z' })]);
  assert.equal(filterGroups(groups, {}), groups);
});
