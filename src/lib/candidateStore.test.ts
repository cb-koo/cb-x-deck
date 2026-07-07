import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets } from './tweetStore.ts';
import { saveCandidate, removeCandidateByTweetId, setMemo, addTag, removeTag, listCandidates, listAllTags } from './candidateStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-cd-' + process.pid + '-';
const TAG = P + 'タグ';

function tw(id: string): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: 'x', media: [], quoted: null,
    metrics: { views: 1, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from tag where name like ${P + '%'}`;
  await sql.end();
});

test('저장(멱등) → 메모 → 태그 자동생성 → 태그 필터 → 해제', async () => {
  await upsertTweets(sql, [tw('a'), tw('b')]);

  const c1 = await saveCandidate(sql, P + 'a');
  const again = await saveCandidate(sql, P + 'a');
  assert.equal(c1.id, again.id);            // 멱등
  await saveCandidate(sql, P + 'b');

  await setMemo(sql, c1.id, '반복 재현 포맷');
  const t = await addTag(sql, c1.id, TAG);
  const t2 = await addTag(sql, c1.id, TAG); // 같은 이름 재사용
  assert.equal(t.id, t2.id);

  const byTag = await listCandidates(sql, { tag: TAG });
  assert.ok(byTag.some((c) => c.id === c1.id));
  assert.ok(!byTag.some((c) => c.tweet.tweetId === P + 'b'));
  const found = byTag.find((c) => c.id === c1.id)!;
  assert.equal(found.memo, '반복 재현 포맷');
  assert.deepEqual(found.tags.map((x) => x.name), [TAG]);

  const tags = await listAllTags(sql);
  assert.ok(tags.some((x) => x.name === TAG && x.count === 1));

  await removeTag(sql, c1.id, t.id);
  await removeCandidateByTweetId(sql, P + 'a');
  const remain = await listCandidates(sql);
  assert.ok(!remain.some((c) => c.tweet.tweetId === P + 'a'));
});
