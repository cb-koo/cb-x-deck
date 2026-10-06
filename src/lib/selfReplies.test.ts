// 인플 본인 댓글 고르기·작업 본 게시물 고르기 — 순수 함수(스펙 2026-10-06-self-replies-design.md §3·§5·§6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickSelfReplies, mainAuthorIdOf, pickTaskMainPost, firstLinkOf, gapLabel,
} from './selfReplies.ts';

// 10-06 실제 응답(get_tweet_thread 2107390523338313767)의 모양을 줄인 것
const AUTHOR = { userName: 'nasu_seikei', id: '766956932561182720' };
const MAIN = {
  id: '2107390523338313767', text: '日本も八重歯… https://t.co/K2bOdsXwvi', createdAt: 'Tue Oct 06 08:40:28 +0000 2026',
  isReply: false, inReplyToId: null, author: AUTHOR,
  viewCount: 1095, likeCount: 1, retweetCount: 0, replyCount: 1, bookmarkCount: 0, quoteCount: 0, media: [],
};
const REPLY = {
  id: '2107411769601962491', text: '今月東京で相談会…\n\n🦷https://pages.s.gy/thesquaredc_jp', createdAt: 'Tue Oct 06 10:04:54 +0000 2026',
  isReply: true, inReplyToId: '2107390523338313767', author: AUTHOR,
  viewCount: 47, likeCount: 1, retweetCount: 0, replyCount: 0, bookmarkCount: 0, quoteCount: 0, media: [],
};
const OTHER = { ...REPLY, id: '2107411769601962999', author: { userName: 'someone', id: '1' } };

test('pickSelfReplies — 같은 작성자 고유번호만·본 게시물 제외·이미 붙은 것 제외·지표 매핑', () => {
  const r = pickSelfReplies({ tweets: [MAIN, REPLY, OTHER], mainTweetId: MAIN.id, mainAuthorId: AUTHOR.id, trackedIds: new Set() });
  assert.equal(r.length, 1);
  assert.equal(r[0].tweetId, REPLY.id);
  assert.equal(r[0].authorUserId, AUTHOR.id);
  assert.equal(r[0].authorHandle, 'nasu_seikei');
  assert.equal(r[0].postedAt, '2026-10-06T10:04:54.000Z');
  assert.deepEqual(r[0].metrics, { views: 47, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 });
  assert.equal(r[0].raw, REPLY);   // 스냅샷 raw는 트윗 하나(스레드 응답 전체가 아니다 — 읽기가 raw->>'isReply'를 본다)

  assert.deepEqual(pickSelfReplies({ tweets: [MAIN, REPLY], mainTweetId: MAIN.id, mainAuthorId: AUTHOR.id, trackedIds: new Set([REPLY.id]) }), []);
  // 핸들이 같아도 고유번호가 다르면 남이다
  const imposter = { ...REPLY, id: '3', author: { userName: 'nasu_seikei', id: '999' } };
  assert.deepEqual(pickSelfReplies({ tweets: [MAIN, imposter], mainTweetId: MAIN.id, mainAuthorId: AUTHOR.id, trackedIds: new Set() }), []);
  // 작성자 번호를 모르면 아무것도 붙이지 않는다
  assert.deepEqual(pickSelfReplies({ tweets: [MAIN, REPLY], mainTweetId: MAIN.id, mainAuthorId: null, trackedIds: new Set() }), []);
  // id 없는 기형 트윗은 건너뛴다
  assert.deepEqual(pickSelfReplies({ tweets: [{ author: AUTHOR }], mainTweetId: MAIN.id, mainAuthorId: AUTHOR.id, trackedIds: new Set() }), []);
});

test('pickSelfReplies — 게시 순으로', () => {
  const late = { ...REPLY, id: '5', createdAt: 'Tue Oct 06 12:00:00 +0000 2026' };
  const r = pickSelfReplies({ tweets: [MAIN, late, REPLY], mainTweetId: MAIN.id, mainAuthorId: AUTHOR.id, trackedIds: new Set() });
  assert.deepEqual(r.map((p) => p.tweetId), [REPLY.id, '5']);
});

