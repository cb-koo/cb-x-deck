import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRefSearch, sortRefRows, REF_SORT_LABEL, type RefSortKey } from './refSheetFilter.ts';
import type { ReferenceRow } from './referenceStore.ts';

const row = (over: Partial<ReferenceRow>): ReferenceRow => ({
  tweetId: 't1', authorHandle: 'mika', authorName: 'みか', authorAvatarUrl: null,
  text: 'ウルセラの体験談', media: [], likes: null,
  metrics: { views: null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
  memos: [{ member: '박구건', text: '앵글이 신선' }], tags: ['시술후기'],
  workspaces: [], addedAt: '2026-08-01T00:00:00Z',
  ...over,
});

test('matchesRefSearch — 본문·작성자·메모·태그·번역문, 토큰 AND, 대소문자 무시', () => {
  const r = row({});
  assert.ok(matchesRefSearch(r, 'ウルセラ'));                    // 본문
  assert.ok(matchesRefSearch(r, 'MIKA'));                        // 핸들, 대소문자 무시
  assert.ok(matchesRefSearch(r, '앵글'));                        // 메모
  assert.ok(matchesRefSearch(r, '시술후기'));                    // 태그
  assert.ok(matchesRefSearch(r, '울쎄라', '울쎄라 체험담'));      // 번역문(있을 때만)
  assert.ok(!matchesRefSearch(r, '울쎄라'));                     // 번역문 없으면 미매칭
  assert.ok(matchesRefSearch(r, 'ウルセラ 신선'));               // 토큰 AND (본문+메모)
  assert.ok(!matchesRefSearch(r, 'ウルセラ 없는말'));            // 하나라도 없으면 탈락
  assert.ok(matchesRefSearch(r, '  '));                          // 빈 검색 = 전부 통과
});

test('sortRefRows — 지표 내림차순·null 뒤로·동률은 addedAt 최신·default는 원본 순서', () => {
  const a = row({ tweetId: 'a', metrics: { ...row({}).metrics, likes: 10 }, addedAt: '2026-08-01T00:00:00Z' });
  const b = row({ tweetId: 'b', metrics: { ...row({}).metrics, likes: 30 }, addedAt: '2026-08-02T00:00:00Z' });
  const c = row({ tweetId: 'c', metrics: { ...row({}).metrics, likes: null }, addedAt: '2026-08-03T00:00:00Z' });
  const d = row({ tweetId: 'd', metrics: { ...row({}).metrics, likes: 30 }, addedAt: '2026-08-04T00:00:00Z' });

  assert.deepEqual(sortRefRows([a, b, c, d], 'likes').map((x) => x.tweetId), ['d', 'b', 'a', 'c']); // 동률 30은 최신(d) 먼저, null은 맨 뒤
  assert.deepEqual(sortRefRows([a, b, c, d], 'recent').map((x) => x.tweetId), ['d', 'c', 'b', 'a']);
  assert.deepEqual(sortRefRows([b, a, c, d], 'default').map((x) => x.tweetId), ['b', 'a', 'c', 'd']); // 서버 순서 그대로
  const keys: RefSortKey[] = ['default', 'likes', 'views', 'bookmarks', 'recent'];
  for (const k of keys) assert.ok(REF_SORT_LABEL[k].length > 0);
});