test('mainAuthorIdOf — 스레드에서 본 게시물의 작성자 고유번호, 없으면 null', () => {
  assert.equal(mainAuthorIdOf([MAIN, REPLY], MAIN.id), AUTHOR.id);
  assert.equal(mainAuthorIdOf([REPLY], MAIN.id), null);
  assert.equal(mainAuthorIdOf([{ id: MAIN.id, author: { id: '' } }], MAIN.id), null);
});

const P = (tweetId: string, postedAt: string | null, isReply: boolean | null) => ({ tweetId, postedAt, isReply });

test('pickTaskMainPost — 게시물 링크(post_url)가 가리키는 트윗 하나', () => {
  const posts = [P('100', '2026-10-06T08:00:00Z', false), P('200', '2026-10-06T09:00:00Z', true)];
  assert.equal(pickTaskMainPost('https://x.com/a/status/200', posts)?.tweetId, '200');
  assert.equal(pickTaskMainPost('https://x.com/a/status/100?s=20', posts)?.tweetId, '100');
});

test('pickTaskMainPost — 링크 없음·트래킹에 없음이면 가장 이른 본 게시물(isReply=false 우선)', () => {
  const posts = [P('200', '2026-10-06T07:00:00Z', true), P('100', '2026-10-06T08:00:00Z', false), P('300', '2026-10-06T06:00:00Z', null)];
  assert.equal(pickTaskMainPost(null, posts)?.tweetId, '100');
  assert.equal(pickTaskMainPost('https://x.com/a/status/999', posts)?.tweetId, '100');
  assert.equal(pickTaskMainPost('엉뚱한 값', posts)?.tweetId, '100');
  // isReply=false가 없으면 가장 이른 것, 시각 없음은 맨 뒤·같으면 들어온 순서
  assert.equal(pickTaskMainPost(null, [P('2', null, null), P('1', '2026-10-06T08:00:00Z', null)])?.tweetId, '1');
  assert.equal(pickTaskMainPost(null, [P('a', null, null), P('b', null, null)])?.tweetId, 'a');
  assert.equal(pickTaskMainPost('https://x.com/a/status/1', []), null);
});

test('firstLinkOf — URL 엔티티 먼저, 없으면 본문의 링크(t.co는 사진·인용 링크라 뺀다)', () => {
  assert.equal(firstLinkOf(REPLY.text, undefined), 'https://pages.s.gy/thesquaredc_jp');
  assert.equal(firstLinkOf(MAIN.text, null), null);
  assert.equal(firstLinkOf('보세요 https://t.co/x', [{ url: 'https://t.co/x', expanded_url: 'https://pages.s.gy/a' }]), 'https://pages.s.gy/a');
  assert.equal(firstLinkOf('링크 http://example.com/a). 끝', []), 'http://example.com/a');
  assert.equal(firstLinkOf('', []), null);
  assert.equal(firstLinkOf('', [{ expanded_url: 'javascript:alert(1)' }]), null);   // 화면 href — http(s)만
});

test('gapLabel — 본 게시물 뒤 걸린 시간', () => {
  assert.equal(gapLabel('2026-10-06T08:40:28Z', '2026-10-06T10:04:54Z'), '1시간 24분');
  assert.equal(gapLabel('2026-10-06T08:00:00Z', '2026-10-06T08:35:10Z'), '35분');
  assert.equal(gapLabel('2026-10-06T08:00:00Z', '2026-10-06T10:00:30Z'), '2시간');
  assert.equal(gapLabel('2026-10-06T08:00:00Z', '2026-10-06T08:00:20Z'), '1분 안');
  assert.equal(gapLabel('2026-10-05T08:00:00Z', '2026-10-06T11:00:00Z'), '1일 3시간');
  assert.equal(gapLabel(null, '2026-10-06T08:00:00Z'), null);
  assert.equal(gapLabel('2026-10-06T09:00:00Z', '2026-10-06T08:00:00Z'), null);   // 거꾸로면 말하지 않는다
});
